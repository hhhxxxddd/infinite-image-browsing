"""OneDrive placeholders stay visible without a background content read."""

import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image as PILImage

from scripts.iib.db.datamodel import DataBase, GlobalSetting, Image
from scripts.iib.db.update_image_data import update_image_data
from scripts.iib.onedrive_sync import SETTING_NAME, _wsl_windows_path, is_managed_path, normalize_settings


class OneDriveSyncTests(unittest.TestCase):
    def test_wsl_windows_path_conversion(self):
        self.assertEqual(_wsl_windows_path("/mnt/c/Users/Me/OneDrive/photo.jpg"),
                         "C:\\Users\\Me\\OneDrive\\photo.jpg")
        self.assertIsNone(_wsl_windows_path("/home/me/photo.jpg"))

    def test_setting_limits_protection_to_selected_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "media"
            root.mkdir()
            settings = normalize_settings({"enabled": True, "directory": str(root)})
            self.assertTrue(is_managed_path(root / "clip.mp4", settings))
            self.assertFalse(is_managed_path(Path(directory) / "media-other" / "clip.mp4", settings))
            self.assertFalse(is_managed_path(root / "clip.mp4", {**settings, "enabled": False}))

    def test_placeholder_is_indexed_without_reading_then_enriched_when_local(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as db_directory:
            root = Path(directory)
            image_path = root / "picture.jpg"
            PILImage.new("RGB", (12, 9)).save(image_path)
            with patch.multiple(DataBase, path=str(Path(db_directory) / "test.db"), local=threading.local()):
                try:
                    conn = DataBase.get_conn()
                    GlobalSetting.save_setting(conn, SETTING_NAME, json.dumps({"enabled": True, "directory": str(root)}))
                    with patch("scripts.iib.db.update_image_data.online_only_paths", side_effect=lambda paths, _: set(paths)), \
                         patch("scripts.iib.db.update_image_data.get_exif_data", side_effect=AssertionError("read placeholder")):
                        update_image_data([str(root)])
                    pending = Image.get(conn, str(image_path))
                    self.assertIsNotNone(pending)
                    self.assertTrue(pending.content_pending)
                    self.assertIsNone(pending.width)
                    pending.update_description(conn, "保留描述")
                    conn.commit()

                    with patch("scripts.iib.db.update_image_data.online_only_paths", return_value=set()):
                        update_image_data([str(root)])
                    ready = Image.get(conn, str(image_path))
                    self.assertEqual(ready.id, pending.id)
                    self.assertFalse(ready.content_pending)
                    self.assertEqual((ready.width, ready.height), (12, 9))
                    self.assertEqual(ready.description, "保留描述")
                finally:
                    if hasattr(DataBase.local, "conn"):
                        DataBase.local.conn.close()


if __name__ == "__main__":
    unittest.main()
