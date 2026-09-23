import base64
import subprocess
import unittest
from unittest.mock import patch

from scripts.iib.local_folder_picker import _choose_with_windows_dialog


class LocalFolderPickerTests(unittest.TestCase):
    @patch("scripts.iib.local_folder_picker._is_wsl", return_value=True)
    @patch("scripts.iib.local_folder_picker.shutil.which", return_value="powershell.exe")
    @patch("scripts.iib.local_folder_picker.subprocess.run")
    def test_wsl_converts_selected_windows_path(self, run, _which, _wsl):
        windows_path = "C:\\Users\\测试\\Pictures"
        encoded = base64.b64encode(windows_path.encode("utf-8")).decode("ascii")
        run.side_effect = [
            subprocess.CompletedProcess([], 0, stdout=encoded),
            subprocess.CompletedProcess([], 0, stdout="/mnt/c/Users/测试/Pictures\n"),
        ]

        self.assertEqual(_choose_with_windows_dialog(), "/mnt/c/Users/测试/Pictures")
        self.assertEqual(run.call_args_list[1].args[0], ["wslpath", "-u", windows_path])

    @patch("scripts.iib.local_folder_picker._is_wsl", return_value=False)
    @patch("scripts.iib.local_folder_picker.shutil.which", return_value="powershell.exe")
    @patch("scripts.iib.local_folder_picker.subprocess.run")
    def test_cancel_returns_none(self, run, _which, _wsl):
        run.return_value = subprocess.CompletedProcess([], 0, stdout="")
        self.assertIsNone(_choose_with_windows_dialog())
        run.assert_called_once()


if __name__ == "__main__":
    unittest.main()
