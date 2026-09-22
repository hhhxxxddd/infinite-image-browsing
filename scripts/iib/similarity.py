"""Offline visual similarity: perceptual structure hash plus a color histogram."""
import base64
import binascii
import io
import os
import sqlite3
import warnings
from contextlib import closing
from pathlib import Path

import numpy as np
from fastapi import Depends, HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field

from scripts.iib.db.datamodel import DataBase
from scripts.iib.tool import get_cache_dir, get_file_info_by_path, is_image_file

MAX_IMAGE_BYTES = 20 * 1024 * 1024
_DCT = np.cos(np.pi * (2 * np.arange(32) + 1)[None, :] * np.arange(8)[:, None] / 64)


def image_features(source):
    # Apply the same orientation/background rules to the query and indexed files.
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(source) as image:
            image = ImageOps.exif_transpose(image)
            image.thumbnail((256, 256), Image.Resampling.LANCZOS)
            rgba = image.convert("RGBA")
            rgb = Image.new("RGBA", rgba.size, "white")
            rgb.alpha_composite(rgba)
            rgb = rgb.convert("RGB")
            gray = np.asarray(rgb.convert("L").resize((32, 32), Image.Resampling.LANCZOS), dtype=np.float64)
            coefficients = (_DCT @ gray @ _DCT.T).ravel()[1:]
            # Suppress floating-point noise in flat-color images.
            coefficients[np.abs(coefficients) < 1e-6] = 0
            bits = coefficients > np.median(coefficients)
            hash_value = sum(int(bit) << i for i, bit in enumerate(bits))
            pixels = np.asarray(rgb.resize((64, 64)), dtype=np.uint8).reshape(-1, 3) // 64
            bins = pixels[:, 0].astype(np.int32) * 16 + pixels[:, 1] * 4 + pixels[:, 2]
            histogram = np.bincount(bins, minlength=64).astype(np.float32)
            histogram /= histogram.sum()
            return hash_value, histogram


def similarity_score(left, right):
    structure = 1 - (left[0] ^ right[0]).bit_count() / 63
    color = float(np.sqrt(left[1] * right[1]).sum())
    return round(min(100.0, max(0.0, (0.7 * structure + 0.3 * color) * 100)), 1)


def search_images(reference, paths, cache_path, minimum=70, limit=100, excluded_path=None):
    """Cache fingerprints by file revision; never store the reference image."""
    Path(cache_path).parent.mkdir(parents=True, exist_ok=True)
    matches = []
    checked = skipped = cached = 0
    with closing(sqlite3.connect(cache_path, timeout=30)) as cache:
        cache.execute("""CREATE TABLE IF NOT EXISTS fingerprints (
            path TEXT PRIMARY KEY, mtime_ns INTEGER, size INTEGER, hash TEXT, histogram BLOB)""")
        for path in paths:
            if not is_image_file(path) or (excluded_path and os.path.realpath(path) == excluded_path):
                continue
            try:
                stat = os.stat(path)
                row = cache.execute("SELECT mtime_ns, size, hash, histogram FROM fingerprints WHERE path=?", (path,)).fetchone()
                if row and row[0] == stat.st_mtime_ns and row[1] == stat.st_size:
                    features = int(row[2], 16), np.frombuffer(row[3], dtype="<f4")
                    cached += 1
                else:
                    features = image_features(path)
                    cache.execute("INSERT OR REPLACE INTO fingerprints VALUES (?, ?, ?, ?, ?)",
                                  (path, stat.st_mtime_ns, stat.st_size, hex(features[0]), features[1].astype('<f4').tobytes()))
                    # Release the write lock between images; other searches can reuse the cache.
                    cache.commit()
                score = similarity_score(reference, features)
                checked += 1
                if score >= minimum:
                    matches.append((score, path))
            except (OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
                skipped += 1
        cache.commit()
    matches.sort(key=lambda item: (-item[0], item[1]))
    files = []
    for score, path in matches:
        try:
            files.append({**get_file_info_by_path(path), "similarity": score})
        except OSError:
            continue
        if len(files) >= limit:
            break
    return {"files": files, "matched": len(matches), "checked": checked, "skipped": skipped, "cached": cached}


class SimilarityRequest(BaseModel):
    image_base64: str | None = Field(default=None, max_length=28 * 1024 * 1024)
    path: str | None = None
    minimum: float = Field(default=70, ge=0, le=100)
    limit: int = Field(default=100, ge=1, le=200)


def mount_similarity_routes(app, db_api_base, verify_secret, is_path_trusted):
    # A synchronous route runs the CPU/disk work in FastAPI's worker pool.
    @app.post(db_api_base + "/similar_images", dependencies=[Depends(verify_secret)])
    def similar_images(req: SimilarityRequest):
        if bool(req.path) == bool(req.image_base64):
            raise HTTPException(400, "请选择一张参考图片")
        excluded_path = None
        if req.path:
            excluded_path = os.path.realpath(req.path)
            if not is_path_trusted(excluded_path):
                raise HTTPException(403, "无权访问该图片")
            source = excluded_path
        else:
            try:
                raw = base64.b64decode(req.image_base64, validate=True)
            except (ValueError, binascii.Error):
                raise HTTPException(400, "参考图片编码无效")
            if len(raw) > MAX_IMAGE_BYTES:
                raise HTTPException(413, "参考图片请勿超过 20 MB")
            source = io.BytesIO(raw)
        try:
            reference = image_features(source)
        except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning):
            raise HTTPException(400, "无法读取参考图片，请使用有效的 PNG、JPEG、WebP 等图片")
        conn = DataBase.get_conn()
        paths = [row[0] for row in conn.execute("SELECT path FROM image")
                 if is_path_trusted(os.path.realpath(row[0]))]
        return search_images(reference, paths, os.path.join(get_cache_dir(), "similarity-v1.sqlite3"),
                             req.minimum, req.limit, excluded_path)
