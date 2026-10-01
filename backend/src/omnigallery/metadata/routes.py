import os

import piexif.helper
from fastapi import Depends, FastAPI, HTTPException
from PIL import ExifTags, Image
from pydantic import BaseModel

from omnigallery.config import (
    is_dev,
)
from omnigallery.infrastructure.auth import verify_secret, write_permission_required
from omnigallery.infrastructure.database import Database
from omnigallery.infrastructure.formatting import get_modified_date
from omnigallery.infrastructure.logging import logger
from omnigallery.infrastructure.route_context import RouteContext
from omnigallery.library.media_repository import Media
from omnigallery.library.media_types import get_video_type


class GeninfoBatchRequest(BaseModel):
    paths: list[str]


class UpdateExifRequest(BaseModel):
    path: str
    exif: str


class UpdateImageDescriptionRequest(BaseModel):
    path: str
    description: str


def _exif_value(tag, value):
    if tag == piexif.ExifIFD.UserComment and isinstance(value, bytes):
        try:
            return piexif.helper.UserComment.load(value)
        except (ValueError, UnicodeError):
            return value.decode("utf-8", errors="replace")
    return str(value)


def mount_routes(app: FastAPI, context: RouteContext):
    check_path_trust = context.check_path_trust
    api_base = context.api_base

    @app.get(api_base + "/image_geninfo", dependencies=[Depends(verify_secret)])
    def image_geninfo(path: str):
        from omnigallery.library.indexing import get_exif_data

        path = os.path.normpath(path)
        check_path_trust(path)
        conn = Database.get_connection()
        try:
            img = Media.get(conn, path)

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

            # 如果 Media 存在，将读取到的数据缓存到数据库
            if img and raw_info:
                img.exif = raw_info
                img.update(conn)

            return raw_info
        except Exception as e:
            logger.error(f"Failed to get geninfo for {path}: {e}")
            return ""

    @app.post(api_base + "/image_geninfo_batch", dependencies=[Depends(verify_secret)])
    def image_geninfo_batch(req: GeninfoBatchRequest):
        from omnigallery.library.indexing import get_exif_data

        paths = {path: os.path.normpath(path) for path in req.paths}
        for path in paths.values():
            check_path_trust(path)
        res = {}
        conn = Database.get_connection()
        cached = {}
        unique_paths = list(dict.fromkeys(paths.values()))
        for start in range(0, len(unique_paths), 900):
            chunk = unique_paths[start : start + 900]
            placeholders = ",".join("?" for _ in chunk)
            cached.update(
                conn.execute(
                    f"SELECT path, exif FROM media WHERE path IN ({placeholders})", chunk
                ).fetchall()
            )
        for original, path in paths.items():
            try:
                if path in cached:
                    res[original] = cached[path] or ""
                else:
                    result = get_exif_data(path)
                    res[original] = result.raw_info or ""
            except Exception as e:
                logger.error(f"Failed to get geninfo for {path}: {e}", stack_info=True)
                res[original] = ""
        return res

    @app.get(api_base + "/image_exif", dependencies=[Depends(verify_secret)])
    def image_exif(path: str):
        path = os.path.normpath(path)
        check_path_trust(path)
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
                        # UserComment lives in the Exif IFD, not the top-level tags.
                        # Decode its encoding header so embedded workflow JSON remains readable.
                        exif_data.update(
                            {
                                str(ExifTags.TAGS.get(k, k)): _exif_value(k, v)
                                for k, v in exif_dict.items()
                            }
                        )
                        exif_data.update(
                            {
                                str(ExifTags.TAGS.get(k, k)): _exif_value(k, v)
                                for k, v in exif_dict.get_ifd(ExifTags.IFD.Exif).items()
                            }
                        )
                except (AttributeError, ValueError, KeyError):
                    pass

                info_data = {k: str(v) for k, v in img.info.items() if not k.startswith("exif")}
                exif_data.update(info_data)

                return exif_data
        except Exception as e:
            logger.error(f"Failed to get exif for {path}: {e}")
            return {}

    @app.post(
        api_base + "/update_exif",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def update_exif(req: UpdateExifRequest):
        """更新图片/视频的 exif 信息"""
        req.path = os.path.normpath(req.path)
        check_path_trust(req.path)
        conn = Database.get_connection()
        try:
            img = Media.get(conn, req.path)
            if img:
                img.update_exif(conn, req.exif)
                conn.commit()
                return {"success": True, "message": "Exif updated successfully"}
            else:
                # 如果数据库中没有记录，创建新记录
                img = Media(path=req.path, exif=req.exif, exif_edited=True)
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
            raise HTTPException(status_code=500, detail=str(e)) from e

    @app.get(api_base + "/image_description", dependencies=[Depends(verify_secret)])
    def get_image_description(path: str):
        path = os.path.normpath(path)
        check_path_trust(path)
        img = Media.get(Database.get_connection(), path)
        if not img:
            raise HTTPException(status_code=404, detail="Media is not indexed")
        return {"description": img.description}

    @app.post(
        api_base + "/image_description",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def update_image_description(req: UpdateImageDescriptionRequest):
        path = os.path.normpath(req.path)
        check_path_trust(path)
        if len(req.description) > 5000:
            raise HTTPException(status_code=400, detail="Description exceeds 5000 characters")
        conn = Database.get_connection()
        img = Media.get(conn, path)
        if not img:
            raise HTTPException(status_code=404, detail="Media is not indexed")
        with conn:
            img.update_description(conn, req.description.strip())
        return {"description": img.description}
