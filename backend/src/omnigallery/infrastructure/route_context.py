import asyncio
import os
import sqlite3
from dataclasses import dataclass, field
from typing import Any

from fastapi import HTTPException

from omnigallery.config import enable_access_control, get_cache_dir
from omnigallery.infrastructure.collections import unique_by
from omnigallery.infrastructure.database import Database
from omnigallery.infrastructure.logging import logger
from omnigallery.infrastructure.paths import normalize_paths, to_abs_path
from omnigallery.infrastructure.sequence import seq
from omnigallery.library.folder_repository import LibraryPath
from omnigallery.library.schemas import FileInfo
from omnigallery.storage.cloud_files import get_sync_settings, online_only_paths


@dataclass
class RouteContext:
    options: dict[str, Any] = field(default_factory=dict)
    api_base: str = "/api"
    mem: dict[str, Any] = field(
        default_factory=lambda: {"extra_paths": [], "all_scanned_paths": []}
    )
    index_update_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    @property
    def cache_base_dir(self):
        return get_cache_dir()

    def update_all_scanned_paths(self):
        allowed_paths = os.getenv("OMNIGALLERY_ACCESS_CONTROL_ALLOWED_PATHS")
        if allowed_paths:
            paths = normalize_paths(
                seq(allowed_paths.split(","))
                .map(lambda path: path.strip())
                .filter(lambda x: x)
                .to_list(),
                os.getcwd(),
            )
        else:
            paths = self.mem["extra_paths"] + self.options.get("extra_paths_cli", [])
        self.mem["all_scanned_paths"] = unique_by(paths)

    def update_extra_paths(self, conn: sqlite3.Connection):
        r = LibraryPath.get_extra_paths(conn)
        self.mem["extra_paths"] = [x.path for x in r]
        self.update_all_scanned_paths()

    def safe_commonpath(self, paths):
        try:
            return os.path.commonpath(paths)
        except ValueError:
            return ""

    def is_path_under_parents(self, path, parent_paths: list[str] | None = None):
        """
        Check if the given path is under one of the specified parent paths.
        :param path: The path to check.
        :param parent_paths: By default, all scanned paths are included in the list of parent paths
        :return: True if the path is under one of the parent paths, False otherwise.
        """
        try:
            if parent_paths is None:
                parent_paths = self.mem["all_scanned_paths"]
            path = os.path.normcase(to_abs_path(path))
            for parent_path in parent_paths:
                parent_path = os.path.normcase(to_abs_path(parent_path))
                if self.safe_commonpath([path, parent_path]) == parent_path:
                    return True
        except Exception as e:
            logger.error(e)
        return False

    def is_path_trusted(self, path: str):
        if not enable_access_control:
            return True
        return self.is_path_under_parents(path)

    def is_path_browsable(self, path: str):
        """Allow ancestors only for navigating toward an authorized library root."""
        if not enable_access_control:
            return True
        try:
            parent_paths = self.mem["all_scanned_paths"]
            path = os.path.normcase(to_abs_path(path))
            for parent_path in parent_paths:
                parent_path = os.path.normcase(to_abs_path(parent_path))
                common_path = self.safe_commonpath([path, parent_path])
                if common_path and common_path in (path, parent_path):
                    return True
        except Exception:
            pass
        return False

    def check_path_trust(self, path: str):
        if not self.is_path_trusted(path):
            raise HTTPException(status_code=403)

    def filter_allowed_files(self, files: list[FileInfo]):
        settings = get_sync_settings(Database.get_connection())
        result = [
            item
            for item in files
            if self.is_path_trusted(item["fullpath"])
            or (item["type"] == "dir" and self.is_path_browsable(item["fullpath"]))
        ]
        cloud_paths = online_only_paths((x["fullpath"] for x in result), settings)
        for item in result:
            item["cloud_only"] = item["fullpath"] in cloud_paths
        return result
