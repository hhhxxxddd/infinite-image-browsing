import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image as PILImage

from scripts.iib.auto_tag import AutoTagMatcher
from scripts.iib.db.datamodel import DataBase, ImageTag
from scripts.iib.db.legacy_generation_tags import (
    LEGACY_GENERATION_TAG_TYPES,
    remove_legacy_generation_tags,
)
from scripts.iib.db.update_image_data import build_single_img_idx
from scripts.iib.parsers.model import ImageGenerationInfo, ImageGenerationParams


class ExplicitGenerationTagTests(unittest.TestCase):
    def test_migration_preserves_custom_tags_and_generation_information(self):
        with sqlite3.connect(":memory:") as conn:
            conn.executescript("""
                CREATE TABLE tag (id INTEGER PRIMARY KEY, name TEXT, type TEXT);
                CREATE TABLE image_tag (image_id INTEGER, tag_id INTEGER);
                CREATE TABLE image (id INTEGER PRIMARY KEY, exif TEXT);
                INSERT INTO image VALUES (1, 'original generation metadata');
            """)
            types = [*LEGACY_GENERATION_TAG_TYPES, "custom", "size", "Media Type"]
            for index, kind in enumerate(types, 1):
                conn.execute("INSERT INTO tag VALUES (?, 'same name', ?)", (index, kind))
                conn.execute("INSERT INTO image_tag VALUES (1, ?)", (index,))
            remove_legacy_generation_tags(conn)
            remove_legacy_generation_tags(conn)
            self.assertEqual([row[0] for row in conn.execute("SELECT type FROM tag ORDER BY id")],
                             ["custom", "size", "Media Type"])
            self.assertEqual(conn.execute("SELECT count(*) FROM image_tag").fetchone()[0], 3)
            self.assertEqual(conn.execute("SELECT exif FROM image").fetchone()[0], "original generation metadata")

    def test_scan_and_rebuild_only_apply_explicit_rules(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "image.png"
            PILImage.new("RGB", (8, 8)).save(path)
            params = ImageGenerationParams(
                meta={"Model": "base", "Sampler": "Euler", "Source Identifier": "ComfyUI",
                      "final_width": 8, "final_height": 8},
                pos_prompt=["portrait"], extra={"lora": [{"name": "style"}]},
            )
            info = ImageGenerationInfo("original generation metadata", params)
            with patch.multiple(DataBase, path=str(Path(directory) / "test.db"), local=threading.local()), \
                    patch.object(AutoTagMatcher, "_instance", None), \
                    patch("scripts.iib.db.update_image_data.get_exif_data", return_value=info):
                conn = DataBase.get_conn()
                try:
                    save = lambda item: item.save_or_ignore(conn)
                    build_single_img_idx(conn, str(path), False, save, protected=False)
                    self.assertEqual({row[0] for row in conn.execute("SELECT type FROM tag")},
                                     {"custom", "size", "Media Type"})
                    self.assertEqual(conn.execute("SELECT count(*) FROM image_tag it JOIN tag t ON t.id=it.tag_id WHERE t.type='custom'").fetchone()[0], 0)
                    AutoTagMatcher.get_instance(conn).rules = [{"tag": "Explicit portrait", "filters": [
                        {"field": "pos_prompt", "operator": "contains", "value": "portrait"},
                        {"field": "Sampler", "operator": "equals", "value": "Euler"},
                        {"field": "Source Identifier", "operator": "equals", "value": "ComfyUI"},
                    ]}]
                    build_single_img_idx(conn, str(path), True, save, protected=False)
                    image_id = conn.execute("SELECT id FROM image").fetchone()[0]
                    self.assertIn("Explicit portrait", [tag.name for tag in ImageTag.get_tags_for_image(conn, image_id)])
                    self.assertEqual({row[0] for row in conn.execute("SELECT type FROM tag")},
                                     {"custom", "size", "Media Type"})
                    self.assertEqual(conn.execute("SELECT exif FROM image").fetchone()[0], info.raw_info)
                finally:
                    conn.close()
