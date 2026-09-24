"""Provider configuration and image generation without live model/API calls."""

import base64
import io
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image as PilImage

from scripts.iib import image_ai
from scripts.iib.db.datamodel import DataBase, GlobalSetting


class ImageAITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.old_db_path = DataBase.path
        DataBase.path = str(Path(self.temp.name) / "test.db")
        self.addCleanup(setattr, DataBase, "path", self.old_db_path)
        # TestClient runs sync endpoints on worker threads. Give this test its
        # own thread-local connections and close every one before Windows removes
        # the temporary database file.
        old_local = DataBase.local
        DataBase.local = threading.local()
        self.addCleanup(setattr, DataBase, "local", old_local)
        connections = []

        def connect_for_test(path):
            conn = sqlite3.connect(path, check_same_thread=False)
            connections.append(conn)
            return conn

        def close_connections():
            for conn in connections:
                conn.close()

        self.addCleanup(close_connections)
        connect_patch = patch("scripts.iib.db.datamodel.connect", side_effect=connect_for_test)
        connect_patch.start()
        self.addCleanup(connect_patch.stop)
        self.path = Path(self.temp.name) / "reference.png"
        PilImage.new("RGB", (8, 8), "blue").save(self.path)
        app = FastAPI()
        image_ai.mount_image_ai_routes(
            app, "/db", lambda: None, lambda: None,
            lambda path: Path(path).is_relative_to(Path(self.temp.name)),
        )
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def config(self, provider="local", **updates):
        config = self.client.get("/db/image-ai/config").json()
        request = {"provider": provider, "openrouter_model": config["openrouter_model"],
                   "prompts": config["prompts"], **updates}
        return self.client.put("/db/image-ai/config", json=request)

    def test_secret_is_separate_and_never_echoed(self):
        response = self.config("openrouter", api_key="test-private-key")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["api_key_configured"])
        self.assertEqual(response.json()["api_key_source"], "saved")
        self.assertNotIn("test-private-key", response.text)
        self.assertNotIn("test-private-key", str(GlobalSetting.get_all_settings(DataBase.get_conn())))
        self.assertEqual(image_ai.openrouter_key()[0], "test-private-key")
        cleared = self.config("openrouter", clear_api_key=True)
        self.assertEqual(cleared.status_code, 200, cleared.text)
        self.assertFalse(cleared.json()["api_key_configured"])

    def test_openrouter_sends_system_prompt_and_local_image(self):
        response = self.config("openrouter", api_key="test-private-key", prompts={
            "description": "请用中文写最多{max_chars}字", "prompt": "English {max_chars}",
            "tags": "仅从{allowed_tags}选标签",
        })
        self.assertEqual(response.status_code, 200, response.text)
        completion = Mock(status_code=200)
        completion.json.return_value = {"choices": [{"message": {"content": "蓝色方块"}}]}
        with patch.object(image_ai.requests, "post", return_value=completion) as post:
            result = self.client.post("/db/image-ai/generate", json={
                "path": str(self.path), "task": "description", "max_chars": 40,
            })
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["text"], "蓝色方块")
        args, kwargs = post.call_args
        self.assertEqual(args[0], image_ai.OPENROUTER_URL)
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer test-private-key")
        self.assertEqual(kwargs["json"]["model"], image_ai.DEFAULT_MODEL)
        messages = kwargs["json"]["messages"]
        self.assertEqual(messages[0], {"role": "system", "content": "请用中文写最多40字"})
        self.assertTrue(messages[1]["content"][1]["image_url"]["url"].startswith("data:image/jpeg;base64,"))

    def test_local_uses_saved_system_prompt_and_restricts_tags(self):
        self.config(prompts={"description": "中文 {max_chars}", "prompt": "English {max_chars}",
                             "tags": "只选 {allowed_tags}"})
        with patch.object(image_ai, "readiness", return_value=("ready", "")), \
             patch.object(image_ai._runtime, "generate", return_value='["喜欢", "未知"]') as generate:
            response = self.client.post("/db/image-ai/generate", json={
                "path": str(self.path), "task": "tags", "allowed_tags": ["喜欢"],
            })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["tags"], ["喜欢"])
        self.assertIn("喜欢", generate.call_args.args[1])
        self.assertTrue(generate.call_args.kwargs["system"])

    def test_missing_key_and_untrusted_path(self):
        self.config("openrouter", clear_api_key=True)
        with patch.dict(image_ai.os.environ, {"OPENROUTER_API_KEY": ""}):
            missing = self.client.post("/db/image-ai/generate", json={
                "path": str(self.path), "task": "description",
            })
        self.assertEqual(missing.status_code, 503)
        denied = self.client.post("/db/image-ai/generate", json={
            "path": str(Path(self.temp.name).parent / "outside.png"), "task": "description",
        })
        self.assertEqual(denied.status_code, 403)
        invalid = self.config("openrouter", openrouter_model="bad model name")
        self.assertEqual(invalid.status_code, 400)

    def test_local_gguf_sends_image_only_to_loopback_vision_service(self):
        saved = self.config("local_gguf", gguf_base_url="http://localhost:8080",
                            gguf_model="Qwen3-VL-2B-Instruct")
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()["gguf_base_url"], "http://localhost:8080/v1")
        completion = Mock(status_code=200)
        completion.json.return_value = {"choices": [{"message": {"content": "蓝色方块"}}]}
        with patch.object(image_ai.requests, "post", return_value=completion) as post:
            result = self.client.post("/db/image-ai/generate", json={
                "path": str(self.path), "task": "description", "max_chars": 40,
            })
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["text"], "蓝色方块")
        args, kwargs = post.call_args
        self.assertEqual(args[0], "http://localhost:8080/v1/chat/completions")
        self.assertNotIn("headers", kwargs)
        self.assertEqual(kwargs["json"]["model"], "Qwen3-VL-2B-Instruct")
        self.assertTrue(kwargs["json"]["messages"][1]["content"][1]["image_url"]["url"].startswith("data:image/jpeg;base64,"))

        status = Mock(status_code=200)
        status.json.return_value = {"data": [{"id": "Qwen3-VL-2B-Instruct"}]}
        with patch.object(image_ai.requests, "get", return_value=status):
            checked = self.client.get("/db/image-ai/gguf/status")
        self.assertEqual(checked.json(), {"ready": True, "models": ["Qwen3-VL-2B-Instruct"]})
        with patch.object(image_ai.requests, "post", side_effect=image_ai.requests.ConnectionError):
            unavailable = self.client.post("/db/image-ai/generate", json={
                "path": str(self.path), "task": "description", "max_chars": 40,
            })
        self.assertEqual(unavailable.status_code, 503)
        self.assertIn("GGUF", unavailable.json()["detail"])

    def test_gguf_rejects_nonlocal_or_malformed_endpoints(self):
        for url in ("https://example.com/v1", "http://192.168.1.5:8080/v1",
                    "http://127.0.0.1:8080/v1/../../secret", "http://localhost:bad/v1",
                    "http://localhost:0/v1"):
            with self.subTest(url=url):
                self.assertEqual(self.config("local_gguf", gguf_base_url=url).status_code, 400)

    def test_comfy_cloud_key_is_separate_and_not_echoed(self):
        saved = self.config("comfy_cloud", comfy_api_key="comfy-private-key")
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertTrue(saved.json()["comfy_api_key_configured"])
        self.assertEqual(saved.json()["comfy_api_key_source"], "saved")
        self.assertNotIn("comfy-private-key", saved.text)
        self.assertNotIn("comfy-private-key", str(GlobalSetting.get_all_settings(DataBase.get_conn())))
        self.assertEqual(image_ai.comfy_cloud_key()[0], "comfy-private-key")
        cleared = self.config("comfy_cloud", clear_comfy_api_key=True)
        self.assertEqual(cleared.status_code, 200, cleared.text)
        self.assertFalse(cleared.json()["comfy_api_key_configured"])

    def test_comfy_cloud_sends_scaled_image_and_parses_text(self):
        saved = self.config("comfy_cloud", comfy_api_key="comfy-private-key",
                            comfy_model="vertexai/gemini-3.1-flash-lite")
        self.assertEqual(saved.status_code, 200, saved.text)
        completion = Mock(status_code=200)
        completion.json.return_value = {"candidates": [{"content": {"parts": [
            {"text": "reasoning", "thought": True}, {"text": "蓝色方块"},
        ]}}]}
        with patch.object(image_ai.requests, "post", return_value=completion) as post:
            result = self.client.post("/db/image-ai/generate", json={
                "path": str(self.path), "task": "description", "max_chars": 40,
            })
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["text"], "蓝色方块")
        args, kwargs = post.call_args
        self.assertEqual(args[0], image_ai.COMFY_ROUTER_URL + "/vertexai/gemini-3.1-flash-lite")
        self.assertEqual(kwargs["headers"]["X-API-Key"], "comfy-private-key")
        self.assertIn("Idempotency-Key", kwargs["headers"])
        payload = kwargs["json"]
        self.assertIn("40", payload["systemInstruction"]["parts"][0]["text"])
        image_part = payload["contents"][0]["parts"][1]["inlineData"]
        self.assertEqual(image_part["mimeType"], "image/jpeg")
        self.assertTrue(image_part["data"].startswith("/9j/"))

        status = Mock(status_code=200)
        with patch.object(image_ai.requests, "get", return_value=status) as get:
            checked = self.client.get("/db/image-ai/comfy/status")
        self.assertTrue(checked.json()["ready"])
        self.assertEqual(get.call_args.args[0], image_ai.COMFY_CLOUD_USER_URL)
        self.assertEqual(get.call_args.kwargs["headers"]["X-API-Key"], "comfy-private-key")

    def test_comfy_cloud_missing_key_and_error_responses(self):
        with patch.dict(image_ai.os.environ, {"COMFY_API_KEY": ""}):
            self.config("comfy_cloud", clear_comfy_api_key=True)
            missing = self.client.post("/db/image-ai/generate", json={
                "path": str(self.path), "task": "description",
            })
            self.assertEqual(missing.status_code, 503)
            self.assertFalse(self.client.get("/db/image-ai/comfy/status").json()["ready"])
        self.config("comfy_cloud", comfy_api_key="comfy-private-key")
        denied = Mock(status_code=402, text="secret upstream detail")
        with patch.object(image_ai.requests, "post", return_value=denied):
            response = self.client.post("/db/image-ai/generate", json={
                "path": str(self.path), "task": "description",
            })
        self.assertEqual(response.status_code, 502)
        self.assertIn("额度不足", response.json()["detail"])
        self.assertNotIn("secret upstream detail", response.text)
        self.assertEqual(self.config("comfy_cloud", comfy_model="some/unknown-model").status_code, 400)

    def test_comfy_workflow_upload_submit_poll_and_text(self):
        graph = {
            "1": {"class_type": "LoadImage", "inputs": {"image": "placeholder.png"}},
            "2": {"class_type": "Vision", "inputs": {"image": ["1", 0], "prompt": "old"}},
            "3": {"class_type": "TextOutput", "inputs": {"text": ["2", 0]}},
        }
        mapping = {"comfy_mode": "workflow", "comfy_workflow": graph,
                   "comfy_workflow_name": "vision_api.json",
                   "comfy_image_node_id": "1", "comfy_image_input": "image",
                   "comfy_prompt_node_id": "2", "comfy_prompt_input": "prompt",
                   "comfy_output_node_id": "3"}
        self.assertEqual(self.config("comfy_cloud", comfy_api_key="secret", **mapping).status_code, 200)
        uploaded = Mock(status_code=200)
        uploaded.json.return_value = {"name": "uploaded.jpg"}
        submitted = Mock(status_code=200)
        submitted.json.return_value = {"prompt_id": "550e8400-e29b-41d4-a716-446655440000"}
        completed = Mock(status_code=200)
        completed.json.return_value = {"status": "completed", "outputs": {"3": {"text": ["蓝色方块"]}}}
        with patch.object(image_ai.requests, "post", side_effect=[uploaded, submitted]) as post, \
             patch.object(image_ai.requests, "get", return_value=completed) as get:
            result = self.client.post("/db/image-ai/generate", json={
                "path": str(self.path), "task": "description", "max_chars": 40,
            })
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["text"], "蓝色方块")
        self.assertEqual(post.call_args_list[0].args[0], image_ai.COMFY_CLOUD_API_URL + "/upload/image")
        submitted_graph = post.call_args_list[1].kwargs["json"]["prompt"]
        self.assertEqual(submitted_graph["1"]["inputs"]["image"], "uploaded.jpg")
        self.assertIn("40", submitted_graph["2"]["inputs"]["prompt"])
        self.assertEqual(graph["1"]["inputs"]["image"], "placeholder.png")
        self.assertEqual(get.call_args.args[0], image_ai.COMFY_CLOUD_API_URL + "/jobs/550e8400-e29b-41d4-a716-446655440000")
        self.assertNotIn("secret", str(self.client.get("/db/image-ai/config").json()))

    def test_comfy_workflow_requires_api_graph_and_mapped_nodes(self):
        invalid = self.config("comfy_cloud", comfy_mode="workflow",
                              comfy_workflow={"nodes": [], "links": []})
        self.assertEqual(invalid.status_code, 400)
        self.assertIn("API 格式", invalid.text)
        graph = {"1": {"class_type": "LoadImage", "inputs": {"image": "a.png"}}}
        missing = self.config("comfy_cloud", comfy_mode="workflow", comfy_workflow=graph,
                              comfy_image_node_id="1", comfy_image_input="image",
                              comfy_prompt_node_id="1", comfy_prompt_input="prompt",
                              comfy_output_node_id="1")
        self.assertEqual(missing.status_code, 400)

    def test_comfy_workflow_reads_text_file_without_forwarding_key_to_redirect(self):
        redirect = Mock(status_code=302, headers={"Location": "https://assets.example.com/result.txt"})
        downloaded = Mock(status_code=200)
        downloaded.iter_content.return_value = [b"hello"]
        with patch.object(image_ai.requests, "get", side_effect=[redirect, downloaded]) as get:
            result = image_ai._comfy_cloud_download_text({"filename": "result.txt", "type": "output"}, "secret")
        self.assertEqual(result, "hello")
        self.assertEqual(get.call_args_list[0].kwargs["headers"]["X-API-Key"], "secret")
        self.assertNotIn("headers", get.call_args_list[1].kwargs)

    def test_studio_edit_uploads_composite_and_mask_then_reads_image_output(self):
        self.config("comfy_cloud", comfy_api_key="secret")
        graph = {
            "1": {"class_type": "LoadImage", "inputs": {"image": "old.png"}},
            "2": {"class_type": "LoadImageMask", "inputs": {"image": "old-mask.png"}},
            "3": {"class_type": "Prompt", "inputs": {"text": "old"}},
            "4": {"class_type": "SaveImage", "inputs": {"images": ["1", 0]}},
        }
        source = self.path.read_bytes()
        mask = io.BytesIO()
        PilImage.new("RGB", (8, 8), "black").save(mask, format="PNG")
        payload = {
            "image_base64": base64.b64encode(source).decode(),
            "mask_base64": base64.b64encode(mask.getvalue()).decode(),
            "prompt": "make the white area blue", "workflow": graph,
            "image_node_id": "1", "image_input": "image",
            "mask_node_id": "2", "mask_input": "image",
            "prompt_node_id": "3", "prompt_input": "text", "output_node_id": "4",
        }
        uploads = [Mock(status_code=200), Mock(status_code=200)]
        uploads[0].json.return_value = {"name": "source.png"}
        uploads[1].json.return_value = {"name": "mask.png"}
        submitted = Mock(status_code=200)
        submitted.json.return_value = {"prompt_id": "550e8400-e29b-41d4-a716-446655440000"}
        completed = Mock(status_code=200)
        completed.json.return_value = {"status": "completed", "outputs": {"4": {
            "images": [{"filename": "result.png", "type": "output"}]}}}
        image = Mock(status_code=200)
        image.iter_content.return_value = [source]
        with patch.object(image_ai.requests, "post", side_effect=[*uploads, submitted]) as post, \
             patch.object(image_ai.requests, "get", side_effect=[completed, image]) as get:
            result = self.client.post("/db/image-ai/studio-edit", json=payload)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(base64.b64decode(result.json()["image_base64"]), source)
        self.assertEqual(result.json()["media_type"], "image/png")
        self.assertEqual([call.args[0] for call in post.call_args_list[:2]],
                         [image_ai.COMFY_CLOUD_API_URL + "/upload/image"] * 2)
        sent = post.call_args_list[2].kwargs["json"]["prompt"]
        self.assertEqual(sent["1"]["inputs"]["image"], "source.png")
        self.assertEqual(sent["2"]["inputs"]["image"], "mask.png")
        self.assertEqual(sent["3"]["inputs"]["text"], payload["prompt"])
        self.assertEqual(graph["1"]["inputs"]["image"], "old.png")
        self.assertEqual(get.call_args_list[1].args[0], image_ai.COMFY_CLOUD_API_URL + "/view")

        bad_size = io.BytesIO()
        PilImage.new("RGB", (4, 4), "black").save(bad_size, format="PNG")
        payload["mask_base64"] = base64.b64encode(bad_size.getvalue()).decode()
        with patch.object(image_ai.requests, "post") as post:
            invalid = self.client.post("/db/image-ai/studio-edit", json=payload)
        self.assertEqual(invalid.status_code, 400)
        self.assertIn("尺寸", invalid.text)
        post.assert_not_called()

        payload["mask_base64"] = base64.b64encode(mask.getvalue()).decode()
        payload["mask_node_id"] = payload["image_node_id"]
        with patch.object(image_ai.requests, "post") as post:
            collision = self.client.post("/db/image-ai/studio-edit", json=payload)
        self.assertEqual(collision.status_code, 400)
        self.assertIn("同一个", collision.text)
        post.assert_not_called()

    def test_creation_config_uses_same_secret_without_changing_content_provider(self):
        self.config("local")
        saved = self.client.put("/db/image-ai/creation/config", json={
            "mode": "router", "model": "vertexai/gemini-3.1-flash-image",
            "comfy_api_key": "shared-private-key",
        })
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertNotIn("shared-private-key", saved.text)
        self.assertEqual(self.client.get("/db/image-ai/config").json()["provider"], "local")
        self.assertTrue(self.client.get("/db/image-ai/config").json()["comfy_api_key_configured"])
        self.assertEqual(image_ai.comfy_cloud_key()[0], "shared-private-key")
        invalid = self.client.put("/db/image-ai/creation/config", json={"mode": "router", "model": "other/model"})
        self.assertEqual(invalid.status_code, 400)

    def test_router_catalog_paginates_and_filters_supported_models(self):
        self.client.put("/db/image-ai/creation/config", json={
            "mode": "router", "model": image_ai.DEFAULT_CREATION_MODEL, "comfy_api_key": "secret"})
        first = Mock(status_code=200)
        first.json.return_value = {"data": [{"id": "vertexai/gemini-3.8-flash"}, {"id": "other/model"}],
                                   "has_more": True, "next_cursor": "next"}
        second = Mock(status_code=200)
        second.json.return_value = {"data": [{"id": "vertexai/gemini-3.1-flash-image"}],
                                    "has_more": False, "next_cursor": None}
        with patch.object(image_ai.requests, "get", side_effect=[first, second]) as get:
            response = self.client.get("/db/image-ai/comfy/models")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([item["id"] for item in response.json()["vision"]], ["vertexai/gemini-3.8-flash"])
        self.assertEqual([item["id"] for item in response.json()["creation"]],
                         ["vertexai/gemini-3.1-flash-image"])
        self.assertEqual(get.call_args_list[1].kwargs["params"]["cursor"], "next")

    def test_router_studio_edit_sends_composite_and_reads_image_after_text(self):
        self.client.put("/db/image-ai/creation/config", json={
            "mode": "router", "model": image_ai.DEFAULT_CREATION_MODEL, "comfy_api_key": "secret"})
        source = self.path.read_bytes()
        result = Mock(status_code=200, headers={"X-Comfy-Request-Id": "request-1"})
        result.json.return_value = {"candidates": [{"content": {"parts": [
            {"text": "Here is your image"},
            {"inlineData": {"mimeType": "image/png", "data": base64.b64encode(source).decode()}},
        ]}}]}
        with patch.object(image_ai.requests, "post", return_value=result) as post:
            response = self.client.post("/db/image-ai/studio-router-edit", json={
                "image_base64": base64.b64encode(source).decode(), "prompt": "Change to green"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(base64.b64decode(response.json()["image_base64"]), source)
        self.assertEqual(post.call_args.args[0], image_ai.COMFY_ROUTER_URL + "/" + image_ai.DEFAULT_CREATION_MODEL)
        self.assertEqual(post.call_args.kwargs["headers"]["X-API-Key"], "secret")
        self.assertIn("Idempotency-Key", post.call_args.kwargs["headers"])
        parts = post.call_args.kwargs["json"]["contents"][0]["parts"]
        self.assertEqual(parts[0]["text"], "Change to green")
        self.assertEqual(parts[1]["inlineData"]["mimeType"], "image/png")
        self.client.put("/db/image-ai/creation/config", json={"mode": "workflow", "model": image_ai.DEFAULT_CREATION_MODEL})
        with patch.object(image_ai.requests, "post") as post:
            denied = self.client.post("/db/image-ai/studio-router-edit", json={
                "image_base64": base64.b64encode(source).decode(), "prompt": "Change to green"})
        self.assertEqual(denied.status_code, 400)
        post.assert_not_called()

if __name__ == "__main__":
    unittest.main()
