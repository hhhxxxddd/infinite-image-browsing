"""Provider configuration and image generation without live model/API calls."""

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


if __name__ == "__main__":
    unittest.main()
