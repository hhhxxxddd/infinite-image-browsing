"""Non-destructive crop and resize for local still images."""

import math
import os
import shutil
from pathlib import Path

from PIL import Image, ImageOps, PngImagePlugin


EDITABLE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}
MAX_SIDE = 16384
MAX_PIXELS = 100_000_000


def _validate_crop(crop: dict) -> tuple[float, float, float, float]:
    try:
        x, y, width, height = (float(crop[key]) for key in ("x", "y", "width", "height"))
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("裁剪区域无效") from error
    if not all(math.isfinite(value) for value in (x, y, width, height)):
        raise ValueError("裁剪区域无效")
    if x < 0 or y < 0 or width <= 0 or height <= 0 or x + width > 1.000001 or y + height > 1.000001:
        raise ValueError("裁剪区域超出图片范围")
    return x, y, width, height


def edit_image_copy(path: str, crop: dict, target_width: int, target_height: int) -> str:
    source = Path(os.path.realpath(path))
    if source.suffix.lower() not in EDITABLE_SUFFIXES:
        raise ValueError("此图片格式暂不支持编辑")
    if not source.is_file():
        raise FileNotFoundError(path)
    if not (1 <= target_width <= MAX_SIDE and 1 <= target_height <= MAX_SIDE) or target_width * target_height > MAX_PIXELS:
        raise ValueError("输出尺寸超出范围")
    x, y, width, height = _validate_crop(crop)
    source_sidecar = source.with_suffix(".txt")

    with Image.open(source) as original:
        if getattr(original, "is_animated", False):
            raise ValueError("暂不支持编辑动态图")
        profile = original.info.get("icc_profile")
        xmp = original.info.get("xmp")
        png_text = dict(getattr(original, "text", {})) if original.format == "PNG" else {}
        image = ImageOps.exif_transpose(original)
        left = max(0, min(image.width - 1, round(x * image.width)))
        top = max(0, min(image.height - 1, round(y * image.height)))
        right = max(left + 1, min(image.width, round((x + width) * image.width)))
        bottom = max(top + 1, min(image.height, round((y + height) * image.height)))
        image = image.crop((left, top, right, bottom))
        if image.size != (target_width, target_height):
            image = image.resize((target_width, target_height), Image.Resampling.LANCZOS)

        suffix = source.suffix.lower() if source.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"} else ".png"
        image_format = {".jpg": "JPEG", ".jpeg": "JPEG", ".png": "PNG", ".webp": "WEBP"}[suffix]
        if image_format == "JPEG":
            image = image.convert("RGB")
        elif image.mode not in {"RGB", "RGBA", "L", "LA"}:
            image = image.convert("RGBA")
        save_options = {"icc_profile": profile} if profile else {}
        exif = image.getexif()
        if exif:
            # Orientation is removed by exif_transpose; dimensions describe the copy.
            for tag in (256, 40962):
                exif[tag] = target_width
            for tag in (257, 40963):
                exif[tag] = target_height
            save_options["exif"] = exif.tobytes()
        if image_format == "PNG" and png_text:
            metadata = PngImagePlugin.PngInfo()
            for key, value in png_text.items():
                if isinstance(value, str):
                    metadata.add_text(key, value)
            save_options["pnginfo"] = metadata
        if image_format == "WEBP" and xmp:
            save_options["xmp"] = xmp
        if image_format == "JPEG":
            save_options.update(quality=95, optimize=True)
        elif image_format == "WEBP":
            save_options.update(quality=95, method=4)

        for number in range(1, 10000):
            name = f"{source.stem}_edited{'' if number == 1 else f'_{number}'}{suffix}"
            destination = source.with_name(name)
            destination_sidecar = destination.with_suffix(".txt")
            if source_sidecar.is_file() and destination_sidecar.exists():
                continue
            try:
                sidecar_created = False
                with destination.open("xb") as output:
                    try:
                        image.save(output, format=image_format, **save_options)
                        if source_sidecar.is_file():
                            with source_sidecar.open("rb") as text_source, destination_sidecar.open("xb") as text_destination:
                                sidecar_created = True
                                shutil.copyfileobj(text_source, text_destination)
                    except Exception:
                        output.close()
                        destination.unlink(missing_ok=True)
                        if sidecar_created:
                            destination_sidecar.unlink(missing_ok=True)
                        raise
                return str(destination)
            except FileExistsError:
                continue
    raise ValueError("同名编辑副本过多")
