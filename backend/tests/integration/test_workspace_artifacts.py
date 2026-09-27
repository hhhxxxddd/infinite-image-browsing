"""Workspace materials stay private until explicitly copied to a scanned folder."""

import base64
import io
import json
import sqlite3
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image, PngImagePlugin

from backend.tests.support.database import isolate_project_storage
from omnigallery.ai.repository import MediaAiNote
from omnigallery.infrastructure.database import Database
from omnigallery.library.media_repository import Media
from omnigallery.library.tag_repository import MediaTag, Tag
from omnigallery.workspaces import artifacts as workspace_artifacts


class WorkspaceArtifactTests(unittest.TestCase):
    def setUp(self):
        isolate_project_storage(self)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.db_path = root / "test.db"
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self.addCleanup(self.conn.close)
        self.conn.execute("CREATE TABLE extra_path (path TEXT PRIMARY KEY, type TEXT, alias TEXT)")
        Media.create_table(self.conn)
        Tag.create_table(self.conn)
        MediaTag.create_table(self.conn)
        MediaAiNote.create_table(self.conn)
        workspace_artifacts.create_workspace_artifact_table(self.conn)
        self.media = root / "media"
        self.media.mkdir()
        self.conn.execute("INSERT INTO extra_path VALUES (?, ?, '')", (str(self.media), "scanned"))
        self.conn.commit()
        get_connection = patch.object(Database, "get_connection", return_value=self.conn)
        get_path = patch.object(Database, "get_file_path", return_value=str(self.db_path))
        get_connection.start()
        get_path.start()
        self.addCleanup(get_connection.stop)
        self.addCleanup(get_path.stop)
        app = FastAPI()
        workspace_artifacts.mount_workspace_artifact_routes(app, "/api", lambda: None, lambda: None)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.workspace_id = str(uuid.uuid4())
        media = io.BytesIO()
        Image.new("RGB", (16, 12), "blue").save(media, "PNG")
        self.image_bytes = media.getvalue()

    def save(self):
        result = self.client.post(
            "/api/workspace_artifacts",
            json={
                "workspace_id": self.workspace_id,
                "name": "草稿",
                "format": "png",
                "image_base64": base64.b64encode(self.image_bytes).decode(),
            },
        )
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def test_save_preview_list_and_delete_are_workspace_owned(self):
        item = self.save()
        self.assertEqual((item["name"], item["width"], item["height"]), ("草稿.png", 16, 12))
        self.assertNotIn("path", item)
        self.assertEqual(
            self.client.get(
                "/api/workspace_artifacts", params={"workspace_id": self.workspace_id}
            ).json(),
            [item],
        )
        self.assertEqual(
            self.client.get(f"/api/workspace_artifacts/{item['id']}/file").content, self.image_bytes
        )
        thumbnail = self.client.get(f"/api/workspace_artifacts/{item['id']}/thumbnail?size=64")
        self.assertEqual(thumbnail.status_code, 200)
        with Image.open(io.BytesIO(thumbnail.content)) as preview:
            self.assertEqual(preview.size, (16, 12))
        path = workspace_artifacts.artifact_root() / self.workspace_id / (item["id"] + ".png")
        self.assertTrue(workspace_artifacts.is_artifact_path(str(path)))
        self.assertEqual(
            self.client.delete(f"/api/workspace_artifacts/{item['id']}").status_code, 200
        )
        self.assertFalse(path.exists())
        self.assertEqual(
            self.client.get(
                "/api/workspace_artifacts", params={"workspace_id": self.workspace_id}
            ).json(),
            [],
        )

    def test_sync_requires_scanned_folder_and_keeps_original(self):
        item = self.save()
        endpoint = f"/api/workspace_artifacts/{item['id']}/sync"
        outside = Path(self.temp.name) / "outside"
        outside.mkdir()
        self.assertEqual(
            self.client.post(endpoint, json={"directory": str(outside)}).status_code, 422
        )
        with patch.object(workspace_artifacts, "add_image_data_single") as index:
            result = self.client.post(endpoint, json={"directory": str(self.media)})
            self.assertEqual(result.status_code, 200, result.text)
            synced = Path(result.json()["path"])
            self.assertEqual(synced.read_bytes(), self.image_bytes)
            index.assert_called_once_with(str(synced))
        self.assertEqual(
            self.client.get(f"/api/workspace_artifacts/{item['id']}/file").content, self.image_bytes
        )
        self.assertEqual(
            self.client.delete(
                "/api/workspace_artifacts", params={"workspace_id": self.workspace_id}
            ).status_code,
            200,
        )
        self.assertTrue(synced.exists())

    def test_rejects_invalid_image(self):
        result = self.client.post(
            "/api/workspace_artifacts",
            json={
                "workspace_id": self.workspace_id,
                "name": "invalid",
                "format": "png",
                "image_base64": base64.b64encode(b"not an image").decode(),
            },
        )
        self.assertEqual(result.status_code, 422)

    def test_source_snapshot_is_private_persistent_and_deleted_with_result(self):
        item = workspace_artifacts.save_workspace_artifact(
            workspace_artifacts.SaveArtifact(
                workspace_id=self.workspace_id,
                name="AI result",
                format="png",
                source="ai_image_edit",
                image_base64=base64.b64encode(self.image_bytes).decode(),
                generation_info="test prompt",
            ),
            source_image_base64=base64.b64encode(self.image_bytes).decode(),
        )
        endpoint = f"/api/workspace_artifacts/{item['id']}"
        self.assertTrue(self.client.get(endpoint + "/metadata").json()["source_image_available"])
        with Image.open(io.BytesIO(self.client.get(endpoint + "/source").content)) as snapshot:
            self.assertEqual(snapshot.size, (16, 12))
        source = workspace_artifacts._source_file(item)
        self.assertTrue(source.exists())
        self.assertEqual(self.client.delete(endpoint).status_code, 200)
        self.assertFalse(source.exists())
        self.assertEqual(self.client.get(endpoint + "/source").status_code, 404)

    def test_legacy_result_does_not_invent_source_and_invalid_snapshot_leaves_no_artifact(self):
        item = self.save()
        endpoint = f"/api/workspace_artifacts/{item['id']}"
        self.assertFalse(self.client.get(endpoint + "/metadata").json()["source_image_available"])
        self.assertEqual(self.client.get(endpoint + "/source").status_code, 404)
        with self.assertRaises(workspace_artifacts.HTTPException):
            workspace_artifacts.save_workspace_artifact(
                workspace_artifacts.SaveArtifact(
                    workspace_id=self.workspace_id,
                    name="bad source",
                    format="png",
                    image_base64=base64.b64encode(self.image_bytes).decode(),
                ),
                source_image_base64="invalid",
            )
        self.assertEqual(
            len(
                self.client.get(
                    "/api/workspace_artifacts", params={"workspace_id": self.workspace_id}
                ).json()
            ),
            1,
        )
        self.assertEqual(
            len(list((workspace_artifacts.artifact_root() / self.workspace_id).iterdir())), 1
        )

    def test_submitted_info_does_not_hide_embedded_generation_metadata(self):
        output = io.BytesIO()
        embedded = "embedded prompt\nNegative prompt: blur\nSteps: 20, Sampler: Euler, Seed: 42, Model: checkpoint"
        pnginfo = PngImagePlugin.PngInfo()
        pnginfo.add_text("parameters", embedded)
        pnginfo.add_text(
            "prompt",
            json.dumps(
                {
                    "1": {"class_type": "CLIPTextEncode", "inputs": {"text": "embedded prompt"}},
                    "2": {
                        "class_type": "CheckpointLoaderSimple",
                        "inputs": {"ckpt_name": "checkpoint.safetensors"},
                    },
                    "4": {"class_type": "CLIPTextEncode", "inputs": {"text": "blur"}},
                    "3": {
                        "class_type": "KSampler",
                        "inputs": {
                            "positive": ["1", 0],
                            "negative": ["4", 0],
                            "model": ["2", 0],
                            "seed": 42,
                            "steps": 20,
                            "cfg": 7,
                            "sampler_name": "euler",
                            "scheduler": "normal",
                        },
                    },
                }
            ),
        )
        Image.new("RGB", (16, 12), "blue").save(output, "PNG", pnginfo=pnginfo)
        item = workspace_artifacts.save_workspace_artifact(
            workspace_artifacts.SaveArtifact(
                workspace_id=self.workspace_id,
                name="metadata",
                format="png",
                image_base64=base64.b64encode(output.getvalue()).decode(),
                generation_info="submitted prompt",
            )
        )
        metadata = self.client.get(f"/api/workspace_artifacts/{item['id']}/metadata").json()
        self.assertEqual(metadata["generation_info"], "submitted prompt")
        self.assertIn("Seed: 42", metadata["embedded_generation_info"])
        self.assertEqual(metadata["exif"]["parameters"], embedded)

    def test_ai_webp_result_keeps_its_source_and_format(self):
        media = io.BytesIO()
        Image.new("RGB", (12, 10), "red").save(media, "WEBP")
        result = self.client.post(
            "/api/workspace_artifacts",
            json={
                "workspace_id": self.workspace_id,
                "name": "AI 抽卡",
                "format": "webp",
                "source": "ai_image_edit",
                "image_base64": base64.b64encode(media.getvalue()).decode(),
            },
        )
        self.assertEqual(result.status_code, 200, result.text)
        item = result.json()
        self.assertEqual((item["name"], item["source"]), ("AI 抽卡.webp", "ai_image_edit"))
        preview = self.client.get(f"/api/workspace_artifacts/{item['id']}/file")
        self.assertEqual(preview.headers["content-type"], "image/webp")
        self.assertEqual(preview.content, media.getvalue())

    def test_metadata_is_editable_and_sync_preserves_it(self):
        item = self.save()
        endpoint = f"/api/workspace_artifacts/{item['id']}"
        self.conn.execute(
            "INSERT INTO tag (name, score, type, count) VALUES ('选片', 0, 'custom', 0)"
        )
        tag_id = self.conn.execute("SELECT id FROM tag WHERE name = '选片'").fetchone()[0]
        metadata = self.client.put(
            endpoint + "/metadata",
            json={
                "description": "蓝色方块",
                "generation_info": "蓝色方块\nNegative prompt: 模糊\nSeed: 42",
                "inferred_prompt": "一张蓝色方块图",
            },
        )
        self.assertEqual(metadata.status_code, 200, metadata.text)
        self.assertEqual(metadata.json()["description"], "蓝色方块")
        self.assertEqual(
            self.client.post(endpoint + "/tags", json={"tag_id": tag_id}).status_code, 200
        )
        self.assertEqual(self.client.get(endpoint + "/metadata").json()["tag_ids"], [tag_id])

        def index(path):
            Media(path, size=len(self.image_bytes)).save(self.conn)

        with patch.object(workspace_artifacts, "add_image_data_single", side_effect=index):
            response = self.client.post(endpoint + "/sync", json={"directory": str(self.media)})
        self.assertEqual(response.status_code, 200, response.text)
        indexed = Media.get(self.conn, response.json()["path"])
        self.assertEqual(indexed.description, "蓝色方块")
        self.assertEqual(indexed.exif, "蓝色方块\nNegative prompt: 模糊\nSeed: 42")
        self.assertEqual(MediaTag.get_tags_for_image(self.conn, indexed.id)[0].id, tag_id)
        self.assertEqual(
            self.conn.execute(
                "SELECT inferred_prompt FROM media_ai_note WHERE media_id = ?", (indexed.id,)
            ).fetchone()[0],
            "一张蓝色方块图",
        )


if __name__ == "__main__":
    unittest.main()
