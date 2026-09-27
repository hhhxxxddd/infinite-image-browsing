from __future__ import annotations

import base64
import io
import warnings

from fastapi import HTTPException
from PIL import Image as PilImage
from PIL import ImageOps, UnidentifiedImageError


def _studio_png(value: str, label: str) -> tuple[bytes, tuple[int, int]]:
    try:
        data = base64.b64decode(value, validate=True)
        if len(data) > 12_000_000:
            raise ValueError()
        with PilImage.open(io.BytesIO(data)) as media:
            if (
                media.format != "PNG"
                or not 1 <= media.width <= 2048
                or not 1 <= media.height <= 2048
            ):
                raise ValueError()
            media.verify()
        with PilImage.open(io.BytesIO(data)) as media:
            return data, media.size
    except (
        ValueError,
        OSError,
        UnidentifiedImageError,
        PilImage.DecompressionBombError,
        PilImage.DecompressionBombWarning,
    ) as error:
        raise HTTPException(400, detail=f"{label}必须是 2048 像素以内的有效 PNG") from error


def _studio_image_with_alpha_mask(image_bytes: bytes, mask_bytes: bytes) -> bytes:
    """Pack the app's white-edit mask into ComfyUI LoadImage's inverse-alpha format."""
    with (
        PilImage.open(io.BytesIO(image_bytes)) as source,
        PilImage.open(io.BytesIO(mask_bytes)) as mask,
    ):
        combined = source.convert("RGB").convert("RGBA")
        combined.putalpha(ImageOps.invert(mask.convert("L")))
        output = io.BytesIO()
        combined.save(output, format="PNG")
        return output.getvalue()


def _image_jpeg_bytes(path: str) -> bytes:
    with warnings.catch_warnings():
        warnings.simplefilter("error", PilImage.DecompressionBombWarning)
        with PilImage.open(path) as opened:
            media = ImageOps.exif_transpose(opened).convert("RGB")
            media.thumbnail((1024, 1024))
            buffer = io.BytesIO()
            media.save(buffer, format="JPEG", quality=85)
    return buffer.getvalue()


def _image_jpeg_base64(path: str) -> str:
    return base64.b64encode(_image_jpeg_bytes(path)).decode("ascii")


def _image_messages(path: str, prompt: str) -> list[dict]:
    data_url = "data:image/jpeg;base64," + _image_jpeg_base64(path)
    image_part = {"type": "image_url", "image_url": {"url": data_url}}
    return [
        {"role": "system", "content": prompt},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Follow the instruction for this image."},
                image_part,
            ],
        },
    ]
