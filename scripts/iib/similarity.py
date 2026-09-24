"""Offline image search: Qwen image vectors or legacy hash and color matching."""
import base64
import binascii
import heapq
import io
import os
import sqlite3
import warnings
from contextlib import closing
from pathlib import Path
from typing import Literal

import numpy as np
from fastapi import Depends, HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import Field

from scripts.iib.db.datamodel import DataBase
from scripts.iib.db.search_filters import MediaSearchFilters
from scripts.iib.tool import get_cache_dir, get_file_info_by_path, is_image_file

MAX_IMAGE_BYTES = 50 * 1024 * 1024
# Base64 expands a 50 MiB file to about 67 MiB; keep the decoded-byte check authoritative.
MAX_IMAGE_BASE64_LENGTH = 70 * 1024 * 1024
FINGERPRINT_BATCH_SIZE = 256


class _ReversePath:
    """Make the lexicographically largest path the worst score tie in a min-heap."""

    def __init__(self, path):
        self.path = path

    def __lt__(self, other):
        return self.path > other.path
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
    best = []
    matched = 0
    checked = skipped = cached = 0
    excluded_key = os.path.normcase(os.path.abspath(excluded_path)) if excluded_path else None
    with closing(sqlite3.connect(cache_path, timeout=30)) as cache:
        cache.execute("""CREATE TABLE IF NOT EXISTS fingerprints (
            path TEXT PRIMARY KEY, mtime_ns INTEGER, size INTEGER, hash TEXT, histogram BLOB)""")
        for start in range(0, len(paths), FINGERPRINT_BATCH_SIZE):
            batch = [path for path in paths[start:start + FINGERPRINT_BATCH_SIZE]
                     if is_image_file(path) and not (excluded_key and os.path.normcase(os.path.abspath(path)) == excluded_key)]
            if not batch:
                continue
            rows = cache.execute(
                f"SELECT path, mtime_ns, size, hash, histogram FROM fingerprints WHERE path IN ({','.join('?' for _ in batch)})",
                batch,
            )
            known = {row[0]: row[1:] for row in rows}
            updates = []
            for path in batch:
                try:
                    stat = os.stat(path)
                    row = known.get(path)
                    if row and row[0] == stat.st_mtime_ns and row[1] == stat.st_size:
                        features = int(row[2], 16), np.frombuffer(row[3], dtype="<f4")
                        cached += 1
                    else:
                        features = image_features(path)
                        updates.append((path, stat.st_mtime_ns, stat.st_size, hex(features[0]),
                                        features[1].astype('<f4').tobytes()))
                    score = similarity_score(reference, features)
                    checked += 1
                    if score >= minimum:
                        matched += 1
                        item = (score, _ReversePath(path), path)
                        if len(best) < limit:
                            heapq.heappush(best, item)
                        elif score > best[0][0] or (score == best[0][0] and path < best[0][2]):
                            heapq.heapreplace(best, item)
                except (OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
                    skipped += 1
            if updates:
                cache.executemany("INSERT OR REPLACE INTO fingerprints VALUES (?, ?, ?, ?, ?)", updates)
                cache.commit()
    matches = sorted(((score, path) for score, _, path in best), key=lambda item: (-item[0], item[1]))
    files = []
    for score, path in matches:
        try:
            files.append({**get_file_info_by_path(path), "similarity": score})
        except OSError:
            continue
        if len(files) >= limit:
            break
    return {"files": files, "matched": matched, "checked": checked, "skipped": skipped, "cached": cached}


class SimilarityRequest(MediaSearchFilters):
    image_base64: str | None = Field(default=None, max_length=MAX_IMAGE_BASE64_LENGTH)
    path: str | None = None
    minimum: float = Field(default=70, ge=0, le=100)
    limit: int = Field(default=100, ge=1, le=200)
    method: Literal["hash", "qwen"] = "hash"


def mount_similarity_routes(app, db_api_base, verify_secret, is_path_trusted, enforce_path_trust=True):
    # A synchronous route runs the CPU/disk work in FastAPI's worker pool.
    @app.post(db_api_base + "/similar_images", dependencies=[Depends(verify_secret)])
    def similar_images(req: SimilarityRequest):
        if bool(req.path) == bool(req.image_base64):
            raise HTTPException(400, "请选择一张参考图片")
        excluded_path = None
        if req.path:
            source = os.path.realpath(req.path)
            if not is_path_trusted(source):
                raise HTTPException(403, "无权访问该图片")
            excluded_path = req.path
        else:
            try:
                raw = base64.b64decode(req.image_base64, validate=True)
            except (ValueError, binascii.Error):
                raise HTTPException(400, "参考图片编码无效")
            if len(raw) > MAX_IMAGE_BYTES:
                raise HTTPException(413, "参考图片请勿超过 50 MB")
            source = io.BytesIO(raw)
        if req.method == "qwen":
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("error", Image.DecompressionBombWarning)
                    with Image.open(source) as opened:
                        query_image = ImageOps.exif_transpose(opened).convert("RGB")
            except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning):
                raise HTTPException(400, "无法读取参考图片，请使用有效的 PNG、JPEG、WebP 等图片") from None
            from scripts.iib.qwen3_vl_search import search_similar_images
            return search_similar_images(req, query_image, is_path_trusted, excluded_path)
        try:
            reference = image_features(source)
        except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning):
            raise HTTPException(400, "无法读取参考图片，请使用有效的 PNG、JPEG、WebP 等图片")
        conn = DataBase.get_conn()
        clauses, params = req.sql_conditions(conn)
        query = "SELECT path FROM image" + (" WHERE " + " AND ".join(clauses) if clauses else "")
        paths = (row[0] for row in conn.execute(query, params))
        if enforce_path_trust:
            paths = (path for path in paths if is_path_trusted(os.path.realpath(path)))
        paths = list(paths)
        return search_images(reference, paths, os.path.join(get_cache_dir(), "similarity-v1.sqlite3"),
                             req.minimum, req.limit, excluded_path)
