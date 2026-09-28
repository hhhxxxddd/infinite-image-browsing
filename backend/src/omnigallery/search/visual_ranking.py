"""Bounded-memory exact ranking of indexed image vectors."""

import heapq
import os
from contextlib import closing

from omnigallery.library.media_repository import Media
from omnigallery.storage.cloud_files import online_only_paths


def rank_visual_media(
    conn,
    clauses,
    params,
    vector,
    limit,
    is_path_trusted,
    *,
    minimum=None,
    excluded_path=None,
    resolve_paths=False,
    sync_settings=None,
):
    import numpy as np

    # Metadata needed for cards only: generation JSON and descriptions can be
    # large and are not used in these results. Preserve Media.from_row's shape.
    sql = """SELECT media.id, media.path, '', media.size, media.date,
        media.exif_edited, '', media.width, media.height, media.content_pending,
        q.dim, q.vec, q.mtime_ns, q.file_size
        FROM media JOIN media_qwen_visual_embedding AS q ON q.media_id = media.id
        WHERE """ + " AND ".join([*clauses, "media.id > ?"])
    sql += " ORDER BY media.id LIMIT ?"
    batch_size = max(1, min(256, (2 * 1024 * 1024) // max(4, len(vector) * 4)))
    excluded = os.path.normcase(os.path.realpath(excluded_path)) if excluded_path else None
    ranked = []
    checked = skipped = matched = 0
    last_id = 0
    while True:
        # Finish the read before filesystem checks, so DELETE-mode SQLite
        # writers are not held up by a slow disk or network share.
        with closing(conn.cursor()) as cur:
            cur.execute(sql, [*params, last_id, batch_size])
            rows = cur.fetchall()
        if not rows:
            break
        last_id = rows[-1][0]
        cloud_paths = (
            online_only_paths((row[1] for row in rows), sync_settings)
            if sync_settings is not None
            else set()
        )
        valid = []
        vectors = []
        for row in rows:
            path = os.path.realpath(row[1]) if resolve_paths or excluded else row[1]
            if excluded and os.path.normcase(path) == excluded:
                continue
            if not is_path_trusted(path) or row[1] in cloud_paths:
                continue
            try:
                stat = os.stat(row[1])
            except OSError:
                skipped += 1
                continue
            dim, blob, saved_mtime, saved_size = row[-4:]
            if (stat.st_mtime_ns, stat.st_size) != (saved_mtime, saved_size):
                skipped += 1
                continue
            if dim != len(vector) or len(blob) != dim * 4:
                skipped += 1
                continue
            valid.append(row)
            vectors.append(np.frombuffer(blob, dtype="<f4"))
        if not valid:
            continue
        scores = np.einsum("ij,j->i", np.stack(vectors), vector)
        if minimum is not None:
            scores = np.maximum(scores, 0) * 100
        for row, value in zip(valid, scores, strict=True):
            if not np.isfinite(value):
                skipped += 1
                continue
            score = float(value)
            checked += 1
            if minimum is not None and score < minimum:
                continue
            matched += 1
            # Store only metadata for the winning items, not their vector blobs.
            if len(ranked) < limit:
                heapq.heappush(ranked, (score, row[0], row[:10]))
            elif (score, row[0]) > ranked[0][:2]:
                heapq.heapreplace(ranked, (score, row[0], row[:10]))
    return (
        [
            (score, media_id, Media.from_row(row))
            for score, media_id, row in sorted(ranked, reverse=True)
        ],
        checked,
        skipped,
        matched,
    )
