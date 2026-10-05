"""Small, versioned on-demand timeline previews. No whole-file reads."""

import hashlib
import math
import os
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Literal
from urllib.parse import urlencode

from fastapi import Depends, HTTPException, Query
from fastapi.responses import FileResponse

from omnigallery.config import get_cache_dir
from omnigallery.storage.filesystem import checked_path
from omnigallery.workspaces.artifacts import _uuid
from omnigallery.workspaces.audio_studio import HIDDEN
from omnigallery.workspaces.video_media import _binary, fingerprint, probe_media, resolve_media
from omnigallery.workspaces.video_render import audio_window

PREVIEW_CONCURRENCY = threading.BoundedSemaphore(2)
PREVIEW_CACHE_BYTES = 2 * 1024**3
MIN_FREE = 256 * 1024**2
EVICTION_LOCK = threading.Lock()
last_eviction = 0.0


def cache_path(workspace, revision, options, suffix):
    try:
        root = checked_path(Path(get_cache_dir()) / "video-timeline-previews")
        digest = hashlib.sha256(options.encode()).hexdigest()
        result = checked_path(root / _uuid(workspace) / revision / (digest + suffix))
        if not result.is_relative_to(root):
            raise ValueError("outside cache")
        return result
    except ValueError as exc:
        raise HTTPException(403, "预览缓存路径不安全") from exc


def evict_cache(keep):
    global last_eviction
    with EVICTION_LOCK:
        if time.monotonic() - last_eviction < 30:
            return
        last_eviction = time.monotonic()
    root = keep.parents[2]
    files = []
    total = 0
    for item in root.glob("*/*/*"):
        if item.is_symlink() or item.suffix not in {".jpg", ".wav"}:
            continue
        try:
            stat = item.stat()
            files.append((stat.st_mtime, stat.st_size, item))
            total += stat.st_size
        except OSError:
            continue
    for _, size, item in sorted(files):
        if total <= PREVIEW_CACHE_BYTES:
            break
        if item == keep:
            continue
        try:
            checked_path(item).unlink(missing_ok=True)
            total -= size
        except (ValueError, OSError):
            continue


def generate(source, revision, target, args):
    import shutil

    if target.is_file():
        target.touch()
        return
    if not PREVIEW_CONCURRENCY.acquire(timeout=0.1):
        raise HTTPException(429, "时间线预览正在准备，请稍后重试", headers={"Retry-After": "1"})
    temporary = target.with_name("." + str(uuid.uuid4()) + target.suffix)
    try:
        if target.is_file():
            return
        target.parent.mkdir(parents=True, exist_ok=True)
        if shutil.disk_usage(target.parent).free < MIN_FREE:
            raise HTTPException(507, "预览缓存空间不足")
        subprocess.run(
            [
                _binary("ffmpeg"),
                "-nostdin",
                "-v",
                "error",
                "-y",
                "-threads",
                "2",
                "-filter_threads",
                "1",
                *args,
                str(temporary),
            ],
            check=True,
            capture_output=True,
            timeout=45,
            creationflags=HIDDEN,
        )
        if fingerprint(source) != revision:
            raise HTTPException(409, "源文件已变化，请重新请求预览")
        if not temporary.is_file() or temporary.stat().st_size == 0:
            raise HTTPException(422, "该时间点没有可用预览")
        os.replace(temporary, target)
        evict_cache(target)
    except (OSError, subprocess.SubprocessError) as exc:
        raise HTTPException(422, "无法生成时间线预览，请检查素材编码") from exc
    finally:
        temporary.unlink(missing_ok=True)
        PREVIEW_CONCURRENCY.release()


def mount_video_preview_routes(app, base, verify_secret, check_path_trust):
    route = base + "/video_studio"
    read = [Depends(verify_secret)]

    @app.get(route + "/thumbnails", dependencies=read)
    def thumbnails(
        workspace_id: str,
        path: str,
        start: float = Query(0, ge=0, le=86400),
        end: float = Query(..., gt=0, le=86400),
        count: int = Query(8, ge=1, le=24),
        width: int = Query(120, ge=64, le=320),
    ):
        source = resolve_media(path, workspace_id, "video", check_path_trust)
        info = probe_media(source)
        if end <= start or start >= info["duration"]:
            raise HTTPException(422, "缩略图窗口超出素材时长")
        end = min(end, info["duration"])
        frames = []
        for index in range(count):
            time = round(start + (end - start) * (index + 0.5) / count, 6)
            query = urlencode(
                {
                    "workspace_id": workspace_id,
                    "path": path,
                    "time": time,
                    "width": width,
                    "revision": info["fingerprint"],
                }
            )
            frames.append({"time": time, "url": route + "/thumbnail?" + query})
        return {"frames": frames, "fingerprint": info["fingerprint"]}

    @app.get(route + "/thumbnail", dependencies=read)
    def thumbnail(
        workspace_id: str,
        path: str,
        time: float = Query(..., ge=0, le=86400),
        width: int = Query(120, ge=64, le=320),
        revision: str = Query(..., pattern=r"^[a-f0-9]{64}$"),
    ):
        source = resolve_media(path, workspace_id, "video", check_path_trust)
        info = probe_media(source)
        if revision != info["fingerprint"]:
            raise HTTPException(409, "素材版本已变化")
        if time >= info["duration"]:
            raise HTTPException(422, "缩略图位置超出素材时长")
        target = cache_path(workspace_id, revision, f"thumbnail-v1:{time:.6f}:{width}", ".jpg")
        generate(
            source,
            revision,
            target,
            [
                "-ss",
                f"{max(0, math.floor(time * (info['fps'] or 30)) / (info['fps'] or 30) - 0.000001):.9f}",
                "-i",
                str(source),
                "-frames:v",
                "1",
                "-an",
                "-vf",
                f"scale={width}:{width}:force_original_aspect_ratio=decrease",
                "-q:v",
                "4",
            ],
        )
        return FileResponse(
            target,
            media_type="image/jpeg",
            headers={"Cache-Control": "private, no-cache", "ETag": f'"{target.stem}"'},
        )

    @app.get(route + "/preview-audio", dependencies=read)
    def preview_audio(
        workspace_id: str,
        path: str,
        kind: Literal["video", "audio"] = "video",
        start: float = Query(0, ge=0, le=86400),
        duration: float = Query(..., gt=0, le=30),
        rate: float = Query(1, ge=0.25, le=4),
        reverse: bool = False,
    ):
        source = resolve_media(path, workspace_id, kind, check_path_trust)
        info = probe_media(source, kind)
        if not info["has_audio"] or start + duration * rate > info["duration"] + 0.03:
            raise HTTPException(422, "预览范围超出源音轨")
        revision = info["fingerprint"]
        target = cache_path(
            workspace_id,
            revision,
            f"audio-v2:{start:.9f}:{duration:.9f}:{rate:.9f}:{reverse}",
            ".wav",
        )
        seek, source_length, filters = audio_window(start, duration, rate)
        if reverse:
            filters.append("areverse")
        generate(
            source,
            revision,
            target,
            [
                "-ss",
                f"{seek:.9f}",
                "-t",
                f"{source_length:.9f}",
                "-i",
                str(source),
                "-map",
                "0:a:0",
                "-vn",
                "-af",
                ",".join(filters),
                "-c:a",
                "pcm_s16le",
                "-t",
                f"{duration:.9f}",
            ],
        )
        return FileResponse(
            target, media_type="audio/wav", headers={"Cache-Control": "private, no-cache"}
        )
