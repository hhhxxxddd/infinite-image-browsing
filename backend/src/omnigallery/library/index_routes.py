import os
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from omnigallery.config import (
    enable_access_control,
)
from omnigallery.infrastructure.auth import verify_secret, write_permission_required
from omnigallery.infrastructure.collections import unique_by
from omnigallery.infrastructure.database import Database
from omnigallery.infrastructure.paths import to_abs_path
from omnigallery.infrastructure.route_context import RouteContext
from omnigallery.library.folder_repository import Folder, LibraryPath, LibraryPathType
from omnigallery.library.indexing import rebuild_image_index, update_image_data
from omnigallery.library.media_order import ensure_media_order, move_media, swap_media
from omnigallery.library.media_repository import Media
from omnigallery.library.tag_repository import Tag


class PickMediaRequest(BaseModel):
    media_type: Literal["all", "image", "video", "audio"] = "all"
    exclude_paths: list[str] = Field(default_factory=list)
    limit: int = 24


class MediaOrderRequest(BaseModel):
    paths: list[str]
    target: str
    after: bool = False


class SwapMediaOrderRequest(BaseModel):
    source: str
    target: str


class ExtraPathModel(BaseModel):
    path: str
    types: list[str]


class ExtraPathAliasModel(BaseModel):
    path: str
    alias: str


def mount_routes(app: FastAPI, context: RouteContext):
    update_extra_paths = context.update_extra_paths
    is_path_under_parents = context.is_path_under_parents
    check_path_trust = context.check_path_trust
    filter_allowed_files = context.filter_allowed_files
    kwargs = context.options
    mem = context.mem
    index_update_lock = context.index_update_lock
    api_base = context.api_base

    @app.get(api_base + "/basic_info", dependencies=[Depends(verify_secret)])
    def get_db_basic_info(include_expiry: bool = True):
        conn = Database.get_connection()
        media_count = Media.count(conn)
        tags = Tag.get_all(conn)
        expired_dirs = Folder.get_expired_dirs(conn) if include_expiry else []
        return {
            "media_count": media_count,
            "tags": tags,
            "expired": len(expired_dirs) != 0,
            "expired_dirs": expired_dirs,
        }

    @app.post(api_base + "/pick_media", dependencies=[Depends(verify_secret)])
    def pick_media(req: PickMediaRequest):
        conn = Database.get_connection()
        imgs = Media.pick_random_media(
            conn, min(max(req.limit, 1), 48), req.media_type, req.exclude_paths
        )
        return filter_allowed_files([x.to_file_info() for x in imgs])

    @app.get(api_base + "/expired_dirs", dependencies=[Depends(verify_secret)])
    def get_db_expired():
        conn = Database.get_connection()
        expired_dirs = Folder.get_expired_dirs(conn)
        return {
            "expired": len(expired_dirs) != 0,
            "expired_dirs": expired_dirs,
        }

    @app.post(
        api_base + "/update_image_data",
        dependencies=[Depends(verify_secret)],
    )
    async def update_image_db_data():
        def scan():
            try:
                Database.is_indexing = True
                conn = Database.get_connection()
                update_extra_paths(conn)
                dirs = Folder.get_expired_dirs(conn) + mem["extra_paths"]
                update_image_data(unique_by(dirs, os.path.normpath))
            finally:
                Database.is_indexing = False

        # Serialize scans/rebuilds; filesystem and metadata work stays off the event loop.
        async with index_update_lock:
            await run_in_threadpool(scan)

    @app.post(
        api_base + "/media_order",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def reorder_media(req: MediaOrderRequest):
        for path in [*req.paths, req.target]:
            check_path_trust(path)
        try:
            move_media(Database.get_connection(), req.paths, req.target, req.after)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        return {"ok": True}

    @app.post(
        api_base + "/media_order/swap",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def swap_media_order(req: SwapMediaOrderRequest):
        check_path_trust(req.source)
        check_path_trust(req.target)
        try:
            swap_media(Database.get_connection(), req.source, req.target)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        return {"ok": True}

    @app.delete(
        api_base + "/media_order",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def reset_media_order():
        conn = Database.get_connection()
        ensure_media_order(conn)
        with conn:
            conn.execute("DELETE FROM media_order")
        return {"ok": True}

    @app.post(
        f"{api_base}/extra_paths",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    async def create_extra_path(extra_path: ExtraPathModel):
        if enable_access_control:
            if not is_path_under_parents(extra_path.path):
                raise HTTPException(status_code=403)
        conn = Database.get_connection()
        path = LibraryPath.get_target_path(conn, extra_path.path)
        if path:
            for t in extra_path.types:
                path.types.append(t)
            path.types = unique_by(path.types)
        else:
            path = LibraryPath(extra_path.path, extra_path.types)
        try:
            path.save(conn)
        finally:
            conn.commit()

    @app.post(
        f"{api_base}/alias_extra_path",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    async def alias_extra_path(req: ExtraPathAliasModel):
        conn = Database.get_connection()
        path = LibraryPath.get_target_path(conn, req.path)
        if not path:
            raise HTTPException(400)
        path.alias = req.alias
        try:
            path.save(conn)
        finally:
            conn.commit()
        return path

    @app.get(
        f"{api_base}/extra_paths",
        dependencies=[Depends(verify_secret)],
    )
    async def read_extra_paths():
        conn = Database.get_connection()
        return LibraryPath.get_extra_paths(conn)

    @app.delete(
        f"{api_base}/extra_paths",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    async def delete_extra_path(extra_path: ExtraPathModel):
        path = to_abs_path(extra_path.path)
        conn = Database.get_connection()
        scanned_paths = [
            entry.path
            for entry in LibraryPath.get_extra_paths(conn)
            if LibraryPathType.scanned.value in entry.types
            or LibraryPathType.scanned_fixed.value in entry.types
        ]
        scanned_paths.extend(kwargs.get("extra_paths_cli", []))
        LibraryPath.remove(
            conn,
            path,
            extra_path.types,
            img_search_dirs=[],
            all_scanned_paths=scanned_paths,
        )
        update_extra_paths(conn)

    @app.post(
        f"{api_base}/rebuild_index",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    async def rebuild_index():
        def rebuild():
            update_extra_paths(conn=Database.get_connection())
            rebuild_image_index(search_dirs=mem["extra_paths"])

        async with index_update_lock:
            await run_in_threadpool(rebuild)
