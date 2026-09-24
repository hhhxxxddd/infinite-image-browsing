"""Small, locally stored icons for managed directory nodes."""

from __future__ import annotations

import base64
import binascii
import io
import os
import sqlite3

from fastapi import Depends, FastAPI, HTTPException
from PIL import Image
from pydantic import BaseModel, Field

from scripts.iib.db.datamodel import DataBase, ExtraPath

PRESET_ICONS = {
    "folder", "disk", "photo", "video", "camera", "star", "heart",
    "book", "archive", "work", "music", "palette", "tag", "home",
}
IMAGE_PREFIX = "data:image/png;base64,"


class FolderIconRequest(BaseModel):
    path: str = Field(min_length=1, max_length=4096)
    icon: str = Field(max_length=90_000)


def validate_icon(icon: str) -> None:
    if not icon or icon in PRESET_ICONS:
        return
    if not icon.startswith(IMAGE_PREFIX):
        raise HTTPException(400, detail="请选择预设图标或上传 PNG 图标")
    try:
        data = base64.b64decode(icon[len(IMAGE_PREFIX):], validate=True)
        if len(data) > 64 * 1024:
            raise ValueError("large icon")
        with Image.open(io.BytesIO(data)) as image:
            if image.format != "PNG" or image.width > 128 or image.height > 128:
                raise ValueError("invalid icon")
            image.verify()
    except (ValueError, OSError, binascii.Error) as error:
        raise HTTPException(400, detail="图标需为不超过 128×128、64 KB 的 PNG 图片") from error


def remap_folder_icons(conn: sqlite3.Connection, source: str, destination: str) -> None:
    source = os.path.normpath(source)
    destination = os.path.normpath(destination)
    prefix = source + os.sep
    conn.execute(
        "UPDATE folder_icon SET path = ? || substr(path, ?) "
        "WHERE path = ? OR substr(path, 1, ?) = ?",
        (destination, len(source) + 1, source, len(prefix), prefix),
    )


def mount_folder_icon_routes(app: FastAPI, db_api_base: str, verify_secret,
                             write_permission_required) -> None:
    @app.get(db_api_base + "/folder-icons", dependencies=[Depends(verify_secret)])
    def get_icons():
        return dict(DataBase.get_conn().execute("SELECT path, icon FROM folder_icon"))

    @app.put(db_api_base + "/folder-icons",
             dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def put_icon(req: FolderIconRequest):
        validate_icon(req.icon)
        path = os.path.abspath(os.path.normpath(req.path))
        resolved_path = os.path.realpath(path)
        if not os.path.isdir(resolved_path):
            raise HTTPException(404, detail="目录不存在")
        conn = DataBase.get_conn()
        def inside(root_path: str) -> bool:
            try:
                root = os.path.normcase(os.path.realpath(root_path))
                return os.path.commonpath((os.path.normcase(resolved_path), root)) == root
            except ValueError:
                return False

        if not any(inside(root.path) for root in ExtraPath.get_extra_paths(conn)):
            raise HTTPException(403, detail="只能设置已添加目录内的图标")
        with conn:
            if req.icon:
                conn.execute(
                    "INSERT INTO folder_icon(path, icon) VALUES (?, ?) "
                    "ON CONFLICT(path) DO UPDATE SET icon = excluded.icon",
                    (path, req.icon),
                )
            else:
                conn.execute("DELETE FROM folder_icon WHERE path = ?", (path,))
        return {"path": path, "icon": req.icon}
