"""Description migration and media refresh regression checks."""

import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from PIL import Image as PILImage

from scripts.iib.db.datamodel import Image, ImageAiNote, ImageQwenVisualEmbedding, ImageVisualEmbedding
from scripts.iib.db.update_image_data import build_single_img_idx, dimensions_from_info


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
        ImageQwenVisualEmbedding.create_table(self.conn)
        ImageAiNote.create_table(self.conn)

    def test_existing_database_gains_editable_description(self):
        Image.create_table(self.conn)
        path = Path(self.directory.name) / "coast.jpg"
        path.touch()
        image = Image(str(path), date="old")
        image.save(self.conn)
        image.update_description(self.conn, "蓝色海岸")
        self.assertEqual(Image.get(self.conn, str(path)).description, "蓝色海岸")

    def test_existing_image_dimensions_are_filled_when_first_searched(self):
        Image.create_table(self.conn)
        path = Path(self.directory.name) / "portrait.jpg"
        PILImage.new("RGB", (80, 120)).save(path)
        Image(str(path), date="2026-01-01").save(self.conn)
        images, _ = Image.find_by_substring(self.conn, "", limit=10)
        self.assertEqual((images[0].width, images[0].height), (80, 120))
        stored = Image.get(self.conn, str(path))
        self.assertEqual((stored.width, stored.height), (80, 120))

    def test_video_stream_dimensions_are_indexed_and_backfilled(self):
        Image.create_table(self.conn)
        path = Path(self.directory.name) / "portrait.mp4"
        path.touch()

        class VideoContainer:
            streams = SimpleNamespace(video=[SimpleNamespace(codec_context=SimpleNamespace(width=1080, height=1920))])

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                pass

        fake_av = SimpleNamespace(open=lambda _path: VideoContainer())
        with patch.dict(sys.modules, {"av": fake_av}), \
                patch("scripts.iib.db.datamodel.is_video_file", return_value=True), \
                patch("scripts.iib.db.update_image_data.is_video_file", return_value=True):
            self.assertEqual(dimensions_from_info(str(path), SimpleNamespace(params=None)), (1080, 1920))
            Image(str(path), date="2026-01-01").save(self.conn)
            images, _ = Image.find_by_substring(self.conn, "", limit=10)

        self.assertEqual((images[0].width, images[0].height), (1080, 1920))
        stored = Image.get(self.conn, str(path))
        self.assertEqual((stored.width, stored.height), (1080, 1920))

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
