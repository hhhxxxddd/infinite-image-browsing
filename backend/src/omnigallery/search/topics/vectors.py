import math
from array import array

from fastapi import HTTPException

from omnigallery.infrastructure.logging import logger

_np = None


_hnswlib = None


_VECTOR_DEPS_READY = False


def _ensure_vector_dependencies() -> None:
    """Load NumPy and optional ANN acceleration without requiring a native compiler."""
    global _np, _hnswlib, _VECTOR_DEPS_READY
    if _VECTOR_DEPS_READY:
        return
    try:
        import numpy as np  # type: ignore
    except ImportError as e:
        raise HTTPException(
            status_code=500,
            detail="Topic clustering requires NumPy. Reinstall the application dependencies.",
        ) from e
    _np = np
    try:
        import hnswlib
    except (ImportError, OSError) as error:
        logger.info(
            "HNSW acceleration unavailable (%s); using exact cosine comparisons. "
            "Optional acceleration: pip install -r backend/requirements/search-index.txt",
            type(error).__name__,
        )
        _hnswlib = None
    else:
        _hnswlib = hnswlib
    _VECTOR_DEPS_READY = True


def _has_hnsw_index() -> bool:
    _ensure_vector_dependencies()
    return _hnswlib is not None


def _vec_to_blob_f32(vec: list[float]) -> bytes:
    arr = array("f", vec)
    return arr.tobytes()


def _blob_to_vec_f32(blob: bytes) -> array:
    arr = array("f")
    arr.frombytes(blob)
    return arr


def _l2_norm_sq(vec: array) -> float:
    return sum(x * x for x in vec)


def _dot(a: array, b: array) -> float:
    return sum((x * y for x, y in zip(a, b, strict=False)))


def _centroid_vec_np(sum_vec: array, norm_sq: float):
    """
    Convert centroid sum-vector to a normalized numpy float32 vector.
    Cosine between unit v and centroid is dot(v, sum)/sqrt(norm_sq).
    So centroid direction is sum / ||sum||.
    """
    _ensure_vector_dependencies()
    if norm_sq <= 0:
        return None
    inv = 1.0 / math.sqrt(norm_sq)
    # array('f') -> numpy without extra python loops
    v = _np.frombuffer(sum_vec.tobytes(), dtype=_np.float32).copy()
    v *= _np.float32(inv)
    return v


def _build_hnsw_index(centroids_np, *, ef: int = 64, M: int = 32):
    """
    Build a cosine HNSW index over centroid vectors.
    Returns index or None.
    """
    if not _has_hnsw_index():
        return None
    if centroids_np is None:
        return None
    if len(centroids_np) == 0:
        return None
    dim = int(centroids_np.shape[1])
    idx = _hnswlib.Index(space="cosine", dim=dim)
    idx.init_index(max_elements=int(centroids_np.shape[0]) + 8, ef_construction=ef, M=M)
    labels = _np.arange(centroids_np.shape[0], dtype=_np.int32)
    idx.add_items(centroids_np, labels)
    idx.set_ef(max(ef, 32))
    return idx


def _cos_sum(a_sum: array, a_norm_sq: float, b_sum: array, b_norm_sq: float) -> float:
    if a_norm_sq <= 0 or b_norm_sq <= 0:
        return 0.0
    dotv = sum((x * y for x, y in zip(a_sum, b_sum, strict=False)))
    return dotv / (math.sqrt(a_norm_sq) * math.sqrt(b_norm_sq))
