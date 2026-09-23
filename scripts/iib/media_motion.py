"""Cached motion probe for image formats that may contain multiple frames."""

from functools import lru_cache
from PIL import Image


MOTION_IMAGE_EXTENSIONS = (".gif", ".webp", ".png", ".avif")


@lru_cache(maxsize=4096)
def _probe(path: str, modified_ns: int, size: int) -> bool:
    # Pillow reads the header here; frame pixels are not decoded.
    with Image.open(path) as image:
        return bool(getattr(image, "is_animated", False) or getattr(image, "n_frames", 1) > 1)


def is_animated_image(path: str, modified_ns: int, size: int) -> bool:
    if not path.lower().endswith(MOTION_IMAGE_EXTENSIONS):
        return False
    return _probe(path, modified_ns, size)
