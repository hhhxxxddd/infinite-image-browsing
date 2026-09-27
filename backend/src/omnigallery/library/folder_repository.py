import os
from contextlib import closing
from enum import Enum
from sqlite3 import Connection
from typing import Optional

from omnigallery.infrastructure.collections import unique_by


class Folder:
    def __init__(self, id: int, path: str, modified_date: str):
        self.id = id
        self.path = path
        self.modified_date = modified_date

    @classmethod
    def create_table(cls, conn):
        with closing(conn.cursor()) as cur:
            cur.execute(
                """CREATE TABLE IF NOT EXISTS folders
                        (id INTEGER PRIMARY KEY AUTOINCREMENT,
                        path TEXT,
                        modified_date TEXT)"""
            )
            cur.execute("CREATE INDEX IF NOT EXISTS folders_idx_path ON folders(path)")

    @classmethod
    def check_need_update(cls, conn: Connection, folder_path: str):
        folder_path = os.path.normpath(folder_path)
        try:
            modified_date = str(os.stat(folder_path).st_mtime_ns)
        except OSError:
            return False
        with closing(conn.cursor()) as cur:
            cur.execute("SELECT * FROM folders WHERE path=?", (folder_path,))
            folder_record = (
                cur.fetchone()
            )  # 如果这个文件夹没有记录，或者修改时间与数据库不同，则需要修改
            return not folder_record or (folder_record[2] != modified_date)

    @classmethod
    def update_modified_date_or_create(cls, conn: Connection, folder_path: str):
        folder_path = os.path.normpath(folder_path)
        modified_date = str(os.stat(folder_path).st_mtime_ns)
        with closing(conn.cursor()) as cur:
            cur.execute("SELECT * FROM folders WHERE path = ?", (folder_path,))
            row = cur.fetchone()
            if row:
                cur.execute(
                    "UPDATE folders SET modified_date = ? WHERE path = ?",
                    (modified_date, folder_path),
                )
            else:
                cur.execute(
                    "INSERT INTO folders (path, modified_date) VALUES (?, ?)",
                    (folder_path, modified_date),
                )

    @classmethod
    def get_expired_dirs(cls, conn: Connection):
        dirs: list[str] = []
        with closing(conn.cursor()) as cur:
            cur.execute("SELECT path, modified_date FROM folders")
            result_set = cur.fetchall()
            extra_paths = LibraryPath.get_extra_paths(conn)
            recorded_paths = {row[0] for row in result_set}
            for ep in extra_paths:
                if ep.path not in recorded_paths:
                    dirs.append(ep.path)
            for folder_path, recorded_date in result_set:
                try:
                    modified_date = str(os.stat(folder_path).st_mtime_ns)
                except OSError:
                    continue
                if modified_date != recorded_date:
                    dirs.append(folder_path)
            return unique_by(dirs, os.path.normpath)

    @classmethod
    def remove_folder(cls, conn: Connection, folder_path: str):
        folder_path = os.path.normpath(folder_path)
        prefix = folder_path + os.sep
        with closing(conn.cursor()) as cur:
            cur.execute(
                "DELETE FROM folders WHERE path = ? OR substr(path, 1, ?) = ?",
                (folder_path, len(prefix), prefix),
            )

    @classmethod
    def remove_all(cls, conn: Connection):
        with closing(conn.cursor()) as cur:
            cur.execute("DELETE FROM folders")
            conn.commit()


class LibraryPathType(Enum):
    scanned = "scanned"
    scanned_fixed = "scanned-fixed"
    walk = "walk"
    cli_only = "cli_access_only"


class LibraryPath:
    def __init__(self, path: str, types: str | list[str], alias=""):
        self.path = os.path.normpath(path)
        self.types = types.split("+") if isinstance(types, str) else types
        self.alias = alias

    def save(self, conn):
        type_str = "+".join(self.types)
        for type in self.types:
            assert type in [
                LibraryPathType.walk.value,
                LibraryPathType.scanned.value,
                LibraryPathType.scanned_fixed.value,
            ]
        with closing(conn.cursor()) as cur:
            cur.execute(
                "INSERT INTO extra_path (path, type, alias) VALUES (?, ?, ?) "
                "ON CONFLICT (path) DO UPDATE SET type = excluded.type, alias = excluded.alias",
                (self.path, type_str, self.alias),
            )

    @classmethod
    def get_target_path(cls, conn, path) -> Optional["LibraryPath"]:
        path = os.path.normpath(path)
        query = "SELECT * FROM extra_path where path = ?"
        params = (path,)
        with closing(conn.cursor()) as cur:
            cur.execute(query, params)
            rows = cur.fetchall()
            paths: list[LibraryPath] = []
            for row in rows:
                path = row[0]
                if os.path.exists(path):
                    paths.append(LibraryPath(*row))
                else:
                    sql = "DELETE FROM extra_path WHERE path = ?"
                    cur.execute(sql, (path,))
                    conn.commit()
            return paths[0] if paths else None

    @classmethod
    def get_extra_paths(cls, conn) -> list["LibraryPath"]:
        query = "SELECT * FROM extra_path"
        with closing(conn.cursor()) as cur:
            cur.execute(query)
            rows = cur.fetchall()
            paths: list[LibraryPath] = []
            for row in rows:
                path = row[0]
                if os.path.exists(path):
                    paths.append(LibraryPath(*row))
                else:
                    cls.remove(conn, path)
            return paths

    @classmethod
    def remove(
        cls,
        conn,
        path: str,
        types: list[str] = None,
        img_search_dirs: list[str] | None = None,
        all_scanned_paths: list[str] | None = None,
    ):
        types = types or []
        img_search_dirs = img_search_dirs or []
        all_scanned_paths = all_scanned_paths or []
        with closing(conn.cursor()) as cur:
            path = os.path.normpath(path)

            target = cls.get_target_path(conn, path)
            if not target:
                return
            new_types = []
            for type in target.types:
                if type not in types:
                    new_types.append(type)
            if new_types:
                target.types = new_types
                target.save(conn)
            else:
                sql = "DELETE FROM extra_path WHERE path = ?"
                cur.execute(sql, (path,))

            still_scanned = any(
                t in new_types
                for t in (LibraryPathType.scanned.value, LibraryPathType.scanned_fixed.value)
            )
            if path not in img_search_dirs and not still_scanned:
                Folder.remove_folder(conn, path)
            conn.commit()

            # Removing a managed scan root must not leave its indexed media behind.
            if not still_scanned and any(
                t in target.types
                for t in (LibraryPathType.scanned.value, LibraryPathType.scanned_fixed.value)
            ):
                remaining_paths = [
                    os.path.normpath(p) for p in all_scanned_paths if os.path.normpath(p) != path
                ]
                cls._cleanup_orphaned_images(conn, path, remaining_paths)

    @classmethod
    def _cleanup_orphaned_images(
        cls,
        conn,
        removed_path: str,
        remaining_paths: list[str],
    ):
        """
        Clean up images under removed_path that are not covered by any remaining_paths.
        An image is orphaned if it's under removed_path but not under any of the remaining paths.
        """
        from omnigallery.library.media_repository import Media

        with closing(conn.cursor()) as cur:
            # Find all images under the removed path
            cur.execute(
                "SELECT id, path FROM media WHERE path LIKE ?", (removed_path + os.sep + "%",)
            )
            rows = cur.fetchall()

            if not rows:
                return

            orphaned_ids = []
            for row in rows:
                img_id, img_path = row[0], row[1]
                img_path_normalized = os.path.normpath(img_path)

                # Check if this image is still covered by any remaining path
                is_still_owned = False
                for remaining_path in remaining_paths:
                    # Image is owned if its path starts with the remaining path
                    if (
                        img_path_normalized.startswith(remaining_path + os.sep)
                        or img_path_normalized == remaining_path
                    ):
                        is_still_owned = True
                        break

                if not is_still_owned:
                    orphaned_ids.append(img_id)

            # Batch remove orphaned images
            if orphaned_ids:
                Media.safe_batch_remove(conn, orphaned_ids)

    @classmethod
    def create_table(cls, conn):
        with closing(conn.cursor()) as cur:
            cur.execute(
                """CREATE TABLE IF NOT EXISTS extra_path (
                            path TEXT PRIMARY KEY,
                            type TEXT NOT NULL,
                            alias TEXT DEFAULT ''
                        )"""
            )
