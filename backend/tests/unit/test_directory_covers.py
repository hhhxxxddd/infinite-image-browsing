import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from omnigallery.library.directory_covers import get_media_files_from_folder


class DirectoryCoverTests(unittest.TestCase):
    def test_only_media_is_statted_and_newest_four_are_selected(self):
        entries = []
        for index in range(100):
            entry = Mock()
            entry.name = f"{index}.png"
            entry.path = "/library/" + entry.name
            entry.is_file.return_value = True
            entry.stat.return_value = SimpleNamespace(
                st_mtime=index, st_ctime=index, st_birthtime=index
            )
            entries.append(entry)
        directory = Mock()
        directory.path = "/library/subfolder"
        directory.is_file.return_value = False
        other = Mock()
        other.name = "readme.txt"
        other.path = "/library/readme.txt"
        other.is_file.return_value = True
        listing = Mock()
        listing.__enter__ = Mock(return_value=iter([directory, other, *entries]))
        listing.__exit__ = Mock(return_value=False)
        with patch("omnigallery.library.directory_covers.os.scandir", return_value=listing):
            result = get_media_files_from_folder("/library")
        self.assertEqual(
            [item["name"] for item in result], ["99.png", "98.png", "97.png", "96.png"]
        )
        directory.stat.assert_not_called()
        other.stat.assert_not_called()
