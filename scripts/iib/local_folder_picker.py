"""Choose a folder on the machine running the media server."""

import base64
import os
import shutil
import subprocess
import sys
import threading


_dialog_lock = threading.Lock()


def _is_wsl() -> bool:
    if os.environ.get("WSL_DISTRO_NAME"):
        return True
    if sys.platform != "linux":
        return False
    try:
        with open("/proc/sys/kernel/osrelease", encoding="utf-8") as release:
            return "microsoft" in release.read().lower()
    except OSError:
        return False


def _choose_with_windows_dialog() -> str | None:
    powershell = shutil.which("powershell.exe") or shutil.which("powershell")
    if not powershell:
        raise RuntimeError("找不到 Windows PowerShell，请手动输入文件夹路径")
    script = (
        "$ErrorActionPreference = 'Stop'; "
        "Add-Type -AssemblyName System.Windows.Forms; "
        "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog; "
        "$dialog.Description = 'Select a media folder'; "
        "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { "
        "[Console]::Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($dialog.SelectedPath))) "
        "}"
    )
    encoded = base64.b64encode(script.encode("utf-16le")).decode("ascii")
    options = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
    result = subprocess.run(
        [powershell, "-NoProfile", "-Sta", "-EncodedCommand", encoded],
        capture_output=True, text=True, encoding="utf-8", errors="replace", **options,
    )
    if result.returncode:
        raise RuntimeError("无法打开 Windows 文件夹选择器，请手动输入路径")
    selected = result.stdout.strip()
    if not selected:
        return None
    try:
        path = base64.b64decode(selected, validate=True).decode("utf-8")
    except (ValueError, UnicodeError) as exc:
        raise RuntimeError("无法读取所选文件夹路径") from exc
    if _is_wsl():
        converted = subprocess.run(
            ["wslpath", "-u", path],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        if converted.returncode:
            raise RuntimeError("所选 Windows 文件夹无法映射到 WSL，请手动输入路径")
        path = converted.stdout.strip()
    return path


def choose_local_directory() -> str | None:
    """Return a server-readable absolute path, or None when the dialog is cancelled."""
    if not _dialog_lock.acquire(blocking=False):
        raise RuntimeError("已有文件夹选择窗口，请先完成当前选择")
    try:
        if os.name == "nt" or _is_wsl():
            return _choose_with_windows_dialog()
        if sys.platform == "darwin":
            result = subprocess.run(
                ["osascript", "-e", 'POSIX path of (choose folder with prompt "选择媒体文件夹")'],
                capture_output=True, text=True, encoding="utf-8", errors="replace",
            )
            return result.stdout.strip() or None
        if shutil.which("zenity"):
            command = ["zenity", "--file-selection", "--directory", "--title=选择媒体文件夹"]
        elif shutil.which("kdialog"):
            command = ["kdialog", "--getexistingdirectory", ".", "选择媒体文件夹"]
        else:
            raise RuntimeError("此环境没有可用的文件夹选择器，请手动输入绝对路径")
        result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
        return result.stdout.strip() or None
    finally:
        _dialog_lock.release()
