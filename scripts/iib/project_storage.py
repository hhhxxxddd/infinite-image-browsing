"""Configurable, non-indexed project file storage and verified directory migration."""
import hashlib
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import threading
from functools import wraps
from pathlib import Path

from scripts.iib.db.datamodel import DataBase, GlobalSetting
from scripts.iib.tool import is_exe_ver

storage_lock = threading.RLock()
STORES = ("iib-workspace-artifacts", "iib-edit-history")


def storage_operation(function):
    @wraps(function)
    def guarded(*args, **kwargs):
        with storage_lock:
            return function(*args, **kwargs)
    return guarded


def _setting():
    try:
        return GlobalSetting.get_setting(DataBase.get_conn(), "project_storage") or {}
    except sqlite3.OperationalError as error:
        # Small embedded consumers may not yet have created global settings.
        if "no such table: global_setting" in str(error):
            return {}
        raise


def default_root():
    base = Path(sys.executable).resolve().parent if is_exe_ver else Path(DataBase.get_db_file_path()).resolve().parent
    return base / "iib-project-data"


def storage_settings():
    saved = _setting()
    default = default_root()
    legacy = Path(DataBase.get_db_file_path()).resolve().parent
    # Existing installs continue reading their current files until an explicit migration.
    existing = not saved.get("directory") and any((legacy / name).exists() for name in STORES)
    current = Path(saved["directory"]) if saved.get("directory") else legacy if existing else default
    return {"directory": str(current), "default_directory": str(default),
            "custom_directory": str(current) if saved.get("directory") and current != default else "",
            "legacy": existing, "stores": list(STORES)}


def storage_root():
    return Path(storage_settings()["directory"])


def is_project_storage_path(path):
    candidate = Path(path).resolve()
    saved = _setting()
    roots = [storage_root(), *(Path(value) for value in saved.get("previous_directories", []))]
    for root in roots:
        for name in STORES:
            parent = (root / name).resolve()
            if candidate == parent or parent in candidate.parents:
                return True
    return False


def _digest(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.digest()


def migrate_storage(directory):
    from scripts.iib.studio_tasks import task_lock
    # Match the AI result writer's lock order (task, then storage).
    with task_lock, storage_lock:
        text = directory.strip()
        if text and (not os.path.isabs(text) or "\0" in text):
            raise ValueError("请填写绝对目录路径")
        destination = Path(text).resolve() if text else default_root().resolve()
        source = storage_root().resolve()
        if destination == source:
            return {**storage_settings(), "migrated": False}
        # Never put one managed store inside another, including old backup locations.
        if is_project_storage_path(destination):
            raise ValueError("请选择独立目录，不能放在已有素材或编辑记录目录内部")
        for name in STORES:
            target = destination / name
            if target.exists():
                raise ValueError(f"目标目录已含 {name}，请选择空的项目数据目录")
        destination.mkdir(parents=True, exist_ok=True)
        staging = Path(tempfile.mkdtemp(prefix=".iib-migration-", dir=destination))
        published = []
        count = total = 0
        try:
            for name in STORES:
                origin = source / name
                if not origin.exists():
                    continue
                # Symlinks can escape the selected store; refuse instead of following them.
                if origin.is_symlink() or any(item.is_symlink() for item in origin.rglob("*")):
                    raise ValueError("项目数据中含符号链接，无法自动迁移")
                shutil.copytree(origin, staging / name)
                for item in origin.rglob("*"):
                    if item.is_file():
                        copied = staging / name / item.relative_to(origin)
                        if item.stat().st_size != copied.stat().st_size or _digest(item) != _digest(copied):
                            raise OSError("数据校验失败，仍使用原目录")
                        count += 1
                        total += item.stat().st_size
            for name in STORES:
                if (staging / name).exists():
                    os.replace(staging / name, destination / name)
                    published.append(destination / name)
            saved = _setting()
            previous = list(dict.fromkeys([*saved.get("previous_directories", []), str(source)]))
            GlobalSetting.save_setting(DataBase.get_conn(), "project_storage", json.dumps({"directory": str(destination), "previous_directories": previous}))
        except Exception:
            # Only directories created by this migration may be removed.
            for target in published:
                if target.parent.resolve() == destination and target.name in STORES:
                    shutil.rmtree(target)
            raise
        finally:
            if staging.parent.resolve() == destination and staging.name.startswith(".iib-migration-"):
                shutil.rmtree(staging, ignore_errors=True)
        return {**storage_settings(), "migrated": True, "files": count, "bytes": total,
                "previous_directory": str(source) if count else None}
