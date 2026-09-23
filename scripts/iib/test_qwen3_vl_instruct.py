"""Exercise VLM generation and saved prompt notes without loading model weights."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image as PilImage

from scripts.iib import qwen3_vl_instruct as instruct
from scripts.iib.db.datamodel import DataBase, Image


class Qwen3VLInstructTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.old_db_path = DataBase.path
        DataBase.path = str(Path(self.temp.name) / "test.db")
        self.addCleanup(self.restore_db)
        self.path = Path(self.temp.name) / "reference.png"
        PilImage.new("RGB", (8, 8), "blue").save(self.path)
        Image(str(self.path), size=self.path.stat().st_size).save(DataBase.get_conn())
        DataBase.get_conn().commit()
        app = FastAPI()
        instruct.mount_qwen3_vl_instruct_routes(
            app, "/db", lambda: None, lambda: None,
            lambda path: Path(path).is_relative_to(Path(self.temp.name)),
        )
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def restore_db(self):
        if hasattr(DataBase.local, "conn"):
            DataBase.local.conn.close()
            del DataBase.local.conn
        DataBase.path = self.old_db_path

    def test_generation_stays_within_limit_and_tags_use_existing_names(self):
        with patch.object(instruct, "readiness", return_value=("ready", "")), \
             patch.object(instruct._runtime, "generate", return_value="描述内容超过限制"):
            response = self.client.post("/db/qwen3-vl/instruct/generate", json={
                "path": str(self.path), "task": "description", "max_chars": 40,
            })
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["text"], "描述内容超过限制")
        self.assertEqual(instruct.parse_tags('["蓝色", "未知", "蓝色", "抽象"]', ["蓝色", "抽象"]),
                         ["蓝色", "抽象"])
        self.assertEqual(instruct.parse_tags("not JSON", ["蓝色"]), [])
        with patch.object(instruct, "readiness", return_value=("ready", "")), \
             patch.object(instruct._runtime, "generate", return_value='["蓝色", "未知", "抽象"]'):
            response = self.client.post("/db/qwen3-vl/instruct/generate", json={
                "path": str(self.path), "task": "tags", "allowed_tags": ["蓝色", "抽象"],
            })
            self.assertEqual(response.json()["tags"], ["蓝色", "抽象"])
            denied = self.client.post("/db/qwen3-vl/instruct/generate", json={
                "path": str(Path(self.temp.name).parent / "outside.png"), "task": "description",
            })
            self.assertEqual(denied.status_code, 403)

    def test_custom_system_instruction_is_used_for_prompt(self):
        with patch.object(instruct, "readiness", return_value=("ready", "")), \
             patch.object(instruct._runtime, "generate", return_value="蓝色抽象波浪") as generate:
            response = self.client.post("/db/qwen3-vl/instruct/generate", json={
                "path": str(self.path), "task": "prompt", "max_chars": 80,
                "prompt_template": "请用中文描述画面，不超过{max_chars}字。",
            })
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["text"], "蓝色抽象波浪")
            self.assertEqual(generate.call_args.args[1], "请用中文描述画面，不超过80字。")
            self.assertTrue(generate.call_args.kwargs["system"])
        self.assertIn("English", instruct.prompt_for("prompt", 120, []))
        self.assertIn("80", instruct.prompt_for("prompt", 80, [], "请用中文回答"))

    def test_inferred_prompt_is_stored_separately_from_image_metadata(self):
        response = self.client.put("/db/image_ai_note", json={
            "path": str(self.path), "inferred_prompt": "  blue abstract waves  ",
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["inferred_prompt"], "blue abstract waves")
        saved = self.client.get("/db/image_ai_note", params={"path": str(self.path)})
        self.assertEqual(saved.json()["inferred_prompt"], "blue abstract waves")

    def test_sharded_8b_model_directory(self):
        folder = Path(self.temp.name) / "Qwen3-VL-8B-Instruct"
        folder.mkdir()
        for name in instruct.MODEL_FILES:
            (folder / name).touch()
        (folder / "model.safetensors.index.json").write_text(json.dumps({
            "weight_map": {"layer.a": "model-00001-of-00002.safetensors",
                           "layer.b": "model-00002-of-00002.safetensors"},
        }))
        with patch.object(instruct, "model_path", return_value=folder):
            self.assertEqual(instruct.readiness()[0], "missing_model")
            (folder / "model-00001-of-00002.safetensors").touch()
            (folder / "model-00002-of-00002.safetensors").touch()
            self.assertEqual(instruct.model_id(), "Qwen/Qwen3-VL-8B-Instruct")
            self.assertIn("model-00002-of-00002.safetensors", instruct.model_key())
            self.assertNotEqual(instruct.readiness()[0], "missing_model")


if __name__ == "__main__":
    unittest.main()
