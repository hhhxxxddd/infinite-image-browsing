"""Read local audio artwork and lyrics without decoding the audio stream."""

from __future__ import annotations

import base64
import io
import os
import re
from functools import lru_cache
from pathlib import Path

import mutagen
from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import Response
from PIL import Image, UnidentifiedImageError

from scripts.iib.tool import is_audio_file
from scripts.iib.onedrive_sync import get_sync_settings, is_protected_online_path

MAX_ART_BYTES = 8 * 1024 * 1024
MAX_LYRICS_BYTES = 512 * 1024
LRC_LINE = re.compile(r"\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]")
SUBTITLE_TIME = re.compile(r"(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{1,3})\s*-->")


def _tag_values(tags, key: str):
    if not tags:
        return []
    try:
        return tags.get(key, [])
    except (KeyError, TypeError, ValueError):
        # Vorbis comments reject keys such as MP4's ©lyr instead of returning [].
        return []


def _first(tags, key: str) -> str:
    value = _tag_values(tags, key)
    if not value:
        return ""
    return str(value[0]).strip()


def _id3_text(audio, key: str) -> str:
    tags = getattr(audio, "tags", None)
    if not tags or not hasattr(tags, "getall"):
        return ""
    frames = tags.getall(key)
    return str(frames[0].text[0]).strip() if frames and getattr(frames[0], "text", None) else ""


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
                lines.append({
                    "time": int(match.group(1)) * 60 + int(match.group(2)) + int(fraction) / 10 ** len(fraction),
                    "text": lyric,
                })
    elif extension in (".srt", ".vtt"):
        for block in re.split(r"\n\s*\n", text):
            parts = block.splitlines()
            for position, raw in enumerate(parts):
                match = SUBTITLE_TIME.search(raw)
                if match:
                    fraction = match.group(4)
                    caption = " ".join(parts[position + 1:]).strip()
                    if caption:
                        lines.append({
                            "time": int(match.group(1) or 0) * 3600 + int(match.group(2)) * 60
                            + int(match.group(3)) + int(fraction) / 10 ** len(fraction),
                            "text": caption,
                        })
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
    for key in ("\xa9lyr", "LYRICS", "UNSYNCEDLYRICS", "SYNCEDLYRICS"):
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
        lines = [{"time": stamp / 1000, "text": str(text).strip()}
                 for text, stamp in frame.text if isinstance(stamp, int) and str(text).strip()]
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
        "lines": timed if timed else [{"text": line.strip()} for line in text.splitlines() if line.strip()],
    }


def _has_embedded_cover(audio) -> bool:
    if audio is None:
        return False
    if getattr(audio, "pictures", None):
        return True
    tags = getattr(audio, "tags", None)
    return bool(tags and ((hasattr(tags, "getall") and tags.getall("APIC"))
                          or _tag_values(tags, "covr") or _tag_values(tags, "metadata_block_picture")))


@lru_cache(maxsize=512)
def _metadata(path: str, modified_ns: int, size: int, lyric_version: tuple, cover_version: tuple) -> dict:
    del modified_ns, size, lyric_version, cover_version
    try:
        easy = mutagen.File(path, easy=True)
        audio = mutagen.File(path)
    except (OSError, ValueError, mutagen.MutagenError):
        easy = audio = None
    duration = getattr(getattr(audio, "info", None), "length", None)
    return {
        "title": _first(easy, "title") or _id3_text(audio, "TIT2") or Path(path).stem,
        "artist": _first(easy, "artist") or _id3_text(audio, "TPE1"),
        "album": _first(easy, "album") or _id3_text(audio, "TALB"),
        "duration": round(float(duration), 2) if duration and duration > 0 else None,
        "has_cover": _has_embedded_cover(audio) or bool(_cover_sidecar(path)),
        "lyrics": _lyrics(path, audio),
    }


def _cover_sidecar(path: str) -> Path | None:
    audio = Path(path)
    folder = audio.parent
    candidates = [audio.with_suffix(ext) for ext in (".jpg", ".jpeg", ".png", ".webp")]
    candidates += [folder / (name + ext) for name in ("cover", "folder", "front")
                   for ext in (".jpg", ".jpeg", ".png", ".webp")]
    return next((item for item in candidates if item.is_file() and not item.is_symlink()
                 and item.stat().st_size <= MAX_ART_BYTES), None)


def _embedded_cover(path: str) -> bytes | None:
    try:
        audio = mutagen.File(path)
    except (OSError, ValueError, mutagen.MutagenError):
        return None
    if audio is None:
        return None
    pictures = getattr(audio, "pictures", None)
    if pictures:
        front = next((picture for picture in pictures if picture.type == 3), pictures[0])
        return bytes(front.data)
    tags = getattr(audio, "tags", None)
    if not tags:
        return None
    if hasattr(tags, "getall"):
        pictures = tags.getall("APIC")
        if pictures:
            front = next((picture for picture in pictures if picture.type == 3), pictures[0])
            return bytes(front.data)
    covers = _tag_values(tags, "covr")
    if covers:
        return bytes(covers[0])
    encoded = _tag_values(tags, "metadata_block_picture")
    if encoded:
        try:
            from mutagen.flac import Picture
            return bytes(Picture(base64.b64decode(encoded[0])).data)
        except (ValueError, TypeError):
            return None
    return None


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
            with Image.open(source) as image:
                if image.width * image.height > 24_000_000:
                    continue
                image.thumbnail((384, 384))
                output = io.BytesIO()
                image.convert("RGBA").save(output, format="WEBP", quality=82)
                return output.getvalue()
        except (OSError, ValueError, UnidentifiedImageError):
            continue
    return None


def _version(path: Path | None) -> tuple:
    if not path:
        return ()
    stat = path.stat()
    return str(path), stat.st_mtime_ns, stat.st_size


def mount_audio_routes(app: FastAPI, api_base: str, verify_secret, check_path_trust) -> None:
    def checked(path: str) -> tuple[str, os.stat_result]:
        path = os.path.abspath(os.path.normpath(path))
        check_path_trust(path)
        from scripts.iib.db.datamodel import DataBase
        if is_protected_online_path(path, get_sync_settings(DataBase.get_conn())):
            raise HTTPException(409, detail="此文件仅在线，音频信息会在下载后读取")
        if not is_audio_file(path) or not os.path.isfile(path):
            raise HTTPException(404, detail="音频文件不存在")
        return path, os.stat(path)

    @app.get(api_base + "/audio_metadata", dependencies=[Depends(verify_secret)])
    def audio_metadata(path: str):
        path, stat = checked(path)
        lyric = _sidecar(path, (".lrc", ".srt", ".vtt", ".txt"))
        return _metadata(path, stat.st_mtime_ns, stat.st_size, _version(lyric), _version(_cover_sidecar(path)))

    @app.get(api_base + "/audio_cover", dependencies=[Depends(verify_secret)])
    def audio_cover(path: str):
        path, stat = checked(path)
        cover = _cover(path, stat.st_mtime_ns, stat.st_size, _version(_cover_sidecar(path)))
        if cover is None:
            raise HTTPException(404, detail="没有封面")
        return Response(cover, media_type="image/webp", headers={"Cache-Control": "private, max-age=60"})
