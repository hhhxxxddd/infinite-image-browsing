"""Workspace materials stay private until explicitly copied to a scanned folder."""

import base64
import io
import sqlite3
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from scripts.iib import workspace_artifacts
from scripts.iib.db.datamodel import DataBase


class WorkspaceArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.db_path = root / "test.db"
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self.addCleanup(self.conn.close)
        self.conn.execute("CREATE TABLE extra_path (path TEXT PRIMARY KEY, type TEXT, alias TEXT)")
        workspace_artifacts.create_workspace_artifact_table(self.conn)
        self.media = root / "media"
        self.media.mkdir()
        self.conn.execute("INSERT INTO extra_path VALUES (?, ?, '')", (str(self.media), 'scanned'))
        self.conn.commit()
        get_conn = patch.object(DataBase, "get_conn", return_value=self.conn)
        get_path = patch.object(DataBase, "get_db_file_path", return_value=str(self.db_path))
        get_conn.start()
        get_path.start()
        self.addCleanup(get_conn.stop)
        self.addCleanup(get_path.stop)
        app = FastAPI()
        workspace_artifacts.mount_workspace_artifact_routes(app, "/db", lambda: None, lambda: None)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.workspace_id = str(uuid.uuid4())
        image = io.BytesIO()
        Image.new("RGB", (16, 12), "blue").save(image, "PNG")
        self.image_bytes = image.getvalue()

    def save(self):
        result = self.client.post("/db/workspace_artifacts", json={
            "workspace_id": self.workspace_id, "name": "草稿", "format": "png",
            "image_base64": base64.b64encode(self.image_bytes).decode(),
        })
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def test_save_preview_list_and_delete_are_workspace_owned(self):
        item = self.save()
        self.assertEqual((item["name"], item["width"], item["height"]), ("草稿.png", 16, 12))
        self.assertNotIn("path", item)
        self.assertEqual(self.client.get("/db/workspace_artifacts", params={"workspace_id": self.workspace_id}).json(), [item])
        self.assertEqual(self.client.get(f"/db/workspace_artifacts/{item['id']}/file").content, self.image_bytes)
        thumbnail = self.client.get(f"/db/workspace_artifacts/{item['id']}/thumbnail?size=64")
        self.assertEqual(thumbnail.status_code, 200)
        with Image.open(io.BytesIO(thumbnail.content)) as preview:
            self.assertEqual(preview.size, (16, 12))
        path = workspace_artifacts.artifact_root() / self.workspace_id / (item["id"] + ".png")
        self.assertTrue(workspace_artifacts.is_artifact_path(str(path)))
        self.assertEqual(self.client.delete(f"/db/workspace_artifacts/{item['id']}").status_code, 200)
        self.assertFalse(path.exists())
        self.assertEqual(self.client.get("/db/workspace_artifacts", params={"workspace_id": self.workspace_id}).json(), [])

    def test_sync_requires_scanned_folder_and_keeps_original(self):
        item = self.save()
        endpoint = f"/db/workspace_artifacts/{item['id']}/sync"
        outside = Path(self.temp.name) / "outside"
        outside.mkdir()
        self.assertEqual(self.client.post(endpoint, json={"directory": str(outside)}).status_code, 422)
        with patch.object(workspace_artifacts, "add_image_data_single") as index:
            result = self.client.post(endpoint, json={"directory": str(self.media)})
            self.assertEqual(result.status_code, 200, result.text)
            synced = Path(result.json()["path"])
            self.assertEqual(synced.read_bytes(), self.image_bytes)
            index.assert_called_once_with(str(synced))
        self.assertEqual(self.client.get(f"/db/workspace_artifacts/{item['id']}/file").content, self.image_bytes)
        self.assertEqual(self.client.delete("/db/workspace_artifacts", params={"workspace_id": self.workspace_id}).status_code, 200)
        self.assertTrue(synced.exists())

    def test_rejects_invalid_image(self):
        result = self.client.post("/db/workspace_artifacts", json={
            "workspace_id": self.workspace_id, "name": "invalid", "format": "png",
            "image_base64": base64.b64encode(b"not an image").decode(),
        })
        self.assertEqual(result.status_code, 422)

    def test_ai_webp_result_keeps_its_source_and_format(self):
        image = io.BytesIO()
        Image.new("RGB", (12, 10), "red").save(image, "WEBP")
        result = self.client.post("/db/workspace_artifacts", json={
            "workspace_id": self.workspace_id, "name": "AI 抽卡", "format": "webp",
            "source": "ai_image_edit", "image_base64": base64.b64encode(image.getvalue()).decode(),
        })
        self.assertEqual(result.status_code, 200, result.text)
        item = result.json()
        self.assertEqual((item["name"], item["source"]), ("AI 抽卡.webp", "ai_image_edit"))
        preview = self.client.get(f"/db/workspace_artifacts/{item['id']}/file")
        self.assertEqual(preview.headers["content-type"], "image/webp")
        self.assertEqual(preview.content, image.getvalue())


if __name__ == "__main__":
    unittest.main()
