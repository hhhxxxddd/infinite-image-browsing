"""Indexing keeps newly added media in nested folders discoverable."""
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image as PILImage

from scripts.iib.db.datamodel import DataBase, Folder, Image
from scripts.iib.db.update_image_data import update_image_data


class ScanRefreshTests(unittest.TestCase):
    def test_incremental_scan_indexes_new_nested_images_and_ignores_other_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            child = root / "child"
            child.mkdir()
            PILImage.new("RGB", (8, 8)).save(root / "first.jpg")
            PILImage.new("RGB", (8, 8)).save(child / "second.jpg")
            (root / "notes.txt").write_text("not media")

            with patch.multiple(DataBase, path=str(root / "test.db"), local=threading.local()):
                try:
                    update_image_data([str(root)])
                    conn = DataBase.get_conn()
                    self.assertEqual(Image.count(conn), 2)
                    self.assertEqual(Folder.get_expired_dirs(conn), [])

                    PILImage.new("RGB", (8, 8)).save(child / "third.jpg")
                    # Folder timestamps are currently stored to the nearest second.
                    stat = child.stat()
                    os.utime(child, (stat.st_atime, stat.st_mtime + 2))
                    self.assertIn(str(child), Folder.get_expired_dirs(conn))
                    update_image_data([str(child)])
                    self.assertEqual(Image.count(conn), 3)
                finally:
                    if hasattr(DataBase.local, "conn"):
                        DataBase.local.conn.close()


if __name__ == "__main__":
    unittest.main()
