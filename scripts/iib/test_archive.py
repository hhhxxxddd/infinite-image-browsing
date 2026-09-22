import os
import tempfile
import unittest
import zipfile
from unittest.mock import patch
from scripts.iib.archive import archive_settings, check_archive_directory, write_archive


class ArchiveTests(unittest.TestCase):
    def test_default_and_custom_destination(self):
        with tempfile.TemporaryDirectory() as root:
            default = archive_settings("", root)
            self.assertEqual(default["directory"], os.path.join(root, "zip_temp"))
            custom = archive_settings(os.path.join(root, "exports"), root)
            self.assertEqual(custom["directory"], os.path.join(root, "exports"))
            self.assertEqual(archive_settings("  ", root), default)

    def test_reject_relative_or_invalid_destination(self):
        for path in ["exports", "../exports", "C:exports", "/invalid\0path"]:
            with self.subTest(path=path), self.assertRaises(ValueError):
                archive_settings(path, os.getcwd())

    def test_create_directory_and_distinct_archives(self):
        with tempfile.TemporaryDirectory() as root:
            target = os.path.join(root, "custom", "archives")
            check_archive_directory(target)
            self.assertEqual(os.listdir(target), [])
            source = os.path.join(root, "example.txt")
            with open(source, "w") as stream:
                stream.write("archive content " * 200)
            paths = [write_archive([source], target, compress) for compress in [False, True]]
            self.assertNotEqual(paths[0], paths[1])
            for path, compression in zip(paths, [zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED]):
                self.assertEqual(os.path.dirname(path), target)
                with zipfile.ZipFile(path) as archive:
                    info = archive.infolist()[0]
                    self.assertEqual(info.compress_type, compression)
                    self.assertEqual(archive.read(info), b"archive content " * 200)

    def test_existing_file_is_not_a_directory(self):
        with tempfile.NamedTemporaryFile() as target:
            with self.assertRaises(OSError):
                check_archive_directory(target.name)

    def test_failed_archive_leaves_no_partial_zip(self):
        with tempfile.TemporaryDirectory() as root:
            with patch("scripts.iib.archive.create_zip_file", side_effect=OSError("disk full")):
                with self.assertRaises(OSError):
                    write_archive(["example.png"], root, False)
            self.assertEqual(os.listdir(root), [])


if __name__ == "__main__":
    unittest.main()
