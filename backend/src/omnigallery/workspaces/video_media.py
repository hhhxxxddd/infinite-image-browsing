"""Bounded source inspection and disposable, cancellable video preview proxies.

Only source references belong in editing documents. Proxy URLs are playback-only;
neither the original media nor the workspace artifact catalogue is changed here.
"""

import hashlib
import json
import math
import os
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlencode

from fastapi import Depends, HTTPException
from fastapi.responses import FileResponse
from PIL import Image
from pydantic import BaseModel, ConfigDict, Field

from omnigallery.config import get_cache_dir
from omnigallery.infrastructure.database import Database
from omnigallery.infrastructure.media_runtime import binary as media_binary
from omnigallery.storage.filesystem import checked_path
from omnigallery.workspaces.artifacts import _file, _row, _uuid, artifact_root
from omnigallery.workspaces.audio_streams import enumerate_audio_streams

HIDDEN = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
PROFILE = "720p-h264-v1"
MAX_CACHE_BYTES = 20 * 1024**3
MIN_FREE_BYTES = 512 * 1024**2
ACTIVE = {"queued", "running"}
SUFFIXES = {
    "image": {".png", ".jpg", ".jpeg", ".jpe", ".webp", ".avif", ".gif", ".bmp"},
    "video": {".mp4", ".m4v", ".avi", ".mkv", ".mov", ".wmv", ".flv", ".ts", ".webm"},
    "audio": {".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".wma"},
}


def proxy_root() -> Path:
    try:
        return checked_path(Path(get_cache_dir()) / "video-proxies")
    except ValueError as error:
        raise HTTPException(403, "视频预览缓存路径不安全") from error


def _safe(path: Path) -> Path:
    try:
        resolved = checked_path(path)
        if not resolved.is_relative_to(proxy_root()):
            raise ValueError("outside cache")
        return resolved
    except ValueError as error:
        raise HTTPException(403, "视频预览缓存路径不安全") from error


def resolve_media(path: str, workspace_id: str, kind: str, check_path_trust) -> Path:
    workspace_id = _uuid(workspace_id)
    if path.startswith("workspace-artifact:"):
        row = _row(Database.get_connection(), path.removeprefix("workspace-artifact:"))
        if row["workspace_id"] != workspace_id or row["kind"] != kind:
            raise HTTPException(403, "素材不属于当前工作区或类型不匹配")
        source = _file(row)
        try:
            source = checked_path(source)
        except ValueError as error:
            raise HTTPException(403, "素材产物路径不安全") from error
        if not source.is_relative_to((artifact_root() / workspace_id).resolve()):
            raise HTTPException(403, "素材产物路径不安全")
    else:
        check_path_trust(path)
        source = Path(path).resolve()
        check_path_trust(str(source))
    if source.is_relative_to(proxy_root()):
        raise HTTPException(422, "代理仅用于预览，请使用原始素材")
    if not source.is_file():
        raise HTTPException(404, "源文件不可用，请恢复原文件后重试")
    if source.suffix.lower() not in SUFFIXES[kind]:
        raise HTTPException(422, "源文件类型与素材不一致")
    return source


def fingerprint(path: Path) -> str:
    stat = path.stat()
    # The source is never read or hashed in Python, even for multi-gigabyte files.
    return hashlib.sha256(
        f"{path}:{stat.st_size}:{stat.st_mtime_ns}:{PROFILE}".encode()
    ).hexdigest()


def _binary(name: str) -> str:
    binary = media_binary(name)
    if not binary:
        raise HTTPException(503, f"视频预览需要 {name}，请到设置 → 运行环境检查 FFmpeg")
    return binary


def _number(value, default=0.0) -> float:
    try:
        value = float(value)
        return value if math.isfinite(value) else default
    except (TypeError, ValueError):
        return default


def _ratio(value, default=0.0) -> float:
    try:
        left, right = str(value).replace(":", "/").split("/")
        return _number(left) / float(right)
    except (ValueError, ZeroDivisionError):
        return default


@lru_cache(maxsize=256)
def _probe(path: str, size: int, modified: int, kind: str) -> dict:
    if kind == "image":
        try:
            with Image.open(path) as image:
                # Header-only dimensions. Do not decode or copy a full image here.
                width, height = image.size
                if image.getexif().get(274) in {5, 6, 7, 8}:
                    width, height = height, width
                return {
                    "duration": 0,
                    "width": width,
                    "height": height,
                    "encoded_width": image.width,
                    "encoded_height": image.height,
                    "rotation": 0,
                    "fps": 0,
                    "video_codec": "",
                    "audio_streams": [],
                    "start_time": 0,
                    "has_audio": False,
                    "hdr": False,
                    "warnings": [],
                }
        except (OSError, ValueError) as error:
            raise HTTPException(422, "无法读取图片尺寸") from error
    try:
        result = subprocess.run(
            [
                _binary("ffprobe"),
                "-v",
                "error",
                "-show_entries",
                "format=format_name,duration,start_time:stream=index,codec_type,codec_name,width,height,"
                "duration,start_time,avg_frame_rate,r_frame_rate,sample_aspect_ratio,sample_rate,channels,"
                "channel_layout,color_transfer,color_primaries,pix_fmt:stream_tags=rotate,language,title,DURATION:"
                "stream_side_data=rotation:stream_disposition=attached_pic,default",
                "-of",
                "json",
                path,
            ],
            capture_output=True,
            timeout=45,
            creationflags=HIDDEN,
            check=True,
        )
        info = json.loads(result.stdout)
        streams = info.get("streams", [])
        video = next(
            (
                item
                for item in streams
                if item.get("codec_type") == "video"
                and not item.get("disposition", {}).get("attached_pic")
            ),
            {},
        )
        audio = [item for item in streams if item.get("codec_type") == "audio"]
        if (kind == "video" and not video) or (kind == "audio" and not audio):
            raise ValueError("no matching media stream")
        container = info.get("format", {})
        duration = _number(container.get("duration")) or max(
            (_number(item.get("duration")) for item in streams), default=0
        )
        if not 0 < duration <= 86400:
            raise ValueError("invalid duration")
        rotation = _number(video.get("tags", {}).get("rotate"))
        for side in video.get("side_data_list", []):
            if "rotation" in side:
                rotation = _number(side["rotation"])
        rotation %= 360
        encoded_width, encoded_height = int(video.get("width", 0)), int(video.get("height", 0))
        sar = _ratio(video.get("sample_aspect_ratio"), 1) or 1
        width, height = round(encoded_width * sar), encoded_height
        if round(rotation) % 180 == 90:
            width, height = height, width
        hdr = video.get("color_transfer") in {"smpte2084", "arib-std-b67"}
        warnings = []
        if hdr:
            warnings.append("HDR 素材：代理为 8 位预览，色彩与 HDR 显示尚未验证，请以原片为准")
        if _ratio(video.get("avg_frame_rate")) != _ratio(video.get("r_frame_rate")):
            warnings.append("可能为可变帧率素材，请检查精确切点与音画同步")
        return {
            "duration": duration,
            "start_time": _number(container.get("start_time")),
            "width": width,
            "height": height,
            "encoded_width": encoded_width,
            "encoded_height": encoded_height,
            "rotation": rotation,
            "fps": _ratio(video.get("avg_frame_rate")),
            "video_codec": video.get("codec_name", ""),
            "container": container.get("format_name", ""),
            "video_stream_index": video.get("index", 0),
            "has_audio": bool(audio),
            "hdr": hdr,
            "audio_streams": enumerate_audio_streams(info),
            "warnings": warnings,
        }
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError) as error:
        raise HTTPException(422, "无法读取源媒体，请检查文件、时长和编码") from error


def probe_media(path: Path, kind="video") -> dict:
    stat = path.stat()
    metadata = _probe(str(path), stat.st_size, stat.st_mtime_ns, kind)
    current = path.stat()
    if (stat.st_size, stat.st_mtime_ns) != (current.st_size, current.st_mtime_ns):
        raise HTTPException(409, "源文件正在变化，请稍后重试")
    return {
        **metadata,
        "size": stat.st_size,
        "fingerprint": fingerprint(path),
    }


class ProxyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    workspace_id: str
    path: str = Field(min_length=1, max_length=8192)


class VideoMedia:
    def __init__(self, check_path_trust, base="/api"):
        self.check_path_trust = check_path_trust
        self.base = base
        self.lock = threading.RLock()
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="video-proxy")
        self.jobs: dict[str, dict] = {}
        self.closed = False

    def _directory(self, workspace_id: str, source: Path) -> Path:
        key = hashlib.sha256(str(source).encode()).hexdigest()
        return _safe(proxy_root() / _uuid(workspace_id) / key)

    def _target(self, workspace_id: str, source: Path, revision: str) -> Path:
        return _safe(self._directory(workspace_id, source) / (revision + ".mp4"))

    def _url(self, workspace_id: str, path: str) -> str:
        return (
            self.base
            + "/video_studio/proxy?"
            + urlencode({"workspace_id": workspace_id, "path": path})
        )

    def info(self, workspace_id: str, path: str, kind: str) -> dict:
        source = resolve_media(path, workspace_id, kind, self.check_path_trust)
        metadata = probe_media(source, kind)
        target = self._target(workspace_id, source, metadata["fingerprint"])
        return {
            **metadata,
            "path": path,
            "kind": kind,
            "proxy_url": self._url(workspace_id, path)
            if kind == "video" and target.is_file()
            else None,
        }

    def _public(self, job: dict) -> dict:
        return {key: value for key, value in job.items() if not key.startswith("_")}

    def submit(self, request: ProxyRequest) -> dict:
        workspace_id = _uuid(request.workspace_id)
        source = resolve_media(request.path, workspace_id, "video", self.check_path_trust)
        metadata = probe_media(source)
        revision = metadata["fingerprint"]
        target = self._target(workspace_id, source, revision)
        with self.lock:
            if self.closed:
                raise HTTPException(503, "视频预览服务正在关闭")
            for job in self.jobs.values():
                if (
                    job["workspace_id"] == workspace_id
                    and job["_target"] == target
                    and job["state"] in ACTIVE
                ):
                    return self._public(job)
            if sum(job["state"] in ACTIVE for job in self.jobs.values()) >= 16:
                raise HTTPException(429, "代理任务较多，请等待当前任务完成")
            for job in list(self.jobs.values()):
                if len(self.jobs) < 256:
                    break
                if job["state"] not in ACTIVE:
                    self.jobs.pop(job["id"])
            ready = target.is_file() and target.stat().st_size > 0
            job = {
                "id": str(uuid.uuid4()),
                "workspace_id": workspace_id,
                "path": request.path,
                "fingerprint": revision,
                "state": "succeeded" if ready else "queued",
                "progress": 1.0 if ready else 0.0,
                "error": "",
                "proxy_url": self._url(workspace_id, request.path) if ready else None,
                "_source": source,
                "_target": target,
                "_metadata": metadata,
                "_cancel": threading.Event(),
                "_process": None,
            }
            self.jobs[job["id"]] = job
            if ready:
                target.touch()
            else:
                self.executor.submit(self._run, job)
            return self._public(job)

    def get(self, workspace_id: str, job_id: str) -> dict:
        with self.lock:
            job = self.jobs.get(job_id)
            if not job or job["workspace_id"] != _uuid(workspace_id):
                raise HTTPException(404, "代理任务不存在")
            return self._public(job)

    def list(self, workspace_id: str) -> dict:
        workspace_id = _uuid(workspace_id)
        with self.lock:
            return {
                "jobs": [
                    self._public(job)
                    for job in reversed(list(self.jobs.values()))
                    if job["workspace_id"] == workspace_id
                ]
            }

    def cancel(self, workspace_id: str, job_id: str) -> dict:
        with self.lock:
            self.get(workspace_id, job_id)
            job = self.jobs[job_id]
            if job["state"] in ACTIVE:
                job["_cancel"].set()
                job["state"] = "cancelled"
                process = job["_process"]
                if process and process.poll() is None:
                    process.kill()
            return self._public(job)

    def clear(self, workspace_id: str, path: str) -> dict:
        workspace_id = _uuid(workspace_id)
        source = resolve_media(path, workspace_id, "video", self.check_path_trust)
        with self.lock:
            active_temporaries = set()
            for job in self.jobs.values():
                if job["workspace_id"] == workspace_id and job["_source"] == source:
                    if job["_process"] is not None:
                        active_temporaries.add("." + job["id"] + ".mp4")
                    self.cancel(workspace_id, job["id"])
                    job.update(state="cancelled", proxy_url=None)
            directory = self._directory(workspace_id, source)
            removed = 0
            for item in directory.glob("*.mp4"):
                # Active temporary files are cleaned by their worker after cancellation.
                if item.name in active_temporaries:
                    continue
                try:
                    _safe(item).unlink(missing_ok=True)
                    removed += 1
                except PermissionError as error:
                    raise HTTPException(409, "代理正在播放，请切回原画后再清理") from error
            return {"deleted": removed}

    def file(self, workspace_id: str, path: str) -> FileResponse:
        source = resolve_media(path, workspace_id, "video", self.check_path_trust)
        target = self._target(workspace_id, source, fingerprint(source))
        if not target.is_file():
            raise HTTPException(404, "代理不可用，请重新生成")
        target.touch()
        return FileResponse(
            target, media_type="video/mp4", headers={"Cache-Control": "private, no-cache"}
        )

    def close(self):
        with self.lock:
            self.closed = True
            for job in self.jobs.values():
                self.cancel(job["workspace_id"], job["id"])
        self.executor.shutdown(wait=True, cancel_futures=True)

    def _evict(self, keep: Path):
        files = []
        for path in proxy_root().glob("*/*/*.mp4"):
            if path.name.startswith("."):
                continue
            try:
                path = _safe(path)
                stat = path.stat()
                files.append((stat.st_mtime, stat.st_size, path))
            except (HTTPException, OSError):
                continue  # Never follow a link or turn a concurrent cleanup into job failure.
        files.sort(reverse=True)
        total = 0
        for _, size, path in files:
            total += size
            if total > MAX_CACHE_BYTES and path != keep:
                try:
                    _safe(path).unlink(missing_ok=True)
                except (HTTPException, OSError):
                    pass  # An actively streamed cache entry can be reclaimed later.

    def _run(self, job: dict):
        target = job["_target"]
        temporary = None
        process = None
        try:
            with self.lock:
                if job["_cancel"].is_set():
                    return
                job["state"] = "running"
            source = resolve_media(job["path"], job["workspace_id"], "video", self.check_path_trust)
            metadata = job["_metadata"]
            if fingerprint(source) != metadata["fingerprint"]:
                raise HTTPException(409, "源文件已变化，请重新生成代理")
            directory = _safe(target.parent)
            directory.mkdir(parents=True, exist_ok=True)
            if shutil.disk_usage(directory).free < MIN_FREE_BYTES:
                raise HTTPException(507, "代理缓存空间不足，请清理磁盘后重试")
            temporary = _safe(directory / ("." + job["id"] + ".mp4"))
            width, height = metadata["width"], metadata["height"]
            scale = min(
                1,
                (1280 if width >= height else 720) / max(1, width),
                (720 if width >= height else 1280) / max(1, height),
            )
            width, height = (
                max(2, int(width * scale) // 2 * 2),
                max(2, int(height * scale) // 2 * 2),
            )
            args = [
                _binary("ffmpeg"),
                "-nostdin",
                "-v",
                "error",
                "-y",
                "-copyts",
                "-start_at_zero",
                "-i",
                str(source),
                "-map",
                f"0:{metadata['video_stream_index']}",
                "-map",
                "0:a?",
                "-vf",
                f"scale={width}:{height}:flags=fast_bilinear,setsar=1",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "26",
                "-pix_fmt",
                "yuv420p",
                "-threads",
                "2",
                "-maxrate",
                "6M",
                "-bufsize",
                "12M",
                "-fps_mode:v",
                "vfr",
                "-force_key_frames",
                "expr:gte(t,n_forced*2)",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                "-metadata:s:v:0",
                "rotate=0",
                "-movflags",
                "+faststart",
                "-progress",
                "pipe:1",
                "-nostats",
                str(temporary),
            ]
            # Only short progress records enter Python. Encoded media stays on disk.
            with tempfile.TemporaryFile() as errors:
                with self.lock:
                    if job["_cancel"].is_set():
                        return
                    process = subprocess.Popen(
                        args, stdout=subprocess.PIPE, stderr=errors, creationflags=HIDDEN
                    )
                    job["_process"] = process
                started = time.monotonic()
                for line in iter(process.stdout.readline, b""):
                    if job["_cancel"].is_set():
                        break
                    if line.startswith(b"out_time_us="):
                        progress = (
                            _number(line.split(b"=", 1)[1]) / 1_000_000 / metadata["duration"]
                        )
                        with self.lock:
                            job["progress"] = max(job["progress"], min(0.99, progress))
                        if (
                            temporary.stat().st_size > MAX_CACHE_BYTES
                            or shutil.disk_usage(directory).free < MIN_FREE_BYTES
                        ):
                            raise HTTPException(507, "代理缓存空间不足，请缩短素材或清理缓存")
                    if time.monotonic() - started > max(600, metadata["duration"] * 20):
                        raise HTTPException(504, "代理生成超时，可取消后重试")
                result = process.wait()
                if job["_cancel"].is_set():
                    return
                if result:
                    errors.seek(0, os.SEEK_END)
                    errors.seek(max(0, errors.tell() - 1200))
                    raise HTTPException(
                        422, "代理生成失败：" + errors.read(1200).decode(errors="replace")
                    )
            resolve_media(job["path"], job["workspace_id"], "video", self.check_path_trust)
            if fingerprint(source) != metadata["fingerprint"]:
                raise HTTPException(409, "源文件已变化，本次代理未保留")
            with self.lock:
                if job["_cancel"].is_set():
                    return
                os.replace(_safe(temporary), _safe(target))
                job.update(
                    state="succeeded",
                    progress=1.0,
                    proxy_url=self._url(job["workspace_id"], job["path"]),
                )
                self._evict(target)
        except Exception as error:
            with self.lock:
                if not job["_cancel"].is_set():
                    job.update(
                        state="failed",
                        error=str(error.detail) if isinstance(error, HTTPException) else str(error),
                    )
        finally:
            if process:
                if process.poll() is None:
                    process.kill()
                process.wait()
                process.stdout.close()
            if temporary:
                try:
                    _safe(temporary).unlink(missing_ok=True)
                except (HTTPException, OSError):
                    pass  # Managed-cache safety still applies if a directory changed mid-job.
            with self.lock:
                job["_process"] = None


def mount_video_media_routes(app, base, verify_secret, write_permission_required, check_path_trust):
    from omnigallery.workspaces.video_previews import mount_video_preview_routes

    mount_video_preview_routes(app, base, verify_secret, check_path_trust)
    service = VideoMedia(check_path_trust, base)
    app.state.video_media = service
    route = base + "/video_studio"
    read = [Depends(verify_secret)]
    write = [Depends(verify_secret), Depends(write_permission_required)]

    @app.get(route + "/media", dependencies=read)
    def media(workspace_id: str, path: str, kind: Literal["video", "audio", "image"] = "video"):
        return service.info(workspace_id, path, kind)

    @app.post(route + "/proxies", dependencies=write)
    def create_proxy(request: ProxyRequest):
        return service.submit(request)

    @app.get(route + "/proxies", dependencies=read)
    def list_proxies(workspace_id: str):
        return service.list(workspace_id)

    @app.get(route + "/proxies/{job_id}", dependencies=read)
    def get_proxy(job_id: str, workspace_id: str):
        return service.get(workspace_id, job_id)

    @app.post(route + "/proxies/{job_id}/cancel", dependencies=write)
    def cancel_proxy(job_id: str, workspace_id: str):
        return service.cancel(workspace_id, job_id)

    @app.get(route + "/proxy", dependencies=read)
    def proxy_file(workspace_id: str, path: str):
        return service.file(workspace_id, path)

    @app.delete(route + "/proxy", dependencies=write)
    def clear_proxy(workspace_id: str, path: str):
        return service.clear(workspace_id, path)
