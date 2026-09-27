import asyncio
import hashlib
import math
import os
from array import array
from collections.abc import Callable
from contextlib import closing
from dataclasses import dataclass
from sqlite3 import Connection

from fastapi import HTTPException

from omnigallery.ai.language import normalize_output_lang
from omnigallery.infrastructure.database import Database
from omnigallery.infrastructure.logging import logger
from omnigallery.search.cache_repository import TopicTitleCache
from omnigallery.search.topics import normalization, schemas, titles
from omnigallery.search.topics import vectors as vector_math
from omnigallery.search.topics.configuration import TopicSearchConfig


@dataclass
class ClusteringService:
    config: TopicSearchConfig

    def folder_cache_state(self, conn: Connection, folders: list[str]) -> dict:
        """
        Determine whether selected folders (and their subfolders) appear to have changed
        since last /api/update_image_data run.

        We use the existing `folders` table (Folder) which stores last observed modified_date.
        If any tracked folder's current modified_date differs, we treat cache as stale.
        If a selected root folder is missing from the table, treat as stale (not indexed yet).
        """
        try:
            from omnigallery.infrastructure.formatting import get_modified_date
        except Exception:
            # If imports fail for any reason, be conservative.
            return {"folders_changed": True, "reason": "folder_state_check_import_failed"}

        changed_path = ""
        # root folder missing in table => stale
        with closing(conn.cursor()) as cur:
            for f in folders:
                cur.execute("SELECT id, path, modified_date FROM folders WHERE path = ?", (str(f),))
                row = cur.fetchone()
                if not row:
                    return {"folders_changed": True, "reason": "folder_not_indexed", "path": str(f)}
        # check all known subfolders under each selected folder
        for f in folders:
            like_prefix = os.path.join(str(f), "%")
            with closing(conn.cursor()) as cur:
                cur.execute(
                    "SELECT path, modified_date FROM folders WHERE path = ? OR path LIKE ?",
                    (str(f), like_prefix),
                )
                rows = cur.fetchall() or []
            for p, stored in rows:
                p = str(p or "")
                if not p:
                    continue
                if not os.path.exists(p) or not os.path.isdir(p):
                    # path removed: treat as changed
                    changed_path = p
                    return {
                        "folders_changed": True,
                        "reason": "folder_missing",
                        "path": changed_path,
                    }
                cur_md = str(get_modified_date(p))
                if cur_md != str(stored or ""):
                    changed_path = p
                    return {
                        "folders_changed": True,
                        "reason": "folder_modified_date_changed",
                        "path": changed_path,
                        "stored": str(stored or ""),
                        "current": cur_md,
                    }
        return {"folders_changed": False}

    def embedding_state(self, conn: Connection, folders: list[str], model: str) -> dict:
        like_prefixes = [os.path.join(f, "%") for f in folders]
        with closing(conn.cursor()) as cur:
            where = " OR ".join(["media.path LIKE ?"] * len(like_prefixes))
            cur.execute(
                f"""SELECT COUNT(*), MAX(media_embedding.updated_at)
                    FROM media
                    INNER JOIN media_embedding ON media_embedding.media_id = media.id
                    WHERE ({where}) AND media_embedding.model = ?""",
                (*like_prefixes, str(model)),
            )
            row = cur.fetchone() or (0, "")
        return {
            "embeddings_count": int(row[0] or 0),
            "embeddings_max_updated_at": str(row[1] or ""),
        }

    def resolve_folders(self, req: schemas.ClusterMediaOutputRequest) -> list[str]:
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
                status_code=400, detail="folder_paths is required (select folders to cluster)"
            )
        folders = list(dict.fromkeys(folders))
        for f in folders:
            if not os.path.exists(f) or not os.path.isdir(f):
                raise HTTPException(status_code=400, detail=f"Folder not found: {f}")
        return folders

    async def cluster(
        self,
        req: schemas.ClusterMediaOutputRequest,
        folders: list[str],
        progress_cb: Callable[[dict], None] | None = None,
    ) -> dict:
        logger.info("[cluster_after] === cluster START ===")
        logger.info("[cluster_after] folders=%s", folders)

        folder = folders[0]
        model = req.model or self.config.embedding_model
        threshold = float(req.threshold or 0.90)
        threshold = max(0.0, min(threshold, 0.999))
        min_cluster_size = max(1, int(req.min_cluster_size or 2))
        title_model = req.title_model or os.getenv("TOPIC_TITLE_MODEL") or self.config.ai_model
        output_lang = normalize_output_lang(req.lang)
        assign_noise_threshold = req.assign_noise_threshold

        logger.info(
            "[cluster_after] model=%s threshold=%s min_cluster_size=%s",
            model,
            threshold,
            min_cluster_size,
        )
        logger.info("[cluster_after] title_model=%s output_lang=%s", title_model, output_lang)

        if assign_noise_threshold is None:
            assign_noise_threshold = max(0.88, min(threshold + 0.02, 0.97))
        else:
            assign_noise_threshold = max(0.0, min(float(assign_noise_threshold), 0.999))

        logger.info("[cluster_after] assign_noise_threshold=%s", assign_noise_threshold)

        use_title_cache = bool(True if req.use_title_cache is None else req.use_title_cache)
        force_title = bool(req.force_title)

        logger.info(
            "[cluster_after] use_title_cache=%s force_title=%s", use_title_cache, force_title
        )

        recursive = bool(req.recursive) if req.recursive is not None else False
        logger.info("[cluster_after] recursive=%s", recursive)

        # Extract existing folder names for AI to consider reusing
        existing_folder_names = req.existing_folder_names or []
        logger.info("[cluster_after] existing_folder_names count=%d", len(existing_folder_names))

        if progress_cb:
            logger.info("[cluster_after] Calling progress callback with clustering stage")
            progress_cb({"stage": "clustering", "folder": folder, "folders": folders})

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

        # Filter to direct children only if not recursive
        if not recursive:

            def is_direct_child(path: str, folders: list[str]) -> bool:
                for f in folders:
                    parent_dir = os.path.dirname(path)
                    if os.path.normpath(parent_dir) == os.path.normpath(f):
                        return True
                return False

            rows = [r for r in rows if is_direct_child(r[1], folders)]
            logger.info("[cluster_after] Filtered to direct children: %d files", len(rows))

        items = []
        for n, (media_id, path, exif, vec_blob) in enumerate(rows):
            if not isinstance(path, str) or not os.path.exists(path):
                continue
            if not vec_blob:
                continue
            vec = vector_math._blob_to_vec_f32(vec_blob)
            n2 = vector_math._l2_norm_sq(vec)
            if n2 <= 0:
                continue
            inv = 1.0 / math.sqrt(n2)
            for i in range(len(vec)):
                vec[i] *= inv
            text_raw = normalization._extract_prompt_text(
                exif, max_chars=int(req.max_chars or 4000)
            )
            if normalization._PROMPT_NORMALIZE_ENABLED:
                text = normalization._clean_prompt_for_semantic(text_raw)
                if not text:
                    text = text_raw
            else:
                text = text_raw
            items.append({"id": int(media_id), "path": path, "text": text, "vec": vec})
            if (n + 1) % 800 == 0:
                await asyncio.sleep(0)

        if not items:
            return {
                "folder": folder,
                "folders": folders,
                "model": model,
                "threshold": threshold,
                "clusters": [],
                "noise": [],
            }

        # Incremental clustering by centroid-direction (sum vector)
        clusters = []  # {sum, norm_sq, members:[idx], sample_text}
        ann_idx = None
        ann_centroids = None
        ann_rebuild_every = 256  # rebuild index periodically to reflect centroid updates
        ann_topk = 8
        for idx, it in enumerate(items):
            v = it["vec"]
            best_ci = -1
            best_sim = -1.0
            best_dot = 0.0
            # Build / rebuild ANN index when helpful (many clusters)
            if len(clusters) >= 64 and vector_math._has_hnsw_index():
                if ann_idx is None or (idx % ann_rebuild_every == 0):
                    # rebuild from current centroids
                    cents = []
                    for c in clusters:
                        cv = vector_math._centroid_vec_np(c["sum"], c["norm_sq"])
                        if cv is None:
                            # fallback to zeros; will never be nearest
                            cv = vector_math._np.zeros((len(v),), dtype=vector_math._np.float32)  # type: ignore
                        cents.append(cv)
                    ann_centroids = vector_math._np.stack(cents, axis=0).astype(
                        vector_math._np.float32
                    )  # type: ignore
                    ann_idx = vector_math._build_hnsw_index(ann_centroids)
                # Query candidates
                if ann_idx is not None:
                    q = (
                        vector_math._np.frombuffer(v.tobytes(), dtype=vector_math._np.float32)
                        .reshape(1, -1)
                        .copy()
                    )  # type: ignore
                    labels, _dists = ann_idx.knn_query(q, k=min(ann_topk, len(clusters)))
                    cand = [int(x) for x in (labels[0].tolist() if labels is not None else [])]
                else:
                    cand = list(range(len(clusters)))
            else:
                cand = list(range(len(clusters)))

            for ci in cand:
                c = clusters[ci]
                dotv = vector_math._dot(v, c["sum"])
                denom = math.sqrt(c["norm_sq"]) if c["norm_sq"] > 0 else 1.0
                sim = dotv / denom
                if sim > best_sim:
                    best_sim = sim
                    best_ci = ci
                    best_dot = dotv
            if best_ci != -1 and best_sim >= threshold:
                c = clusters[best_ci]
                for i in range(len(v)):
                    c["sum"][i] += v[i]
                c["norm_sq"] = c["norm_sq"] + 2.0 * best_dot + 1.0
                c["members"].append(idx)
            else:
                clusters.append(
                    {
                        "sum": array("f", v),
                        "norm_sq": 1.0,
                        "members": [idx],
                        "sample_text": it.get("text") or "",
                    }
                )
                ann_idx = None  # force rebuild after new cluster
            if (idx + 1) % 800 == 0:
                if progress_cb:
                    progress_cb(
                        {"stage": "clustering", "items_total": len(items), "items_done": idx + 1}
                    )
                await asyncio.sleep(0)

        # Merge highly similar clusters (fix: same theme split into multiple clusters)
        # IMPORTANT: keep this VERY strict; otherwise unrelated clusters can be merged.
        merge_threshold = min(0.999, max(threshold + 0.08, 0.965))
        merged = True
        while merged and len(clusters) > 1:
            merged = False
            best_i = best_j = -1
            best_sim = merge_threshold
            for i in range(len(clusters)):
                ci = clusters[i]
                for j in range(i + 1, len(clusters)):
                    cj = clusters[j]
                    sim = vector_math._cos_sum(ci["sum"], ci["norm_sq"], cj["sum"], cj["norm_sq"])
                    if sim >= best_sim:
                        best_sim = sim
                        best_i, best_j = i, j
            if best_i != -1:
                a = clusters[best_i]
                b = clusters[best_j]
                for k in range(len(a["sum"])):
                    a["sum"][k] += b["sum"][k]
                a["norm_sq"] = vector_math._l2_norm_sq(a["sum"])
                a["members"].extend(b["members"])
                if not a.get("sample_text"):
                    a["sample_text"] = b.get("sample_text", "")
                clusters.pop(best_j)
                merged = True
            await asyncio.sleep(0)

        # Reassign members from small clusters into best large cluster to reduce noise
        if min_cluster_size > 1 and assign_noise_threshold > 0 and clusters:
            large = [c for c in clusters if len(c["members"]) >= min_cluster_size]
            if large:
                new_large = []
                # copy large clusters first
                for c in clusters:
                    if len(c["members"]) >= min_cluster_size:
                        new_large.append(c)
                # Build ANN over large centroids once (optional)
                ann_large = None
                if len(new_large) >= 64 and vector_math._has_hnsw_index():
                    cents = []
                    for c in new_large:
                        cv = vector_math._centroid_vec_np(c["sum"], c["norm_sq"])
                        if cv is None:
                            cv = vector_math._np.zeros(
                                (len(items[0]["vec"]),), dtype=vector_math._np.float32
                            )  # type: ignore
                        cents.append(cv)
                    cent_mat = vector_math._np.stack(cents, axis=0).astype(vector_math._np.float32)  # type: ignore
                    ann_large = vector_math._build_hnsw_index(cent_mat, ef=64, M=32)
                # reassign items from small clusters
                for c in clusters:
                    if len(c["members"]) >= min_cluster_size:
                        continue
                    for mi in c["members"]:
                        v = items[mi]["vec"]
                        best_ci = -1
                        best_sim = -1.0
                        best_dot = 0.0
                        if ann_large is not None:
                            q = (
                                vector_math._np.frombuffer(
                                    v.tobytes(), dtype=vector_math._np.float32
                                )
                                .reshape(1, -1)
                                .copy()
                            )  # type: ignore
                            labels, _dists = ann_large.knn_query(q, k=min(8, len(new_large)))
                            cand = [
                                int(x) for x in (labels[0].tolist() if labels is not None else [])
                            ]
                        else:
                            cand = range(len(new_large))
                        for ci in cand:
                            bigc = new_large[ci]
                            dotv = vector_math._dot(v, bigc["sum"])
                            denom = math.sqrt(bigc["norm_sq"]) if bigc["norm_sq"] > 0 else 1.0
                            sim = dotv / denom
                            if sim > best_sim:
                                best_sim = sim
                                best_ci = ci
                                best_dot = dotv
                        if best_ci != -1 and best_sim >= assign_noise_threshold:
                            bigc = new_large[best_ci]
                            for k in range(len(v)):
                                bigc["sum"][k] += v[k]
                            bigc["norm_sq"] = bigc["norm_sq"] + 2.0 * best_dot + 1.0
                            bigc["members"].append(mi)
                        # else: keep in small cluster -> will become noise below
                    await asyncio.sleep(0)
                clusters = new_large

        # Split small clusters to noise, generate titles
        out_clusters = []
        noise = []
        if progress_cb:
            progress_cb({"stage": "titling", "clusters_total": len(clusters)})

        keyword_frequency: dict[str, int] = TopicTitleCache.get_all_keywords_frequency(conn, model)

        def _get_top_keywords() -> list[str]:
            if not keyword_frequency:
                return []
            sorted_keywords = sorted(keyword_frequency.items(), key=lambda x: x[1], reverse=True)
            return [k for k, v in sorted_keywords[:100]]

        # Separate clusters that need LLM title from those that are too small (noise)
        clusters_to_title = []
        for cidx, c in enumerate(clusters):
            if len(c["members"]) < min_cluster_size:
                for mi in c["members"]:
                    noise.append(items[mi]["path"])
            else:
                member_items = [items[mi] for mi in c["members"]]
                paths = [x["path"] for x in member_items]
                texts = [x.get("text") or "" for x in member_items]
                member_ids = [x["id"] for x in member_items]
                rep = (c.get("sample_text") or (texts[0] if texts else "")).strip()
                cluster_hash = self._cluster_sig(
                    member_ids=member_ids,
                    model=model,
                    threshold=threshold,
                    min_cluster_size=min_cluster_size,
                    title_model=title_model,
                    lang=output_lang,
                )
                clusters_to_title.append(
                    {
                        "cidx": cidx,
                        "paths": paths,
                        "texts": texts,
                        "rep": rep,
                        "cluster_hash": cluster_hash,
                    }
                )

        # Process LLM titles concurrently in batches
        LLM_CONCURRENCY = 5  # Number of concurrent LLM requests
        completed_count = [0]  # Use list for closure mutation

        async def process_cluster_title(cluster_info: dict) -> dict:
            cidx = cluster_info["cidx"]
            paths = cluster_info["paths"]
            texts = cluster_info["texts"]
            rep = cluster_info["rep"]
            cluster_hash = cluster_info["cluster_hash"]

            # Check cache first
            cached = None
            if use_title_cache and (not force_title):
                cached = TopicTitleCache.get(conn, cluster_hash)

            if cached and isinstance(cached, dict) and cached.get("title"):
                title = str(cached.get("title"))
                keywords = cached.get("keywords") or []
            else:
                top_keywords = _get_top_keywords()
                llm = await titles._call_chat_title(
                    base_url=self.config.openai_base_url,
                    api_key=self.config.openai_api_key,
                    model=title_model,
                    prompt_samples=[rep] + texts[:5],
                    output_lang=output_lang,
                    existing_keywords=top_keywords,
                    existing_folder_names=existing_folder_names,
                )
                title = (llm or {}).get("title")
                keywords = (llm or {}).get("keywords", [])
                if not title:
                    raise HTTPException(status_code=502, detail="Chat API returned empty title")
                if use_title_cache and title:
                    try:
                        TopicTitleCache.upsert(
                            conn, cluster_hash, str(title), list(keywords or []), str(title_model)
                        )
                        conn.commit()
                    except Exception:
                        pass

            # Update progress
            completed_count[0] += 1
            if progress_cb:
                progress_cb(
                    {
                        "stage": "titling",
                        "clusters_total": len(clusters_to_title),
                        "clusters_done": completed_count[0],
                    }
                )

            return {
                "id": f"topic_{cidx}",
                "title": title,
                "keywords": keywords,
                "size": len(paths),
                "paths": paths,
                "sample_prompt": normalization._clean_for_title(rep)[:200],
            }

        # Use semaphore to limit concurrency
        semaphore = asyncio.Semaphore(LLM_CONCURRENCY)

        async def process_with_semaphore(cluster_info: dict) -> dict:
            async with semaphore:
                return await process_cluster_title(cluster_info)

        # Run all title generations concurrently (limited by semaphore)
        if clusters_to_title:
            logger.info(
                f"[cluster_after] Processing {len(clusters_to_title)} clusters with concurrency={LLM_CONCURRENCY}"
            )
            tasks = [process_with_semaphore(c) for c in clusters_to_title]
            out_clusters = await asyncio.gather(*tasks)

            # Update keyword frequency from results
            for cluster in out_clusters:
                for kw in cluster.get("keywords") or []:
                    keyword_frequency[kw] = keyword_frequency.get(kw, 0) + 1

        out_clusters.sort(key=lambda x: x["size"], reverse=True)
        return {
            "folder": folder,
            "folders": folders,
            "count": len(items),
            "threshold": threshold,
            "min_cluster_size": min_cluster_size,
            "model": model,
            "assign_noise_threshold": assign_noise_threshold,
            "clusters": out_clusters,
            "noise": noise,
        }

    def _cluster_sig(
        self,
        *,
        member_ids: list[int],
        model: str,
        threshold: float,
        min_cluster_size: int,
        title_model: str,
        lang: str,
    ) -> str:
        h = hashlib.sha1()
        h.update(
            f"m={model}|t={threshold:.6f}|min={min_cluster_size}|tm={title_model}|lang={lang}|nv={normalization._PROMPT_NORMALIZE_VERSION}|nm={normalization._PROMPT_NORMALIZE_MODE}".encode()
        )
        for iid in sorted(member_ids):
            h.update(b"|")
            h.update(str(int(iid)).encode("utf-8"))
        return h.hexdigest()
