"""Immutable generated PNGs shared by media editors and workspace documents."""

import base64
import hashlib
import io
import re

from PIL import Image

from omnigallery.image_editing.history import _write
from omnigallery.storage.filesystem import checked_path
from omnigallery.storage.project_files import storage_operation, storage_root

MAX_BYTES = 64 * 1024 * 1024


def asset_path(asset_id: str):
    if not re.fullmatch(r"[a-f0-9]{64}", asset_id):
        raise ValueError("合成素材编号无效")
    return checked_path(storage_root() / "image-editor-assets" / (asset_id + ".png"))


@storage_operation
def save_png(encoded: str):
    if len(encoded) > (MAX_BYTES + 2) // 3 * 4:
        raise ValueError("合成图片不能超过 64 MiB")
    try:
        raw = base64.b64decode(encoded, validate=True)
        if len(raw) > MAX_BYTES:
            raise ValueError("合成图片不能超过 64 MiB")
        with Image.open(io.BytesIO(raw)) as image:
            if image.format != "PNG" or getattr(image, "n_frames", 1) != 1:
                raise ValueError("合成素材必须为静态 PNG 图片")
            width, height = image.size
            if max(width, height) > 16384 or width * height > 100_000_000:
                raise ValueError("合成图片尺寸过大")
            image.verify()
        # Verify decoded pixels too; CRC-valid but incomplete compressed data is not an asset.
        with Image.open(io.BytesIO(raw)) as image:
            image.load()
    except (OSError, SyntaxError, Image.DecompressionBombError) as error:
        raise ValueError("合成图片数据无效") from error
    asset_id = hashlib.sha256(raw).hexdigest()
    destination = asset_path(asset_id)
    if not destination.exists():
        _write(destination, raw)
    return {"path": "editor-asset:" + asset_id, "width": width, "height": height}


@storage_operation
def read_png(asset_id: str):
    return asset_path(asset_id).read_bytes()
