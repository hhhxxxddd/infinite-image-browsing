import ctypes
import os
import platform
import subprocess
import sys

from omnigallery.config import cwd


def get_windows_drives():
    drives = []
    bitmask = ctypes.windll.kernel32.GetLogicalDrives()
    for letter in range(65, 91):
        if bitmask & 1:
            drive_name = chr(letter) + ":/"
            drives.append(drive_name)
        bitmask >>= 1
    return drives


def open_folder(folder_path, file_path=None):
    folder = os.path.realpath(folder_path)
    if file_path:
        file = os.path.join(folder, file_path)
        if os.name == "nt":
            subprocess.run(["explorer", "/select,", file])
        elif sys.platform == "darwin":
            subprocess.run(["open", "-R", file])
        elif os.name == "posix":
            subprocess.run(["xdg-open", file])
    else:
        if os.name == "nt":
            subprocess.run(["explorer", folder])
        elif sys.platform == "darwin":
            subprocess.run(["open", folder])
        elif os.name == "posix":
            subprocess.run(["xdg-open", folder])


def open_file_with_default_app(file_path):
    system = platform.system()
    if system == "Darwin":  # macOS
        subprocess.call(["open", file_path])
    elif system == "Windows":  # Windows
        os.startfile(file_path)
    elif system == "Linux":  # Linux
        subprocess.call(["xdg-open", file_path])
    else:
        raise OSError(f"Unsupported operating system: {system}")


def open_file_with_app_picker(file_path):
    """Let Windows users choose a local player for a file the WebView cannot decode."""
    if platform.system() == "Windows":
        os.startfile(file_path, "openas")
    else:
        open_file_with_default_app(file_path)


def get_current_commit_hash():
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"], capture_output=True, text=True, cwd=cwd
        )
        if result.returncode == 0:
            return result.stdout.strip()
        else:
            return None
    except Exception:
        return None


def get_current_tag():
    try:
        result = subprocess.run(
            ["git", "describe", "--tags", "--abbrev=0"], capture_output=True, text=True, cwd=cwd
        )
        if result.returncode == 0:
            return result.stdout.strip()
        else:
            return None
    except Exception:
        return None
