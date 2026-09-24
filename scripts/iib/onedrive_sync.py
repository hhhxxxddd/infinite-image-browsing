"""Local OneDrive folder settings and Windows Files On-Demand detection.

The app never signs in to OneDrive or transfers files.  In protected mode it
may list placeholders, but background indexing must not open their contents.
"""

import base64
import os
import re
import sqlite3
import subprocess


SETTING_NAME = "onedrive_sync"
FILE_ATTRIBUTE_OFFLINE = 0x1000
FILE_ATTRIBUTE_RECALL_ON_OPEN = 0x40000
FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS = 0x400000
ONLINE_ONLY_ATTRIBUTES = (
    FILE_ATTRIBUTE_OFFLINE
    | FILE_ATTRIBUTE_RECALL_ON_OPEN
    | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS
)


def normalize_settings(value):
    if not isinstance(value, dict):
        value = {}
    directory = value.get("directory")
    return {
        "enabled": value.get("enabled") is True,
        "directory": directory.strip() if isinstance(directory, str) else "",
    }


def get_sync_settings(conn):
    from scripts.iib.db.datamodel import GlobalSetting

    try:
        return normalize_settings(GlobalSetting.get_setting(conn, SETTING_NAME))
    except sqlite3.OperationalError as error:
        # Some migration/standalone callers only initialize the image tables.
        if "no such table: global_setting" not in str(error):
            raise
        return normalize_settings(None)


def is_managed_path(path, settings):
    if not settings.get("enabled") or not settings.get("directory"):
        return False
    try:
        root = os.path.normcase(os.path.abspath(settings["directory"]))
        candidate = os.path.normcase(os.path.abspath(path))
        return os.path.commonpath((root, candidate)) == root
    except (OSError, ValueError):
        return False


def is_online_only(path):
    if os.name != "nt":
        return False
    try:
        import ctypes

        get_attributes = ctypes.windll.kernel32.GetFileAttributesW
        get_attributes.argtypes = [ctypes.c_wchar_p]
        get_attributes.restype = ctypes.c_uint32
        attributes = get_attributes(str(path))
        return attributes != 0xFFFFFFFF and bool(attributes & ONLINE_ONLY_ATTRIBUTES)
    except (AttributeError, OSError, ValueError):
        return False


def _wsl_windows_path(path):
    match = re.match(r"^/mnt/([a-zA-Z])/(.+)$", str(path))
    if not match:
        return None
    return match.group(1).upper() + ":\\" + match.group(2).replace("/", "\\")


def online_only_paths(paths, settings):
    """Return protected placeholders, querying Windows in one batch under WSL."""
    managed = [str(path) for path in paths if is_managed_path(path, settings)]
    if not managed:
        return set()
    if os.name == "nt":
        return {path for path in managed if is_online_only(path)}
    converted = [(_wsl_windows_path(path), path) for path in managed]
    converted = [(win_path, path) for win_path, path in converted if win_path]
    if not converted:
        return set(managed)
    powershell = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
    if not os.path.isfile(powershell):
        return set(managed)
    script = (
        "[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);"
        "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);"
        "while(($p=[Console]::ReadLine()) -ne $null){"
        "try{$a=[uint32][IO.File]::GetAttributes($p);"
        "if(($a -band 0x441000) -ne 0){[Console]::WriteLine('1')}"
        "else{[Console]::WriteLine('0')}}"
        "catch{[Console]::WriteLine('0')}}"
    )
    try:
        result = subprocess.run(
            [powershell, "-NoProfile", "-NonInteractive", "-EncodedCommand", base64.b64encode(script.encode("utf-16le")).decode("ascii")],
            input="".join(win_path + "\n" for win_path, _ in converted),
            text=True, encoding="utf-8", capture_output=True, timeout=30, check=True,
        )
        flags = result.stdout.splitlines()
        if len(flags) != len(converted) or any(flag.strip() not in ("0", "1") for flag in flags):
            return set(managed)
        return {path for (_, path), flag in zip(converted, flags) if flag.strip() == "1"}
    except (OSError, subprocess.SubprocessError, UnicodeError):
        return set(managed)


def is_protected_online_path(path, settings):
    return str(path) in online_only_paths([path], settings)
