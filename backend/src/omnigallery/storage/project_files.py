"""Project files are fixed children of the application data directory."""

import threading
from functools import wraps
from pathlib import Path

from omnigallery.config import PROJECT_DATA_ROOT
from omnigallery.storage.layout import storage

storage_lock = threading.RLock()
STORES = (
    "omnigallery-workspace-artifacts",
    "omnigallery-edit-history",
    "media-covers",
    "template-assets",
    "image-editor-assets",
    "image-editor-tasks",
)


def storage_operation(function):
    @wraps(function)
    def guarded(*args, **kwargs):
        with storage_lock:
            return function(*args, **kwargs)

    return guarded


def storage_root():
    return PROJECT_DATA_ROOT


def storage_settings():
    return {"directory": str(storage_root()), "stores": list(STORES)}


def is_project_storage_path(path):
    candidate = Path(path).resolve()
    roots = [
        storage.root,
        PROJECT_DATA_ROOT,
        *(Path(value) for value in storage.state.get("excluded_paths", [])),
    ]
    return any(candidate == root.resolve() or root.resolve() in candidate.parents for root in roots)
