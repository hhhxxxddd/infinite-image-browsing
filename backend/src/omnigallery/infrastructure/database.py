import re
import threading
from pathlib import Path
from sqlite3 import Connection, connect

from omnigallery.config import DATABASE_PATH, is_dev
from omnigallery.library.media_order import ensure_media_order


class Database:
    local = threading.local()

    is_indexing = False

    num = 0

    path = str(DATABASE_PATH)

    @classmethod
    def get_connection(cls) -> Connection:
        # for : sqlite3.ProgrammingError: SQLite objects created in a thread can only be used in that same thread
        if hasattr(cls.local, "conn"):
            return cls.local.conn
        else:
            conn = cls.initialize()
            cls.local.conn = conn

            return conn

    @classmethod
    def get_file_path(cls):
        return str(Path(cls.path).expanduser().resolve())

    @classmethod
    def initialize(cls):
        # 创建连接并打开数据库
        from omnigallery.ai.repository import AiSecret, MediaAiNote
        from omnigallery.library.cover_repository import DirectoryCoverCache
        from omnigallery.library.folder_repository import Folder, LibraryPath
        from omnigallery.library.media_repository import Media
        from omnigallery.library.tag_repository import MediaTag, Tag
        from omnigallery.search.cache_repository import TopicClusterCache, TopicTitleCache
        from omnigallery.search.embedding_repository import (
            MediaEmbedding,
            MediaEmbeddingFailure,
            MediaVisualEmbedding,
        )
        from omnigallery.storage.settings_repository import SettingsRepository

        Path(cls.get_file_path()).parent.mkdir(parents=True, exist_ok=True)
        conn = connect(cls.get_file_path())

        # # 禁用 WAL 模式，使用传统的 DELETE 日志模式
        # conn.execute("PRAGMA journal_mode=DELETE")

        def regexp(expr, item):
            if not isinstance(item, str):
                return False
            reg = re.compile(expr, flags=re.IGNORECASE | re.MULTILINE | re.DOTALL)
            return reg.search(item) is not None

        conn.create_function("regexp", 2, regexp)
        try:
            Folder.create_table(conn)
            MediaTag.create_table(conn)
            Tag.create_table(conn)
            Media.create_table(conn)
            ensure_media_order(conn)
            LibraryPath.create_table(conn)
            conn.execute(
                "CREATE TABLE IF NOT EXISTS folder_icon (path TEXT PRIMARY KEY, icon TEXT NOT NULL)"
            )
            DirectoryCoverCache.create_table(conn)
            SettingsRepository.create_table(conn)
            MediaEmbedding.create_table(conn)

            MediaVisualEmbedding.create_table(conn)
            MediaAiNote.create_table(conn)
            AiSecret.create_table(conn)
            MediaEmbeddingFailure.create_table(conn)
            TopicTitleCache.create_table(conn)
            TopicClusterCache.create_table(conn)
            from omnigallery.workspaces.artifacts import create_workspace_artifact_table

            create_workspace_artifact_table(conn)
            from omnigallery.workspaces.state import create_workspace_state_tables

            create_workspace_state_tables(conn)

        except Exception:
            conn.close()
            raise
        conn.commit()
        cls.num += 1
        if is_dev:
            print(f"当前连接数{cls.num}")
        return conn
