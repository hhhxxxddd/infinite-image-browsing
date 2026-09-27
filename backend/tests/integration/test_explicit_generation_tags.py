import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image as PILImage

from omnigallery.infrastructure.database import Database
from omnigallery.library.auto_tag import AutoTagMatcher
from omnigallery.library.indexing import build_single_img_idx
from omnigallery.library.tag_repository import MediaTag
from omnigallery.metadata.parsers.model import ImageGenerationInfo, ImageGenerationParams


class ExplicitGenerationTagTests(unittest.TestCase):
    def test_scan_and_rebuild_only_apply_explicit_rules(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "image.png"
            PILImage.new("RGB", (8, 8)).save(path)
            params = ImageGenerationParams(
                meta={
                    "Model": "base",
                    "Sampler": "Euler",
                    "Source Identifier": "ComfyUI",
                    "final_width": 8,
                    "final_height": 8,
                },
                pos_prompt=["portrait"],
                extra={"lora": [{"name": "style"}]},
            )
            info = ImageGenerationInfo("original generation metadata", params)
            with (
                patch.multiple(
                    Database, path=str(Path(directory) / "test.db"), local=threading.local()
                ),
                patch.object(AutoTagMatcher, "_instance", None),
                patch("omnigallery.library.indexing.get_exif_data", return_value=info),
            ):
                conn = Database.get_connection()
                try:

                    def save(item):
                        return item.save_or_ignore(conn)

                    build_single_img_idx(conn, str(path), False, save, protected=False)
                    self.assertEqual(
                        {row[0] for row in conn.execute("SELECT type FROM tag")},
                        {"custom", "size", "Media Type"},
                    )
                    self.assertEqual(
                        conn.execute(
                            "SELECT count(*) FROM media_tag it JOIN tag t ON t.id=it.tag_id WHERE t.type='custom'"
                        ).fetchone()[0],
                        0,
                    )
                    AutoTagMatcher.get_instance(conn).rules = [
                        {
                            "tag": "Explicit portrait",
                            "filters": [
                                {
                                    "field": "pos_prompt",
                                    "operator": "contains",
                                    "value": "portrait",
                                },
                                {"field": "Sampler", "operator": "equals", "value": "Euler"},
                                {
                                    "field": "Source Identifier",
                                    "operator": "equals",
                                    "value": "ComfyUI",
                                },
                            ],
                        }
                    ]
                    build_single_img_idx(conn, str(path), True, save, protected=False)
                    media_id = conn.execute("SELECT id FROM media").fetchone()[0]
                    self.assertIn(
                        "Explicit portrait",
                        [tag.name for tag in MediaTag.get_tags_for_image(conn, media_id)],
                    )
                    self.assertEqual(
                        {row[0] for row in conn.execute("SELECT type FROM tag")},
                        {"custom", "size", "Media Type"},
                    )
                    self.assertEqual(
                        conn.execute("SELECT exif FROM media").fetchone()[0], info.raw_info
                    )
                finally:
                    conn.close()
