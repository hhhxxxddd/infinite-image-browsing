"""Persistent manual media order shared by library filters."""

def ensure_media_order(conn):
    conn.execute("CREATE TABLE IF NOT EXISTS media_order (image_id INTEGER PRIMARY KEY, position INTEGER NOT NULL)")


def _ensure_media_positions(conn):
    conn.execute("DELETE FROM media_order WHERE image_id NOT IN (SELECT id FROM image)")
    conn.execute("""INSERT INTO media_order (image_id, position)
        SELECT id, COALESCE((SELECT MAX(position) + 1 FROM media_order), 0)
            + ROW_NUMBER() OVER (ORDER BY date DESC, id DESC) - 1
        FROM image WHERE id NOT IN (SELECT image_id FROM media_order)""")


def move_media(conn, paths, target_path, after=False):
    ensure_media_order(conn)
    # Start the write transaction before reading positions so concurrent drags serialize.
    with conn:
        _ensure_media_positions(conn)
        rows = conn.execute("""SELECT image.id, image.path, media_order.position FROM image
            JOIN media_order ON image.id = media_order.image_id ORDER BY media_order.position""").fetchall()
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
        conn.executemany("UPDATE media_order SET position = ? WHERE image_id = ?",
                         [(i, row[0]) for i, row in enumerate(ordered) if i != row[2]])


def swap_media(conn, source_path, target_path):
    if source_path == target_path:
        return
    ensure_media_order(conn)
    with conn:
        _ensure_media_positions(conn)
        rows = conn.execute("""SELECT image.id, image.path, media_order.position FROM image
            JOIN media_order ON image.id = media_order.image_id
            WHERE image.path IN (?, ?)""", (source_path, target_path)).fetchall()
        by_path = {row[1]: row for row in rows}
        if source_path not in by_path or target_path not in by_path:
            raise ValueError("排序失败，部分文件已不在媒体库，请刷新后重试")
        source = by_path[source_path]
        target = by_path[target_path]
        conn.executemany("UPDATE media_order SET position = ? WHERE image_id = ?",
                         [(target[2], source[0]), (source[2], target[0])])


def manual_offset(cursor):
    if not cursor:
        return 0
    if not cursor.startswith("manual:") or not cursor[7:].isdigit():
        raise ValueError("排序已变化，请刷新媒体库")
    return int(cursor[7:])
