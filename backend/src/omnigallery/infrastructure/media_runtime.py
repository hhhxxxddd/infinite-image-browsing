"""Detect and manage the FFmpeg tools used by local media editors."""

from __future__ import annotations

import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import threading
import uuid
import zipfile
from pathlib import Path

import requests
from fastapi import Depends, FastAPI, HTTPException

from omnigallery.config import DATA_ROOT, is_exe_ver
from omnigallery.infrastructure.network_proxy import requests_proxy_kwargs

RUNTIME_ROOT = DATA_ROOT / "media-runtime"
RECIPE = "ffmpeg-9.0.2-essentials"
ARCHIVE_URL = "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip"
ARCHIVE_SHA256 = "60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba"
MAX_ARCHIVE_BYTES = 220 * 1024 * 1024
MAX_UNPACKED_BYTES = 600 * 1024 * 1024
_lock = threading.RLock()
_job = {"running": False, "stage": "", "error": "", "progress": 0}


def supported() -> bool:
    return is_exe_ver and os.name == "nt" and platform.machine().lower() in {"amd64", "x86_64"}


def active_runtime() -> Path | None:
    try:
        directory = json.loads((RUNTIME_ROOT / "active.json").read_text(encoding="utf-8"))[
            "directory"
        ]
        if not isinstance(directory, str) or not re.fullmatch(r"[0-9a-f]{32}", directory):
            return None
        path = RUNTIME_ROOT / directory
        return path if (path / "bin/ffmpeg.exe").is_file() else None
    except (OSError, ValueError, KeyError, TypeError):
        return None


def binaries() -> tuple[str | None, str | None, str]:
    managed = active_runtime()
    if managed and (managed / "bin/ffprobe.exe").is_file():
        return str(managed / "bin/ffmpeg.exe"), str(managed / "bin/ffprobe.exe"), "managed"
    return shutil.which("ffmpeg"), shutil.which("ffprobe"), "system"


def binary(name: str) -> str | None:
    ffmpeg, ffprobe, _ = binaries()
    return ffmpeg if name == "ffmpeg" else ffprobe if name == "ffprobe" else None


def _run(path: str, *args: str) -> str:
    result = subprocess.run(
        [path, *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=20,
        check=True,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    return result.stdout


def _version(path: str | None) -> str:
    if not path:
        return ""
    try:
        first = _run(path, "-version").splitlines()[0]
        return first.split(" version ", 1)[1].split(" ", 1)[0]
    except (IndexError, OSError, ValueError, subprocess.SubprocessError):
        return ""


def status() -> dict:
    ffmpeg, ffprobe, source = binaries()
    ffmpeg_version, ffprobe_version = _version(ffmpeg), _version(ffprobe)
    managed = active_runtime()
    manifest = {}
    if managed:
        try:
            manifest = json.loads((managed / "manifest.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
    with _lock:
        return {
            "supported": supported(),
            "ready": bool(ffmpeg_version and ffprobe_version),
            "source": source if ffmpeg or ffprobe else "missing",
            "path": str(Path(ffmpeg).parent) if ffmpeg else "",
            "version": ffmpeg_version,
            "ffprobe_version": ffprobe_version,
            "managed_installed": bool(managed),
            "recipe": RECIPE,
            "update_available": bool(managed) and manifest.get("recipe") != RECIPE,
            "job": dict(_job),
        }


def _progress(stage: str, progress: int):
    with _lock:
        _job.update(stage=stage, progress=progress)


def check():
    try:
        ffmpeg, ffprobe, _ = binaries()
        _progress("检查混音滤镜与编码器", 60)
        _validate(ffmpeg, ffprobe)
        _progress("音视频引擎可用", 100)
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        with _lock:
            _job.update(stage="检查失败", error=str(error)[-1200:])
    finally:
        with _lock:
            _job["running"] = False


def _validate(ffmpeg: str | None, ffprobe: str | None):
    if not ffmpeg or not ffprobe:
        raise RuntimeError("未找到 ffmpeg 和 ffprobe，请安装 FFmpeg 或配置服务进程的 PATH")
    if not _version(ffmpeg) or not _version(ffprobe):
        raise RuntimeError("FFmpeg 无法启动，请检查安装文件")
    filters = _run(ffmpeg, "-hide_banner", "-filters")
    encoders = _run(ffmpeg, "-hide_banner", "-encoders")
    for name in ("amix", "atempo", "astats", "aresample"):
        if not re.search(rf"\b{name}\b", filters):
            raise RuntimeError(f"当前 FFmpeg 缺少 {name} 滤镜")
    for name in ("libmp3lame", "pcm_s16le"):
        if not re.search(rf"\b{name}\b", encoders):
            raise RuntimeError(f"当前 FFmpeg 缺少 {name} 编码器")


def _download(destination: Path):
    digest = hashlib.sha256()
    size = 0
    with requests.get(
        ARCHIVE_URL, stream=True, timeout=(20, 90), **requests_proxy_kwargs()
    ) as response:
        response.raise_for_status()
        with destination.open("wb") as output:
            for chunk in response.iter_content(1024 * 1024):
                size += len(chunk)
                if size > MAX_ARCHIVE_BYTES:
                    raise RuntimeError("FFmpeg 安装包超过允许大小")
                digest.update(chunk)
                output.write(chunk)
    if digest.hexdigest() != ARCHIVE_SHA256:
        raise RuntimeError("FFmpeg 安装包校验失败，请重试")


def _unpack(archive: Path, stage: Path):
    with zipfile.ZipFile(archive) as source:
        entries = source.infolist()
        if sum(item.file_size for item in entries) > MAX_UNPACKED_BYTES:
            raise RuntimeError("FFmpeg 安装包解压后超过允许大小")
        matches = {}
        for item in entries:
            parts = Path(item.filename).parts
            if ".." in parts or item.filename.startswith(("/", "\\")):
                raise RuntimeError("FFmpeg 安装包包含非法路径")
            if (
                len(parts) >= 2
                and parts[-2] == "bin"
                and parts[-1] in {"ffmpeg.exe", "ffprobe.exe"}
            ):
                matches.setdefault(str(Path(*parts[:-1])), {})[parts[-1]] = item
        pairs = [pair for pair in matches.values() if len(pair) == 2]
        if len(pairs) != 1:
            raise RuntimeError("FFmpeg 安装包缺少匹配的 ffmpeg／ffprobe")
        destination = stage / "bin"
        destination.mkdir(exist_ok=True)
        for name, item in pairs[0].items():
            with source.open(item) as input_file, (destination / name).open("wb") as output_file:
                shutil.copyfileobj(input_file, output_file)


def install():
    stage = None
    try:
        RUNTIME_ROOT.mkdir(parents=True, exist_ok=True)
        stage = RUNTIME_ROOT / uuid.uuid4().hex
        stage.mkdir()
        _progress("下载 FFmpeg", 5)
        archive = stage / "ffmpeg.zip"
        _download(archive)
        _progress("校验并解压 FFmpeg", 70)
        _unpack(archive, stage)
        archive.unlink()
        _progress("检查音视频引擎", 90)
        _validate(str(stage / "bin/ffmpeg.exe"), str(stage / "bin/ffprobe.exe"))
        (stage / "manifest.json").write_text(json.dumps({"recipe": RECIPE}), encoding="utf-8")
        pointer = RUNTIME_ROOT / "active.next.json"
        pointer.write_text(json.dumps({"directory": stage.name}), encoding="utf-8")
        pointer.replace(RUNTIME_ROOT / "active.json")
        _progress("音视频引擎已就绪", 100)
    except Exception as error:
        with _lock:
            _job.update(stage="安装失败，可重试", error=str(error)[-1200:])
        if stage and stage.resolve().parent == RUNTIME_ROOT.resolve() and stage != active_runtime():
            shutil.rmtree(stage, ignore_errors=True)
    finally:
        with _lock:
            _job["running"] = False


def mount_media_runtime_routes(
    app: FastAPI, api_base: str, verify_secret, write_permission_required
):
    @app.get(api_base + "/media-runtime", dependencies=[Depends(verify_secret)])
    def get_status():
        return status()

    def start(target):
        with _lock:
            if _job["running"]:
                raise HTTPException(409, detail="运行环境任务进行中")
            _job.update(running=True, stage="准备中", error="", progress=0)
        threading.Thread(target=target, daemon=True).start()
        return status()

    @app.post(
        api_base + "/media-runtime/check",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def check_runtime():
        return start(check)

    @app.post(
        api_base + "/media-runtime/install",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def install_runtime():
        if not supported():
            raise HTTPException(400, detail="仅 Windows x64 EXE 支持安装应用管理的 FFmpeg")
        return start(install)
