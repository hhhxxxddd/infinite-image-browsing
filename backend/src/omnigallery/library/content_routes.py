import base64
import hashlib
import os
import urllib.parse
from datetime import datetime, timedelta

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from omnigallery.infrastructure.auth import verify_secret, write_permission_required
from omnigallery.infrastructure.database import Database
from omnigallery.infrastructure.logging import logger
from omnigallery.infrastructure.route_context import RouteContext
from omnigallery.infrastructure.video_streaming import (
    range_requests_response,
)
from omnigallery.library.media_types import get_video_type, is_media_file, is_valid_media_path
from omnigallery.library.thumbnails import _ensure_thumbnail, _parse_thumbnail_size
from omnigallery.library.video_covers import video_cover_cache_path, write_video_cover
from omnigallery.metadata.motion import is_animated_image
from omnigallery.storage.cloud_files import (
    get_sync_settings,
    is_protected_online_path,
)


class SetTargetFrameAsCoverRequest(BaseModel):
    base64_img: str
    path: str
    updated_time: str


def mount_routes(app: FastAPI, context: RouteContext):
    is_path_under_parents = context.is_path_under_parents
    check_path_trust = context.check_path_trust
    api_base = context.api_base
    cache_base_dir = context.cache_base_dir

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
        cache_dir = os.path.join(cache_base_dir, "thumbnails", hash_dir)
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

        if is_protected_online_path(path, get_sync_settings(Database.get_connection())):
            raise HTTPException(409, "此文件仅在线，缩略图会在下载后生成")

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
        if media_type and not media_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="Not an image file")

        # 设置 Content-Disposition 为 inline，带文件名
        headers = {}
        encoded_filename = urllib.parse.quote(filename.encode("utf-8"))
        headers["Content-Disposition"] = f"inline; filename*=UTF-8''{encoded_filename}"

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
    async def get_file(path: str, t: str, disposition: str | None = None):
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
            encoded_filename = urllib.parse.quote(disposition.encode("utf-8"))
            headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{encoded_filename}"

        if is_path_under_parents(filename) and is_valid_media_path(
            filename
        ):  # 认为永远不变,不要协商缓存了试试
            headers["Cache-Control"] = (
                "public, max-age=31536000"  # 针对同样名字文件但实际上不同内容的文件要求必须传入创建时间来避免浏览器缓存
            )
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
        return range_requests_response(request, file_path=path, content_type=media_type)

    @app.get(api_base + "/media_motion", dependencies=[Depends(verify_secret)])
    def media_motion(path: str):
        check_path_trust(path)
        if is_protected_online_path(path, get_sync_settings(Database.get_connection())):
            return {"animated": False}
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
        cache_path = video_cover_cache_path(path, cache_base_dir)
        cache_dir = os.path.dirname(cache_path)
        # 如果缓存文件存在，则直接返回该文件
        if os.path.exists(cache_path):
            return FileResponse(
                cache_path,
                media_type="image/webp",
                headers={
                    "Cache-Control": "no-store",
                },
            )
        if is_protected_online_path(path, get_sync_settings(Database.get_connection())):
            raise HTTPException(409, "此文件仅在线，封面会在下载后生成")
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
            raise HTTPException(
                status_code=500, detail=f"Failed to generate video cover: {e}"
            ) from e

        # 返回缓存文件
        return FileResponse(
            cache_path,
            media_type="image/webp",
            headers={
                "Cache-Control": "no-store",
            },
        )

    def save_base64_image(base64_str, file_path):
        if base64_str.startswith("data:image"):
            base64_str = base64_str.split(",")[1]
        image_data = base64.b64decode(base64_str)
        with open(file_path, "wb") as file:
            file.write(image_data)

    @app.post(
        api_base + "/set_target_frame_as_video_cover",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    async def set_target_frame_as_video_cover(req: SetTargetFrameAsCoverRequest):
        check_path_trust(req.path)
        if not os.path.isfile(req.path):
            raise HTTPException(status_code=404, detail="视频文件不存在")
        cache_path = video_cover_cache_path(req.path, cache_base_dir)
        cache_dir = os.path.dirname(cache_path)
        hash = os.path.basename(cache_dir)

        os.makedirs(cache_dir, exist_ok=True)

        save_base64_image(req.base64_img, cache_path)
        return FileResponse(
            cache_path,
            media_type="image/webp",
            headers={"ETag": hash},
        )
