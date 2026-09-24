import base64
import asyncio
from starlette.concurrency import run_in_threadpool
import json
from datetime import datetime, timedelta
import os
import shutil
import sqlite3
import threading

from scripts.iib.dir_cover_cache import get_top_4_media_info
from scripts.iib.tool import (
    get_created_date_by_stat,
    get_video_type,
    human_readable_size,
    is_valid_media_path,
    is_media_file,
    get_cache_dir,
    get_formatted_date,
    get_modified_date,
    is_win,
    is_dev,
    cwd,
    locale,
    enable_access_control,
    get_windows_drives,
    open_folder,
    get_img_geninfo_txt_path,
    unique_by,
    create_zip_file,
    normalize_paths,
    to_abs_path,
    open_file_with_default_app,
    open_file_with_app_picker,
    is_exe_ver,
    backup_db_file,
    get_current_commit_hash,
    get_current_tag,
    get_file_info_by_path,
    get_data_file_path
)
from fastapi import FastAPI, HTTPException, Response
from typing import List, Optional
from pydantic import BaseModel
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image, ExifTags
from scripts.iib.thumbnail_size import fit_short_edge
from fastapi import Depends, Request
from fastapi.middleware.cors import CORSMiddleware
import hashlib
from scripts.iib.db.datamodel import (
    DataBase,
    ExtraPathType,
    Image as DbImg,
    Tag,
    Folder,
    ImageTag,
    ExtraPath,
    FileInfoDict,
    Cursor, 
    GlobalSetting,
)
from scripts.iib.db.update_image_data import update_image_data, rebuild_image_index, add_image_data_single, inherit_edited_image_data
from scripts.iib.archive import archive_settings, check_archive_directory, write_archive
from scripts.iib.db.size_filter import ImageSizeFilter
from scripts.iib.db.search_filters import MediaSearchFilters
from scripts.iib.db.media_order import ensure_media_order, move_media, swap_media
from scripts.iib.image_edit import edit_image_copy
from scripts.iib.media_motion import is_animated_image
from scripts.iib.folder_rename import rename_managed_folder
from scripts.iib.folder_icons import mount_folder_icon_routes, remap_folder_icons
from scripts.iib.audio_metadata import mount_audio_routes
from scripts.iib.video_cover_gen import write_video_cover
from scripts.iib.topic_cluster import mount_topic_cluster_routes
from scripts.iib.tag_graph import mount_tag_graph_routes
from scripts.iib.organize_files import mount_organize_routes
from scripts.iib.similarity import mount_similarity_routes
from scripts.iib.qwen3_vl_search import mount_qwen3_vl_routes
from scripts.iib.qwen3_vl_instruct import mount_qwen3_vl_instruct_routes
from scripts.iib.image_ai import mount_image_ai_routes
from scripts.iib.qwen_model_manager import mount_qwen_model_manager_routes
from scripts.iib.logger import logger
from scripts.iib.local_folder_picker import choose_local_directory
from scripts.iib.seq import seq
import urllib.parse
from scripts.iib.fastapi_video import range_requests_response, close_video_file_reader

import requests
import dotenv



# 加载环境变量
dotenv.load_dotenv()

index_html_path = get_data_file_path("vue/dist/index.html") if is_exe_ver else os.path.join(cwd, "vue/dist/index.html")  # 在app.py也被使用


mem = {"secret_key_hash": None, "extra_paths": [], "all_scanned_paths": []}
secret_key = os.getenv("IIB_SECRET_KEY")
if secret_key:
    print("Secret key loaded successfully. ")

# AI 配置
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
AI_MODEL = os.getenv("AI_MODEL", "gpt-4o-mini")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")

# Dedicated TwelveLabs key for the optional Marengo embedding backend, kept
# separate from OPENAI_API_KEY so the OpenAI-compatible chat path (cluster
# titles) and the Marengo embedding path can use different services without
# clobbering each other. Falls back to the SDK's own var and then to
# OPENAI_API_KEY for backward compatibility.
TWELVELABS_API_KEY = (
    os.getenv("TWELVELABS_API_KEY")
    or os.getenv("TWELVE_LABS_API_KEY")
    or OPENAI_API_KEY
)

print(f"AI Model: {AI_MODEL or 'Not configured'}")
print(f"OpenAI Base URL: {OPENAI_BASE_URL}")
print(f"OpenAI API Key: {'Configured' if OPENAI_API_KEY else 'Not configured'}")
print(f"Embedding Model: {EMBEDDING_MODEL or 'Not configured'}")
print(f"TwelveLabs API Key: {'Configured' if TWELVELABS_API_KEY else 'Not configured'}")

WRITEABLE_PERMISSIONS = ["read-write", "write-only"]

is_api_writeable = not (os.getenv("IIB_ACCESS_CONTROL_PERMISSION")) or (
    os.getenv("IIB_ACCESS_CONTROL_PERMISSION") in WRITEABLE_PERMISSIONS
)
IIB_DEBUG=False

_MAX_THUMBNAIL_DIMENSION = 4096
_THUMBNAIL_GENERATION_SLOTS = threading.BoundedSemaphore(
    max(2, min(4, os.cpu_count() or 2))
)
_THUMBNAIL_LOCKS = tuple(threading.Lock() for _ in range(64))


def _parse_thumbnail_size(size: str):
    try:
        width, height = (int(value) for value in size.lower().split("x", 1))
    except (AttributeError, TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid thumbnail size")

    if not (0 < width <= _MAX_THUMBNAIL_DIMENSION and 0 < height <= _MAX_THUMBNAIL_DIMENSION):
        raise HTTPException(status_code=400, detail="Invalid thumbnail size")
    return width, height


def _ensure_thumbnail(path: str, cache_path: str, width: int, height: int, fit: str = "contain"):
    if os.path.exists(cache_path):
        return

    lock_idx = int(hashlib.md5(cache_path.encode("utf-8")).hexdigest()[:8], 16) % len(_THUMBNAIL_LOCKS)
    # Wait for a generation slot *before* taking the per-key lock, so threads
    # waiting for a slot do not hold a stripe lock (which would needlessly
    # serialize unrelated cache keys that hash to the same stripe).
    with _THUMBNAIL_GENERATION_SLOTS:
        with _THUMBNAIL_LOCKS[lock_idx]:
            if os.path.exists(cache_path):
                return

            os.makedirs(os.path.dirname(cache_path), exist_ok=True)
            temp_path = f"{cache_path}.{threading.get_ident()}.tmp"
            try:
                with Image.open(path) as img:
                    target_size = fit_short_edge(img.size, min(width, height)) if fit == "short" else (width, height)
                    # JPEG decoders can downsample during decode, which saves substantial
                    # CPU and memory for large source images.
                    img.draft("RGB", target_size)
                    img.thumbnail(target_size)
                    img.save(temp_path, "WEBP", quality=80, method=1)
                os.replace(temp_path, cache_path)
            except Exception:
                # Deleted or broken source images used to surface as opaque 500s,
                # hammered on every retry; report them as 404 so the client can
                # fall back to the raw file instead.
                raise HTTPException(status_code=404, detail="Failed to generate thumbnail")
            finally:
                if os.path.exists(temp_path):
                    os.remove(temp_path)


async def write_permission_required():
    if not is_api_writeable:
        error_msg = (
            "User is not authorized to perform this action. Required permission: "
            + ", ".join(WRITEABLE_PERMISSIONS)
        )
        raise HTTPException(status_code=403, detail=error_msg)


async def verify_secret(request: Request):
    if not secret_key:
        return
    token = request.cookies.get("IIB_S")
    if not token:
        raise HTTPException(status_code=401, detail={"type": "secret_verification_failed"})
    if not mem["secret_key_hash"]:
        mem["secret_key_hash"] = hashlib.sha256(
            (secret_key + "_ciallo").encode("utf-8")
        ).hexdigest()
    if mem["secret_key_hash"] != token:
        raise HTTPException(status_code=401, detail={"type": "secret_verification_failed"})

DEFAULT_BASE = "/infinite_image_browsing"
def infinite_image_browsing_api(app: FastAPI, **kwargs):
    backup_db_file(DataBase.get_db_file_path())
    api_base = kwargs.get("base") if isinstance(kwargs.get("base"), str) else DEFAULT_BASE
    fe_public_path = kwargs.get("fe_public_path") if isinstance(kwargs.get("fe_public_path"), str) else api_base
    cache_base_dir = get_cache_dir()
    index_update_lock = asyncio.Lock()

    # print(f"IIB api_base:{api_base} fe_public_path:{fe_public_path}")
    if IIB_DEBUG or is_exe_ver:
        @app.exception_handler(Exception)
        async def exception_handler(request: Request, exc: Exception):
            error_msg = f"An exception occurred while processing {request.method} {request.url}: {exc}"
            logger.error(error_msg)

            return JSONResponse(
                status_code=500, content={"message": "Internal Server Error"}
            )
        @app.middleware("http")
        async def log_requests(request: Request, call_next):
            path = request.url.path
            if (
                path.find("infinite_image_browsing/image-thumbnail") == -1
                and path.find("infinite_image_browsing/file") == -1
                and path.find("infinite_image_browsing/fe-static") == -1
            ):
                logger.info(f"Received request: {request.method} {request.url}")
                if request.query_params:
                    logger.debug(f"Query Params: {request.query_params}")
                if request.path_params:
                    logger.debug(f"Path Params: {request.path_params}")

            try:
                return await call_next(request)
            except HTTPException as http_exc:
                logger.warning(
                    f"HTTPException occurred while processing {request.method} {request.url}: {http_exc}"
                )
                raise http_exc
            except Exception as exc:
                logger.error(
                    f"An exception occurred while processing {request.method} {request.url}: {exc}"
                )

    
    if kwargs.get("allow_cors"):
        app.add_middleware(
            CORSMiddleware,
            allow_origin_regex=r"^[\w./:-]+$",
            allow_methods=["*"],
            allow_headers=["*"],
            allow_credentials=True,
        )

    def update_all_scanned_paths():
        allowed_paths = os.getenv("IIB_ACCESS_CONTROL_ALLOWED_PATHS")
        if allowed_paths:
            paths = normalize_paths(
                seq(allowed_paths.split(","))
                .map(lambda path: path.strip())
                .filter(lambda x: x)
                .to_list(),
                os.getcwd()
            )
        else:
            paths = (
                mem["extra_paths"]
                + kwargs.get("extra_paths_cli", [])
            )
        mem["all_scanned_paths"] = unique_by(paths)

    update_all_scanned_paths()

    def update_extra_paths(conn: sqlite3.Connection):
        r = ExtraPath.get_extra_paths(conn)
        mem["extra_paths"] = [x.path for x in r]
        update_all_scanned_paths()

    def safe_commonpath(seq):
        try:
            return os.path.commonpath(seq)
        except Exception as e:
            # logger.error(e)
            return ""

    def is_path_under_parents(path, parent_paths: List[str] | None = None):
        """
        Check if the given path is under one of the specified parent paths.
        :param path: The path to check.
        :param parent_paths: By default, all scanned paths are included in the list of parent paths
        :return: True if the path is under one of the parent paths, False otherwise.
        """
        try:
            if not parent_paths:
                parent_paths = mem["all_scanned_paths"]
            path = to_abs_path(path)
            for parent_path in parent_paths:
                if safe_commonpath([path, parent_path]) == parent_path:
                    return True
        except Exception as e:
            logger.error(e)
        return False

    def is_path_trusted(path: str):
        if not enable_access_control:
            return True
        try:
            parent_paths = mem["all_scanned_paths"]
            path = to_abs_path(path)
            for parent_path in parent_paths:
                parent_path = os.path.realpath(parent_path)
                if len(path) <= len(parent_path):
                    if parent_path.startswith(path):
                        return True
                else:
                    if path.startswith(parent_path + os.sep):
                        return True
        except:
            pass
        return False

    def check_path_trust(path: str):
        if not is_path_trusted(path):
            raise HTTPException(status_code=403)

    def filter_allowed_files(files: List[FileInfoDict]):
        return [x for x in files if is_path_trusted(x["fullpath"])]



    class PathsReq(BaseModel):
        paths: List[str]

    @app.get(f"{api_base}/hello")
    async def greeting():
        return "hello"

    def current_archive_settings():
        saved = GlobalSetting.get_setting(DataBase.get_conn(), "archive") or {}
        return archive_settings(saved.get("directory", ""), cwd)

    @app.get(f"{api_base}/archive_settings", dependencies=[Depends(verify_secret)])
    def get_archive_settings():
        return current_archive_settings()

    class ArchiveSettingsReq(BaseModel):
        directory: str = ""

    @app.put(f"{api_base}/archive_settings", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def save_archive_settings(req: ArchiveSettingsReq):
        try:
            settings = archive_settings(req.directory, cwd)
            if settings["custom_directory"]:
                check_path_trust(os.path.realpath(settings["directory"]))
            check_archive_directory(settings["directory"])
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        except OSError as error:
            raise HTTPException(400, "目录不可用或没有写入权限，请选择其他目录") from error
        GlobalSetting.save_setting(DataBase.get_conn(), "archive", json.dumps({"directory": settings["custom_directory"]}))
        return settings

    @app.get(f"{api_base}/global_setting", dependencies=[Depends(verify_secret)])
    async def global_setting():
        all_custom_tags = []

        extra_paths = []
        app_fe_setting = {}
        try:
            conn = DataBase.get_conn()
            all_custom_tags = Tag.get_all_custom_tag(conn)
            extra_paths = ExtraPath.get_extra_paths(conn) + [
                ExtraPath(path, ExtraPathType.cli_only.value)
                for path in kwargs.get("extra_paths_cli", [])
            ]
            update_extra_paths(conn)
            app_fe_setting = GlobalSetting.get_all_settings(conn)
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
            "export_fe_fn": bool(kwargs.get("export_fe_fn")),
            "app_fe_setting": app_fe_setting,
            "is_readonly": not is_api_writeable,
        }
    
    
    class AppFeSettingReq(BaseModel):
        name: str
        value: str
    
    @app.post(f"{api_base}/app_fe_setting", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    async def app_fe_setting(req: AppFeSettingReq):
        conn = DataBase.get_conn()
        GlobalSetting.save_setting(conn, req.name, req.value)
        # 如果更新的是自动标签规则，重新加载
        if req.name == "auto_tag_rules":
            from scripts.iib.auto_tag import AutoTagMatcher
            AutoTagMatcher.reload_rules(conn)

    class AppFeSettingDelReq(BaseModel):
        name: str

    @app.delete(f"{api_base}/app_fe_setting", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    async def remove_app_fe_setting(req: AppFeSettingDelReq):
        conn = DataBase.get_conn()
        GlobalSetting.remove_setting(conn, req.name)
    
    @app.get(f"{api_base}/version", dependencies=[Depends(verify_secret)])
    async def get_version():
        import sys
        import platform

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

    class DeleteFilesReq(BaseModel):
        file_paths: List[str]

    @app.post(
        api_base + "/delete_files",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    async def delete_files(req: DeleteFilesReq):
        conn = DataBase.get_conn()

        for path in req.file_paths:
            check_path_trust(path)
            try:
                if os.path.isdir(path):
                    if len(os.listdir(path)):
                        error_msg = (
                            "When a folder is not empty, it is not allowed to be deleted."
                            if locale == "en"
                            else "文件夹不为空时不允许删除。"
                        )
                        raise HTTPException(400, detail=error_msg)
                    os.rmdir(path)
                    Folder.remove_folder(conn, path)
                    conn.execute("DELETE FROM folder_icon WHERE path = ?", (os.path.normpath(path),))
                    conn.commit()
                else:
                    close_video_file_reader(path)
                    txt_path = get_img_geninfo_txt_path(path)

                    os.remove(path)
                    if txt_path:
                        os.remove(txt_path)

                    img = DbImg.get(conn, os.path.normpath(path))
                    if img:
                        logger.info("delete file: %s", path)
                        ImageTag.remove(conn, img.id)
                        DbImg.remove(conn, img.id)
            except OSError as e:
                # 处理删除失败的情况
                logger.error("delete failed")
                error_msg = (
                    f"Error deleting file {path}: {e}"
                    if locale == "en"
                    else f"删除文件 {path} 时出错：{e}"
                )
                raise HTTPException(400, detail=error_msg)

        return {"ok": True}

    class CreateFoldersReq(BaseModel):
        dest_folder: str

    @app.post(
        api_base + "/mkdirs",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    async def create_folders(req: CreateFoldersReq):
        if enable_access_control:
            if not is_path_under_parents(req.dest_folder):
                raise HTTPException(status_code=403)
        os.makedirs(req.dest_folder, exist_ok=True)

    class MoveFilesReq(BaseModel):
        file_paths: List[str]
        dest: str
        create_dest_folder: Optional[bool] = False
        continue_on_error: Optional[bool] = False

    @app.post(
        api_base + "/copy_files",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    async def copy_files(req: MoveFilesReq):
        errors = []
        for path in req.file_paths:
            try:
                check_path_trust(path)
                shutil.copy(path, req.dest)
                txt_path = get_img_geninfo_txt_path(path)
                if txt_path:
                    shutil.copy(txt_path, req.dest)
            except OSError as e:
                error_msg = (
                    f"Error copying file {path} to {req.dest}: {e}"
                    if locale == "en"
                    else f"复制文件 {path} 到 {req.dest} 时出错：{e}"
                )
                if req.continue_on_error:
                    errors.append(error_msg)
                    continue
                raise HTTPException(400, detail=error_msg)
        return {"errors": errors}

    @app.post(
        api_base + "/move_files",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    async def move_files(req: MoveFilesReq):
        if req.create_dest_folder:
            os.makedirs(req.dest, exist_ok=True)
        elif not os.path.isdir(req.dest):
            error_msg = (
                f"Destination folder {req.dest} does not exist."
                if locale == "en"
                else f"目标文件夹 {req.dest} 不存在。"
            )
            raise HTTPException(400, detail=error_msg)

        conn = DataBase.get_conn()        
        errors = []

        def move_file_with_geninfo(path: str, dest: str):
            path = os.path.normpath(path)
            txt_path = get_img_geninfo_txt_path(path)
            if txt_path:
                shutil.move(txt_path, dest)
            img = DbImg.get(conn, path)
            new_path = os.path.normpath(os.path.join(dest, os.path.basename(path)))
            if img:
                logger.info(f"update file path: {path} -> {new_path} in db")
                img.update_path(conn, new_path, force=True)

        for path in req.file_paths:
            try:
                check_path_trust(path)
                path = os.path.normpath(path)
                base_dir = os.path.dirname(path)
                files = list(os.walk(path))
                is_dir = os.path.isdir(path)
                shutil.move(path, req.dest)
                if is_dir:
                    remap_folder_icons(conn, path, os.path.join(req.dest, os.path.basename(path)))
                    for root, _, files in files:
                        relative_path = root[len(base_dir) + 1 :]
                        dest = os.path.join(req.dest, relative_path)
                        for file in files:
                            is_valid = is_media_file(file)
                            if is_valid:
                                move_file_with_geninfo(os.path.join(root, file), dest)
                else:
                    move_file_with_geninfo(path, req.dest)
                            
                conn.commit()
            except OSError as e:
                
                conn.rollback()
                error_msg = (
                    f"Error moving file {path} to {req.dest}: {e}"
                    if locale == "en"
                    else f"移动文件 {path} 到 {req.dest} 时出错：{e}"
                )
                if req.continue_on_error:
                    errors.append(error_msg)
                    continue
                raise HTTPException(400, detail=error_msg)
        return {"errors": errors}

    @app.get(api_base + "/files", dependencies=[Depends(verify_secret)])
    def get_target_folder_files(folder_path: str, directories_only: bool = False):
        files: List[FileInfoDict] = []
        try:
            if is_win and folder_path == "/":
                for item in get_windows_drives():
                    files.append(
                        {"type": "dir", "size": "-", "name": item, "fullpath": item}
                    )
            else:
                if not os.path.exists(folder_path):
                    return {"files": []}
                folder_path = to_abs_path(folder_path)
                check_path_trust(folder_path)
                is_under_scanned_path = is_path_under_parents(folder_path)
                with os.scandir(folder_path) as folder_listing:
                    for item in folder_listing:
                        try:
                            is_dir = item.is_dir()
                            if directories_only and not is_dir:
                                continue
                            fullpath = os.path.normpath(item.path)
                            if directories_only:
                                # Node graphs and folder chips need names and
                                # paths only; avoid a stat call per directory.
                                files.append({"type": "dir", "date": "", "created_time": "",
                                              "size": "-", "name": item.name,
                                              "is_under_scanned_path": is_under_scanned_path,
                                              "fullpath": fullpath})
                                continue
                            is_file = not is_dir and item.is_file()
                            if not (is_dir or is_file):
                                continue
                            stat = item.stat()
                        except OSError:
                            # The file may have disappeared during enumeration.
                            continue
                        date = get_formatted_date(stat.st_mtime)
                        created_time = get_created_date_by_stat(stat)
                        if is_file:
                            files.append(
                                {
                                    "type": "file",
                                    "date": date,
                                    "size": human_readable_size(stat.st_size),
                                    "name": item.name,
                                    "bytes": stat.st_size,
                                    "created_time": created_time,
                                    "fullpath": fullpath,
                                    "is_under_scanned_path": is_under_scanned_path,
                                }
                            )
                        else:
                            files.append(
                                {
                                    "type": "dir",
                                    "date": date,
                                    "created_time": created_time,
                                    "size": "-",
                                    "name": item.name,
                                    "is_under_scanned_path": is_under_scanned_path,
                                    "fullpath": fullpath,
                                }
                            )
        except Exception as e:
            # logger.error(e)
            raise HTTPException(status_code=400, detail=str(e))

        return {"files": filter_allowed_files(files)}
    

    @app.post(api_base + "/batch_get_files_info", dependencies=[Depends(verify_secret)])
    async def batch_get_files_info(req: PathsReq):
        res = {}
        for path in req.paths:
            check_path_trust(path)
            res[path] = get_file_info_by_path(path)
        return res

    @app.get(api_base + "/image-thumbnail", dependencies=[Depends(verify_secret)])
    def thumbnail(path: str, t: str, size: str = "256x256", fit: str = "contain"):
        check_path_trust(path)
        if not cache_base_dir:
            return
        if fit not in {"contain", "short"}:
            raise HTTPException(status_code=400, detail="Invalid thumbnail fit")
        width, height = _parse_thumbnail_size(size)
        size = f"{width}x{height}"
        # 生成缓存文件的路径
        hash_dir = hashlib.md5((path + t).encode("utf-8")).hexdigest()
        cache_name = f"short-{size}" if fit == "short" else size
        hash = hash_dir + cache_name
        cache_dir = os.path.join(cache_base_dir, "iib_cache", hash_dir)
        cache_path = os.path.join(cache_dir, f"{cache_name}.webp")
        cache_headers = {
            "Cache-Control": "public, max-age=31536000, immutable",
            "ETag": hash,
        }

        # 如果缓存文件存在，则直接返回该文件
        if os.path.exists(cache_path):
            return FileResponse(
                cache_path,
                media_type="image/webp",
                headers=cache_headers,
            )

                
        # Keep the small-file shortcut for legacy previews; short-edge cards
        # must still honor their requested resolution.
        if fit == "contain" and os.path.getsize(path) < 64 * 1024:
            return FileResponse(
                path,
                media_type="image/" + path.split(".")[-1],
                headers=cache_headers,
            )
        

        # 如果缓存文件不存在，则生成缩略图并保存
        _ensure_thumbnail(path, cache_path, width, height, fit)

        # 返回缓存文件
        return FileResponse(
            cache_path,
            media_type="image/webp",
            headers=cache_headers,
        )

    @app.get(api_base + "/img/{filename}", dependencies=[Depends(verify_secret)])
    async def get_image(filename: str, path: str, t: str):
        import mimetypes
        import urllib.parse

        check_path_trust(path)

        # 验证文件名是否匹配
        actual_filename = os.path.basename(path)
        decoded_filename = urllib.parse.unquote(filename)

        if actual_filename != decoded_filename:
            raise HTTPException(status_code=400, detail="Filename mismatch")

        if not os.path.exists(path):
            raise HTTPException(status_code=404)
        if not os.path.isfile(path):
            raise HTTPException(status_code=400, detail=f"{path} is not a file")

        # 验证是否为图片文件
        media_type, _ = mimetypes.guess_type(path)
        if media_type and not media_type.startswith('image/'):
            raise HTTPException(status_code=400, detail="Not an image file")

        # 设置 Content-Disposition 为 inline，带文件名
        headers = {}
        encoded_filename = urllib.parse.quote(filename.encode('utf-8'))
        headers['Content-Disposition'] = f"inline; filename*=UTF-8''{encoded_filename}"

        if is_path_under_parents(path) and is_valid_media_path(path):
            headers["Cache-Control"] = "public, max-age=31536000"
            headers["Expires"] = (datetime.now() + timedelta(days=365)).strftime(
                "%a, %d %b %Y %H:%M:%S GMT"
            )

        return FileResponse(
            path,
            media_type=media_type,
            headers=headers,
        )

    @app.get(api_base + "/file", dependencies=[Depends(verify_secret)])
    async def get_file(path: str, t: str, disposition: Optional[str] = None):
        filename = path
        import mimetypes

        check_path_trust(path)
        if not os.path.exists(filename):
            raise HTTPException(status_code=404)
        if not os.path.isfile(filename):
            raise HTTPException(status_code=400, detail=f"{filename} is not a file")
        # 根据文件后缀名获取媒体类型
        media_type, _ = mimetypes.guess_type(filename)
        headers = {}
        if disposition:
            encoded_filename = urllib.parse.quote(disposition.encode('utf-8'))
            headers['Content-Disposition'] = f"attachment; filename*=UTF-8''{encoded_filename}"

        if is_path_under_parents(filename) and is_valid_media_path(
            filename
        ):  # 认为永远不变,不要协商缓存了试试
            headers[
                "Cache-Control"
            ] = "public, max-age=31536000"  # 针对同样名字文件但实际上不同内容的文件要求必须传入创建时间来避免浏览器缓存
            headers["Expires"] = (datetime.now() + timedelta(days=365)).strftime(
                "%a, %d %b %Y %H:%M:%S GMT"
            )

        return FileResponse(
            filename,
            media_type=media_type,
            headers=headers,
        )
    
    @app.get(api_base + "/stream_video", dependencies=[Depends(verify_secret)])
    async def stream_video(path: str, request: Request):      
        check_path_trust(path)
        import mimetypes
        media_type, _ = mimetypes.guess_type(path)
        return range_requests_response(
            request, file_path=path, content_type=media_type
        )

    @app.get(api_base + "/media_motion", dependencies=[Depends(verify_secret)])
    def media_motion(path: str):
        check_path_trust(path)
        try:
            stat = os.stat(path)
            if not os.path.isfile(path):
                raise HTTPException(400, "需要媒体文件")
            return {"animated": is_animated_image(path, stat.st_mtime_ns, stat.st_size)}
        except FileNotFoundError as error:
            raise HTTPException(404, "文件不存在") from error
        except (OSError, ValueError) as error:
            raise HTTPException(400, "无法读取媒体文件") from error

    @app.get(api_base + "/video_cover", dependencies=[Depends(verify_secret)])
    def video_cover(path: str, mt: str):
        check_path_trust(path)
        if not cache_base_dir:
            return
        
        if not os.path.exists(path):
            raise HTTPException(status_code=404)
        if not os.path.isfile(path) and get_video_type(path):
            raise HTTPException(status_code=400, detail=f"{path} is not a video file")
        # 生成缓存文件的路径
        hash_dir = hashlib.md5((path + mt).encode("utf-8")).hexdigest()
        hash = hash_dir
        cache_dir = os.path.join(cache_base_dir, "iib_cache", "video_cover", hash_dir)
        cache_path = os.path.join(cache_dir, "cover.webp")
        # 如果缓存文件存在，则直接返回该文件
        if os.path.exists(cache_path):
            return FileResponse(
                cache_path,
                media_type="image/webp",
                headers={
                    "Cache-Control": "no-store",
                },
            )
        if not is_media_file(path):
            raise HTTPException(status_code=400, detail=f"{path} is not a video file")
        # 如果缓存文件不存在，则生成缩略图并保存
        try:
            logger.info(
                "Generating video cover thumbnail: path=%s, mt=%s, cache_path=%s",
                path,
                mt,
                cache_path,
            )
            write_video_cover(path, cache_path)
            logger.info("Saved video cover thumbnail: %s", cache_path)
        except Exception as e:
            # record full stack trace and contextual info in English
            logger.exception(
                "Failed to generate video cover for path=%s mt=%s cache_dir=%s: %s",
                path,
                mt,
                cache_dir,
                e,
            )
            # return a clear HTTP error (detail contains exception message)
            raise HTTPException(status_code=500, detail=f"Failed to generate video cover: {e}")

        # 返回缓存文件
        return FileResponse(
            cache_path,
            media_type="image/webp",
            headers={
                "Cache-Control": "no-store",
            },
        )
    
    class SetTargetFrameAsCoverReq(BaseModel):
        base64_img: str
        path: str
        updated_time: str

    def save_base64_image(base64_str, file_path):
        if base64_str.startswith('data:image'):
            base64_str = base64_str.split(',')[1]
        image_data = base64.b64decode(base64_str)
        with open(file_path, 'wb') as file:
            file.write(image_data)

    @app.post(api_base+ "/set_target_frame_as_video_cover", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    async def set_target_frame_as_video_cover(req: SetTargetFrameAsCoverReq):
        hash_dir = hashlib.md5((req.path + req.updated_time).encode("utf-8")).hexdigest()
        hash = hash_dir
        cache_dir = os.path.join(cache_base_dir, "iib_cache", "video_cover", hash_dir)
        cache_path = os.path.join(cache_dir, "cover.webp")

        os.makedirs(cache_dir, exist_ok=True)
        
        save_base64_image(req.base64_img, cache_path)
        return FileResponse(
            cache_path,
            media_type="image/webp",
            headers={"ETag": hash},
        )

    @app.get(api_base + "/image_geninfo", dependencies=[Depends(verify_secret)])
    async def image_geninfo(path: str):
        from scripts.iib.db.update_image_data import get_exif_data
        conn = DataBase.get_conn()
        try:
            img = DbImg.get(conn, path)

            # dev 模式下，未编辑过的直接从文件读取（方便调试 EXIF 解析）
            if is_dev and (not img or not img.exif_edited):
                result = get_exif_data(path)
                return result.raw_info or ""

            # 优先从数据库查询
            if img and img.exif:
                return img.exif

            # 数据库中没有，从文件读取
            result = get_exif_data(path)
            raw_info = result.raw_info or ""

            # 如果 DbImg 存在，将读取到的数据缓存到数据库
            if img and raw_info:
                img.exif = raw_info
                img.update(conn)

            return raw_info
        except Exception as e:
            logger.error(f"Failed to get geninfo for {path}: {e}")
            return ""

    class GeninfoBatchReq(BaseModel):
        paths: List[str]

    @app.post(api_base + "/image_geninfo_batch", dependencies=[Depends(verify_secret)])
    async def image_geninfo_batch(req: GeninfoBatchReq):
        from scripts.iib.db.update_image_data import get_exif_data
        res = {}
        conn = DataBase.get_conn()
        for path in req.paths:
            try:
                img = DbImg.get(conn, path)
                if img:
                    res[path] = img.exif
                else:
                    result = get_exif_data(path)
                    res[path] = result.raw_info or ""
            except Exception as e:
                logger.error(f"Failed to get geninfo for {path}: {e}", stack_info=True)
                res[path] = ""
        return res

    class ImageCropRect(BaseModel):
        x: float
        y: float
        width: float
        height: float

    class ImageEditReq(BaseModel):
        path: str
        crop: ImageCropRect
        width: int
        height: int

    @app.post(api_base + "/edit_image", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def save_edited_image(req: ImageEditReq):
        check_path_trust(req.path)
        try:
            destination = edit_image_copy(req.path, req.crop.model_dump(), req.width, req.height)
        except FileNotFoundError as error:
            raise HTTPException(404, "原图不存在") from error
        except (ValueError, OSError) as error:
            raise HTTPException(400, str(error)) from error
        add_image_data_single(destination)
        inherit_edited_image_data(req.path, destination, req.width, req.height)
        file = get_file_info_by_path(destination)
        file.update(width=req.width, height=req.height)
        return {"file": file}

    @app.get(api_base + "/image_exif", dependencies=[Depends(verify_secret)])
    async def image_exif(path: str):
        try:
            if get_video_type(path):
                return {}
            with Image.open(path) as img:
                exif_data = {
                    "格式": img.format or "",
                    "像素尺寸": f"{img.width} × {img.height}",
                    "颜色模式": img.mode,
                }
                try:
                    exif_dict = img.getexif()
                    if exif_dict:
                        exif_data.update({str(ExifTags.TAGS.get(k, k)): str(v) for k, v in exif_dict.items()})
                except AttributeError:
                    pass

                info_data = {k: str(v) for k, v in img.info.items() if not k.startswith('exif')}
                exif_data.update(info_data)

                return exif_data
        except Exception as e:
            logger.error(f"Failed to get exif for {path}: {e}")
            return {}

    class UpdateExifReq(BaseModel):
        path: str
        exif: str

    @app.post(api_base + "/update_exif", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    async def update_exif(req: UpdateExifReq):
        """更新图片/视频的 exif 信息"""
        conn = DataBase.get_conn()
        try:
            img = DbImg.get(conn, req.path)
            if img:
                img.update_exif(conn, req.exif)
                conn.commit()
                return {"success": True, "message": "Exif updated successfully"}
            else:
                # 如果数据库中没有记录，创建新记录
                img = DbImg(path=req.path, exif=req.exif, exif_edited=True)
                # 获取文件信息
                if os.path.exists(req.path):
                    stat = os.stat(req.path)
                    img.size = stat.st_size
                    img.date = get_modified_date(req.path)
                img.save(conn)
                conn.commit()
                return {"success": True, "message": "Exif created successfully"}
        except Exception as e:
            logger.error(f"Failed to update exif for {req.path}: {e}", stack_info=True)
            raise HTTPException(status_code=500, detail=str(e))


    class CheckPathExistsReq(BaseModel):
        paths: List[str]

    @app.post(api_base + "/check_path_exists", dependencies=[Depends(verify_secret)])
    async def check_path_exists(req: CheckPathExistsReq):
        update_all_scanned_paths()
        res = {}
        for path in req.paths:
            res[path] = os.path.exists(path) and is_path_trusted(path)
        return res

    @app.post(api_base + "/check_path_is_directory", dependencies=[Depends(verify_secret)])
    async def check_path_is_directory(req: CheckPathExistsReq):
        update_all_scanned_paths()
        return {path: os.path.isdir(path) and is_path_trusted(path) for path in req.paths}

    @app.post(
        api_base + "/choose_local_directory",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def choose_directory(request: Request):
        # A browser cannot disclose an absolute local folder path. Open the
        # server machine's native dialog only for a locally opened app.
        from ipaddress import ip_address

        from urllib.parse import urlsplit

        try:
            local_client = bool(request.client and ip_address(request.client.host).is_loopback)
        except ValueError:
            local_client = False
        origin = request.headers.get("origin") or request.headers.get("referer")
        local_origin = not origin or urlsplit(origin).hostname in {"localhost", "127.0.0.1", "::1"}
        if not local_client or not local_origin:
            raise HTTPException(status_code=403, detail="只能从本机打开文件夹选择器")
        try:
            path = choose_local_directory()
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        if path and not os.path.isdir(path):
            raise HTTPException(status_code=422, detail="所选文件夹无法由媒体服务读取，请手动输入路径")
        return {"path": path}

    @app.get(api_base)
    def index_bd():
        if fe_public_path:
            with open(index_html_path, "r", encoding="utf-8") as file:
                content = file.read().replace(DEFAULT_BASE, fe_public_path)
                return Response(content=content, media_type="text/html")
        return FileResponse(index_html_path)
    
    static_dir = get_data_file_path("vue/dist") if is_exe_ver else f"{cwd}/vue/dist" 
    @app.get(api_base + "/fe-static/{file_path:path}")
    async def serve_static_file(file_path: str):
        file_full_path = f"{static_dir}/{file_path}"
        if file_path.endswith(".js"):
            with open(file_full_path, "r", encoding="utf-8") as file:
                content = file.read().replace(DEFAULT_BASE, fe_public_path)
            return Response(content=content, media_type="text/javascript")
        else:
            return FileResponse(file_full_path)

    class OpenFolderReq(BaseModel):
        path: str

    @app.post(
        api_base + "/open_folder",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def open_folder_using_explore(req: OpenFolderReq):
        if not is_path_trusted(req.path):
            raise HTTPException(status_code=403)
        open_folder(*os.path.split(req.path))

    @app.post(api_base + "/shutdown")
    async def shutdown_app():
        # This API endpoint is mainly used as a sidecar in Tauri applications to shut down the application
        if not kwargs.get("enable_shutdown"):
            raise HTTPException(status_code=403, detail="Shutdown is disabled.")
        os.kill(os.getpid(), 9)
        return {"message": "Application is shutting down."}


    class PackReq(BaseModel):
        paths: List[str]
        compress: bool
        pack_only: bool


    @app.post(
        api_base + "/zip",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def zip_files(req: PackReq):
        for path in req.paths:
            check_path_trust(path)
            if not os.path.isfile(path):
                   raise HTTPException(400, "The corresponding path must be a file.")
        if not req.paths:
            raise HTTPException(400, "请选择需要导出的文件")
        try:
            settings = current_archive_settings() if req.pack_only else archive_settings("", cwd)
            if req.pack_only and settings["custom_directory"]:
                check_path_trust(os.path.realpath(settings["directory"]))
            file_path = write_archive(req.paths, settings["directory"], req.compress)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        except OSError as error:
            raise HTTPException(400, "归档失败，请检查目标目录和写入权限") from error
        if not req.pack_only:
            return FileResponse(file_path, media_type="application/zip")
        return {"path": os.path.abspath(file_path)}
    
    @app.post(
        api_base + "/open_with_default_app",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def open_target_file_withDefault_app(req: OpenFolderReq):
        check_path_trust(req.path)
        open_file_with_default_app(req.path)

    @app.post(
        api_base + "/open_with_app_picker",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def open_target_file_with_app_picker(req: OpenFolderReq):
        check_path_trust(req.path)
        if not os.path.isfile(req.path) or not is_media_file(req.path):
            raise HTTPException(400, "需要媒体文件")
        open_file_with_app_picker(req.path)

    # ========== Flatten Folder API ==========

    class FlattenFolderReq(BaseModel):
        folder_path: str
        dry_run: bool = True  # If True, only check for conflicts without moving

    class FlattenFolderResp(BaseModel):
        success: bool
        total_files: int
        conflicts: List[str]  # List of duplicate file names
        moved_files: int = 0
        errors: List[str] = []

    @app.post(
        api_base + "/flatten_folder",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    async def flatten_folder(req: FlattenFolderReq):
        """
        Flatten a folder by moving all files from subfolders to the root folder.
        Two phases:
        1. dry_run=True: Scan and check for filename conflicts
        2. dry_run=False: Actually move the files
        """
        check_path_trust(req.folder_path)
        folder_path = os.path.normpath(req.folder_path)

        if not os.path.isdir(folder_path):
            raise HTTPException(400, detail=f"Not a folder: {folder_path}")

        # Collect all files recursively
        all_files = []  # List of (full_path, filename)
        for root, dirs, files in os.walk(folder_path):
            # Skip the root folder itself
            if root == folder_path:
                continue
            for f in files:
                if is_media_file(f):
                    full_path = os.path.join(root, f)
                    all_files.append((full_path, f))

        # Check for filename conflicts
        filename_count = {}
        for _, filename in all_files:
            filename_count[filename] = filename_count.get(filename, 0) + 1

        conflicts = [name for name, count in filename_count.items() if count > 1]

        if req.dry_run:
            return FlattenFolderResp(
                success=len(conflicts) == 0,
                total_files=len(all_files),
                conflicts=conflicts
            )

        # If not dry_run, check for conflicts first
        if conflicts:
            raise HTTPException(
                400,
                detail=f"Cannot flatten: {len(conflicts)} filename conflicts found"
            )

        # Actually move files
        conn = DataBase.get_conn()
        moved_count = 0
        errors = []

        for full_path, filename in all_files:
            try:
                dest_path = os.path.join(folder_path, filename)

                # Move the file
                shutil.move(full_path, dest_path)

                # Update database
                img = DbImg.get(conn, full_path)
                if img:
                    img.update_path(conn, dest_path, force=True)

                # Move associated txt file if exists
                txt_path = get_img_geninfo_txt_path(full_path)
                if txt_path and os.path.exists(txt_path):
                    txt_dest = os.path.join(folder_path, os.path.basename(txt_path))
                    shutil.move(txt_path, txt_dest)

                moved_count += 1
            except Exception as e:
                errors.append(f"{full_path}: {str(e)}")

        # Clean up empty directories
        for root, dirs, files in os.walk(folder_path, topdown=False):
            if root != folder_path:
                try:
                    if not os.listdir(root):  # Directory is empty
                        os.rmdir(root)
                except Exception:
                    pass

        return FlattenFolderResp(
            success=len(errors) == 0,
            total_files=len(all_files),
            conflicts=[],
            moved_files=moved_count,
            errors=errors
        )

    @app.post(
        api_base + "/batch_top_4_media_info",
        dependencies=[Depends(verify_secret)],
    )
    def batch_get_top_4_media_cover_info(req: PathsReq):
        for path in req.paths:
            check_path_trust(path)
        res = {}
        for path in req.paths:
            res[path] = get_top_4_media_info(path)
        return res

    db_api_base = api_base + "/db"
    mount_audio_routes(app, api_base, verify_secret, check_path_trust)
    mount_similarity_routes(app, db_api_base, verify_secret, is_path_trusted, enable_access_control)
    mount_qwen3_vl_instruct_routes(app, db_api_base, verify_secret, write_permission_required, is_path_trusted)
    mount_image_ai_routes(app, db_api_base, verify_secret, write_permission_required, is_path_trusted)
    mount_folder_icon_routes(app, db_api_base, verify_secret, write_permission_required)
    mount_qwen_model_manager_routes(app, db_api_base, verify_secret, write_permission_required)
    mount_qwen3_vl_routes(app, db_api_base, verify_secret, write_permission_required, is_path_trusted)

    @app.get(db_api_base + "/basic_info", dependencies=[Depends(verify_secret)])
    def get_db_basic_info(include_expiry: bool = True):
        conn = DataBase.get_conn()
        img_count = DbImg.count(conn)
        tags = Tag.get_all(conn)
        expired_dirs = Folder.get_expired_dirs(conn) if include_expiry else []
        return {
            "img_count": img_count,
            "tags": tags,
            "expired": len(expired_dirs) != 0,
            "expired_dirs": expired_dirs,
        }
    
    
    

    @app.get(db_api_base + "/random_images", dependencies=[Depends(verify_secret)])
    async def random_image():
        conn = DataBase.get_conn()
        imgs = DbImg.get_random_images(conn, 128)
        return filter_allowed_files([x.to_file_info() for x in imgs])

    @app.get(db_api_base + "/expired_dirs", dependencies=[Depends(verify_secret)])
    def get_db_expired():
        conn = DataBase.get_conn()
        expired_dirs = Folder.get_expired_dirs(conn)
        return {
            "expired": len(expired_dirs) != 0,
            "expired_dirs": expired_dirs,
        }

    @app.post(
        db_api_base + "/update_image_data",
        dependencies=[Depends(verify_secret)],
    )
    async def update_image_db_data():
        def scan():
            try:
                DataBase._initing = True
                conn = DataBase.get_conn()
                update_extra_paths(conn)
                dirs = Folder.get_expired_dirs(conn) + mem["extra_paths"]
                update_image_data(unique_by(dirs, os.path.normpath))
            finally:
                DataBase._initing = False
        # Serialize scans/rebuilds; filesystem and metadata work stays off the event loop.
        async with index_update_lock:
            await run_in_threadpool(scan)

    class MediaOrderReq(BaseModel):
        paths: List[str]
        target: str
        after: bool = False

    @app.post(db_api_base + "/media_order", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def reorder_media(req: MediaOrderReq):
        for path in [*req.paths, req.target]:
            check_path_trust(path)
        try:
            move_media(DataBase.get_conn(), req.paths, req.target, req.after)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        return {"ok": True}

    class SwapMediaOrderReq(BaseModel):
        source: str
        target: str

    @app.post(db_api_base + "/media_order/swap", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def swap_media_order(req: SwapMediaOrderReq):
        check_path_trust(req.source)
        check_path_trust(req.target)
        try:
            swap_media(DataBase.get_conn(), req.source, req.target)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        return {"ok": True}

    @app.delete(db_api_base + "/media_order", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def reset_media_order():
        conn = DataBase.get_conn()
        ensure_media_order(conn)
        with conn:
            conn.execute("DELETE FROM media_order")
        return {"ok": True}

    class SearchBySubstrReq(MediaSearchFilters):
        surstr: str
        manual_order: bool = False
        cursor: Optional[str] = ""
        regexp: Optional[str] = ""
        folder_paths: List[str] = None
        size: Optional[int] = 200
        filename_only: Optional[bool] = False
        media_type: Optional[str] = None  # "all", "image", "video", "audio"

    @app.get(db_api_base + "/image_description", dependencies=[Depends(verify_secret)])
    def get_image_description(path: str):
        path = os.path.normpath(path)
        check_path_trust(path)
        img = DbImg.get(DataBase.get_conn(), path)
        if not img:
            raise HTTPException(status_code=404, detail="Media is not indexed")
        return {"description": img.description}

    class UpdateImageDescriptionReq(BaseModel):
        path: str
        description: str

    @app.post(db_api_base + "/image_description", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def update_image_description(req: UpdateImageDescriptionReq):
        path = os.path.normpath(req.path)
        check_path_trust(path)
        if len(req.description) > 5000:
            raise HTTPException(status_code=400, detail="Description exceeds 5000 characters")
        conn = DataBase.get_conn()
        img = DbImg.get(conn, path)
        if not img:
            raise HTTPException(status_code=404, detail="Media is not indexed")
        with conn:
            img.update_description(conn, req.description.strip())
        return {"description": img.description}

    @app.post(db_api_base + "/search_by_substr", dependencies=[Depends(verify_secret)])
    def search_by_substr(req: SearchBySubstrReq):
        if IIB_DEBUG:
            logger.info(req)
        conn = DataBase.get_conn()
        folder_paths=normalize_paths(req.folder_paths or [], os.getcwd())
        if(not folder_paths and req.folder_paths):
            return { "files": [], "cursor": Cursor(has_next=False) }
        filter_clauses, filter_params = req.sql_conditions(conn)
        from scripts.iib.db.search_query import SearchQueryError
        try:
            imgs, next_cursor = DbImg.find_by_substring(
                conn=conn,
                substring=req.surstr,
                cursor=req.cursor,
                limit=req.size,
                regexp=req.regexp,
                folder_paths=folder_paths,
                filename_only=req.filename_only,
                media_type=req.media_type,
                filter_clauses=filter_clauses,
                filter_params=filter_params,
                manual_order=req.manual_order,
            )
        except SearchQueryError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        return {
            "files": filter_allowed_files([x.to_file_info() for x in imgs]),
            "cursor": next_cursor
        }
    
    class MatchImagesByTagsReq(BaseModel):
        and_tags: Optional[List[int]] = []
        or_tags: Optional[List[int]] = []
        not_tags: Optional[List[int]] = []
        cursor: Optional[str] = ""
        folder_paths: List[str] = None
        size: Optional[int] = 200
        random_sort: Optional[bool] = False
        dimensions: Optional[ImageSizeFilter] = None

    @app.post(db_api_base + "/match_images_by_tags", dependencies=[Depends(verify_secret)])
    def match_image_by_tags(req: MatchImagesByTagsReq):
        if IIB_DEBUG:
            logger.info(req)
        conn = DataBase.get_conn()
        folder_paths=normalize_paths(req.folder_paths or [], os.getcwd())
        if(not folder_paths and req.folder_paths):
            return { "files": [], "cursor": Cursor(has_next=False) }
        imgs, next_cursor = ImageTag.get_images_by_tags(
            conn=conn,
            tag_dict={"and": req.and_tags, "or": req.or_tags, "not": req.not_tags},
            cursor=req.cursor,
            folder_paths=folder_paths,
            limit=req.size,
            random_sort=req.random_sort,
            size_tag_ids=req.dimensions.matching_tag_ids(conn) if req.dimensions else None,
        )
        return {
            "files": filter_allowed_files([x.to_file_info() for x in imgs]),
            "cursor": next_cursor
        }

    @app.get(db_api_base + "/img_selected_custom_tag", dependencies=[Depends(verify_secret)])
    async def get_img_selected_custom_tag(path: str):
        path = os.path.normpath(path)
        if not is_valid_media_path(path):
            return []
        conn = DataBase.get_conn()
        update_extra_paths(conn)
        if not is_path_under_parents(path):
            return []
        img = DbImg.get(conn, path)
        if not img:
            if DbImg.count(conn) == 0:
                return []
            update_image_data([os.path.dirname(path)])
            img = DbImg.get(conn, path)
        assert img
        # tags = Tag.get_all_custom_tag()
        return ImageTag.get_tags_for_image(conn, img.id, type="custom")

    @app.post(db_api_base + "/get_image_tags", dependencies=[Depends(verify_secret)])
    async def get_img_tags(req: PathsReq):
        conn = DataBase.get_conn()
        return ImageTag.batch_get_tags_by_path(conn, req.paths)
    

    # update tag
    class UpdateTagReq(BaseModel):
        id: int
        color: Optional[str] = None
        group_name: Optional[str] = None

    @app.post(
        db_api_base + "/update_tag",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    async def update_tag(req: UpdateTagReq):
        conn = DataBase.get_conn()
        tag = Tag.get(conn, req.id)
        if not tag or tag.type != "custom":
            raise HTTPException(404, "找不到自定义标签")
        if req.group_name is not None and req.group_name and req.group_name not in Tag.get_groups(conn):
            raise HTTPException(400, "标签分组不存在")
        with conn:
            if req.color is not None:
                conn.execute("UPDATE tag SET color = ? WHERE id = ?", (req.color, req.id))
            if req.group_name is not None:
                conn.execute("UPDATE tag SET group_name = ? WHERE id = ?", (req.group_name, req.id))
        return Tag.get(conn, req.id)

    @app.get(db_api_base + "/tag_groups", dependencies=[Depends(verify_secret)])
    def get_tag_groups():
        return Tag.get_groups(DataBase.get_conn())

    class TagGroupReq(BaseModel):
        name: str
        new_name: Optional[str] = None

    @app.post(db_api_base + "/create_tag_group", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def create_tag_group(req: TagGroupReq):
        try:
            Tag.create_group(DataBase.get_conn(), req.name)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        except sqlite3.IntegrityError as error:
            raise HTTPException(409, "分组名称已存在") from error
        return Tag.get_groups(DataBase.get_conn())

    @app.post(db_api_base + "/rename_tag_group", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def rename_tag_group(req: TagGroupReq):
        try:
            Tag.rename_group(DataBase.get_conn(), req.name, req.new_name or "")
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        return Tag.get_groups(DataBase.get_conn())

    @app.post(db_api_base + "/delete_tag_group", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def delete_tag_group(req: TagGroupReq):
        Tag.remove_group(DataBase.get_conn(), req.name)
        return Tag.get_groups(DataBase.get_conn())

    class RenameCustomTagReq(BaseModel):
        id: int
        name: str

    @app.post(
        db_api_base + "/rename_custom_tag",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def rename_custom_tag(req: RenameCustomTagReq):
        conn = DataBase.get_conn()
        try:
            tag, old_name = Tag.rename_custom(conn, req.id, req.name)
        except ValueError as error:
            raise HTTPException(409 if str(error) == "标签名称已存在" else 400, str(error)) from error
        if tag.name != old_name:
            from scripts.iib.auto_tag import AutoTagMatcher
            AutoTagMatcher.reload_rules(conn)
        return tag


    class ToggleCustomTagToImgReq(BaseModel):
        img_path: str
        tag_id: int

    @app.post(
        db_api_base + "/toggle_custom_tag_to_img",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    async def toggle_custom_tag_to_img(req: ToggleCustomTagToImgReq):
        conn = DataBase.get_conn()
        path = os.path.normpath(req.img_path)
        update_extra_paths(conn)
        if not is_path_under_parents(path):
            raise HTTPException(
                400,
                '当前文件不在搜索路径内，你可以将它添加到扫描路径再尝试。在右上角的"更多"里面'
                if locale == "zh"
                else 'The current file is not within the scan path. You can add it to the scan path and try again. In the top right corner, click on "More".',
            )
        img = DbImg.get(conn, path)
        if not img:
            if DbImg.count(conn):
                # update_image_data([os.path.dirname(path)])
                add_image_data_single(path)
                img = DbImg.get(conn, path)
            else:
                raise HTTPException(
                    400,
                    "你需要先通过图像搜索页生成索引"
                    if locale == "zh"
                    else "You need to generate an index through the image search page first.",
                )
        tags = ImageTag.get_tags_for_image(
            conn=conn, image_id=img.id, type="custom", tag_id=req.tag_id
        )
        is_remove = len(tags)
        if is_remove:
            ImageTag.remove(conn, img.id, tags[0].id)
        else:
            ImageTag(img.id, req.tag_id).save(conn)
        conn.commit()
        return {"is_remove": is_remove}

    class BatchUpdateImageReq(BaseModel):
        img_paths: List[str]
        action: str
        tag_id: int

    @app.post(
        db_api_base + "/batch_update_image_tag",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    async def batch_update_image_tag(req: BatchUpdateImageReq):
        assert req.action in ["add", "remove"]
        conn = DataBase.get_conn()
        paths: List[str] = seq(req.img_paths).map(os.path.normpath).to_list()
        update_extra_paths(conn)
        for path in paths:
            if not is_path_under_parents(path):
                raise HTTPException(
                    400,
                    '当前文件不在搜索路径内，你可以将它添加到扫描路径再尝试。在右上角的"更多"里面'
                    if locale == "zh"
                    else 'The current file is not within the scan path. You can add it to the scan path and try again. In the top right corner, click on "More".',
                )
            img = DbImg.get(conn, path)
            if not img:
                if DbImg.count(conn):
                    add_image_data_single(path)
                    img = DbImg.get(conn, path)
                else: 
                    raise HTTPException(
                        400,
                        "你需要先通过图像搜索页生成索引"
                        if locale == "zh"
                        else "You need to generate an index through the image search page first.",
                    )
        try:            
            for path in paths:
                img = DbImg.get(conn, path)
                if req.action == "add":
                    ImageTag(img.id, req.tag_id).save_or_ignore(conn)
                else:
                    ImageTag.remove(conn, img.id, req.tag_id)
        finally:
            conn.commit()

    class AddCustomTagReq(BaseModel):
        tag_name: str
        group_name: str = ""

    @app.post(
        db_api_base + "/add_custom_tag",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    async def add_custom_tag(req: AddCustomTagReq):
        conn = DataBase.get_conn()
        if req.group_name and req.group_name not in Tag.get_groups(conn):
            raise HTTPException(400, "标签分组不存在")
        tag = Tag.get_or_create(conn, name=req.tag_name, type="custom")
        if tag is None:
            raise HTTPException(400, "Invalid tag name")
        if req.group_name:
            conn.execute("UPDATE tag SET group_name = ? WHERE id = ?", (req.group_name, tag.id))
            tag.group_name = req.group_name
        conn.commit()
        return tag
    
    class RenameFileReq(BaseModel):
        path: str
        name: str

    @app.post(
        db_api_base + "/rename_folder",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    async def rename_folder(req: RenameFileReq):
        path = to_abs_path(req.path)
        check_path_trust(path)

        def rename():
            conn = DataBase.get_conn()
            roots = [entry.path for entry in ExtraPath.get_extra_paths(conn)]
            prefix = os.path.normpath(path) + os.sep
            for (media_path,) in conn.execute(
                "SELECT path FROM image WHERE substr(path, 1, ?) = ?", (len(prefix), prefix)
            ):
                close_video_file_reader(media_path)
            destination = rename_managed_folder(conn, path, req.name, roots)
            with conn:
                remap_folder_icons(conn, path, destination)
            return destination

        try:
            async with index_update_lock:
                new_path = await run_in_threadpool(rename)
            return {"new_path": new_path}
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        except PermissionError as error:
            raise HTTPException(status_code=403, detail="没有权限修改此文件夹") from error
        except OSError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

    @app.post(
        db_api_base + "/rename",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    async def rename_file(req: RenameFileReq):
        conn = DataBase.get_conn()
        try:
            # Normalize the paths

            path = os.path.normpath(req.path)
            new_path = os.path.join(os.path.dirname(path), req.name)

            # Check if the file exists
            if not os.path.exists(path):
                raise HTTPException(status_code=404, detail="File not found")

            # Check if a file with the new name already exists
            if os.path.exists(new_path):
                raise HTTPException(status_code=400, detail="A file with the new name already exists")
            close_video_file_reader(path)
            img = DbImg.get(conn, path)
            if img:
                img.update_path(conn, new_path)
                conn.commit()

            # Perform the file rename operation
            os.rename(path, new_path)


            return {"detail": "File renamed successfully", "new_path": new_path}

        except PermissionError:
            raise HTTPException(status_code=403, detail="Permission denied")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    class RemoveCustomTagReq(BaseModel):
        tag_id: int

    @app.post(
        db_api_base + "/remove_custom_tag",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    async def remove_custom_tag(req: RemoveCustomTagReq):
        conn = DataBase.get_conn()
        ImageTag.remove(conn, tag_id=req.tag_id)
        Tag.remove(conn, req.tag_id)

    class RemoveCustomTagFromReq(BaseModel):
        img_id: int
        tag_id: str

    @app.post(
        db_api_base + "/remove_custom_tag_from_img",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    async def remove_custom_tag_from_img(req: RemoveCustomTagFromReq):
        conn = DataBase.get_conn()
        ImageTag.remove(conn, image_id=req.img_id, tag_id=req.tag_id)


    # ===== 主题聚类 / Embedding（拆分到独立模块，减少 api.py 体积）=====
    topic_cluster_funcs = mount_topic_cluster_routes(
        app=app,
        db_api_base=db_api_base,
        verify_secret=verify_secret,
        write_permission_required=write_permission_required,
        openai_base_url=OPENAI_BASE_URL,
        openai_api_key=OPENAI_API_KEY,
        twelvelabs_api_key=TWELVELABS_API_KEY,
        embedding_model=EMBEDDING_MODEL,
        ai_model=AI_MODEL,
    )

    # ===== Tag 关系图 =====
    mount_tag_graph_routes(
        app=app,
        db_api_base=db_api_base,
        verify_secret=verify_secret,
        embedding_model=EMBEDDING_MODEL,
        ai_model=AI_MODEL,
        openai_base_url=OPENAI_BASE_URL,
        openai_api_key=OPENAI_API_KEY,
    )

    # ===== 智能文件整理 =====
    mount_organize_routes(
        app=app,
        db_api_base=db_api_base,
        verify_secret=verify_secret,
        write_permission_required=write_permission_required,
        start_cluster_job_func=topic_cluster_funcs["start_cluster_job"],
        get_cluster_job_status_func=topic_cluster_funcs["get_cluster_job_status"],
    )



    class ExtraPathModel(BaseModel):
        path: str
        types: List[str]

    @app.post(
        f"{db_api_base}/extra_paths",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    async def create_extra_path(extra_path: ExtraPathModel):
        if enable_access_control:
            if not is_path_under_parents(extra_path.path):
                raise HTTPException(status_code=403)
        conn = DataBase.get_conn()
        path = ExtraPath.get_target_path(conn, extra_path.path)
        if path:
            for t in extra_path.types:
                path.types.append(t)
            path.types = unique_by(path.types)
        else:
            path = ExtraPath(extra_path.path, extra_path.types)
        try:
            path.save(conn)
        finally:
            conn.commit()

    class ExtraPathAliasModel(BaseModel):
        path: str
        alias: str


    @app.post(
        f"{db_api_base}/alias_extra_path",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    async def alias_extra_path(req: ExtraPathAliasModel):
        conn = DataBase.get_conn()
        path = ExtraPath.get_target_path(conn, req.path)
        if not path:
            raise HTTPException(400)
        path.alias = req.alias
        try:
            path.save(conn)
        finally:
            conn.commit()
        return path
        

    @app.get(
        f"{db_api_base}/extra_paths",
        dependencies=[Depends(verify_secret)],
    )
    async def read_extra_paths():
        conn = DataBase.get_conn()
        return ExtraPath.get_extra_paths(conn)
    


    @app.delete(
        f"{db_api_base}/extra_paths",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    async def delete_extra_path(extra_path: ExtraPathModel):
        path = to_abs_path(extra_path.path)
        conn = DataBase.get_conn()
        scanned_paths = [entry.path for entry in ExtraPath.get_extra_paths(conn)
                         if ExtraPathType.scanned.value in entry.types or ExtraPathType.scanned_fixed.value in entry.types]
        scanned_paths.extend(kwargs.get("extra_paths_cli", []))
        ExtraPath.remove(
            conn,
            path,
            extra_path.types,
            img_search_dirs=[],
            all_scanned_paths=scanned_paths,
        )
        update_extra_paths(conn)

    
    @app.post(
        f"{db_api_base}/rebuild_index",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    async def rebuild_index():
        def rebuild():
            update_extra_paths(conn=DataBase.get_conn())
            rebuild_image_index(search_dirs=mem["extra_paths"])
        async with index_update_lock:
            await run_in_threadpool(rebuild)


    # AI 相关路由
    class AIChatRequest(BaseModel):
        messages: List[dict]
        temperature: Optional[float] = 0.7
        max_tokens: Optional[int] = None
        stream: Optional[bool] = False

    @app.post(f"{api_base}/ai-chat", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    async def ai_chat(req: AIChatRequest):
        """通用AI聊天接口，转发到OpenAI兼容API"""
        if not OPENAI_API_KEY:
            raise HTTPException(status_code=500, detail="OpenAI API Key not configured")

        try:
            payload = {
                "model": AI_MODEL,
                "messages": req.messages,
                "temperature": req.temperature,
                "stream": req.stream
            }
            if req.max_tokens:
                payload["max_tokens"] = req.max_tokens

            headers = {
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json"
            }

            response = requests.post(
                f"{OPENAI_BASE_URL}/chat/completions",
                json=payload,
                headers=headers,
                timeout=60
            )

            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail=response.text)

            return response.json()

        except requests.RequestException as e:
            logger.error(f"AI API request failed: {e}")
            raise HTTPException(status_code=500, detail=f"AI API request failed: {str(e)}")
