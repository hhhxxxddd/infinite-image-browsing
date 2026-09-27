import os

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


def mount_routes(app: FastAPI, context: RouteContext):
    check_path_trust = context.check_path_trust
    api_base = context.api_base
    api_base = context.api_base

    @app.get(api_base + "/image_geninfo", dependencies=[Depends(verify_secret)])
    async def image_geninfo(path: str):
        from omnigallery.library.indexing import get_exif_data

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
    async def image_geninfo_batch(req: GeninfoBatchRequest):
        from omnigallery.library.indexing import get_exif_data

        res = {}
        conn = Database.get_connection()
        for path in req.paths:
            try:
                img = Media.get(conn, path)
                if img:
                    res[path] = img.exif
                else:
                    result = get_exif_data(path)
                    res[path] = result.raw_info or ""
            except Exception as e:
                logger.error(f"Failed to get geninfo for {path}: {e}", stack_info=True)
                res[path] = ""
        return res

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
                        exif_data.update(
                            {str(ExifTags.TAGS.get(k, k)): str(v) for k, v in exif_dict.items()}
                        )
                except AttributeError:
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
    async def update_exif(req: UpdateExifRequest):
        """更新图片/视频的 exif 信息"""
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
