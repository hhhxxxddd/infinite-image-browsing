import hashlib
import os
import threading

from fastapi import HTTPException
from PIL import Image

from omnigallery.library.thumbnail_size import fit_short_edge
from omnigallery.storage.maintenance import use_cache

_MAX_THUMBNAIL_DIMENSION = 4096


_THUMBNAIL_GENERATION_SLOTS = threading.BoundedSemaphore(max(2, min(4, os.cpu_count() or 2)))


_THUMBNAIL_LOCKS = tuple(threading.Lock() for _ in range(64))


def _parse_thumbnail_size(size: str):
    try:
        width, height = (int(value) for value in size.lower().split("x", 1))
    except (AttributeError, TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid thumbnail size") from None

    if not (0 < width <= _MAX_THUMBNAIL_DIMENSION and 0 < height <= _MAX_THUMBNAIL_DIMENSION):
        raise HTTPException(status_code=400, detail="Invalid thumbnail size")
    return width, height


def _ensure_thumbnail(path: str, cache_path: str, width: int, height: int, fit: str = "contain"):
    if os.path.exists(cache_path):
        return

    lock_idx = int(hashlib.md5(cache_path.encode("utf-8")).hexdigest()[:8], 16) % len(
        _THUMBNAIL_LOCKS
    )
    # Wait for a generation slot *before* taking the per-key lock, so threads
    # waiting for a slot do not hold a stripe lock (which would needlessly
    # serialize unrelated cache keys that hash to the same stripe).
    with use_cache(cache_path), _THUMBNAIL_GENERATION_SLOTS:
        with _THUMBNAIL_LOCKS[lock_idx]:
            if os.path.exists(cache_path):
                return

            os.makedirs(os.path.dirname(cache_path), exist_ok=True)
            temp_path = f"{cache_path}.{threading.get_ident()}.tmp"
            try:
                with Image.open(path) as img:
                    target_size = (
                        fit_short_edge(img.size, min(width, height))
                        if fit == "short"
                        else (width, height)
                    )
                    # JPEG decoders can downsample during decode, which saves substantial
                    # CPU and memory for large source images.
                    img.draft("RGB", target_size)
                    img.thumbnail(target_size)
                    img.save(temp_path, "WEBP", quality=80, method=1)
                os.replace(temp_path, cache_path)
            except Exception:
                # Deleted or broken source images used to surface as opaque 500s,
                # hammered on every retry; report them as 404 so the client can
                # fall back to the raw file instead.
                raise HTTPException(
                    status_code=404, detail="Failed to generate thumbnail"
                ) from None
            finally:
                if os.path.exists(temp_path):
                    os.remove(temp_path)
