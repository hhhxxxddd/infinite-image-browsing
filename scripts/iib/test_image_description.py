"""Description migration and media refresh regression checks."""

import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from scripts.iib.db.datamodel import Image, ImageVisualEmbedding
from scripts.iib.db.update_image_data import build_single_img_idx


class ImageDescriptionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.conn = sqlite3.connect(":memory:")
        self.addCleanup(self.conn.close)
        self.conn.executescript("""
            CREATE TABLE image (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT UNIQUE,
                exif TEXT,
                size INTEGER,
                date TEXT,
                exif_edited INTEGER DEFAULT 0
            );
            CREATE TABLE image_tag (image_id INTEGER, tag_id INTEGER);
            CREATE TABLE image_embedding (image_id INTEGER);
            CREATE TABLE image_embedding_fail (image_id INTEGER);
        """)
        ImageVisualEmbedding.create_table(self.conn)

    def test_existing_database_gains_editable_description(self):
        Image.create_table(self.conn)
        path = Path(self.directory.name) / "coast.jpg"
        path.touch()
        image = Image(str(path), date="old")
        image.save(self.conn)
        image.update_description(self.conn, "蓝色海岸")
        self.assertEqual(Image.get(self.conn, str(path)).description, "蓝色海岸")

    def test_file_refresh_preserves_description(self):
        Image.create_table(self.conn)
        path = Path(self.directory.name) / "coast.jpg"
        path.touch()
        image = Image(str(path), date="old", description="蓝色海岸")
        image.save(self.conn)
        with patch("scripts.iib.db.update_image_data.get_exif_data", return_value=SimpleNamespace(raw_info="", params=None)):
            build_single_img_idx(self.conn, str(path), False, lambda tag: None)
        self.assertEqual(Image.get(self.conn, str(path)).description, "蓝色海岸")


if __name__ == "__main__":
    unittest.main()
