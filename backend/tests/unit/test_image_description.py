"""Description migration and media refresh regression checks."""

import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image as PILImage

from omnigallery.ai.repository import MediaAiNote
from omnigallery.library.indexing import build_single_img_idx, dimensions_from_info
from omnigallery.library.media_repository import Media
from omnigallery.search.embedding_repository import MediaVisualEmbedding


class ImageDescriptionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.conn = sqlite3.connect(":memory:")
        self.addCleanup(self.conn.close)
        self.conn.executescript("""
            CREATE TABLE media (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT UNIQUE,
                exif TEXT,
                size INTEGER,
                date TEXT,
                exif_edited INTEGER DEFAULT 0,
                description TEXT NOT NULL DEFAULT '',
                width INTEGER, height INTEGER, content_pending INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE media_tag (media_id INTEGER, tag_id INTEGER);
            CREATE TABLE media_embedding (media_id INTEGER);
            CREATE TABLE media_embedding_fail (media_id INTEGER);
        """)

        MediaVisualEmbedding.create_table(self.conn)
        MediaAiNote.create_table(self.conn)

    def test_media_description_is_editable(self):
        Media.create_table(self.conn)
        path = Path(self.directory.name) / "coast.jpg"
        path.touch()
        media = Media(str(path), date="old")
        media.save(self.conn)
        media.update_description(self.conn, "蓝色海岸")
        self.assertEqual(Media.get(self.conn, str(path)).description, "蓝色海岸")

    def test_existing_image_dimensions_are_filled_when_first_searched(self):
        Media.create_table(self.conn)
        path = Path(self.directory.name) / "portrait.jpg"
        PILImage.new("RGB", (80, 120)).save(path)
        Media(str(path), date="2026-01-01").save(self.conn)
        images, _ = Media.find_by_substring(self.conn, "", limit=10)
        self.assertEqual((images[0].width, images[0].height), (80, 120))
        stored = Media.get(self.conn, str(path))
        self.assertEqual((stored.width, stored.height), (80, 120))

    def test_video_stream_dimensions_are_indexed_and_backfilled(self):
        Media.create_table(self.conn)
        path = Path(self.directory.name) / "portrait.mp4"
        path.touch()

        class VideoContainer:
            streams = SimpleNamespace(
                video=[SimpleNamespace(codec_context=SimpleNamespace(width=1080, height=1920))]
            )

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                pass

        fake_av = SimpleNamespace(open=lambda _path: VideoContainer())
        with (
            patch.dict(sys.modules, {"av": fake_av}),
            patch("omnigallery.library.media_repository.is_video_file", return_value=True),
            patch("omnigallery.library.indexing.is_video_file", return_value=True),
        ):
            self.assertEqual(
                dimensions_from_info(str(path), SimpleNamespace(params=None)), (1080, 1920)
            )
            Media(str(path), date="2026-01-01").save(self.conn)
            images, _ = Media.find_by_substring(self.conn, "", limit=10)

        self.assertEqual((images[0].width, images[0].height), (1080, 1920))
        stored = Media.get(self.conn, str(path))
        self.assertEqual((stored.width, stored.height), (1080, 1920))

    def test_file_refresh_preserves_description(self):
        Media.create_table(self.conn)
        path = Path(self.directory.name) / "coast.jpg"
        path.touch()
        media = Media(str(path), date="old", description="蓝色海岸")
        media.save(self.conn)
        with patch(
            "omnigallery.library.indexing.get_exif_data",
            return_value=SimpleNamespace(raw_info="", params=None),
        ):
            build_single_img_idx(self.conn, str(path), False, lambda tag: None)
        self.assertEqual(Media.get(self.conn, str(path)).description, "蓝色海岸")


if __name__ == "__main__":
    unittest.main()
