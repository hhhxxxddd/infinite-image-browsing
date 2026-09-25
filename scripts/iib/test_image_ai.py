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

from scripts.iib import image_ai, network_proxy
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
        network_proxy.mount_network_proxy_routes(app, "/db", lambda: None, lambda: None)
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

    def test_shared_proxy_settings_validate_and_route_comfy_requests(self):
        self.assertEqual(self.client.get("/db/network-proxy").json(), {"enabled": False, "url": ""})
        self.assertEqual(self.client.put("/db/network-proxy", json={"enabled": True, "url": ""}).status_code, 400)
        self.assertEqual(self.client.put("/db/network-proxy", json={"enabled": True,
                         "url": "http://user:secret@127.0.0.1:7890"}).status_code, 400)
        saved = self.client.put("/db/network-proxy", json={"enabled": True,
                                "url": "http://127.0.0.1:7890"})
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(self.client.get("/db/network-proxy").json(), saved.json())
        response = Mock(status_code=200)
        response.json.return_value = {"data": [], "has_more": False}
        with patch.object(image_ai.requests, "get", return_value=response) as get:
            image_ai.comfy_router_models("test-key")
        self.assertEqual(get.call_args.kwargs["proxies"], {
            "http": "http://127.0.0.1:7890", "https": "http://127.0.0.1:7890"})
        self.client.put("/db/network-proxy", json={"enabled": False, "url": "http://127.0.0.1:7890"})
        with patch.object(image_ai.requests, "get", return_value=response) as get:
            image_ai.comfy_router_models("test-key")
        self.assertEqual(get.call_args.kwargs["proxies"], {
            "http": None, "https": None, "all": None})
        with patch.dict(network_proxy.os.environ, {"HTTP_PROXY": "http://old:8080",
                                                   "HTTPS_PROXY": "http://old:8080"}):
            env = network_proxy.download_environment()
        self.assertNotIn("HTTP_PROXY", env)
        self.assertNotIn("HTTPS_PROXY", env)
        with patch.dict(network_proxy.os.environ, {"HTTPS_PROXY": "http://old:8080"}):
            with network_proxy.bundled_download_environment():
                self.assertNotIn("HTTPS_PROXY", network_proxy.os.environ)
            self.assertEqual(network_proxy.os.environ["HTTPS_PROXY"], "http://old:8080")

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
            "2": {"class_type": "LoadImageMask", "inputs": {"image": "old-mask.png", "channel": "red"}},
            "3": {"class_type": "Prompt", "inputs": {"text": "old"}},
            "4": {"class_type": "SaveImage", "inputs": {"images": ["1", 0]}},
            "6": {"class_type": "Prompt", "inputs": {"text": "old-negative"}},
        }
        source = self.path.read_bytes()
        mask = io.BytesIO()
        PilImage.new("RGB", (8, 8), "black").save(mask, format="PNG")
        payload = {
            "image_base64": base64.b64encode(source).decode(),
            "mask_base64": base64.b64encode(mask.getvalue()).decode(),
            "prompt": "make the white area blue", "negative_prompt": "no red", "workflow": graph,
            "image_node_id": "1", "image_input": "image",
            "mask_node_id": "2", "mask_input": "image",
            "prompt_node_id": "3", "prompt_input": "text", "output_node_id": "4",
            "negative_prompt_node_id": "6", "negative_prompt_input": "text",
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
        self.assertEqual(sent["6"]["inputs"]["text"], payload["negative_prompt"])
        self.assertEqual(graph["1"]["inputs"]["image"], "old.png")
        self.assertEqual(get.call_args_list[1].args[0], image_ai.COMFY_CLOUD_API_URL + "/view")

        graph["2"]["inputs"]["channel"] = "alpha"
        painted = PilImage.new("RGB", (8, 8), "black")
        painted.putpixel((0, 0), (255, 255, 255))
        alpha_mask = io.BytesIO()
        painted.save(alpha_mask, format="PNG")
        alpha_payload = {**payload, "workflow": graph, "mask_base64": base64.b64encode(alpha_mask.getvalue()).decode()}
        with patch.object(image_ai.requests, "post", side_effect=[*uploads, submitted]) as post, \
             patch.object(image_ai.requests, "get", side_effect=[completed, image]):
            alpha_result = self.client.post("/db/image-ai/studio-edit", json=alpha_payload)
        self.assertEqual(alpha_result.status_code, 200, alpha_result.text)
        with PilImage.open(io.BytesIO(post.call_args_list[1].kwargs["files"]["image"][1])) as sent_mask:
            self.assertEqual(sent_mask.getchannel("A").getpixel((0, 0)), 0)
            self.assertEqual(sent_mask.getchannel("A").getpixel((1, 0)), 255)
        graph["2"]["inputs"]["channel"] = "red"

        graph["5"] = {"class_type": "LoadImage", "inputs": {"image": "old-reference.png"}}
        reference_payload = {**payload, "workflow": graph, "reference_images": [{
            "image_base64": base64.b64encode(source).decode(), "node_id": "5", "input": "image"}]}
        reference_upload = Mock(status_code=200)
        reference_upload.json.return_value = {"name": "reference.png"}
        with patch.object(image_ai.requests, "post", side_effect=[*uploads, reference_upload, submitted]) as post, \
             patch.object(image_ai.requests, "get", side_effect=[completed, image]):
            with_reference = self.client.post("/db/image-ai/studio-edit", json=reference_payload)
        self.assertEqual(with_reference.status_code, 200, with_reference.text)
        self.assertEqual(post.call_args_list[3].kwargs["json"]["prompt"]["5"]["inputs"]["image"], "reference.png")
        self.assertEqual(graph["5"]["inputs"]["image"], "old-reference.png")
        reference_payload["reference_images"][0]["node_id"] = "1"
        with patch.object(image_ai.requests, "post") as post:
            collision = self.client.post("/db/image-ai/studio-edit", json=reference_payload)
        self.assertEqual(collision.status_code, 400)
        post.assert_not_called()

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

    def test_studio_workflows_are_global_and_edit_uses_saved_mapping(self):
        self.config("comfy_cloud", comfy_api_key="secret")
        graph = {
            "1": {"class_type": "LoadImage", "inputs": {"image": "source.png"}},
            "2": {"class_type": "LoadImage", "inputs": {"image": "reference.png"}},
            "3": {"class_type": "Prompt", "inputs": {"text": "old"}},
            "4": {"class_type": "SaveImage", "inputs": {"images": ["1", 0]}},
            "5": {"class_type": "Prompt", "inputs": {"text": "old-negative"}},
        }
        preset = {"name": "换装", "workflow": graph, "image_node_id": "1", "image_input": "image",
                  "mask_node_id": "", "mask_input": "", "prompt_node_id": "3", "prompt_input": "text",
                  "negative_prompt_node_id": "5", "negative_prompt_input": "text",
                  "output_node_id": "4", "reference_slots": [{"node_id": "2", "input": "image"}]}
        saved = self.client.post("/db/image-ai/studio/workflows", json=preset)
        self.assertEqual(saved.status_code, 200, saved.text)
        workflow_id = saved.json()["id"]
        listing = self.client.get("/db/image-ai/studio/workflows").json()
        self.assertEqual([item["id"] for item in listing], [workflow_id])
        self.assertEqual(listing[0]["purpose"], "image_edit")
        self.assertNotIn("workflow", listing[0])
        self.assertEqual(listing[0]["negative_prompt_node_id"], "5")
        self.assertEqual(self.client.get(f"/db/image-ai/studio/workflows/{workflow_id}").json()["workflow"], graph)

        with patch.object(image_ai, "_comfy_cloud_studio_edit", return_value={"job_id": "done"}) as run:
            result = self.client.post("/db/image-ai/studio/workflow-edit", json={
                "workflow_id": workflow_id, "image_base64": "main", "prompt": "blue coat",
                "negative_prompt": "no red",
                "reference_images_base64": ["reference"],
            })
        self.assertEqual(result.status_code, 200, result.text)
        request = run.call_args.args[0]
        self.assertEqual(request.workflow, graph)
        self.assertEqual(request.image_node_id, "1")
        self.assertEqual(request.negative_prompt_node_id, "5")
        self.assertEqual(request.negative_prompt, "no red")
        self.assertEqual(request.reference_images[0].node_id, "2")
        self.assertEqual(run.call_args.args[1], "secret")

        too_many = self.client.post("/db/image-ai/studio/workflow-edit", json={
            "workflow_id": workflow_id, "image_base64": "main", "prompt": "blue coat",
            "reference_images_base64": ["a", "b"],
        })
        self.assertEqual(too_many.status_code, 400)
        with patch.object(image_ai, "_comfy_cloud_studio_edit", return_value={"job_id": "done"}) as run:
            without_reference = self.client.post("/db/image-ai/studio/workflow-edit", json={
                "workflow_id": workflow_id, "image_base64": "main", "prompt": "blue coat",
                "reference_images_base64": [],
            })
        self.assertEqual(without_reference.status_code, 200, without_reference.text)
        self.assertNotIn("2", run.call_args.args[0].workflow)
        self.assertEqual(run.call_args.args[0].reference_images, [])
        collision = self.client.post("/db/image-ai/studio/workflows", json={
            **preset, "reference_slots": [{"node_id": "1", "input": "image"}],
        })
        self.assertEqual(collision.status_code, 400)
        same_prompt_field = self.client.post("/db/image-ai/studio/workflows", json={
            **preset, "negative_prompt_node_id": "3", "negative_prompt_input": "text",
        })
        self.assertEqual(same_prompt_field.status_code, 400)
        linked_negative = self.client.post("/db/image-ai/studio/workflows", json={
            **preset, "workflow": {**graph, "5": {"class_type": "Prompt", "inputs": {"text": ["3", 0]}}},
        })
        self.assertEqual(linked_negative.status_code, 400)
        self.assertIn("文本输入", linked_negative.text)
        self.assertEqual(len(self.client.get("/db/image-ai/studio/workflows").json()), 1)

        updated = self.client.put(f"/db/image-ai/studio/workflows/{workflow_id}", json={**preset, "name": "蓝衣换装"})
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(self.client.get("/db/image-ai/studio/workflows").json()[0]["name"], "蓝衣换装")
        self.assertEqual(self.client.delete(f"/db/image-ai/studio/workflows/{workflow_id}").status_code, 200)
        self.assertEqual(self.client.get("/db/image-ai/studio/workflows").json(), [])

    def test_studio_workflow_purpose_defaults_to_edit_and_other_purposes_can_be_saved(self):
        self.config("comfy_cloud", comfy_api_key="secret")
        graph = {"1": {"class_type": "SaveAudio", "inputs": {"filename_prefix": "audio"}}}
        saved = self.client.post("/db/image-ai/studio/workflows", json={
            "name": "声音创作", "purpose": "audio_creation", "workflow": graph,
        })
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()["purpose"], "audio_creation")
        listing = self.client.get("/db/image-ai/studio/workflows").json()
        self.assertEqual(listing[0]["purpose"], "audio_creation")
        edit = self.client.post("/db/image-ai/studio/workflow-edit", json={
            "workflow_id": saved.json()["id"], "image_base64": "source", "prompt": "prompt",
        })
        self.assertEqual(edit.status_code, 400)
        self.assertIn("图片编辑工作流", edit.text)
        invalid = self.client.post("/db/image-ai/studio/workflows", json={
            "name": "未知用途", "purpose": "unknown", "workflow": graph,
        })
        self.assertEqual(invalid.status_code, 422)

    def test_studio_workflow_can_save_only_main_image_mapping(self):
        self.config("comfy_cloud", comfy_api_key="secret")
        graph = {
            "1": {"class_type": "LoadImage", "inputs": {"image": "source.png"}},
            "2": {"class_type": "Prompt", "inputs": {"text": "original prompt"}},
            "3": {"class_type": "SaveImage", "inputs": {"images": ["1", 0]}},
        }
        main_only = {"name": "仅主图", "workflow": graph, "image_node_id": "1", "image_input": "image"}
        saved = self.client.post("/db/image-ai/studio/workflows", json=main_only)
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()["prompt_node_id"], "")
        self.assertEqual(saved.json()["output_node_id"], "")
        self.assertEqual(saved.json()["reference_slots"], [])
        not_ready = self.client.post("/db/image-ai/studio/workflow-edit", json={
            "workflow_id": saved.json()["id"], "image_base64": "main",
        })
        self.assertEqual(not_ready.status_code, 400)
        self.assertIn("结果节点", not_ready.text)

        runnable = self.client.put(f"/db/image-ai/studio/workflows/{saved.json()['id']}", json={
            **main_only, "output_node_id": "3",
        })
        self.assertEqual(runnable.status_code, 200, runnable.text)
        with patch.object(image_ai, "_comfy_cloud_studio_edit", return_value={"job_id": "done"}) as run:
            response = self.client.post("/db/image-ai/studio/workflow-edit", json={
                "workflow_id": saved.json()["id"], "image_base64": "main",
            })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(run.call_args.args[0].prompt_node_id, "")
        self.assertEqual(run.call_args.args[0].prompt, "")

        source = self.path.read_bytes()
        upload = Mock(status_code=200)
        upload.json.return_value = {"name": "uploaded.png"}
        submitted = Mock(status_code=200)
        submitted.json.return_value = {"prompt_id": "550e8400-e29b-41d4-a716-446655440000"}
        completed = Mock(status_code=200)
        completed.json.return_value = {"status": "completed", "outputs": {
            "3": {"images": [{"filename": "result.png", "type": "output"}]}}}
        image = Mock(status_code=200)
        image.iter_content.return_value = [source]
        with patch.object(image_ai.requests, "post", side_effect=[upload, submitted]) as post, \
             patch.object(image_ai.requests, "get", side_effect=[completed, image]):
            actual = self.client.post("/db/image-ai/studio/workflow-edit", json={
                "workflow_id": saved.json()["id"], "image_base64": base64.b64encode(source).decode(),
            })
        self.assertEqual(actual.status_code, 200, actual.text)
        sent_graph = post.call_args_list[1].kwargs["json"]["prompt"]
        self.assertEqual(sent_graph["1"]["inputs"]["image"], "uploaded.png")
        self.assertEqual(sent_graph["2"]["inputs"]["text"], "original prompt")

    def test_studio_workflow_adjustable_parameters_are_generic_and_validated(self):
        self.config("comfy_cloud", comfy_api_key="secret")
        graph = {
            "1": {"class_type": "LoadImage", "inputs": {"image": "source.png"}},
            "2": {"class_type": "CustomSampler", "inputs": {
                "steps": 20, "width": 512, "height": 512, "algorithm": "euler",
                "enabled": True, "note": "original", "image": ["1", 0]}},
            "3": {"class_type": "SaveImage", "inputs": {"images": ["2", 0]}},
        }
        parameters = [
            {"id": "steps", "name": "迭代次数", "kind": "number", "targets": [{"node_id": "2", "input": "steps"}],
             "minimum": 1, "maximum": 50, "step": 1},
            {"id": "size", "name": "画幅", "kind": "select", "targets": [
                {"node_id": "2", "input": "width"}, {"node_id": "2", "input": "height"}],
             "options": [{"name": "方形", "values": ["512", "512"]},
                         {"name": "横向", "values": ["768", "512"]}]},
            {"id": "algorithm", "name": "采样方式", "kind": "select",
             "targets": [{"node_id": "2", "input": "algorithm"}],
             "options": [{"name": "Euler", "values": ["euler"]},
                         {"name": "DPM", "values": ["dpm"]}]},
            {"id": "enabled", "name": "增强", "kind": "boolean",
             "targets": [{"node_id": "2", "input": "enabled"}]},
            {"id": "note", "name": "附注", "kind": "text",
             "targets": [{"node_id": "2", "input": "note"}]},
        ]
        preset = {"name": "通用参数", "workflow": graph, "image_node_id": "1", "image_input": "image",
                  "output_node_id": "3", "parameters": parameters}
        saved = self.client.post("/db/image-ai/studio/workflows", json=preset)
        self.assertEqual(saved.status_code, 200, saved.text)
        workflow_id = saved.json()["id"]
        summary = self.client.get("/db/image-ai/studio/workflows").json()[0]
        self.assertEqual(summary["parameter_defaults"]["size"], [512, 512])
        self.assertEqual(summary["parameters"][0]["name"], "迭代次数")
        values = {"steps": 30, "size": 1, "algorithm": 1, "enabled": False, "note": "hello"}
        with patch.object(image_ai, "_comfy_cloud_studio_edit", return_value={"job_id": "done"}) as run:
            response = self.client.post("/db/image-ai/studio/workflow-edit", json={
                "workflow_id": workflow_id, "image_base64": "main", "parameter_values": values,
            })
        self.assertEqual(response.status_code, 200, response.text)
        sent = run.call_args.args[0].workflow["2"]["inputs"]
        self.assertEqual((sent["steps"], sent["width"], sent["height"], sent["algorithm"],
                          sent["enabled"], sent["note"]), (30, 768, 512, "dpm", False, "hello"))
        self.assertEqual(graph["2"]["inputs"]["steps"], 20)
        for invalid_values in ({"steps": 99}, {"steps": "not a number"}, {"size": 9}, {"unknown": 1}):
            invalid = self.client.post("/db/image-ai/studio/workflow-edit", json={
                "workflow_id": workflow_id, "image_base64": "main", "parameter_values": invalid_values,
            })
            self.assertEqual(invalid.status_code, 400, invalid.text)
        duplicate = self.client.post("/db/image-ai/studio/workflows", json={
            **preset, "parameters": [{**parameters[0], "targets": [{"node_id": "1", "input": "image"}]}],
        })
        self.assertEqual(duplicate.status_code, 400)
        linked = self.client.post("/db/image-ai/studio/workflows", json={
            **preset, "parameters": [{**parameters[0], "targets": [{"node_id": "2", "input": "image"}]}],
        })
        self.assertEqual(linked.status_code, 400)

    def test_load_image_mask_output_uses_one_rgba_upload(self):
        self.config("comfy_cloud", comfy_api_key="secret")
        graph = {
            "1": {"class_type": "LoadImage", "inputs": {"image": "old.png"}},
            "2": {"class_type": "OpenAIGPTImageNodeV2", "inputs": {
                "prompt": "old", "model.images.image_1": ["1", 0], "model.mask": ["1", 1]}},
            "3": {"class_type": "SaveImage", "inputs": {"images": ["2", 0]}},
        }
        mask = io.BytesIO()
        painted = PilImage.new("RGB", (8, 8), "black")
        painted.putpixel((0, 0), (255, 255, 255))
        painted.save(mask, format="PNG")
        preset = {"name": "单图遮罩", "workflow": graph, "image_node_id": "1", "image_input": "image",
                  "mask_node_id": "", "mask_input": "", "prompt_node_id": "2", "prompt_input": "prompt",
                  "output_node_id": "3", "reference_slots": []}
        saved = self.client.post("/db/image-ai/studio/workflows", json=preset)
        self.assertEqual(saved.status_code, 200, saved.text)
        workflow_id = saved.json()["id"]
        listing = self.client.get("/db/image-ai/studio/workflows").json()
        self.assertTrue(listing[0]["mask_from_image"])

        payload = {"workflow_id": workflow_id, "image_base64": base64.b64encode(self.path.read_bytes()).decode(),
                   "mask_base64": base64.b64encode(mask.getvalue()).decode(), "prompt": "blue coat",
                   "reference_images_base64": []}
        uploaded = Mock(status_code=200)
        uploaded.json.return_value = {"name": "combined.png"}
        submitted = Mock(status_code=200)
        submitted.json.return_value = {"prompt_id": "550e8400-e29b-41d4-a716-446655440000"}
        completed = Mock(status_code=200)
        completed.json.return_value = {"status": "completed", "outputs": {"3": {
            "images": [{"filename": "result.png", "type": "output"}]}}}
        result_image = Mock(status_code=200)
        result_image.iter_content.return_value = [self.path.read_bytes()]
        with patch.object(image_ai.requests, "post", side_effect=[uploaded, submitted]) as post, \
             patch.object(image_ai.requests, "get", side_effect=[completed, result_image]):
            response = self.client.post("/db/image-ai/studio/workflow-edit", json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(post.call_count, 2)
        packed = post.call_args_list[0].kwargs["files"]["image"][1]
        with PilImage.open(io.BytesIO(packed)) as image:
            self.assertEqual(image.mode, "RGBA")
            self.assertEqual(image.getpixel((0, 0)), (0, 0, 255, 0))
            self.assertEqual(image.getpixel((1, 0)), (0, 0, 255, 255))
        self.assertEqual(post.call_args_list[1].kwargs["json"]["prompt"]["1"]["inputs"]["image"], "combined.png")
        self.assertEqual(graph["1"]["inputs"]["image"], "old.png")

        with patch.object(image_ai, "_comfy_cloud_studio_edit", return_value={"job_id": "done"}) as run:
            without_mask = self.client.post("/db/image-ai/studio/workflow-edit", json={**payload, "mask_base64": None})
        self.assertEqual(without_mask.status_code, 200, without_mask.text)
        self.assertNotIn("model.mask", run.call_args.args[0].workflow["2"]["inputs"])
        self.assertEqual(run.call_args.args[0].mask_base64, None)
        with_reference = {**preset, "workflow": {**graph, "2": {**graph["2"], "inputs": {
            **graph["2"]["inputs"], "model.images.image_2": ["4", 0]}},
            "4": {"class_type": "LoadImage", "inputs": {"image": "reference.png"}}},
            "reference_slots": [{"node_id": "4", "input": "image"}]}
        saved_combination = self.client.post("/db/image-ai/studio/workflows", json=with_reference)
        self.assertEqual(saved_combination.status_code, 200, saved_combination.text)
        with patch.object(image_ai, "_comfy_cloud_studio_edit", return_value={"job_id": "done"}) as run:
            without_reference = self.client.post("/db/image-ai/studio/workflow-edit", json={**payload,
                "workflow_id": saved_combination.json()["id"]})
        self.assertEqual(without_reference.status_code, 200, without_reference.text)
        self.assertNotIn("model.images.image_2", run.call_args.args[0].workflow["2"]["inputs"])

        broken_mask = {**preset, "workflow": {**graph, "2": {**graph["2"], "inputs": {
            **graph["2"]["inputs"], "model.mask": ["4", 0]}},
            "4": {"class_type": "ImageToMask", "inputs": {"channel": "alpha"}}}}
        invalid = self.client.post("/db/image-ai/studio/workflows", json=broken_mask)
        self.assertEqual(invalid.status_code, 400)
        self.assertIn("缺少图片输入", invalid.text)

        disabled = self.client.post("/db/image-ai/studio/workflows", json={**preset,
            "name": "不使用遮罩", "mask_enabled": False})
        self.assertEqual(disabled.status_code, 200, disabled.text)
        self.assertFalse(next(item for item in self.client.get("/db/image-ai/studio/workflows").json()
                              if item["id"] == disabled.json()["id"])["mask_enabled"])
        rejected = self.client.post("/db/image-ai/studio/workflow-edit", json={**payload,
            "workflow_id": disabled.json()["id"]})
        self.assertEqual(rejected.status_code, 400)
        with patch.object(image_ai, "_comfy_cloud_studio_edit", return_value={"job_id": "done"}) as run:
            allowed = self.client.post("/db/image-ai/studio/workflow-edit", json={**payload,
                "workflow_id": disabled.json()["id"], "mask_base64": None})
        self.assertEqual(allowed.status_code, 200, allowed.text)
        self.assertNotIn("model.mask", run.call_args.args[0].workflow["2"]["inputs"])

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

    def test_router_studio_edit_uses_model_selected_for_this_request(self):
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
                "image_base64": base64.b64encode(source).decode(), "prompt": "Change to green",
                "model": "vertexai/gemini-2.5-flash-image"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(base64.b64decode(response.json()["image_base64"]), source)
        self.assertEqual(post.call_args.args[0], image_ai.COMFY_ROUTER_URL + "/vertexai/gemini-2.5-flash-image")
        self.assertEqual(post.call_args.kwargs["headers"]["X-API-Key"], "secret")
        self.assertIn("Idempotency-Key", post.call_args.kwargs["headers"])
        parts = post.call_args.kwargs["json"]["contents"][0]["parts"]
        self.assertEqual(parts[0]["text"], "Change to green")
        self.assertEqual(parts[1]["inlineData"]["mimeType"], "image/png")
        self.assertEqual(base64.b64decode(parts[1]["inlineData"]["data"]), source)
        self.assertNotIn("imageConfig", post.call_args.kwargs["json"]["generationConfig"])
        self.client.put("/db/image-ai/creation/config", json={"mode": "workflow", "model": image_ai.DEFAULT_CREATION_MODEL})
        with patch.object(image_ai.requests, "post", return_value=result) as post:
            allowed = self.client.post("/db/image-ai/studio-router-edit", json={
                "image_base64": base64.b64encode(source).decode(), "prompt": "Change to green",
                "model": image_ai.DEFAULT_CREATION_MODEL,
                "aspect_ratio": "16:9", "image_size": "2K"})
        self.assertEqual(allowed.status_code, 200, allowed.text)
        self.assertEqual(post.call_args.kwargs["json"]["generationConfig"]["imageConfig"],
                         {"aspectRatio": "16:9", "imageSize": "2K"})
        with patch.object(image_ai.requests, "post", return_value=result) as post:
            with_reference = self.client.post("/db/image-ai/studio-router-edit", json={
                "image_base64": base64.b64encode(source).decode(), "prompt": "Change to green",
                "model": image_ai.DEFAULT_CREATION_MODEL,
                "reference_images_base64": [base64.b64encode(source).decode()]})
        self.assertEqual(with_reference.status_code, 200, with_reference.text)
        parts = post.call_args.kwargs["json"]["contents"][0]["parts"]
        self.assertEqual(parts[2]["text"], "参考图 1")
        self.assertEqual(base64.b64decode(parts[3]["inlineData"]["data"]), source)
        with patch.object(image_ai.requests, "post") as post:
            base = {"image_base64": base64.b64encode(source).decode(), "prompt": "Change to green"}
            for options in (
                {"model": "other/model"},
                {"model": image_ai.DEFAULT_CREATION_MODEL, "aspect_ratio": "3:5"},
                {"model": "vertexai/gemini-3-pro-image", "aspect_ratio": "1:8"},
                {"model": "vertexai/gemini-3.1-flash-lite-image", "image_size": "2K"},
                {"model": "vertexai/gemini-2.5-flash-image", "image_size": "4K"},
                {"model": "vertexai/gemini-2.5-flash-image",
                 "reference_images_base64": [base64.b64encode(source).decode()] * 3},
            ):
                denied = self.client.post("/db/image-ai/studio-router-edit", json={**base, **options})
                self.assertEqual(denied.status_code, 400, denied.text)
        post.assert_not_called()

if __name__ == "__main__":
    unittest.main()
