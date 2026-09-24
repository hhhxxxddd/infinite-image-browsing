"""Folder icon storage and managed-path protection."""

import base64
import io
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from scripts.iib import folder_icons
from scripts.iib.db.datamodel import DataBase, ExtraPath


class FolderIconTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "photos"
        self.root.mkdir()
        self.child = self.root / "landscape"
        self.child.mkdir()
        self.outside = Path(self.temp.name) / "outside"
        self.outside.mkdir()
        conn = sqlite3.connect(":memory:", check_same_thread=False)
        self.addCleanup(conn.close)
        conn.execute("CREATE TABLE extra_path (path TEXT PRIMARY KEY, type TEXT, alias TEXT)")
        conn.execute("CREATE TABLE folder_icon (path TEXT PRIMARY KEY, icon TEXT NOT NULL)")
        ExtraPath(str(self.root), ["walk"]).save(conn)
        conn.commit()
        self.conn = conn
        connection = patch.object(DataBase, "get_conn", return_value=conn)
        connection.start()
        self.addCleanup(connection.stop)
        app = FastAPI()
        folder_icons.mount_folder_icon_routes(app, "/db", lambda: None, lambda: None)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_presets_and_uploaded_png_are_local_and_resettable(self):
        saved = self.client.put("/db/folder-icons", json={"path": str(self.child), "icon": "camera"})
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(self.client.get("/db/folder-icons").json()[str(self.child)], "camera")
        image = Image.new("RGBA", (80, 80), (0, 0, 0, 0))
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        custom = folder_icons.IMAGE_PREFIX + base64.b64encode(buffer.getvalue()).decode("ascii")
        self.assertEqual(self.client.put("/db/folder-icons", json={
            "path": str(self.child), "icon": custom,
        }).status_code, 200)
        self.assertEqual(self.client.get("/db/folder-icons").json()[str(self.child)], custom)
        self.assertEqual(self.client.put("/db/folder-icons", json={
            "path": str(self.child), "icon": "",
        }).status_code, 200)
        self.assertNotIn(str(self.child), self.client.get("/db/folder-icons").json())

    def test_invalid_images_and_unmanaged_paths_are_rejected(self):
        self.assertEqual(self.client.put("/db/folder-icons", json={
            "path": str(self.child), "icon": "data:image/svg+xml;base64,AAA",
        }).status_code, 400)
        self.assertEqual(self.client.put("/db/folder-icons", json={
            "path": str(self.outside), "icon": "star",
        }).status_code, 403)

    def test_folder_move_remaps_icon_and_descendants(self):
        deeper = self.child / "child"
        self.conn.executemany("INSERT INTO folder_icon(path, icon) VALUES (?, ?)", [
            (str(self.child), "photo"), (str(deeper), "star"), (str(self.root), "disk"),
        ])
        destination = self.root / "renamed"
        folder_icons.remap_folder_icons(self.conn, str(self.child), str(destination))
        icons = dict(self.conn.execute("SELECT path, icon FROM folder_icon"))
        self.assertEqual(icons[str(destination)], "photo")
        self.assertEqual(icons[str(destination / "child")], "star")
        self.assertEqual(icons[str(self.root)], "disk")
        self.assertNotIn(str(self.child), icons)


if __name__ == "__main__":
    unittest.main()
