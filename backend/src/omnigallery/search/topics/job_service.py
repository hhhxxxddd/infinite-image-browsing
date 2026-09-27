import hashlib
import json
import os
from collections.abc import Callable
from contextlib import closing
from dataclasses import dataclass

from fastapi import HTTPException

from omnigallery.infrastructure.database import Database
from omnigallery.infrastructure.logging import logger
from omnigallery.search.cache_repository import TopicClusterCache
from omnigallery.search.topics import jobs, normalization
from omnigallery.search.topics.cluster_service import ClusteringService
from omnigallery.search.topics.configuration import TopicSearchConfig
from omnigallery.search.topics.embedding_service import EmbeddingService


@dataclass
class ClusterJobService:
    config: TopicSearchConfig
    embedding_service: EmbeddingService
    cluster_service: ClusteringService
    authorize_folder: Callable[[str], None] | None = None

    async def run(self, job_id: str, req) -> None:
        logger.info("[cluster_job] === run START ===")
        logger.info("[cluster_job] job_id=%s", job_id)

        try:
            logger.info("[cluster_job] Initializing job")
            jobs._job_upsert(
                job_id,
                {
                    "status": "running",
                    "stage": "init",
                    "created_at": jobs._job_now(),
                    "req": req.model_dump() if hasattr(req, "model_dump") else req.dict(),
                },
            )
            logger.info("[cluster_job] Job initialized successfully")

            logger.info("[cluster_job] Extracting and validating folders")
            folders = self.cluster_service.resolve_folders(req)
            if self.authorize_folder:
                for folder in folders:
                    self.authorize_folder(folder)
            logger.info("[cluster_job] Folders validated: %s", folders)
            jobs._job_upsert(job_id, {"folders": folders, "stage": "embedding"})

            # Aggregate per-folder embedding progress into totals
            per_folder: dict[str, dict] = {}

            def _embed_cb(p: dict) -> None:
                if not isinstance(p, dict):
                    return
                if p.get("stage") != "embedding":
                    return
                f = str(p.get("folder") or "")
                if f:
                    per_folder[f] = dict(p)
                scanned = sum(int(x.get("scanned") or 0) for x in per_folder.values())
                to_embed = sum(int(x.get("to_embed") or 0) for x in per_folder.values())
                embedded_done = sum(int(x.get("embedded_done") or 0) for x in per_folder.values())
                updated = sum(int(x.get("updated") or 0) for x in per_folder.values())
                skipped = sum(int(x.get("skipped") or 0) for x in per_folder.values())
                jobs._job_upsert(
                    job_id,
                    {
                        "stage": "embedding",
                        "progress": {
                            "scanned": scanned,
                            "to_embed": to_embed,
                            "embedded_done": embedded_done,
                            "updated": updated,
                            "skipped": skipped,
                            "folder": f,
                            "batch_n": int((p or {}).get("batch_n") or 0),
                        },
                    },
                )

            # Ensure embeddings exist (incremental per folder)
            model = req.model or self.config.embedding_model
            batch_size = max(1, min(int(req.batch_size or 64), 256))
            max_chars = max(256, min(int(req.max_chars or 4000), 8000))
            force = bool(req.force_embed)
            recursive = bool(req.recursive) if req.recursive is not None else True
            logger.info(f"[run] recursive={recursive}, req.recursive={req.recursive}")
            for f in folders:
                logger.info(f"[run] Building embeddings for folder: {f}, recursive={recursive}")
                await self.embedding_service.build_folder(
                    folder=f,
                    model=model,
                    force=force,
                    batch_size=batch_size,
                    max_chars=max_chars,
                    recursive=recursive,
                    progress_cb=_embed_cb,
                )

            # If embeddings didn't change and we have a cached clustering result, return it directly.
            conn = Database.get_connection()
            like_prefixes = [os.path.join(f, "%") for f in folders]
            with closing(conn.cursor()) as cur:
                where = " OR ".join(["media.path LIKE ?"] * len(like_prefixes))
                cur.execute(
                    f"""SELECT COUNT(*), MAX(media_embedding.updated_at)
                        FROM media
                        INNER JOIN media_embedding ON media_embedding.media_id = media.id
                        WHERE ({where}) AND media_embedding.model = ?""",
                    (*like_prefixes, model),
                )
                row = cur.fetchone() or (0, "")
            embeddings_count = int(row[0] or 0)
            embeddings_max_updated_at = str(row[1] or "")

            cache_params = {
                "model": model,
                "threshold": float(req.threshold or 0.90),
                "min_cluster_size": int(req.min_cluster_size or 2),
                "assign_noise_threshold": req.assign_noise_threshold,
                "title_model": req.title_model,
                "lang": str(req.lang or ""),
                "nv": normalization._PROMPT_NORMALIZE_VERSION,
                "nm": normalization._PROMPT_NORMALIZE_MODE,
                "recursive": recursive,
            }
            h = hashlib.sha1()
            h.update(
                json.dumps(
                    {"folders": folders, "params": cache_params}, ensure_ascii=False, sort_keys=True
                ).encode("utf-8")
            )
            cache_key = h.hexdigest()
            cached = TopicClusterCache.get(conn, cache_key)
            if (
                cached
                and int(cached.get("embeddings_count") or 0) == embeddings_count
                and str(cached.get("embeddings_max_updated_at") or "") == embeddings_max_updated_at
                and isinstance(cached.get("result"), dict)
            ):
                jobs._job_upsert(
                    job_id,
                    {
                        "status": "done",
                        "stage": "done",
                        "result": cached["result"],
                        "cache_hit": True,
                    },
                )
                return

            # Clustering + titling progress
            def _cluster_cb(p: dict) -> None:
                if not isinstance(p, dict):
                    return
                st = str(p.get("stage") or "")
                if st:
                    patch = {"stage": st, "status": "running"}
                    # keep small progress fields only
                    prog = {}
                    for k in [
                        "items_total",
                        "items_done",
                        "clusters_total",
                        "clusters_done",
                        "folder",
                    ]:
                        if k in p:
                            prog[k] = p.get(k)
                    if prog:
                        patch["progress"] = {
                            **(jobs._job_get(job_id) or {}).get("progress", {}),
                            **prog,
                        }
                    jobs._job_upsert(job_id, patch)

            res = await self.cluster_service.cluster(req, folders, progress_cb=_cluster_cb)
            try:
                TopicClusterCache.upsert(
                    conn,
                    cache_key=cache_key,
                    folders=folders,
                    model=model,
                    params=cache_params,
                    embeddings_count=embeddings_count,
                    embeddings_max_updated_at=embeddings_max_updated_at,
                    result=res,
                )
                conn.commit()
            except Exception:
                pass
            jobs._job_upsert(job_id, {"status": "done", "stage": "done", "result": res})
        except HTTPException as e:
            jobs._job_upsert(job_id, {"status": "error", "stage": "error", "error": str(e.detail)})
        except Exception as e:
            jobs._job_upsert(
                job_id, {"status": "error", "stage": "error", "error": f"{type(e).__name__}: {e}"}
            )
