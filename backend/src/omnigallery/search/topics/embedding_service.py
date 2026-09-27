import asyncio
import os
from collections.abc import Callable
from contextlib import closing
from dataclasses import dataclass

from fastapi import HTTPException

from omnigallery.ai.providers.marengo import is_marengo_model
from omnigallery.infrastructure.database import Database
from omnigallery.infrastructure.logging import logger
from omnigallery.search.embedding_repository import MediaEmbedding, MediaEmbeddingFailure
from omnigallery.search.topics import embedding_requests, normalization
from omnigallery.search.topics import vectors as vector_math
from omnigallery.search.topics.configuration import TopicSearchConfig


@dataclass
class EmbeddingService:
    config: TopicSearchConfig

    async def build_folder(
        self,
        *,
        folder: str,
        model: str,
        force: bool,
        batch_size: int,
        max_chars: int,
        recursive: bool = True,
        progress_cb: Callable[[dict], None] | None = None,
    ) -> dict:
        """
        Build embeddings for a single folder with optional progress callback.
        Progress payload (best-effort):
        - stage: "embedding"
        - folder, scanned, to_embed, embedded_done, updated, skipped

        Args:
            recursive: If True, include files in subfolders.
        """
        logger.info("[build_embeddings] === build_folder START ===")
        logger.info(
            "[build_embeddings] folder=%s model=%s force=%s batch_size=%s max_chars=%s recursive=%s",
            folder,
            model,
            force,
            batch_size,
            max_chars,
            recursive,
        )

        if is_marengo_model(model):
            if not self.config.twelvelabs_api_key:
                logger.error("[build_embeddings] TwelveLabs API Key not configured")
                raise HTTPException(status_code=500, detail="TwelveLabs API Key not configured")
        else:
            if not self.config.openai_api_key:
                logger.error("[build_embeddings] OpenAI API Key not configured")
                raise HTTPException(status_code=500, detail="OpenAI API Key not configured")

            if not self.config.openai_base_url:
                logger.error("[build_embeddings] OpenAI Base URL not configured")
                raise HTTPException(status_code=500, detail="OpenAI Base URL not configured")

        logger.info("[build_embeddings] Configuration check passed")
        logger.info("[build_embeddings] API URL: %s", self.config.openai_base_url)

        folder = os.path.normpath(folder)
        logger.info("[build_embeddings] Normalized folder path: %s", folder)

        if not os.path.exists(folder) or not os.path.isdir(folder):
            logger.error("[build_embeddings] Folder not found: %s", folder)
            raise HTTPException(status_code=400, detail=f"Folder not found: {folder}")

        conn = Database.get_connection()
        like_prefix = os.path.join(folder, "%")
        with closing(conn.cursor()) as cur:
            cur.execute("SELECT id, path, exif FROM media WHERE path LIKE ?", (like_prefix,))
            rows = cur.fetchall()

        # Filter to direct children only if not recursive
        if not recursive:

            def is_direct_child(path: str) -> bool:
                parent_dir = os.path.dirname(path)
                return os.path.normpath(parent_dir) == os.path.normpath(folder)

            rows = [r for r in rows if is_direct_child(r[1])]
            logger.info("[build_embeddings] Filtered to direct children: %d files", len(rows))

        images = []
        for media_id, path, exif in rows:
            if not isinstance(path, str) or not os.path.exists(path):
                continue
            text_raw = normalization._extract_prompt_text(exif, max_chars=max_chars)
            if normalization._PROMPT_NORMALIZE_ENABLED:
                text = normalization._clean_prompt_for_semantic(text_raw)
                if not text:
                    text = text_raw
            else:
                text = text_raw
            # Some embedding models/providers have strict context limits (often 8192 tokens).
            # Apply a conservative truncation before sending to embedding API.
            text = embedding_requests._truncate_for_embedding_tokens(
                text, embedding_requests._EMBEDDING_MAX_TOKENS_SOFT
            )
            if not text:
                continue
            images.append({"id": int(media_id), "path": path, "text": text})

        if not images:
            if progress_cb:
                progress_cb(
                    {
                        "stage": "embedding",
                        "folder": folder,
                        "scanned": 0,
                        "to_embed": 0,
                        "embedded_done": 0,
                        "updated": 0,
                        "skipped": 0,
                    }
                )
            return {"folder": folder, "count": 0, "updated": 0, "skipped": 0, "model": model}

        id_list = [x["id"] for x in images]
        existing = MediaEmbedding.get_by_image_ids(conn, id_list)
        existing_fail = MediaEmbeddingFailure.get_by_image_ids(conn, id_list, model)

        to_embed = []
        skipped = 0
        skipped_failed = 0
        for item in images:
            # include normalize version to force refresh when rules change
            text_hash = MediaEmbedding.compute_text_hash(
                f"{normalization._PROMPT_NORMALIZE_VERSION}:{item['text']}"
            )
            old = existing.get(item["id"])
            old_fail = existing_fail.get(item["id"])
            if (
                (not force)
                and old
                and old.get("model") == model
                and old.get("text_hash") == text_hash
                and old.get("vec")
            ):
                skipped += 1
                continue
            # Skip known failures for the same model+text_hash (unless force is enabled).
            if (not force) and old_fail and str(old_fail.get("text_hash") or "") == text_hash:
                skipped_failed += 1
                continue
            to_embed.append({**item, "text_hash": text_hash})

        if progress_cb:
            progress_cb(
                {
                    "stage": "embedding",
                    "folder": folder,
                    "scanned": len(images),
                    "to_embed": len(to_embed),
                    "embedded_done": 0,
                    "updated": 0,
                    "skipped": skipped,
                    "skipped_failed": skipped_failed,
                    "failed": 0,
                }
            )

        updated = 0
        embedded_done = 0
        failed = 0
        batches = embedding_requests._batched_by_token_budget(
            to_embed,
            max_items=batch_size,
            max_tokens_sum=embedding_requests._EMBEDDING_REQUEST_MAX_TOKENS_SOFT,
        )
        for bi, batch in enumerate(batches):
            inputs = [x["text"] for x in batch]
            if embedding_requests._EMBEDDING_DEBUG:
                token_sum = sum(embedding_requests._estimate_tokens_soft(s) for s in inputs)
                token_max = max(
                    (embedding_requests._estimate_tokens_soft(s) for s in inputs), default=0
                )
                print(
                    f"[omnigallery][embed] folder={folder} batch={bi + 1}/{len(batches)} n={len(inputs)} token_sum~={token_sum} token_max~={token_max}"
                )
            try:
                logger.info(
                    "[build_embeddings] Calling embedding API for batch %d/%d, size=%d",
                    bi + 1,
                    len(batches),
                    len(inputs),
                )
                vectors = await embedding_requests._call_embeddings(
                    inputs=inputs,
                    model=model,
                    base_url=self.config.openai_base_url,
                    api_key=self.config.openai_api_key,
                    tl_api_key=self.config.twelvelabs_api_key,
                )
                logger.info(
                    "[build_embeddings] Embedding API success for batch %d/%d", bi + 1, len(batches)
                )
            except HTTPException as e:
                logger.error(
                    "[build_embeddings] Embedding API failed for batch %d/%d: %s",
                    bi + 1,
                    len(batches),
                    str(e.detail),
                )
                if (
                    "localhost" in self.config.openai_base_url
                    or "127.0.0.1" in self.config.openai_base_url
                ):
                    logger.error(
                        "[build_embeddings] Local API request failed, please check if Ollama is running: ollama serve"
                    )
                # Cache failures for this batch and continue (skip these images for now).
                err = str(e.detail)
                for it in batch:
                    try:
                        MediaEmbeddingFailure.upsert(
                            conn,
                            media_id=int(it["id"]),
                            model=str(model),
                            text_hash=str(it.get("text_hash") or ""),
                            error=err,
                        )
                    except Exception:
                        pass
                try:
                    conn.commit()
                except Exception:
                    pass
                failed += len(batch)
                if progress_cb:
                    progress_cb(
                        {
                            "stage": "embedding",
                            "folder": folder,
                            "scanned": len(images),
                            "to_embed": len(to_embed),
                            "embedded_done": embedded_done,
                            "updated": updated,
                            "skipped": skipped,
                            "skipped_failed": skipped_failed,
                            "failed": failed,
                            "batch_n": len(inputs),
                        }
                    )
                await asyncio.sleep(0)
                continue
            if len(vectors) != len(batch):
                raise HTTPException(status_code=500, detail="Embeddings count mismatch")
            for item, vec in zip(batch, vectors, strict=False):
                if vec is None:
                    # Marengo content filter: single prompt was rejected but the
                    # rest of the batch is fine. Record as a per-item failure.
                    try:
                        MediaEmbeddingFailure.upsert(
                            conn,
                            media_id=int(item["id"]),
                            model=str(model),
                            text_hash=str(item.get("text_hash") or ""),
                            error="Marengo returned empty embedding (token limit exceeded or content filtered)",
                        )
                    except Exception:
                        pass
                    failed += 1
                    embedded_done += 1
                    continue
                MediaEmbedding.upsert(
                    conn=conn,
                    media_id=item["id"],
                    model=model,
                    dim=len(vec),
                    text_hash=item["text_hash"],
                    vec_blob=vector_math._vec_to_blob_f32(vec),
                )
                # Success -> clear fail cache for this image+model (any old failure becomes irrelevant).
                try:
                    MediaEmbeddingFailure.delete(conn, media_id=int(item["id"]), model=str(model))
                except Exception:
                    pass
                updated += 1
                embedded_done += 1
            conn.commit()
            if progress_cb:
                progress_cb(
                    {
                        "stage": "embedding",
                        "folder": folder,
                        "scanned": len(images),
                        "to_embed": len(to_embed),
                        "embedded_done": embedded_done,
                        "updated": updated,
                        "skipped": skipped,
                        "skipped_failed": skipped_failed,
                        "failed": failed,
                        "batch_n": len(inputs),
                    }
                )
            # yield between batches
            await asyncio.sleep(0)

        return {
            "folder": folder,
            "count": len(images),
            "updated": updated,
            "skipped": skipped,
            "skipped_failed": skipped_failed,
            "failed": failed,
            "model": model,
        }
