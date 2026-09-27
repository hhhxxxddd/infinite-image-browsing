import json
import os
from contextlib import closing
from datetime import datetime


class DirectoryCoverCache:
    @classmethod
    def create_table(cls, conn):
        with closing(conn.cursor()) as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS dir_cover_cache (
                    folder_path TEXT PRIMARY KEY,
                    modified_time TEXT,
                    media_files TEXT
                )
            """)

    @classmethod
    def is_cache_expired(cls, conn, folder_path):
        with closing(conn.cursor()) as cur:
            cur.execute(
                "SELECT modified_time FROM dir_cover_cache WHERE folder_path = ?", (folder_path,)
            )
            result = cur.fetchone()

        if not result:
            return True

        cached_time = datetime.fromisoformat(result[0])
        folder_modified_time = os.path.getmtime(folder_path)
        return datetime.fromtimestamp(folder_modified_time) > cached_time

    @classmethod
    def cache_media_files(cls, conn, folder_path, media_files):
        media_files_json = json.dumps(media_files)
        with closing(conn.cursor()) as cur:
            cur.execute(
                """
                INSERT INTO dir_cover_cache (folder_path, modified_time, media_files)
                VALUES (?, ?, ?)
                ON CONFLICT(folder_path) DO UPDATE SET modified_time = excluded.modified_time, media_files = excluded.media_files
            """,
                (folder_path, datetime.now().isoformat(), media_files_json),
            )
            conn.commit()

    @classmethod
    def get_cached_media_files(cls, conn, folder_path):
        with closing(conn.cursor()) as cur:
            cur.execute(
                "SELECT media_files FROM dir_cover_cache WHERE folder_path = ?", (folder_path,)
            )
            result = cur.fetchone()

        if result:
            media_files_json = result[0]
            return json.loads(media_files_json)
        else:
            return []
