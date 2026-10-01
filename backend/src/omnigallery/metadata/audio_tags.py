"""Native song-tag adapters; saving changes metadata without encoding audio."""

from __future__ import annotations

import base64
import io
import struct
from pathlib import Path

from mutagen import MutagenError
from mutagen.asf import ASF, ASFByteArrayAttribute
from mutagen.flac import FLAC, Picture
from mutagen.id3 import APIC, TALB, TIT2, TPE1
from mutagen.mp3 import MP3
from mutagen.mp4 import MP4, MP4Cover
from mutagen.oggflac import OggFLAC
from mutagen.oggopus import OggOpus
from mutagen.oggspeex import OggSpeex
from mutagen.oggvorbis import OggVorbis
from mutagen.wave import WAVE
from PIL import Image

OGG_TYPES = (OggVorbis, OggOpus, OggFLAC, OggSpeex)
WRITABLE_TYPES = {
    ".mp3": (MP3,),
    ".wav": (WAVE,),
    ".flac": (FLAC,),
    ".ogg": OGG_TYPES,
    ".m4a": (MP4,),
    ".wma": (ASF,),
}


def can_write_tags(path: str, audio) -> bool:
    return isinstance(audio, WRITABLE_TYPES.get(Path(path).suffix.lower(), ()))


def tag_values(tags, key: str):
    if not tags:
        return []
    try:
        return tags.get(key, [])
    except (KeyError, TypeError, ValueError):
        # Vorbis comments reject non-ASCII keys used by MP4 instead of returning [].
        return []


def first(tags, key: str) -> str:
    values = tag_values(tags, key)
    return str(values[0]).strip() if values else ""


def _text_keys(audio) -> tuple[str, str, str]:
    if isinstance(audio, MP4):
        return "\xa9nam", "\xa9ART", "\xa9alb"
    if isinstance(audio, ASF):
        return "Title", "Author", "WM/AlbumTitle"
    return "title", "artist", "album"


def song_fields(audio) -> tuple[str, str, str]:
    tags = getattr(audio, "tags", None)
    if tags and hasattr(tags, "getall"):
        result = []
        for key in ("TIT2", "TPE1", "TALB"):
            frames = tags.getall(key)
            result.append(str(frames[0].text[0]).strip() if frames and frames[0].text else "")
        return tuple(result)
    return tuple(first(tags, key) for key in _text_keys(audio))


def _asf_picture(value, max_bytes: int) -> tuple[int, bytes] | None:
    data = getattr(value, "value", value)
    if not isinstance(data, bytes) or not 5 <= len(data) <= max_bytes + 4096:
        return None
    picture_type, size = struct.unpack_from("<BI", data)
    if not 0 < size <= max_bytes:
        return None
    offset = 5
    # WM/Picture: type + length + two terminated UTF-16LE strings + image bytes.
    for _ in range(2):
        end = next(
            (
                index
                for index in range(offset, min(len(data) - 1, 4096), 2)
                if data[index : index + 2] == b"\0\0"
            ),
            None,
        )
        if end is None:
            return None
        offset = end + 2
    if len(data) - offset != size:
        return None
    return picture_type, data[offset:]


def embedded_cover(audio, max_bytes: int) -> bytes | None:
    pictures = getattr(audio, "pictures", None)
    if pictures:
        ordered = sorted(pictures, key=lambda picture: picture.type != 3)
        return next((bytes(p.data) for p in ordered if 0 < len(p.data) <= max_bytes), None)
    tags = getattr(audio, "tags", None)
    if not tags:
        return None
    if hasattr(tags, "getall"):
        pictures = sorted(tags.getall("APIC"), key=lambda picture: picture.type != 3)
        return next((bytes(p.data) for p in pictures if 0 < len(p.data) <= max_bytes), None)
    for cover in tag_values(tags, "covr"):
        if 0 < len(cover) <= max_bytes:
            return bytes(cover)
    for value in tag_values(tags, "metadata_block_picture"):
        try:
            if len(value) > (max_bytes + 4096) * 4 // 3 + 4:
                continue
            picture = Picture(base64.b64decode(value, validate=True))
            if 0 < len(picture.data) <= max_bytes:
                return bytes(picture.data)
        except (ValueError, TypeError, MutagenError):
            continue
    for value in tag_values(tags, "coverart"):
        try:
            if len(value) > max_bytes * 4 // 3 + 4:
                continue
            data = base64.b64decode(value, validate=True)
            if 0 < len(data) <= max_bytes:
                return data
        except (ValueError, TypeError):
            continue
    pictures = [
        picture
        for value in tag_values(tags, "WM/Picture")
        if (picture := _asf_picture(value, max_bytes)) is not None
    ]
    if pictures:
        return min(pictures, key=lambda picture: picture[0] != 3)[1]
    return None


def _flac_picture(data: bytes, mime: str) -> Picture:
    picture = Picture()
    picture.type = 3
    picture.mime = mime
    picture.desc = "Cover"
    picture.data = data
    with Image.open(io.BytesIO(data)) as image:
        picture.width, picture.height = image.size
    picture.depth = 24
    return picture


def _remove_tag(tags, key: str) -> None:
    # Vorbis/ASF mapping implementations do not support dict.pop's default argument.
    if key in tags:
        del tags[key]


def write_song_tags(
    audio, title: str, artist: str, album: str, cover: tuple[bytes, str] | None, remove_cover: bool
) -> None:
    if audio.tags is None:
        audio.add_tags()
    tags = audio.tags
    values = (title.strip(), artist.strip(), album.strip())
    if isinstance(audio, (MP3, WAVE)):
        for key, value, frame in zip(
            ("TIT2", "TPE1", "TALB"), values, (TIT2, TPE1, TALB), strict=True
        ):
            tags.delall(key)
            if value:
                tags.add(frame(encoding=3, text=value))
    else:
        for key, value in zip(_text_keys(audio), values, strict=True):
            _remove_tag(tags, key)
            if value:
                tags[key] = [value]
    if cover or remove_cover:
        if isinstance(audio, (MP3, WAVE)):
            tags.delall("APIC")
            if cover:
                data, mime = cover
                tags.add(APIC(encoding=3, mime=mime, type=3, desc="Cover", data=data))
        elif isinstance(audio, FLAC):
            audio.clear_pictures()
            if cover:
                audio.add_picture(_flac_picture(*cover))
        elif isinstance(audio, OGG_TYPES):
            for key in ("metadata_block_picture", "coverart", "coverartmime"):
                _remove_tag(tags, key)
            if cover:
                tags["metadata_block_picture"] = [
                    base64.b64encode(_flac_picture(*cover).write()).decode("ascii")
                ]
        elif isinstance(audio, MP4):
            _remove_tag(tags, "covr")
            if cover:
                tags["covr"] = [MP4Cover(cover[0], imageformat=MP4Cover.FORMAT_JPEG)]
        elif isinstance(audio, ASF):
            _remove_tag(tags, "WM/Picture")
            if cover:
                data, mime = cover
                packed = (
                    struct.pack("<BI", 3, len(data))
                    + (mime + "\0Cover\0").encode("utf-16-le")
                    + data
                )
                tags["WM/Picture"] = [ASFByteArrayAttribute(packed)]
    audio.save()
