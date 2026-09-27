import json
from contextlib import closing
from datetime import datetime
from sqlite3 import Connection


class TopicTitleCache:
    """
    Cache cluster titles/keywords to avoid repeated LLM calls.
    """

    @classmethod
    def create_table(cls, conn: Connection):
        with closing(conn.cursor()) as cur:
            cur.execute(
                """CREATE TABLE IF NOT EXISTS topic_title_cache (
                    cluster_hash TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    keywords TEXT NOT NULL,
                    model TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )"""
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS topic_title_cache_idx_model ON topic_title_cache(model)"
            )

    @classmethod
    def get(cls, conn: Connection, cluster_hash: str):
        with closing(conn.cursor()) as cur:
            cur.execute(
                "SELECT title, keywords, model, updated_at FROM topic_title_cache WHERE cluster_hash = ?",
                (cluster_hash,),
            )
            row = cur.fetchone()
        if not row:
            return None
        title, keywords, model, updated_at = row
        try:
            kw = json.loads(keywords) if isinstance(keywords, str) else []
        except Exception:
            kw = []
        if not isinstance(kw, list):
            kw = []
        return {"title": title, "keywords": kw, "model": model, "updated_at": updated_at}

    @classmethod
    def get_all_keywords_frequency(
        cls, conn: Connection, model: str | None = None
    ) -> dict[str, int]:
        """
        Get keyword frequency from all cached clusters.
        Optionally filter by model.
        Returns a dictionary mapping keyword -> frequency.
        """
        with closing(conn.cursor()) as cur:
            if model:
                cur.execute(
                    "SELECT keywords FROM topic_title_cache WHERE model = ?",
                    (model,),
                )
            else:
                cur.execute(
                    "SELECT keywords FROM topic_title_cache",
                )
            rows = cur.fetchall()

        keyword_frequency: dict[str, int] = {}
        for row in rows:
            keywords_str = row[0] if row else None
            try:
                keywords = json.loads(keywords_str) if isinstance(keywords_str, str) else []
            except Exception:
                keywords = []
            if isinstance(keywords, list):
                for kw in keywords:
                    if isinstance(kw, str) and kw.strip():
                        keyword_frequency[kw] = keyword_frequency.get(kw, 0) + 1
        return keyword_frequency

    @classmethod
    def upsert(
        cls,
        conn: Connection,
        cluster_hash: str,
        title: str,
        keywords: list[str],
        model: str,
        updated_at: str | None = None,
    ):
        updated_at = updated_at or datetime.now().isoformat()
        kw = json.dumps([str(x) for x in (keywords or [])], ensure_ascii=False)
        with closing(conn.cursor()) as cur:
            cur.execute(
                """INSERT INTO topic_title_cache (cluster_hash, title, keywords, model, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(cluster_hash) DO UPDATE SET
                    title = excluded.title,
                    keywords = excluded.keywords,
                    model = excluded.model,
                    updated_at = excluded.updated_at
                """,
                (cluster_hash, title, kw, model, updated_at),
            )

    @classmethod
    def update_keywords(
        cls,
        conn: Connection,
        cluster_hash: str,
        keywords: list[str],
        updated_at: str | None = None,
    ):
        """
        Update only the keywords for an existing cluster cache entry.
        """
        updated_at = updated_at or datetime.now().isoformat()
        kw = json.dumps([str(x) for x in (keywords or [])], ensure_ascii=False)
        with closing(conn.cursor()) as cur:
            cur.execute(
                "UPDATE topic_title_cache SET keywords = ?, updated_at = ? WHERE cluster_hash = ?",
                (kw, updated_at, cluster_hash),
            )


class TopicClusterCache:
    """
    Persist the final clustering result (clusters/noise) to avoid re-clustering when:
    - embeddings haven't changed (by max(updated_at) & count), and
    - clustering parameters are unchanged.

    This is intentionally lightweight:
    - result is stored as JSON text
    - caller defines cache_key (sha1 over params + folders + normalize version + lang, etc.)
    """

    @classmethod
    def create_table(cls, conn: Connection):
        with closing(conn.cursor()) as cur:
            cur.execute(
                """CREATE TABLE IF NOT EXISTS topic_cluster_cache (
                            cache_key TEXT PRIMARY KEY,
                            folders TEXT NOT NULL,
                            model TEXT NOT NULL,
                            params TEXT NOT NULL,
                            embeddings_count INTEGER NOT NULL,
                            embeddings_max_updated_at TEXT NOT NULL,
                            result TEXT NOT NULL,
                            updated_at TEXT NOT NULL
                        )"""
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS topic_cluster_cache_idx_model ON topic_cluster_cache(model)"
            )

    @classmethod
    def get(cls, conn: Connection, cache_key: str):
        with closing(conn.cursor()) as cur:
            cur.execute(
                "SELECT folders, model, params, embeddings_count, embeddings_max_updated_at, result, updated_at FROM topic_cluster_cache WHERE cache_key = ?",
                (cache_key,),
            )
            row = cur.fetchone()
        if not row:
            return None
        folders, model, params, embeddings_count, embeddings_max_updated_at, result, updated_at = (
            row
        )
        try:
            folders_obj = json.loads(folders) if isinstance(folders, str) else []
        except Exception:
            folders_obj = []
        try:
            params_obj = json.loads(params) if isinstance(params, str) else {}
        except Exception:
            params_obj = {}
        try:
            result_obj = json.loads(result) if isinstance(result, str) else None
        except Exception:
            result_obj = None
        return {
            "cache_key": cache_key,
            "folders": folders_obj if isinstance(folders_obj, list) else [],
            "model": str(model),
            "params": params_obj if isinstance(params_obj, dict) else {},
            "embeddings_count": int(embeddings_count or 0),
            "embeddings_max_updated_at": str(embeddings_max_updated_at or ""),
            "result": result_obj,
            "updated_at": str(updated_at or ""),
        }

    @classmethod
    def upsert(
        cls,
        conn: Connection,
        *,
        cache_key: str,
        folders: list[str],
        model: str,
        params: dict,
        embeddings_count: int,
        embeddings_max_updated_at: str,
        result: dict,
        updated_at: str | None = None,
    ):
        updated_at = updated_at or datetime.now().isoformat()
        folders_s = json.dumps([str(x) for x in (folders or [])], ensure_ascii=False)
        params_s = json.dumps(params or {}, ensure_ascii=False, sort_keys=True)
        result_s = json.dumps(result or {}, ensure_ascii=False)
        with closing(conn.cursor()) as cur:
            cur.execute(
                """INSERT INTO topic_cluster_cache
                   (cache_key, folders, model, params, embeddings_count, embeddings_max_updated_at, result, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(cache_key) DO UPDATE SET
                     folders = excluded.folders,
                     model = excluded.model,
                     params = excluded.params,
                     embeddings_count = excluded.embeddings_count,
                     embeddings_max_updated_at = excluded.embeddings_max_updated_at,
                     result = excluded.result,
                     updated_at = excluded.updated_at
                """,
                (
                    cache_key,
                    folders_s,
                    str(model),
                    params_s,
                    int(embeddings_count or 0),
                    str(embeddings_max_updated_at or ""),
                    result_s,
                    updated_at,
                ),
            )
