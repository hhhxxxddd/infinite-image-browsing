"""One application data root and the fixed child directories owned by the app."""

import atexit
import json
import os
import sqlite3
import sys
import tempfile
import threading
import uuid
from pathlib import Path

from dotenv import load_dotenv

from omnigallery.storage.filesystem import DirectoryLease, checked_path

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = PACKAGE_ROOT.parents[2]
IS_NUITKA = "__compiled__" in globals()
IS_PYINSTALLER = bool(getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"))
IS_PACKAGED = IS_NUITKA or IS_PYINSTALLER
APPLICATION_ROOT = Path(sys.executable).resolve().parent if IS_PACKAGED else PROJECT_ROOT
RESOURCE_ROOT = Path(
    getattr(sys, "_MEIPASS", os.getenv("OMNIGALLERY_BUNDLE_ROOT", APPLICATION_ROOT))
)
load_dotenv(APPLICATION_ROOT / ".env")

# Keep existing child names so upgrading the default layout does not move large files.
DIRECTORIES = {
    "db": "数据库与设置",
    "project-data": "工作区与编辑记录",
    "templates": "模板",
    "exports": "归档与导出",
    "cache": "缓存",
    "tmp": "临时文件",
    "models": "模型",
    "ai-runtime": "Python AI 运行环境",
    "gguf-runtime": "GGUF 运行环境",
    "media-runtime": "FFmpeg 运行环境",
    "logs": "日志",
}


def write_json(path: Path, value):
    path = checked_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix=".storage-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


class ApplicationStorage:
    def __init__(self, default: Path, legacy: dict | None = None):
        self.default = checked_path(default)
        self.locator = self.default / "storage.json"
        self.legacy = legacy or {}
        self.lock = threading.RLock()
        self.leases: dict[Path, DirectoryLease] = {}
        self.prepared = False
        self.state = self._read()
        self.root = checked_path(Path(self.state.get("directory", str(self.default))))

    def _read(self):
        if not self.locator.exists():
            return {}
        checked_path(self.locator)
        value = json.loads(self.locator.read_text("utf-8"))
        if not isinstance(value, dict) or value.get("version") != 1:
            raise ValueError(f"应用数据位置配置无效：{self.locator}")
        for key in ("directory", "pending_directory"):
            path = value.get(key)
            if key == "pending_directory" and path is None:
                continue
            if (
                not isinstance(path, str)
                or not path
                or "\0" in path
                or not Path(path).is_absolute()
            ):
                raise ValueError(f"应用数据位置必须是绝对路径：{self.locator}")
        return value

    def _save(self, state):
        write_json(self.locator, state)
        self.state = state

    def _lease(self, directory):
        directory = checked_path(directory)
        if directory not in self.leases:
            self.leases[directory] = DirectoryLease(directory)

    def prepare(self):
        """Run before importing the application, opening its DB or starting any workers."""
        from omnigallery.storage.migration import consolidate_legacy, migrate_root

        with self.lock:
            if self.prepared:
                return
            self._lease(self.default)
            self.state = self._read()
            self.root = checked_path(Path(self.state.get("directory", str(self.default))))
            self._lease(self.root)
            for name in DIRECTORIES:
                child = checked_path(self.root / name)
                if child.exists() and not child.is_dir():
                    raise ValueError(f"应用数据子目录被同名文件占用：{child}")
            if not self.state:
                report = consolidate_legacy(self.root, self.legacy)
                self._save({"version": 1, "directory": str(self.root), **report})
            (self.root / ".storage-upgrade.json").unlink(missing_ok=True)
            pending = self.state.get("pending_directory")
            if pending:
                target = Path(pending)
                try:
                    target = checked_path(target)
                    self._lease(target)
                    migrate_root(self, target)
                except (OSError, ValueError, sqlite3.Error) as error:
                    # Continue on the intact original root; the settings page can retry/cancel.
                    self._save({**self.state, "error": str(error)})
                    if target != self.root and target != self.default:
                        lease = self.leases.pop(target, None)
                        if lease:
                            lease.close()
            self.prepared = True

    def settings(self):
        return {
            "directory": str(self.root),
            "default_directory": str(self.default),
            "pending_directory": self.state.get("pending_directory", ""),
            "restart_required": bool(self.state.get("pending_directory")),
            "error": self.state.get("error", ""),
            "backups": self.state.get("backups", []),
            "directories": [
                {"name": name, "label": label, "path": str(self.root / name)}
                for name, label in DIRECTORIES.items()
            ],
        }

    def schedule(self, directory: str):
        from omnigallery.storage.migration import validate_destination

        with self.lock:
            text = directory.strip()
            if text and (not Path(text).is_absolute() or "\0" in text):
                raise ValueError("请填写文件服务所在电脑的绝对目录路径")
            target = checked_path(Path(text) if text else self.default)
            if target != self.root:
                validate_destination(self, target)
            state = {**self.state, "version": 1, "directory": str(self.root)}
            state.pop("error", None)
            if target == self.root:
                state.pop("pending_directory", None)
                state.pop("pending_id", None)
            else:
                state["pending_directory"] = str(target)
                state["pending_id"] = uuid.uuid4().hex
            self._save(state)
            return self.settings()

    def close(self):
        for lease in self.leases.values():
            lease.close()
        self.leases.clear()
        self.prepared = False


storage = ApplicationStorage(
    Path(os.getenv("OMNIGALLERY_DATA_DIR", str(APPLICATION_ROOT / ".local"))),
    {
        "db": os.getenv("OMNIGALLERY_DB_PATH", ""),
        "cache": os.getenv("OMNIGALLERY_CACHE_DIR", "")
        or os.getenv("OMNIGALLERY_LEGACY_CACHE_DIR", ""),
        "project-data": os.getenv("OMNIGALLERY_PROJECT_DATA_DIR", "")
        or (str(APPLICATION_ROOT / ".local/project-data") if IS_PACKAGED else ""),
        "models": os.getenv("OMNIGALLERY_MODEL_DIR", ""),
    },
)
atexit.register(storage.close)
