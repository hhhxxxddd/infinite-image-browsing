def fit_short_edge(source_size: tuple[int, int], short_edge: int, max_dimension: int = 4096) -> tuple[int, int]:
    """Preserve aspect ratio while sizing the shorter edge, without upscaling."""
    width, height = source_size
    if width <= 0 or height <= 0 or short_edge <= 0 or max_dimension <= 0:
        raise ValueError("Thumbnail dimensions must be positive")
    scale = min(1.0, short_edge / min(width, height), max_dimension / max(width, height))
    return max(1, round(width * scale)), max(1, round(height * scale))
