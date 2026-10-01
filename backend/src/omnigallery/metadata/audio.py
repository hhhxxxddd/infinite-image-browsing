"""Read and safely update local audio metadata without encoding the audio stream."""

from __future__ import annotations

import base64
import io
import os
import re
import shutil
import tempfile
import threading
import time
from functools import lru_cache
from pathlib import Path

import mutagen
from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import Response
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field

from omnigallery.infrastructure.auth import write_permission_required
from omnigallery.infrastructure.formatting import get_modified_date
from omnigallery.infrastructure.video_streaming import close_video_file_reader
from omnigallery.library.media_types import is_audio_file
from omnigallery.metadata.audio_tags import (
    WRITABLE_TYPES,
    can_write_tags,
    embedded_cover,
    song_fields,
    write_song_tags,
)
from omnigallery.metadata.audio_tags import (
    first as _first,
)
from omnigallery.storage.cloud_files import get_sync_settings, is_protected_online_path

MAX_ART_BYTES = 8 * 1024 * 1024
MAX_LYRICS_BYTES = 512 * 1024
LRC_LINE = re.compile(r"\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]")
SUBTITLE_TIME = re.compile(r"(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{1,3})\s*-->")
_write_lock = threading.Lock()


class UpdateAudioMetadataRequest(BaseModel):
    path: str
    revision: str = Field(min_length=1, max_length=100)
    title: str = Field(max_length=1000)
    artist: str = Field(max_length=1000)
    album: str = Field(max_length=1000)
    cover: str | None = Field(default=None, max_length=12 * 1024 * 1024)
    remove_cover: bool = False


def _revision(stat: os.stat_result) -> str:
    return f"{stat.st_mtime_ns}:{stat.st_size}"


def _sidecar(path: str, extensions: tuple[str, ...]) -> Path | None:
    audio = Path(path)
    for extension in extensions:
        candidate = audio.with_suffix(extension)
        if candidate.is_file() and not candidate.is_symlink():
            return candidate
    return None


def _read_sidecar(path: Path) -> str:
    if path.stat().st_size > MAX_LYRICS_BYTES:
        return ""
    data = path.read_bytes()
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            return data.decode(encoding).strip()
        except UnicodeDecodeError:
            pass
    return ""


def _timed_lyrics(text: str, extension: str) -> list[dict]:
    lines: list[dict] = []
    if extension == ".lrc" or LRC_LINE.search(text):
        for raw in text.splitlines():
            matches = list(LRC_LINE.finditer(raw))
            lyric = LRC_LINE.sub("", raw).strip()
            if not matches or not lyric:
                continue
            for match in matches:
                fraction = match.group(3) or "0"
                lines.append(
                    {
                        "time": int(match.group(1)) * 60
                        + int(match.group(2))
                        + int(fraction) / 10 ** len(fraction),
                        "text": lyric,
                    }
                )
    elif extension in (".srt", ".vtt"):
        for block in re.split(r"\n\s*\n", text):
            parts = block.splitlines()
            for position, raw in enumerate(parts):
                match = SUBTITLE_TIME.search(raw)
                if match:
                    fraction = match.group(4)
                    caption = " ".join(parts[position + 1 :]).strip()
                    if caption:
                        lines.append(
                            {
                                "time": int(match.group(1) or 0) * 3600
                                + int(match.group(2)) * 60
                                + int(match.group(3))
                                + int(fraction) / 10 ** len(fraction),
                                "text": caption,
                            }
                        )
                    break
    return sorted(lines, key=lambda line: line["time"])


def _embedded_lyrics(audio) -> str:
    tags = getattr(audio, "tags", None)
    if not tags:
        return ""
    if hasattr(tags, "getall"):
        frames = tags.getall("USLT")
        if frames:
            return str(frames[0].text).strip()
    for key in ("\xa9lyr", "LYRICS", "UNSYNCEDLYRICS", "SYNCEDLYRICS", "WM/Lyrics"):
        text = _first(tags, key)
        if text:
            return text
    return ""


def _embedded_timed_lyrics(audio) -> list[dict]:
    tags = getattr(audio, "tags", None)
    if not tags or not hasattr(tags, "getall"):
        return []
    for frame in tags.getall("SYLT"):
        # ID3 permits MPEG-frame timestamps too; only milliseconds map to playback time.
        if frame.format != 2:
            continue
        lines = [
            {"time": stamp / 1000, "text": str(text).strip()}
            for text, stamp in frame.text
            if isinstance(stamp, int) and str(text).strip()
        ]
        if lines:
            return sorted(lines, key=lambda line: line["time"])
    return []


def _lyrics(path: str, audio) -> dict | None:
    sidecar = _sidecar(path, (".lrc", ".srt", ".vtt", ".txt"))
    text = _read_sidecar(sidecar) if sidecar else ""
    if not text:
        sidecar = None
        timed = _embedded_timed_lyrics(audio)
        if timed:
            return {"source": "embedded", "timed": True, "lines": timed}
        text = _embedded_lyrics(audio)
    if not text:
        return None
    timed = _timed_lyrics(text, sidecar.suffix.lower() if sidecar else "")
    return {
        "source": "sidecar" if sidecar else "embedded",
        "timed": bool(timed),
        "lines": timed
        if timed
        else [{"text": line.strip()} for line in text.splitlines() if line.strip()],
    }


def _has_embedded_cover(audio) -> bool:
    return embedded_cover(audio, MAX_ART_BYTES) is not None


@lru_cache(maxsize=512)
def _metadata(
    path: str, modified_ns: int, size: int, lyric_version: tuple, cover_version: tuple
) -> dict:
    del lyric_version, cover_version
    try:
        audio = mutagen.File(path)
    except (OSError, ValueError, mutagen.MutagenError):
        audio = None
    duration = getattr(getattr(audio, "info", None), "length", None)
    title, artist, album = song_fields(audio)
    sidecar = _cover_sidecar(path)
    embedded_cover = _has_embedded_cover(audio)
    return {
        "title": title or Path(path).stem,
        "embedded_title": title,
        "title_source": "embedded" if title else "filename",
        "artist": artist,
        "album": album,
        "duration": round(float(duration), 2) if duration and duration > 0 else None,
        "has_cover": embedded_cover or bool(sidecar),
        "cover_source": "embedded"
        if embedded_cover
        else ("same_name" if sidecar.stem == Path(path).stem else "directory")
        if sidecar
        else None,
        "cover_name": sidecar.name if sidecar and not embedded_cover else "",
        "editable": can_write_tags(path, audio),
        "revision": f"{modified_ns}:{size}",
        "modified_date": get_modified_date(path),
        "lyrics": _lyrics(path, audio),
    }


def _cover_sidecar(path: str) -> Path | None:
    audio = Path(path)
    folder = audio.parent
    candidates = [audio.with_suffix(ext) for ext in (".jpg", ".jpeg", ".png", ".webp")]
    candidates += [
        folder / (name + ext)
        for name in ("cover", "folder", "front")
        for ext in (".jpg", ".jpeg", ".png", ".webp")
    ]
    return next(
        (
            item
            for item in candidates
            if item.is_file() and not item.is_symlink() and item.stat().st_size <= MAX_ART_BYTES
        ),
        None,
    )


def _embedded_cover(path: str) -> bytes | None:
    try:
        audio = mutagen.File(path)
    except (OSError, ValueError, mutagen.MutagenError):
        return None
    return embedded_cover(audio, MAX_ART_BYTES)


@lru_cache(maxsize=256)
def _cover(path: str, modified_ns: int, size: int, sidecar_version: tuple) -> bytes | None:
    del modified_ns, size, sidecar_version
    data = _embedded_cover(path)
    sidecar = _cover_sidecar(path)
    if data and len(data) > MAX_ART_BYTES:
        data = None
    if not data and sidecar is None:
        return None
    for source in (io.BytesIO(data) if data else None, sidecar):
        if source is None:
            continue
        try:
            with Image.open(source) as media:
                if media.width * media.height > 24_000_000:
                    continue
                media.thumbnail((384, 384))
                output = io.BytesIO()
                media.convert("RGBA").save(output, format="WEBP", quality=82)
                return output.getvalue()
        except (OSError, ValueError, UnidentifiedImageError):
            continue
    return None


def _version(path: Path | None) -> tuple:
    if not path:
        return ()
    stat = path.stat()
    return str(path), stat.st_mtime_ns, stat.st_size


def _read_cover_upload(value: str) -> tuple[bytes, str]:
    try:
        header, encoded = value.split(",", 1)
        if header not in (
            "data:image/png;base64",
            "data:image/jpeg;base64",
            "data:image/webp;base64",
        ):
            raise ValueError("unsupported image")
        data = base64.b64decode(encoded, validate=True)
        if len(data) > MAX_ART_BYTES:
            raise ValueError("cover too large")
        with Image.open(io.BytesIO(data)) as image:
            if image.width * image.height > 24_000_000 or image.format not in (
                "PNG",
                "JPEG",
                "WEBP",
            ):
                raise ValueError("invalid image")
            image.load()
            output = io.BytesIO()
            image.convert("RGB").save(output, format="JPEG", quality=95)
            result = output.getvalue()
            if len(result) > MAX_ART_BYTES:
                raise ValueError("cover too large")
            return result, "image/jpeg"
    except (ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError) as cause:
        raise HTTPException(
            422, detail="封面须为 JPEG、PNG 或 WebP，最大 8 MB、2400 万像素"
        ) from cause


def _write_audio_tags(path: str, request: UpdateAudioMetadataRequest) -> None:
    if request.cover is not None and request.remove_cover:
        raise HTTPException(422, detail="不能同时替换和移除封面")
    cover = _read_cover_upload(request.cover) if request.cover is not None else None
    with _write_lock:
        before = os.stat(path)
        if request.revision != _revision(before):
            raise HTTPException(409, detail="音频文件已改变，请重新读取后编辑")
        if os.path.islink(path):
            raise HTTPException(422, detail="不支持修改符号链接的音频标签")
        temporary = None
        try:
            # Mutagen changes only tags on a copy; publication replaces the complete file atomically.
            with tempfile.NamedTemporaryFile(
                dir=Path(path).parent,
                prefix=".omnigallery-audio-",
                suffix=Path(path).suffix,
                delete=False,
            ) as output:
                temporary = output.name
            shutil.copy2(path, temporary)
            audio = mutagen.File(temporary)
            if not can_write_tags(path, audio):
                raise HTTPException(422, detail="此音频内容不支持写入歌曲信息")
            write_song_tags(
                audio, request.title, request.artist, request.album, cover, request.remove_cover
            )
            if _revision(os.stat(path)) != _revision(before):
                raise HTTPException(409, detail="音频文件已改变，请重新读取后编辑")
            for attempt in range(5):
                if _revision(os.stat(path)) != _revision(before):
                    raise HTTPException(409, detail="音频文件已改变，请重新读取后编辑")
                try:
                    # The in-app audio preview uses /stream_video and can still have an
                    # open range reader after its HTMLAudioElement has been detached.
                    # Release those readers before Windows replaces the original audio.
                    close_video_file_reader(path)
                    os.replace(temporary, path)
                    break
                except PermissionError as cause:
                    if getattr(cause, "winerror", None) not in (5, 32, 33) or attempt == 4:
                        raise HTTPException(
                            422, detail="音频文件正在被占用或无法替换，请停止使用此文件后重试"
                        ) from cause
                    time.sleep(0.1 * (attempt + 1))
            temporary = None
            _metadata.cache_clear()
            _cover.cache_clear()
        except (OSError, ValueError, mutagen.MutagenError) as cause:
            raise HTTPException(422, detail="无法写入歌曲标签，请检查音频格式与文件权限") from cause
        finally:
            if temporary and os.path.exists(temporary):
                os.unlink(temporary)


def mount_audio_routes(app: FastAPI, api_base: str, verify_secret, check_path_trust) -> None:
    def checked(path: str) -> tuple[str, os.stat_result]:
        path = os.path.abspath(os.path.normpath(path))
        check_path_trust(path)
        from omnigallery.infrastructure.database import Database

        if is_protected_online_path(path, get_sync_settings(Database.get_connection())):
            raise HTTPException(409, detail="此文件仅在线，音频信息会在下载后读取")
        if not is_audio_file(path) or not os.path.isfile(path):
            raise HTTPException(404, detail="音频文件不存在")
        return path, os.stat(path)

    @app.get(api_base + "/audio_metadata", dependencies=[Depends(verify_secret)])
    def audio_metadata(path: str):
        path, stat = checked(path)
        lyric = _sidecar(path, (".lrc", ".srt", ".vtt", ".txt"))
        return _metadata(
            path, stat.st_mtime_ns, stat.st_size, _version(lyric), _version(_cover_sidecar(path))
        )

    @app.post(
        api_base + "/audio_metadata",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def update_audio_metadata(request: UpdateAudioMetadataRequest):
        path, _ = checked(request.path)
        if Path(path).suffix.lower() not in WRITABLE_TYPES:
            raise HTTPException(
                422, detail="歌曲信息写入支持 MP3、FLAC、OGG、M4A、WAV、WMA；裸 AAC 只读"
            )
        _write_audio_tags(path, request)
        return audio_metadata(path)

    @app.get(api_base + "/audio_cover", dependencies=[Depends(verify_secret)])
    def audio_cover(path: str):
        path, stat = checked(path)
        cover = _cover(path, stat.st_mtime_ns, stat.st_size, _version(_cover_sidecar(path)))
        if cover is None:
            raise HTTPException(404, detail="没有封面")
        return Response(
            cover, media_type="image/webp", headers={"Cache-Control": "private, max-age=60"}
        )
