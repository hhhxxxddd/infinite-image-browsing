"""Persistent manual media order shared by library filters."""

from omnigallery.library.pagination import make_page_cursor, page_cursor_clause


def ensure_media_order(conn):
    conn.execute(
        "CREATE TABLE IF NOT EXISTS media_order (media_id INTEGER PRIMARY KEY, position INTEGER NOT NULL)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS media_order_idx_position ON media_order(position, media_id)"
    )


def read_ordered_media_page(cur, conditions, params, limit, cursor):
    """Read positioned media first, then new media, without sorting the whole library."""
    where = " WHERE " + " AND ".join(conditions) if conditions else ""
    # Accept cursors issued before position-based pagination. Only that first
    # legacy request pays the offset cost; subsequent pages use the new cursor.
    if cursor and cursor.startswith("manual:") and cursor[7:].isdigit():
        cur.execute(
            "SELECT media.*, media_order.position FROM media "
            "LEFT JOIN media_order ON media.id = media_order.media_id"
            + where
            + " ORDER BY (media_order.position IS NULL), media_order.position, "
            "media.date DESC, media.id DESC LIMIT ? OFFSET ?",
            [*params, limit, manual_offset(cursor)],
        )
        rows = cur.fetchall()
    else:
        rows = []
        if not cursor or cursor.startswith("manual:p:"):
            ordered_conditions = list(conditions)
            ordered_params = list(params)
            if cursor:
                parts = cursor.split(":")
                if len(parts) != 4 or not all(part.isdigit() for part in parts[2:]):
                    raise ValueError("排序已变化，请刷新媒体库")
                # Moves and swaps maintain distinct positions. The identity at
                # the page boundary may change after swapping two loaded cards;
                # advancing by position prevents replaying that boundary card.
                ordered_conditions.append("media_order.position > ?")
                ordered_params.append(int(parts[2]))
            ordered_where = (
                " WHERE " + " AND ".join(ordered_conditions) if ordered_conditions else ""
            )
            cur.execute(
                "SELECT media.*, media_order.position FROM media_order "
                "INDEXED BY media_order_idx_position CROSS JOIN media "
                "ON media.id = media_order.media_id"
                + ordered_where
                + " ORDER BY media_order.position, media_order.media_id LIMIT ?",
                [*ordered_params, limit],
            )
            rows = cur.fetchall()
        elif not cursor.startswith("manual:d:"):
            raise ValueError("排序已变化，请刷新媒体库")
        if len(rows) < limit:
            remaining_conditions = [
                *conditions,
                "NOT EXISTS (SELECT 1 FROM media_order WHERE media_order.media_id = media.id)",
            ]
            remaining_params = list(params)
            if cursor and cursor.startswith("manual:d:"):
                remaining_conditions.append(page_cursor_clause(cursor[9:], remaining_params))
            cur.execute(
                "SELECT media.*, NULL FROM media WHERE "
                + " AND ".join(remaining_conditions)
                + " ORDER BY media.date DESC, media.id DESC LIMIT ?",
                [*remaining_params, limit - len(rows)],
            )
            rows.extend(cur.fetchall())
    next_cursor = ""
    if rows:
        last = rows[-1]
        next_cursor = (
            f"manual:p:{last[-1]}:{last[0]}"
            if last[-1] is not None
            else "manual:d:" + make_page_cursor(last[4], last[0])
        )
    return [row[:-1] for row in rows], next_cursor


def _ensure_media_positions(conn):
    conn.execute("DELETE FROM media_order WHERE media_id NOT IN (SELECT id FROM media)")
    conn.execute("""INSERT INTO media_order (media_id, position)
        SELECT id, COALESCE((SELECT MAX(position) + 1 FROM media_order), 0)
            + ROW_NUMBER() OVER (ORDER BY date DESC, id DESC) - 1
        FROM media WHERE id NOT IN (SELECT media_id FROM media_order)""")


def move_media(conn, paths, target_path, after=False):
    ensure_media_order(conn)
    # Start the write transaction before reading positions so concurrent drags serialize.
    with conn:
        _ensure_media_positions(conn)
        rows = conn.execute("""SELECT media.id, media.path, media_order.position FROM media
            JOIN media_order ON media.id = media_order.media_id ORDER BY media_order.position""").fetchall()
        available = {row[1] for row in rows}
        if not paths or target_path not in available or not set(paths).issubset(available):
            raise ValueError("排序失败，部分文件已不在媒体库，请刷新后重试")
        chosen = set(paths)
        if target_path in chosen:
            return
        moving = [row for row in rows if row[1] in chosen]
        remaining = [row for row in rows if row[1] not in chosen]
        index = next(i for i, row in enumerate(remaining) if row[1] == target_path) + int(after)
        ordered = remaining[:index] + moving + remaining[index:]
        conn.executemany(
            "UPDATE media_order SET position = ? WHERE media_id = ?",
            [(i, row[0]) for i, row in enumerate(ordered) if i != row[2]],
        )


def swap_media(conn, source_path, target_path):
    if source_path == target_path:
        return
    ensure_media_order(conn)
    with conn:
        if not conn.in_transaction:
            conn.execute("BEGIN IMMEDIATE")
        rows = conn.execute(
            """SELECT media.id, media.path, media_order.position FROM media
            LEFT JOIN media_order ON media.id = media_order.media_id
            WHERE media.path IN (?, ?)""",
            (source_path, target_path),
        ).fetchall()
        by_path = {row[1]: row for row in rows}
        if source_path not in by_path or target_path not in by_path:
            raise ValueError("排序失败，部分文件已不在媒体库，请刷新后重试")
        if any(row[2] is None for row in rows):
            _ensure_media_positions(conn)
            rows = conn.execute(
                """SELECT media.id, media.path, media_order.position FROM media
                JOIN media_order ON media.id = media_order.media_id WHERE media.path IN (?, ?)""",
                (source_path, target_path),
            ).fetchall()
            by_path = {row[1]: row for row in rows}
        source = by_path[source_path]
        target = by_path[target_path]
        conn.executemany(
            "UPDATE media_order SET position = ? WHERE media_id = ?",
            [(target[2], source[0]), (source[2], target[0])],
        )


def manual_offset(cursor):
    if not cursor:
        return 0
    if not cursor.startswith("manual:") or not cursor[7:].isdigit():
        raise ValueError("排序已变化，请刷新媒体库")
    return int(cursor[7:])
