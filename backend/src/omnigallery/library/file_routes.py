import os
import shutil

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from omnigallery.config import cwd, enable_access_control, is_win, locale
from omnigallery.infrastructure.auth import verify_secret, write_permission_required
from omnigallery.infrastructure.database import Database
from omnigallery.infrastructure.folder_picker import choose_local_directory
from omnigallery.infrastructure.formatting import (
    get_created_date_by_stat,
    get_formatted_date,
    human_readable_size,
)
from omnigallery.infrastructure.logging import logger
from omnigallery.infrastructure.paths import to_abs_path
from omnigallery.infrastructure.platform import (
    get_windows_drives,
    open_file_with_app_picker,
    open_file_with_default_app,
    open_folder,
)
from omnigallery.infrastructure.route_context import RouteContext
from omnigallery.infrastructure.video_streaming import close_video_file_reader
from omnigallery.library.directory_covers import get_top_4_media_info
from omnigallery.library.file_info import get_file_info_by_path
from omnigallery.library.folder_icons import remap_folder_icons
from omnigallery.library.folder_rename import rename_managed_folder
from omnigallery.library.folder_repository import Folder, LibraryPath
from omnigallery.library.media_references import rename_media_file, resolve_media_paths
from omnigallery.library.media_repository import Media
from omnigallery.library.media_types import is_media_file
from omnigallery.library.request_schemas import PathsRequest
from omnigallery.library.schemas import FileInfo
from omnigallery.library.tag_repository import MediaTag
from omnigallery.metadata.generation import get_img_geninfo_txt_path
from omnigallery.storage.archive import archive_settings, write_archive
from omnigallery.storage.archive_settings import current_archive_settings


class DeleteFilesRequest(BaseModel):
    file_paths: list[str]


class CreateFoldersRequest(BaseModel):
    dest_folder: str


class MoveFilesRequest(BaseModel):
    file_paths: list[str]
    dest: str
    create_dest_folder: bool | None = False
    continue_on_error: bool | None = False


class MediaPathsRequest(BaseModel):
    ids: list[int] = Field(max_length=500)


class CheckPathExistsRequest(BaseModel):
    paths: list[str]


class OpenFolderRequest(BaseModel):
    path: str


class PackRequest(BaseModel):
    paths: list[str]
    compress: bool
    pack_only: bool


class FlattenFolderRequest(BaseModel):
    folder_path: str
    dry_run: bool = True  # If True, only check for conflicts without moving


class FlattenFolderResp(BaseModel):
    success: bool
    total_files: int
    conflicts: list[str]  # List of duplicate file names
    moved_files: int = 0
    errors: list[str] = []


class RenameFileRequest(BaseModel):
    path: str
    name: str


def mount_routes(app: FastAPI, context: RouteContext):
    update_all_scanned_paths = context.update_all_scanned_paths
    is_path_under_parents = context.is_path_under_parents
    is_path_trusted = context.is_path_trusted
    is_path_browsable = context.is_path_browsable
    check_path_trust = context.check_path_trust
    filter_allowed_files = context.filter_allowed_files
    api_base = context.api_base
    index_update_lock = context.index_update_lock
    api_base = context.api_base

    @app.post(
        api_base + "/delete_files",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def delete_files(req: DeleteFilesRequest):
        for path in req.file_paths:
            check_path_trust(path)
        conn = Database.get_connection()

        for path in req.file_paths:
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
                    conn.execute(
                        "DELETE FROM folder_icon WHERE path = ?", (os.path.normpath(path),)
                    )
                    conn.commit()
                else:
                    close_video_file_reader(path)
                    txt_path = get_img_geninfo_txt_path(path)

                    os.remove(path)
                    if txt_path:
                        os.remove(txt_path)

                    img = Media.get(conn, os.path.normpath(path))
                    if img:
                        logger.info("delete file: %s", path)
                        MediaTag.remove(conn, img.id)
                        Media.remove(conn, img.id)
            except OSError as e:
                # 处理删除失败的情况
                logger.error("delete failed")
                error_msg = (
                    f"Error deleting file {path}: {e}"
                    if locale == "en"
                    else f"删除文件 {path} 时出错：{e}"
                )
                raise HTTPException(400, detail=error_msg) from e

        return {"ok": True}

    @app.post(
        api_base + "/mkdirs",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def create_folders(req: CreateFoldersRequest):
        if enable_access_control:
            if not is_path_under_parents(req.dest_folder):
                raise HTTPException(status_code=403)
        os.makedirs(req.dest_folder, exist_ok=True)

    @app.post(
        api_base + "/copy_files",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def copy_files(req: MoveFilesRequest):
        check_path_trust(req.dest)
        for path in req.file_paths:
            check_path_trust(path)
            txt_path = get_img_geninfo_txt_path(path)
            if txt_path:
                check_path_trust(txt_path)
        errors = []
        for path in req.file_paths:
            try:
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
                raise HTTPException(400, detail=error_msg) from e
        return {"errors": errors}

    @app.post(
        api_base + "/move_files",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def move_files(req: MoveFilesRequest):
        check_path_trust(req.dest)
        for path in req.file_paths:
            check_path_trust(path)
            txt_path = get_img_geninfo_txt_path(path)
            if txt_path:
                check_path_trust(txt_path)
        if req.create_dest_folder:
            os.makedirs(req.dest, exist_ok=True)
        elif not os.path.isdir(req.dest):
            error_msg = (
                f"Destination folder {req.dest} does not exist."
                if locale == "en"
                else f"目标文件夹 {req.dest} 不存在。"
            )
            raise HTTPException(400, detail=error_msg)

        conn = Database.get_connection()
        errors = []

        def move_file_with_geninfo(path: str, dest: str):
            path = os.path.normpath(path)
            txt_path = get_img_geninfo_txt_path(path)
            if txt_path:
                shutil.move(txt_path, dest)
            img = Media.get(conn, path)
            new_path = os.path.normpath(os.path.join(dest, os.path.basename(path)))
            if img:
                logger.info(f"update file path: {path} -> {new_path} in db")
                img.update_path(conn, new_path, force=True)

        for path in req.file_paths:
            try:
                path = os.path.normpath(path)
                base_dir = os.path.dirname(path)
                directory_entries = list(os.walk(path))
                is_dir = os.path.isdir(path)
                shutil.move(path, req.dest)
                if is_dir:
                    remap_folder_icons(conn, path, os.path.join(req.dest, os.path.basename(path)))
                    for root, _, files in directory_entries:
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
                raise HTTPException(400, detail=error_msg) from e
        return {"errors": errors}

    @app.get(api_base + "/files", dependencies=[Depends(verify_secret)])
    def get_target_folder_files(folder_path: str, directories_only: bool = False):
        files: list[FileInfo] = []
        try:
            if is_win and folder_path == "/":
                for item in get_windows_drives():
                    files.append({"type": "dir", "size": "-", "name": item, "fullpath": item})
            else:
                if not os.path.exists(folder_path):
                    return {"files": []}
                folder_path = to_abs_path(folder_path)
                if not os.path.isdir(folder_path):
                    raise HTTPException(status_code=400, detail="Not a folder")
                if not is_path_browsable(folder_path):
                    raise HTTPException(status_code=403)
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
                                files.append(
                                    {
                                        "type": "dir",
                                        "date": "",
                                        "created_time": "",
                                        "size": "-",
                                        "name": item.name,
                                        "is_under_scanned_path": is_under_scanned_path,
                                        "fullpath": fullpath,
                                    }
                                )
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
        except HTTPException:
            raise
        except Exception as e:
            # logger.error(e)
            raise HTTPException(status_code=400, detail=str(e)) from e

        return {"files": filter_allowed_files(files)}

    @app.post(api_base + "/batch_get_files_info", dependencies=[Depends(verify_secret)])
    def batch_get_files_info(req: PathsRequest):
        res = {}
        for path in req.paths:
            check_path_trust(path)
            res[path] = get_file_info_by_path(path)
        return res

    @app.post(api_base + "/media-paths", dependencies=[Depends(verify_secret)])
    def media_paths(req: MediaPathsRequest):
        return resolve_media_paths(Database.get_connection(), req.ids, is_path_trusted)

    @app.post(api_base + "/check_path_exists", dependencies=[Depends(verify_secret)])
    def check_path_exists(req: CheckPathExistsRequest):
        update_all_scanned_paths()
        res = {}
        for path in req.paths:
            res[path] = os.path.exists(path) and (
                is_path_trusted(path) or (os.path.isdir(path) and is_path_browsable(path))
            )
        return res

    @app.post(api_base + "/check_path_is_directory", dependencies=[Depends(verify_secret)])
    def check_path_is_directory(req: CheckPathExistsRequest):
        update_all_scanned_paths()
        return {path: os.path.isdir(path) and is_path_browsable(path) for path in req.paths}

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
            raise HTTPException(
                status_code=422, detail="所选文件夹无法由媒体服务读取，请手动输入路径"
            )
        return {"path": path}

    @app.post(
        api_base + "/open_folder",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def open_folder_using_explore(req: OpenFolderRequest):
        check_path_trust(req.path)
        open_folder(*os.path.split(req.path))

    @app.post(
        api_base + "/zip",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def zip_files(req: PackRequest):
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
    def open_target_file_withDefault_app(req: OpenFolderRequest):
        check_path_trust(req.path)
        open_file_with_default_app(req.path)

    @app.post(
        api_base + "/open_with_app_picker",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def open_target_file_with_app_picker(req: OpenFolderRequest):
        check_path_trust(req.path)
        if not os.path.isfile(req.path) or not is_media_file(req.path):
            raise HTTPException(400, "需要媒体文件")
        open_file_with_app_picker(req.path)

    @app.post(
        api_base + "/flatten_folder",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def flatten_folder(req: FlattenFolderRequest):
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
        for root, _dirs, files in os.walk(folder_path):
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
                success=len(conflicts) == 0, total_files=len(all_files), conflicts=conflicts
            )

        # If not dry_run, check for conflicts first
        if conflicts:
            raise HTTPException(
                400, detail=f"Cannot flatten: {len(conflicts)} filename conflicts found"
            )

        # Actually move files
        conn = Database.get_connection()
        moved_count = 0
        errors = []

        for full_path, filename in all_files:
            try:
                dest_path = os.path.join(folder_path, filename)

                # Move the file
                shutil.move(full_path, dest_path)

                # Update database
                img = Media.get(conn, full_path)
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
        for root, _dirs, _files in os.walk(folder_path, topdown=False):
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
            errors=errors,
        )

    @app.post(
        api_base + "/batch_top_4_media_info",
        dependencies=[Depends(verify_secret)],
    )
    def batch_get_top_4_media_cover_info(req: PathsRequest):
        for path in req.paths:
            check_path_trust(path)
        res = {}
        for path in req.paths:
            res[path] = get_top_4_media_info(path)
        return res

    @app.post(
        api_base + "/rename_folder",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    async def rename_folder(req: RenameFileRequest):
        path = to_abs_path(req.path)
        check_path_trust(path)

        def rename():
            conn = Database.get_connection()
            roots = [entry.path for entry in LibraryPath.get_extra_paths(conn)]
            prefix = os.path.normpath(path) + os.sep
            for (media_path,) in conn.execute(
                "SELECT path FROM media WHERE substr(path, 1, ?) = ?", (len(prefix), prefix)
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
        api_base + "/rename",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def rename_file(req: RenameFileRequest):
        conn = Database.get_connection()
        path = os.path.normpath(req.path)
        check_path_trust(path)
        try:
            close_video_file_reader(path)
            new_path = rename_media_file(conn, path, req.name)
            return {"detail": "File renamed successfully", "new_path": new_path}
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="File not found") from None
        except FileExistsError:
            raise HTTPException(
                status_code=400, detail="A file with the new name already exists"
            ) from None
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except PermissionError:
            raise HTTPException(status_code=403, detail="Permission denied") from None
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e)) from e
