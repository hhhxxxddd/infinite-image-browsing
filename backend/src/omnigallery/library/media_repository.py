import os
import random
from contextlib import closing
from sqlite3 import Connection

from PIL import Image as PillowImage

from omnigallery.infrastructure.formatting import (
    human_readable_size,
)
from omnigallery.library.media_order import ensure_media_order, read_ordered_media_page
from omnigallery.library.media_types import is_image_file, is_video_file
from omnigallery.library.schemas import Cursor, FileInfo
from omnigallery.library.tag_labels import tags_translate
from omnigallery.search.query import compile_search_query

PICK_MEDIA_SUFFIXES = {
    "image": (".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".avif", ".jpe"),
    "video": (".mp4", ".m4v", ".avi", ".mkv", ".mov", ".wmv", ".flv", ".ts", ".webm"),
    "audio": (".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".wma"),
}


def read_media_dimensions(path: str) -> tuple[int | None, int | None]:
    """Read image headers or video stream metadata without decoding video frames."""
    if is_image_file(path):
        try:
            with PillowImage.open(path) as media:
                return media.size
        except (OSError, ValueError):
            return None, None
    if is_video_file(path):
        try:
            import av

            with av.open(path) as container:
                stream = next(iter(container.streams.video), None)
                if stream is not None:
                    width = int(stream.codec_context.width or 0)
                    height = int(stream.codec_context.height or 0)
                    if width > 0 and height > 0:
                        return width, height
        except Exception:
            # A missing decoder or unsupported file can still use the poster's
            # natural dimensions when it loads in the browser.
            pass
    return None, None


class Media:
    def __init__(
        self,
        path,
        exif=None,
        size=0,
        date="",
        exif_edited=False,
        id=None,
        description="",
        width=None,
        height=None,
        content_pending=False,
    ):
        self.path = path
        self.exif = exif
        self.exif_edited = exif_edited
        self.id = id
        self.size = size
        self.date = date
        self.description = description or ""
        self.width = width
        self.height = height
        self.content_pending = content_pending

    def to_file_info(self) -> FileInfo:
        return {
            "type": "file",
            "id": self.id,
            "date": self.date,
            "created_date": self.date,
            "size": human_readable_size(self.size),
            "is_under_scanned_path": True,
            "bytes": self.size,
            "name": os.path.basename(self.path),
            "fullpath": self.path,
            "width": self.width,
            "height": self.height,
        }

    def save(self, conn):
        with closing(conn.cursor()) as cur:
            cur.execute(
                "INSERT OR REPLACE INTO media (path, exif, exif_edited, size, date, description, width, height, content_pending) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    self.path,
                    self.exif,
                    int(self.exif_edited),
                    self.size,
                    self.date,
                    self.description,
                    self.width,
                    self.height,
                    int(self.content_pending),
                ),
            )
            self.id = cur.lastrowid

    def update_exif(self, conn: Connection, exif: str, mark_edited: bool = True):
        """更新图片的 exif 信息并标记为已编辑"""
        with closing(conn.cursor()) as cur:
            cur.execute(
                "UPDATE media SET exif = ?, exif_edited = ? WHERE id = ?",
                (exif, mark_edited, self.id),
            )
        self.exif = exif
        self.exif_edited = mark_edited

    def update_description(self, conn: Connection, description: str):
        with closing(conn.cursor()) as cur:
            cur.execute("UPDATE media SET description = ? WHERE id = ?", (description, self.id))
        self.description = description

    def update_dimensions(self, conn: Connection, width: int, height: int):
        with closing(conn.cursor()) as cur:
            cur.execute(
                "UPDATE media SET width = ?, height = ? WHERE id = ?", (width, height, self.id)
            )
        self.width, self.height = width, height

    def update_path(self, conn: Connection, new_path: str, force=False):
        self.path = os.path.normpath(new_path)
        with closing(conn.cursor()) as cur:
            if force:  # force update path
                cur.execute("DELETE FROM media WHERE path = ?", (self.path,))
            cur.execute("UPDATE media SET path = ? WHERE id = ?", (self.path, self.id))

    @classmethod
    def get(cls, conn: Connection, id_or_path):
        with closing(conn.cursor()) as cur:
            cur.execute("SELECT * FROM media WHERE id = ? OR path = ?", (id_or_path, id_or_path))
            row = cur.fetchone()
            if row is None:
                return None
            else:
                return cls.from_row(row)

    @classmethod
    def get_by_ids(cls, conn: Connection, ids: list[int]) -> list["Media"]:
        if not ids:
            return []

        query = """
            SELECT * FROM media
            WHERE id IN ({})
        """.format(",".join("?" * len(ids)))

        with closing(conn.cursor()) as cur:
            cur.execute(query, ids)
            rows = cur.fetchall()

        images = []
        for row in rows:
            images.append(cls.from_row(row))
        return images

    @classmethod
    def create_table(cls, conn):
        with closing(conn.cursor()) as cur:
            cur.execute(
                """CREATE TABLE IF NOT EXISTS media (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            path TEXT UNIQUE,
                            exif TEXT,
                            size INTEGER,
                            date TEXT,
                            exif_edited INTEGER DEFAULT 0,
                            description TEXT NOT NULL DEFAULT '',
                            width INTEGER,
                            height INTEGER,
                            content_pending INTEGER NOT NULL DEFAULT 0
                        )"""
            )
            cur.execute("CREATE INDEX IF NOT EXISTS media_idx_path ON media(path)")
            cur.execute(
                "CREATE INDEX IF NOT EXISTS media_idx_path_nocase ON media(path COLLATE NOCASE)"
            )
            cur.execute("CREATE INDEX IF NOT EXISTS media_idx_date_id ON media(date DESC, id DESC)")

            # 数据库迁移：为旧表添加 exif_edited 列
            {row[1] for row in cur.execute("PRAGMA table_info(media)")}
            cur.execute(
                "CREATE INDEX IF NOT EXISTS media_idx_content_pending ON media(content_pending)"
            )
        from omnigallery.search.text_index import create_text_index

        create_text_index(conn)

    @classmethod
    def count(cls, conn):
        with closing(conn.cursor()) as cur:
            cur.execute("SELECT COUNT(*) FROM media")
            count = cur.fetchone()[0]
            return count

    @classmethod
    def from_row(cls, row: tuple):
        """从数据库行创建 Image 对象

        字段顺序：id=0, path=1, exif=2, size=3, date=4, exif_edited=5, description=6, width=7, height=8
        """
        media = cls(
            path=row[1],
            exif=row[2],
            size=row[3],
            date=row[4],
            exif_edited=bool(row[5]),
            description=row[6],
            width=row[7] if len(row) > 7 else None,
            height=row[8] if len(row) > 8 else None,
            content_pending=bool(row[9]) if len(row) > 9 else False,
        )
        media.id = row[0]
        return media

    @classmethod
    def remove(cls, conn: Connection, media_id: int) -> None:
        with closing(conn.cursor()) as cur:
            # Manual cascade delete to avoid leaving orphan rows in related tables.
            # NOTE: SQLite foreign key constraints are often disabled by default unless
            # PRAGMA foreign_keys=ON is set. We still delete related rows explicitly
            # so deletion works regardless of FK settings and keeps DB clean.
            cur.execute("DELETE FROM media_embedding WHERE media_id = ?", (int(media_id),))

            cur.execute(
                "DELETE FROM media_qwen_visual_embedding WHERE media_id = ?", (int(media_id),)
            )
            cur.execute("DELETE FROM media_ai_note WHERE media_id = ?", (int(media_id),))
            cur.execute("DELETE FROM media_embedding_fail WHERE media_id = ?", (int(media_id),))
            cur.execute("DELETE FROM media_tag WHERE media_id = ?", (int(media_id),))
            cur.execute("DELETE FROM media WHERE id = ?", (media_id,))
            conn.commit()

    @classmethod
    def safe_batch_remove(cls, conn: Connection, media_ids: list[int]) -> None:
        if not (media_ids):
            return
        with closing(conn.cursor()) as cur:
            try:
                placeholders = ",".join("?" * len(media_ids))
                # Manual cascade delete for related tables.
                # Keep this in sync with tables referencing media.id.
                cur.execute(
                    f"DELETE FROM media_embedding WHERE media_id IN ({placeholders})",
                    media_ids,
                )
                cur.execute(
                    f"DELETE FROM media_qwen_visual_embedding WHERE media_id IN ({placeholders})",
                    media_ids,
                )
                cur.execute(
                    f"DELETE FROM media_ai_note WHERE media_id IN ({placeholders})",
                    media_ids,
                )
                cur.execute(
                    f"DELETE FROM media_embedding_fail WHERE media_id IN ({placeholders})",
                    media_ids,
                )
                cur.execute(
                    f"DELETE FROM media_tag WHERE media_id IN ({placeholders})",
                    media_ids,
                )
                cur.execute(f"DELETE FROM media WHERE id IN ({placeholders})", media_ids)
            except BaseException as e:
                print(e)
            finally:
                conn.commit()

    @classmethod
    def find_by_substring(
        cls,
        conn: Connection,
        substring: str,
        limit: int = 500,
        cursor="",
        regexp="",
        filename_only=False,
        folder_paths: list[str] | None = None,
        media_type: str = None,
        filter_clauses: list[str] | None = None,
        filter_params: list[int] | None = None,
        manual_order: bool = False,
    ) -> tuple[list["Media"], Cursor]:
        from omnigallery.library.pagination import make_page_cursor, page_cursor_clause

        api_cur = Cursor()
        if manual_order:
            ensure_media_order(conn)
        # Handle both POSIX and Windows separators, independent of the server OS.
        conn.create_function(
            "search_filename", 1, lambda path: str(path or "").replace("\\", "/").rsplit("/", 1)[-1]
        )
        conn.create_function(
            "search_tag_label",
            1,
            lambda name: "喜欢" if name == "like" else tags_translate.get(name or "", ""),
        )
        with closing(conn.cursor()) as cur:
            has_custom_order = (
                manual_order
                and cur.execute("SELECT EXISTS(SELECT 1 FROM media_order LIMIT 1)").fetchone()[0]
            )
            params = list(filter_params or [])
            where_clauses = list(filter_clauses or [])
            if regexp:
                if filename_only:
                    where_clauses.append("(search_filename(media.path) REGEXP ?)")
                    params.append(regexp)
                else:
                    where_clauses.append(
                        "(search_filename(media.path) REGEXP ? OR media.description REGEXP ? OR EXISTS (SELECT 1 FROM media_tag AS text_image_tag JOIN tag AS text_tag ON text_tag.id = text_image_tag.tag_id WHERE text_image_tag.media_id = media.id AND (text_tag.name REGEXP ? OR search_tag_label(text_tag.name) REGEXP ?)))"
                    )
                    params.extend((regexp,) * 4)
            elif substring:
                from omnigallery.search.text_index import has_text_index

                clause, query_params = compile_search_query(
                    substring, filename_only, indexed=has_text_index(conn)
                )
                if clause:
                    where_clauses.append(clause)
                    params.extend(query_params)
            cursor_clause = "" if has_custom_order else page_cursor_clause(cursor, params)
            if cursor_clause:
                where_clauses.append(cursor_clause)
            if folder_paths:
                folder_clauses = []
                for folder_path in folder_paths:
                    folder_clauses.append("(media.path LIKE ?)")
                    params.append(os.path.join(folder_path, "%"))
                where_clauses.append("(" + " OR ".join(folder_clauses) + ")")

            if media_type and media_type.lower() != "all":
                media_type_name = {"image": "Image", "audio": "Audio"}.get(
                    media_type.lower(), "Video"
                )
                where_clauses.append(
                    "EXISTS (SELECT 1 FROM media_tag JOIN tag ON media_tag.tag_id = tag.id "
                    "WHERE media_tag.media_id = media.id AND tag.type = 'Media Type' AND tag.name = ?)"
                )
                params.append(media_type_name)
            manual_next = ""
            if has_custom_order:
                rows, manual_next = read_ordered_media_page(
                    cur, where_clauses, params, limit, cursor
                )
            else:
                sql = "SELECT media.* FROM media"
                if where_clauses:
                    sql += " WHERE " + " AND ".join(where_clauses)
                sql += " ORDER BY media.date DESC, media.id DESC LIMIT ?"
                cur.execute(sql, [*params, limit])
                rows = cur.fetchall()

        api_cur.has_next = len(rows) >= limit
        images = []
        deleted_ids = []
        dimensions_updated = False
        from omnigallery.storage.cloud_files import get_sync_settings, online_only_paths

        sync_settings = get_sync_settings(conn)
        cloud_paths = online_only_paths(
            (row[1] for row in rows if len(row) < 9 or not row[7] or not row[8]), sync_settings
        )
        for row in rows:
            img = cls.from_row(row)
            if os.path.exists(img.path):
                if (not img.width or not img.height) and img.path not in cloud_paths:
                    width, height = read_media_dimensions(img.path)
                    if width and height:
                        img.update_dimensions(conn, width, height)
                        dimensions_updated = True
                images.append(img)
            else:
                deleted_ids.append(img.id)
        if dimensions_updated:
            conn.commit()
        cls.safe_batch_remove(conn, deleted_ids)
        if rows:
            # Advance past the last row read, not the last row kept: a trailing
            # run of deleted files would otherwise rewind the cursor.
            last = cls.from_row(rows[-1])
            api_cur.next = manual_next if has_custom_order else make_page_cursor(last.date, last.id)
        return images, api_cur

    @classmethod
    def pick_random_media(
        cls,
        conn: Connection,
        size: int,
        media_type: str = "all",
        exclude_paths: list[str] | None = None,
    ) -> list["Media"]:
        """Draw a small browse batch, including scarce video/audio in mixed mode."""
        if size <= 0 or media_type not in ("all", *PICK_MEDIA_SUFFIXES):
            return []
        excluded = set((exclude_paths or [])[:256])
        missing_ids = []

        def draw(kind: str, count: int) -> list["Media"]:
            if count <= 0:
                return []
            clauses = []
            params: list = []
            if kind != "all":
                suffixes = PICK_MEDIA_SUFFIXES[kind]
                clauses.append("(" + " OR ".join("lower(path) LIKE ?" for _ in suffixes) + ")")
                params.extend(f"%{suffix}" for suffix in suffixes)
            if excluded:
                clauses.append("path NOT IN (" + ",".join("?" for _ in excluded) + ")")
                params.extend(excluded)
            where = " WHERE " + " AND ".join(clauses) if clauses else ""
            with closing(conn.cursor()) as cur:
                cur.execute(
                    f"SELECT * FROM media{where} ORDER BY RANDOM() LIMIT ?",
                    (*params, max(count + 12, count * 2)),
                )
                rows = cur.fetchall()
            found = []
            for row in rows:
                item = cls.from_row(row)
                if os.path.isfile(item.path):
                    found.append(item)
                    excluded.add(item.path)
                    if len(found) >= count:
                        break
                else:
                    missing_ids.append(item.id)
            return found

        if media_type == "all":
            minor = max(1, size // 6)
            selected = draw("image", max(0, size - minor * 2))
            selected += draw("video", minor)
            selected += draw("audio", minor)
            selected += draw("all", size - len(selected))
            random.shuffle(selected)
        else:
            selected = draw(media_type, size)
        if missing_ids:
            cls.safe_batch_remove(conn, list(set(missing_ids)))
        return selected
