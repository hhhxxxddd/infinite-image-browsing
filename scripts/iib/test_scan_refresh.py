"""Indexing keeps newly added media in nested folders discoverable."""
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image as PILImage

from scripts.iib.db.datamodel import DataBase, ExtraPath, Folder, Image
from scripts.iib.db.update_image_data import update_image_data


class ScanRefreshTests(unittest.TestCase):
    def test_removed_scan_root_cleans_only_its_images(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as db_directory:
            first_root = Path(directory) / "first"
            second_root = Path(directory) / "second"
            first_root.mkdir()
            second_root.mkdir()
            PILImage.new("RGB", (8, 8)).save(first_root / "first.jpg")
            nested = first_root / "nested"
            nested.mkdir()
            PILImage.new("RGB", (8, 8)).save(nested / "nested.jpg")
            PILImage.new("RGB", (8, 8)).save(second_root / "second.jpg")

            with patch.multiple(DataBase, path=str(Path(db_directory) / "test.db"), local=threading.local()):
                try:
                    conn = DataBase.get_conn()
                    ExtraPath(str(first_root), ["scanned", "walk"]).save(conn)
                    ExtraPath(str(second_root), ["scanned", "walk"]).save(conn)
                    update_image_data([str(first_root), str(second_root)])
                    self.assertEqual(Image.count(conn), 3)

                    scanned_paths = [str(first_root), str(second_root)]
                    ExtraPath.remove(conn, str(first_root), ["walk"], all_scanned_paths=scanned_paths)
                    self.assertEqual(Image.count(conn), 3)
                    self.assertEqual(ExtraPath.get_target_path(conn, str(first_root)).types, ["scanned"])

                    ExtraPath.remove(conn, str(first_root), ["scanned"], all_scanned_paths=scanned_paths)
                    self.assertIsNone(Image.get(conn, str(first_root / "first.jpg")))
                    self.assertIsNone(Image.get(conn, str(nested / "nested.jpg")))
                    self.assertIsNotNone(Image.get(conn, str(second_root / "second.jpg")))
                    self.assertEqual(Image.count(conn), 1)
                    self.assertEqual(conn.execute("SELECT count(*) FROM folders WHERE path = ?", (str(nested),)).fetchone()[0], 0)
                finally:
                    if hasattr(DataBase.local, "conn"):
                        DataBase.local.conn.close()

    def test_incremental_scan_indexes_new_nested_images_and_ignores_other_files(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as db_directory:
            root = Path(directory)
            child = root / "child"
            child.mkdir()
            PILImage.new("RGB", (8, 8)).save(root / "first.jpg")
            PILImage.new("RGB", (8, 8)).save(child / "second.jpg")
            (root / "notes.txt").write_text("not media")

            with patch.multiple(DataBase, path=str(Path(db_directory) / "test.db"), local=threading.local()):
                try:
                    update_image_data([str(root)])
                    conn = DataBase.get_conn()
                    self.assertEqual(Image.count(conn), 2)
                    first = Image.get(conn, str(root / "first.jpg"))
                    self.assertEqual((first.width, first.height), (8, 8))
                    self.assertEqual(Folder.get_expired_dirs(conn), [])

                    PILImage.new("RGB", (8, 8)).save(child / "third.jpg")
                    # A second file can arrive within the same displayed second.
                    stat = child.stat()
                    second = stat.st_mtime_ns // 1_000_000_000
                    changed_ns = second * 1_000_000_000 + 100_000_000
                    if changed_ns == stat.st_mtime_ns:
                        changed_ns += 1
                    os.utime(child, ns=(stat.st_atime_ns, changed_ns))
                    self.assertIn(str(child), Folder.get_expired_dirs(conn))
                    update_image_data([str(child)])
                    self.assertEqual(Image.count(conn), 3)
                finally:
                    if hasattr(DataBase.local, "conn"):
                        DataBase.local.conn.close()


if __name__ == "__main__":
    unittest.main()
