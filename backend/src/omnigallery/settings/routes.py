import json
import os

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel

from omnigallery.config import DATA_ROOT, cwd, enable_access_control, is_win
from omnigallery.infrastructure.auth import (
    is_api_writeable,
    verify_secret,
    write_permission_required,
)
from omnigallery.infrastructure.database import Database
from omnigallery.infrastructure.logging import logger
from omnigallery.infrastructure.platform import get_current_commit_hash, get_current_tag
from omnigallery.infrastructure.route_context import RouteContext
from omnigallery.library.folder_repository import LibraryPath, LibraryPathType
from omnigallery.library.tag_repository import Tag
from omnigallery.storage.archive import archive_settings, check_archive_directory
from omnigallery.storage.archive_settings import current_archive_settings
from omnigallery.storage.cloud_files import SETTING_NAME, get_sync_settings
from omnigallery.storage.settings_repository import SettingsRepository


class SyncSettingsRequest(BaseModel):
    enabled: bool = False
    directory: str = ""


class ArchiveSettingsRequest(BaseModel):
    directory: str = ""


class AppFeSettingRequest(BaseModel):
    name: str
    value: str


class AppFeSettingDelRequest(BaseModel):
    name: str


def mount_routes(app: FastAPI, context: RouteContext):
    update_extra_paths = context.update_extra_paths
    is_path_under_parents = context.is_path_under_parents
    check_path_trust = context.check_path_trust
    api_base = context.api_base
    kwargs = context.options

    @app.get(f"{api_base}/hello")
    async def greeting():
        return "hello"

    @app.get(f"{api_base}/archive_settings", dependencies=[Depends(verify_secret)])
    def get_archive_settings():
        return current_archive_settings()

    @app.get(f"{api_base}/sync_settings", dependencies=[Depends(verify_secret)])
    def read_sync_settings():
        return get_sync_settings(Database.get_connection())

    @app.put(
        f"{api_base}/sync_settings",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def save_sync_settings(req: SyncSettingsRequest):
        directory = req.directory.strip()
        if req.enabled:
            if not directory or not os.path.isabs(directory) or not os.path.isdir(directory):
                raise HTTPException(400, "请选择这台电脑上由 OneDrive 管理的有效文件夹")
            directory = os.path.normpath(directory)
            if enable_access_control and not is_path_under_parents(directory):
                raise HTTPException(403, "该目录不在允许访问的路径内")
        elif directory:
            directory = os.path.normpath(directory)
        settings = {"enabled": req.enabled, "directory": directory}
        conn = Database.get_connection()
        SettingsRepository.save_setting(conn, SETTING_NAME, json.dumps(settings))
        if req.enabled:
            path = LibraryPath.get_target_path(conn, directory)
            if path is None:
                LibraryPath(directory, [LibraryPathType.walk.value]).save(conn)
                conn.commit()
            update_extra_paths(conn)
        return settings

    @app.put(
        f"{api_base}/archive_settings",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def save_archive_settings(req: ArchiveSettingsRequest):
        try:
            settings = archive_settings(req.directory, str(DATA_ROOT))
            if settings["custom_directory"]:
                check_path_trust(os.path.realpath(settings["directory"]))
            check_archive_directory(settings["directory"])
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        except OSError as error:
            raise HTTPException(400, "目录不可用或没有写入权限，请选择其他目录") from error
        SettingsRepository.save_setting(
            Database.get_connection(),
            "archive",
            json.dumps({"directory": settings["custom_directory"]}),
        )
        return settings

    @app.get(f"{api_base}/global_setting", dependencies=[Depends(verify_secret)])
    async def global_setting():
        all_custom_tags = []

        extra_paths = []
        app_fe_setting = {}
        try:
            conn = Database.get_connection()
            all_custom_tags = Tag.get_all_custom_tag(conn)
            extra_paths = LibraryPath.get_extra_paths(conn) + [
                LibraryPath(path, LibraryPathType.cli_only.value)
                for path in kwargs.get("extra_paths_cli", [])
            ]
            update_extra_paths(conn)
            app_fe_setting = SettingsRepository.get_all_settings(conn)
        except Exception as e:
            print(e)
        return {
            "cwd": cwd,
            "is_win": is_win,
            "home": os.environ.get("USERPROFILE") if is_win else os.environ.get("HOME"),
            "working_dir": os.getcwd(),
            "archive": current_archive_settings(),
            "all_custom_tags": all_custom_tags,
            "extra_paths": extra_paths,
            "enable_access_control": enable_access_control,
            "launch_mode": "server",
            "app_fe_setting": app_fe_setting,
            "is_readonly": not is_api_writeable,
        }

    @app.post(
        f"{api_base}/app_fe_setting",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    async def app_fe_setting(req: AppFeSettingRequest):
        conn = Database.get_connection()
        SettingsRepository.save_setting(conn, req.name, req.value)
        # 如果更新的是自动标签规则，重新加载
        if req.name == "auto_tag_rules":
            from omnigallery.library.auto_tag import AutoTagMatcher

            AutoTagMatcher.reload_rules(conn)

    @app.delete(
        f"{api_base}/app_fe_setting",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    async def remove_app_fe_setting(req: AppFeSettingDelRequest):
        conn = Database.get_connection()
        SettingsRepository.remove_setting(conn, req.name)

    @app.get(f"{api_base}/version", dependencies=[Depends(verify_secret)])
    async def get_version():
        import platform
        import sys

        def _get_dist_version(dist_name: str = None, module_name: str = None):
            # Try importlib.metadata first (distribution metadata), then fallback to module __version__
            try:
                if dist_name:
                    try:
                        from importlib.metadata import version

                        return version(dist_name)
                    except Exception:
                        pass
                if module_name:
                    mod = __import__(module_name)
                    return getattr(mod, "__version__", None)
                if dist_name:
                    # try importing by normalized name
                    mod = __import__(dist_name.replace("-", "_"))
                    return getattr(mod, "__version__", None)
            except Exception as e:
                logger.debug("Version probe failed for %s/%s: %s", dist_name, module_name, e)
            return None

        versions = {
            "python_version": sys.version.splitlines()[0],
            "platform": platform.platform(),
            "hash": get_current_commit_hash(),
            "tag": get_current_tag(),
            "av": _get_dist_version("av", "av"),
            "imageio": _get_dist_version("imageio", "imageio"),
            "pillow": _get_dist_version("Pillow", "PIL"),
            "requests": _get_dist_version("requests", "requests"),
            "numpy": _get_dist_version("numpy", "numpy"),
            "hnswlib": _get_dist_version("hnswlib", "hnswlib"),
        }

        logger.info("Version info requested: %s", {k: v for k, v in versions.items() if v})
        return versions
