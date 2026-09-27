import hashlib
from contextlib import closing
from datetime import datetime
from sqlite3 import Connection


class MediaVisualEmbedding:
    """Qwen3-VL image vectors used by text and image retrieval."""

    @staticmethod
    def create_table(conn: Connection):
        conn.execute("""CREATE TABLE IF NOT EXISTS media_qwen_visual_embedding (
            media_id INTEGER PRIMARY KEY,
            model_key TEXT NOT NULL,
            mtime_ns INTEGER NOT NULL,
            file_size INTEGER NOT NULL,
            dim INTEGER NOT NULL,
            vec BLOB NOT NULL,
            FOREIGN KEY (media_id) REFERENCES media(id)
        )""")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS image_qwen_visual_embedding_model_idx ON media_qwen_visual_embedding(model_key)"
        )


class MediaEmbedding:
    """
    Store embeddings for image prompt text.

    Notes:
    - vec is stored as float32 bytes (little-endian), compatible with Python's array('f').
    - text_hash is used to skip recomputation when prompt text doesn't change.
    """

    @classmethod
    def create_table(cls, conn: Connection):
        with closing(conn.cursor()) as cur:
            cur.execute(
                """CREATE TABLE IF NOT EXISTS media_embedding (
                    media_id INTEGER PRIMARY KEY,
                    model TEXT NOT NULL,
                    dim INTEGER NOT NULL,
                    text_hash TEXT NOT NULL,
                    vec BLOB NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (media_id) REFERENCES media(id)
                )"""
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS image_embedding_idx_model_hash ON media_embedding(model, text_hash)"
            )

    @staticmethod
    def compute_text_hash(text: str) -> str:
        return hashlib.sha256(text.encode("utf-8")).hexdigest()

    _BATCH_SIZE = 900  # SQLite default max variable number is 999

    @classmethod
    def get_by_image_ids(cls, conn: Connection, media_ids: list[int]):
        if not media_ids:
            return {}
        res = {}
        with closing(conn.cursor()) as cur:
            for i in range(0, len(media_ids), cls._BATCH_SIZE):
                batch = media_ids[i : i + cls._BATCH_SIZE]
                placeholders = ",".join("?" * len(batch))
                cur.execute(
                    f"SELECT media_id, model, dim, text_hash, vec, updated_at FROM media_embedding WHERE media_id IN ({placeholders})",
                    batch,
                )
                for row in cur.fetchall():
                    res[row[0]] = {
                        "media_id": row[0],
                        "model": row[1],
                        "dim": row[2],
                        "text_hash": row[3],
                        "vec": row[4],
                        "updated_at": row[5],
                    }
        return res

    @classmethod
    def upsert(
        cls,
        conn: Connection,
        media_id: int,
        model: str,
        dim: int,
        text_hash: str,
        vec_blob: bytes,
        updated_at: str | None = None,
    ):
        updated_at = updated_at or datetime.now().isoformat()
        with closing(conn.cursor()) as cur:
            cur.execute(
                """INSERT INTO media_embedding (media_id, model, dim, text_hash, vec, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(media_id) DO UPDATE SET
                    model = excluded.model,
                    dim = excluded.dim,
                    text_hash = excluded.text_hash,
                    vec = excluded.vec,
                    updated_at = excluded.updated_at
                """,
                (media_id, model, dim, text_hash, vec_blob, updated_at),
            )


class MediaEmbeddingFailure:
    """
    Cache embedding failures per image+model+text_hash to avoid repeatedly hitting the API
    for known-failing inputs. This helps keep clustering/search usable by skipping bad items.
    """

    _BATCH_SIZE = 900  # SQLite default max variable number is 999

    @classmethod
    def create_table(cls, conn: Connection):
        with closing(conn.cursor()) as cur:
            cur.execute(
                """CREATE TABLE IF NOT EXISTS media_embedding_fail (
                    media_id INTEGER NOT NULL,
                    model TEXT NOT NULL,
                    text_hash TEXT NOT NULL,
                    error TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY(media_id, model, text_hash)
                )"""
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS image_embedding_fail_idx_model ON media_embedding_fail(model)"
            )

    @classmethod
    def get_by_image_ids(
        cls, conn: Connection, media_ids: list[int], model: str
    ) -> dict[int, dict]:
        if not media_ids:
            return {}
        ids = [int(x) for x in media_ids]
        out: dict[int, dict] = {}
        with closing(conn.cursor()) as cur:
            for i in range(0, len(ids), cls._BATCH_SIZE):
                batch = ids[i : i + cls._BATCH_SIZE]
                placeholders = ",".join(["?"] * len(batch))
                cur.execute(
                    f"SELECT media_id, text_hash, error, updated_at FROM media_embedding_fail WHERE model = ? AND media_id IN ({placeholders})",
                    (str(model), *batch),
                )
                for media_id, text_hash, error, updated_at in cur.fetchall() or []:
                    out[int(media_id)] = {
                        "text_hash": str(text_hash or ""),
                        "error": str(error or ""),
                        "updated_at": str(updated_at or ""),
                    }
        return out

    @classmethod
    def upsert(
        cls,
        conn: Connection,
        *,
        media_id: int,
        model: str,
        text_hash: str,
        error: str,
        updated_at: str | None = None,
    ):
        updated_at = updated_at or datetime.now().isoformat()
        with closing(conn.cursor()) as cur:
            cur.execute(
                """INSERT INTO media_embedding_fail (media_id, model, text_hash, error, updated_at)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(media_id, model, text_hash) DO UPDATE SET
                      error = excluded.error,
                      updated_at = excluded.updated_at
                """,
                (
                    int(media_id),
                    str(model),
                    str(text_hash),
                    str(error or "")[:600],
                    str(updated_at),
                ),
            )

    @classmethod
    def delete(cls, conn: Connection, *, media_id: int, model: str):
        with closing(conn.cursor()) as cur:
            cur.execute(
                "DELETE FROM media_embedding_fail WHERE media_id = ? AND model = ?",
                (int(media_id), str(model)),
            )
