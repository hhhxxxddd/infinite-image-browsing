import asyncio
import hashlib
import json
import math
import os
import uuid
from array import array
from contextlib import closing

from fastapi import Depends, FastAPI, HTTPException

from omnigallery.ai.providers.marengo import is_marengo_model
from omnigallery.config import cwd
from omnigallery.infrastructure.database import Database
from omnigallery.search.cache_repository import TopicClusterCache
from omnigallery.search.topics import embedding_requests, jobs, normalization, schemas
from omnigallery.search.topics import vectors as vector_math
from omnigallery.search.topics.cluster_service import ClusteringService
from omnigallery.search.topics.configuration import TopicSearchConfig
from omnigallery.search.topics.embedding_service import EmbeddingService
from omnigallery.search.topics.job_service import ClusterJobService


def mount_topic_cluster_routes(
    app: FastAPI,
    api_base: str,
    verify_secret,
    write_permission_required,
    check_path_trust,
    *,
    openai_base_url: str,
    openai_api_key: str,
    embedding_model: str,
    ai_model: str,
    twelvelabs_api_key: str = "",
):
    """Mount embedding, clustering, and cluster-job endpoints."""
    config = TopicSearchConfig(
        openai_base_url, openai_api_key, embedding_model, ai_model, twelvelabs_api_key
    )
    embedding_service = EmbeddingService(config)
    cluster_service = ClusteringService(config)
    job_service = ClusterJobService(
        config, embedding_service, cluster_service, authorize_folder=check_path_trust
    )

    def authorize_requested_folders(req) -> None:
        """Reject forbidden paths before existence checks or background work."""
        for folder in req.folder_paths or []:
            if isinstance(folder, str) and folder.strip():
                check_path_trust(folder.strip())
        if isinstance(req.folder, str) and req.folder.strip():
            check_path_trust(req.folder.strip())

    def authorize_job_folders(job: dict) -> None:
        folders = job.get("folders") or (job.get("req") or {}).get("folder_paths") or []
        for folder in folders:
            check_path_trust(folder)

    @app.post(
        f"{api_base}/build_media_output_embeddings",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    async def build_media_output_embeddings(req: schemas.BuildMediaOutputEmbeddingRequest):
        folder = req.folder or os.path.join(cwd, "media_output")
        check_path_trust(folder)
        # Load the numerical runtime; HNSW acceleration is optional.
        vector_math._ensure_vector_dependencies()
        model = req.model or embedding_model
        if is_marengo_model(model):
            if not twelvelabs_api_key:
                raise HTTPException(status_code=500, detail="TwelveLabs API Key not configured")
        else:
            if not openai_api_key:
                raise HTTPException(status_code=500, detail="OpenAI API Key not configured")
            if not openai_base_url:
                raise HTTPException(status_code=500, detail="OpenAI Base URL not configured")
        batch_size = max(1, min(int(req.batch_size or 64), 256))
        max_chars = max(256, min(int(req.max_chars or 4000), 8000))
        force = bool(req.force)
        recursive = bool(req.recursive) if req.recursive is not None else True
        return await embedding_service.build_folder(
            folder=folder,
            model=model,
            force=force,
            batch_size=batch_size,
            max_chars=max_chars,
            recursive=recursive,
            progress_cb=None,
        )

    @app.post(
        f"{api_base}/cluster_media_output_cached",
        # Read-only: do NOT require write permission; only reads sqlite cache and folder mtimes.
        dependencies=[Depends(verify_secret)],
    )
    async def cluster_media_output_cached(req: schemas.ClusterMediaOutputRequest):
        """
        Return cached clustering result if exists, WITHOUT triggering embedding/clustering.
        Also returns a lightweight "stale" signal based on:
        - folders table modified_date changes (requires user to run refresh/index update)
        - embedding state changes (count / max(updated_at)) compared to cache metadata
        """
        authorize_requested_folders(req)
        folders = cluster_service.resolve_folders(req)
        model = req.model or embedding_model
        conn = Database.get_connection()

        cache_params = {
            "model": str(model),
            "threshold": float(req.threshold or 0.90),
            "min_cluster_size": int(req.min_cluster_size or 2),
            "assign_noise_threshold": req.assign_noise_threshold,
            "title_model": req.title_model,
            "lang": str(req.lang or ""),
            "nv": normalization._PROMPT_NORMALIZE_VERSION,
            "nm": normalization._PROMPT_NORMALIZE_MODE,
        }
        h = hashlib.sha1()
        h.update(
            json.dumps(
                {"folders": folders, "params": cache_params}, ensure_ascii=False, sort_keys=True
            ).encode("utf-8")
        )
        cache_key = h.hexdigest()

        cached = TopicClusterCache.get(conn, cache_key)
        folder_state = cluster_service.folder_cache_state(conn, folders)
        emb_state = cluster_service.embedding_state(conn, folders, model)

        embeddings_changed = False
        if cached:
            embeddings_changed = int(cached.get("embeddings_count") or 0) != int(
                emb_state["embeddings_count"]
            ) or str(cached.get("embeddings_max_updated_at") or "") != str(
                emb_state["embeddings_max_updated_at"]
            )

        stale = (
            bool(folder_state.get("folders_changed")) or bool(embeddings_changed) or (not cached)
        )
        return {
            "cache_key": cache_key,
            "cache_hit": bool(cached and isinstance(cached.get("result"), dict)),
            "cached_at": (cached or {}).get("updated_at") if cached else "",
            "result": (cached or {}).get("result") if cached else None,
            "stale": stale,
            "stale_reason": {
                **folder_state,
                "embeddings_changed": bool(embeddings_changed),
                "embeddings_count": int(emb_state["embeddings_count"]),
                "embeddings_max_updated_at": str(emb_state["embeddings_max_updated_at"]),
            },
        }

    @app.post(
        f"{api_base}/cluster_media_output_job_start",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    async def cluster_media_output_job_start(req: schemas.ClusterMediaOutputRequest):
        authorize_requested_folders(req)
        # Load the numerical runtime; HNSW acceleration is optional.
        vector_math._ensure_vector_dependencies()
        """
        Start a background job for embedding + clustering + LLM titling.
        Returns job_id immediately; frontend should poll job_status to show progress.
        """
        job_id = uuid.uuid4().hex
        jobs._job_upsert(
            job_id, {"status": "queued", "stage": "queued", "created_at": jobs._job_now()}
        )
        asyncio.create_task(job_service.run(job_id, req))
        return {"job_id": job_id}

    @app.get(
        f"{api_base}/cluster_media_output_job_status",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    async def cluster_media_output_job_status(job_id: str):
        j = jobs._job_get(job_id)
        if not j:
            raise HTTPException(status_code=404, detail="job not found")
        authorize_job_folders(j)
        return j

    @app.post(
        f"{api_base}/search_media_output_by_prompt",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    async def search_media_output_by_prompt(req: schemas.PromptSearchRequest):
        authorize_requested_folders(req)
        # Load the numerical runtime; HNSW acceleration is optional.
        vector_math._ensure_vector_dependencies()
        if is_marengo_model(req.model or embedding_model):
            if not twelvelabs_api_key:
                raise HTTPException(status_code=500, detail="TwelveLabs API Key not configured")
        else:
            if not openai_api_key:
                raise HTTPException(status_code=500, detail="OpenAI API Key not configured")
            if not openai_base_url:
                raise HTTPException(status_code=500, detail="OpenAI Base URL not configured")

        q = (req.query or "").strip()
        if not q:
            raise HTTPException(status_code=400, detail="query is required")

        folders: list[str] = []
        if req.folder_paths:
            for p in req.folder_paths:
                if isinstance(p, str) and p.strip():
                    folders.append(os.path.normpath(p.strip()))
        if req.folder and isinstance(req.folder, str) and req.folder.strip():
            folders.append(os.path.normpath(req.folder.strip()))
        # 用户不会用默认 media_output：未指定范围则直接报错
        if not folders:
            raise HTTPException(
                status_code=400, detail="folder_paths is required (select folders to search)"
            )

        # validate folders
        folders = list(dict.fromkeys(folders))  # de-dup keep order
        for f in folders:
            if not os.path.exists(f) or not os.path.isdir(f):
                raise HTTPException(status_code=400, detail=f"Folder not found: {f}")

        folder = folders[0]
        model = req.model or embedding_model
        top_k = max(1, min(int(req.top_k or 50), 500))
        min_score = float(req.min_score or 0.0)
        min_score = max(-1.0, min(min_score, 1.0))
        max_chars = max(256, min(int(req.max_chars or 4000), 8000))

        if bool(req.ensure_embed):
            for f in folders:
                await build_media_output_embeddings(
                    schemas.BuildMediaOutputEmbeddingRequest(
                        folder=f, model=model, force=False, batch_size=64, max_chars=max_chars
                    )
                )

        # Build query embedding
        q_text = normalization._extract_prompt_text(q, max_chars=max_chars)
        if normalization._PROMPT_NORMALIZE_ENABLED:
            q_text2 = normalization._clean_prompt_for_semantic(q_text)
            if q_text2:
                q_text = q_text2
        q_text = embedding_requests._truncate_for_embedding_tokens(
            q_text, embedding_requests._EMBEDDING_MAX_TOKENS_SOFT
        )
        vecs = await embedding_requests._call_embeddings(
            inputs=[q_text],
            model=model,
            base_url=openai_base_url,
            api_key=openai_api_key,
            tl_api_key=twelvelabs_api_key,
        )
        if not vecs or not isinstance(vecs[0], list) or not vecs[0]:
            raise HTTPException(status_code=502, detail="Embedding API returned empty vector")
        qv = array("f", [float(x) for x in vecs[0]])
        qn2 = vector_math._l2_norm_sq(qv)
        if qn2 <= 0:
            raise HTTPException(status_code=502, detail="Query embedding has zero norm")
        qinv = 1.0 / math.sqrt(qn2)
        for i in range(len(qv)):
            qv[i] *= qinv

        conn = Database.get_connection()
        like_prefixes = [os.path.join(f, "%") for f in folders]
        with closing(conn.cursor()) as cur:
            where = " OR ".join(["media.path LIKE ?"] * len(like_prefixes))
            cur.execute(
                f"""SELECT media.id, media.path, media.exif, media_embedding.vec
                    FROM media
                    INNER JOIN media_embedding ON media_embedding.media_id = media.id
                    WHERE ({where}) AND media_embedding.model = ?""",
                (*like_prefixes, model),
            )
            rows = cur.fetchall()

        # TopK by cosine similarity (brute force; MVP only)
        import heapq

        heap: list[tuple[float, int, dict]] = []
        heap_idx = 0
        total = 0
        for media_id, path, exif, vec_blob in rows:
            if not isinstance(path, str) or not os.path.exists(path):
                continue
            if not vec_blob:
                continue
            v = vector_math._blob_to_vec_f32(vec_blob)
            n2 = vector_math._l2_norm_sq(v)
            if n2 <= 0:
                continue
            inv = 1.0 / math.sqrt(n2)
            for i in range(len(v)):
                v[i] *= inv
            score = vector_math._dot(qv, v)
            total += 1
            if score < min_score:
                continue
            item = {
                "id": int(media_id),
                "path": path,
                "score": float(score),
                "sample_prompt": normalization._clean_for_title(
                    normalization._extract_prompt_text(exif, max_chars=max_chars)
                )[:200],
            }
            if len(heap) < top_k:
                heapq.heappush(heap, (score, heap_idx, item))
                heap_idx += 1
            else:
                if score > heap[0][0]:
                    heapq.heapreplace(heap, (score, heap_idx, item))
                    heap_idx += 1

        heap.sort(key=lambda x: x[0], reverse=True)
        results = [x[2] for x in heap]
        return {
            "query": q,
            "folder": folder,
            "folders": folders,
            "model": model,
            "count": total,
            "top_k": top_k,
            "results": results,
        }

    async def start_cluster_job_for_organize(
        folder_paths: list[str],
        threshold: float = 0.90,
        min_cluster_size: int = 2,
        lang: str = "en",
        recursive: bool = False,
        existing_folder_names: list[str] | None = None,
    ) -> str:
        """
        Start a cluster job and return job_id.
        This is a wrapper for organize_files to use.

        Args:
            existing_folder_names: List of folder names already in dest directory.
                                   AI will prefer reusing these names if theme matches.
        """
        for folder in folder_paths:
            check_path_trust(folder)
        vector_math._ensure_vector_dependencies()
        req = schemas.ClusterMediaOutputRequest(
            folder_paths=folder_paths,
            threshold=threshold,
            min_cluster_size=min_cluster_size,
            lang=lang,
            recursive=recursive,
            existing_folder_names=existing_folder_names,
        )
        job_id = uuid.uuid4().hex
        jobs._job_upsert(
            job_id, {"status": "queued", "stage": "queued", "created_at": jobs._job_now()}
        )
        asyncio.create_task(job_service.run(job_id, req))
        return job_id

    async def get_cluster_job_status_for_organize(job_id: str) -> dict:
        """
        Get cluster job status.
        This is a wrapper for organize_files to use.
        """
        j = jobs._job_get(job_id)
        if not j:
            return {"status": "not_found", "error": "job not found"}
        authorize_job_folders(j)
        return j

    return {
        "start_cluster_job": start_cluster_job_for_organize,
        "get_cluster_job_status": get_cluster_job_status_for_organize,
    }
