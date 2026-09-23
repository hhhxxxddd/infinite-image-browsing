"""Local Qwen3-VL image retrieval and optional cross-encoder reranking."""

from __future__ import annotations

import heapq
import importlib.util
import json
import os
import re
import threading
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field

from scripts.iib.db.datamodel import DataBase, GlobalSetting, Image
from scripts.iib.db.search_filters import MediaSearchFilters
from scripts.iib.logger import logger
from scripts.iib.qwen_model_memory import inference_lock
from scripts.iib.tool import is_image_file

MODEL_IDS = {
    "embedding": "Qwen/Qwen3-VL-Embedding-2B",
    "reranker": "Qwen/Qwen3-VL-Reranker-2B",
}
MODEL_FILES = {
    "embedding": ("config.json", "preprocessor_config.json", "tokenizer_config.json", "scripts/qwen3_vl_embedding.py"),
    "reranker": ("config.json", "preprocessor_config.json", "tokenizer_config.json", "scripts/qwen3_vl_reranker.py"),
}
ENV_VARS = {
    "embedding": "IIB_QWEN3_VL_EMBEDDING_PATH",
    "reranker": "IIB_QWEN3_VL_RERANKER_PATH",
}
SETTING_KEYS = {
    "embedding": "qwen3_vl_embedding_path",
    "reranker": "qwen3_vl_reranker_path",
}
DEFAULT_BASE = Path.home() / ".cache" / "infinite-image-browsing" / "models"
INSTRUCTION = "Retrieve images or text relevant to the user's query."
IMAGE_SUFFIXES = (".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".avif", ".jpe")


def model_path(kind: str) -> Path:
    saved = GlobalSetting.get_setting(DataBase.get_conn(), SETTING_KEYS[kind])
    configured = saved if isinstance(saved, str) and saved else os.getenv(ENV_VARS[kind])
    return Path(os.path.expanduser(configured or str(DEFAULT_BASE / f"Qwen3-VL-{kind.title()}-2B"))).resolve()


def model_id(kind: str) -> str:
    name = model_path(kind).name
    if re.fullmatch(rf"Qwen3-VL-{kind.title()}-(?:2B|8B)", name):
        return "Qwen/" + name
    return MODEL_IDS[kind]


def weight_files(path: Path) -> list[Path]:
    single = path / "model.safetensors"
    if single.is_file():
        return [single]
    index = path / "model.safetensors.index.json"
    if not index.is_file():
        return []
    try:
        names = set(json.loads(index.read_text(encoding="utf-8"))["weight_map"].values())
    except (OSError, ValueError, KeyError, TypeError):
        return []
    files = [path / name for name in sorted(names)]
    return files if files and all(file.is_file() for file in files) else []


def readiness(kind: str) -> tuple[str, str]:
    path = model_path(kind)
    missing = [name for name in MODEL_FILES[kind] if not (path / name).is_file()]
    if not weight_files(path):
        missing.append("model.safetensors 或完整分片权重")
    if missing:
        return "missing_model", "模型目录缺少：" + "、".join(missing)
    packages = ("torch", "torchvision", "transformers", "numpy", "qwen_vl_utils") + (("scipy",) if kind == "reranker" else ())
    missing = [name for name in packages if importlib.util.find_spec(name) is None]
    if missing:
        return "missing_dependency", "缺少 Python 依赖：" + "、".join(missing)
    return "ready", ""


def model_key(kind: str) -> str:
    path = model_path(kind)
    weights = weight_files(path)
    if len(weights) == 1 and weights[0].name == "model.safetensors":
        weight = weights[0].stat()
        return f"{model_id(kind)}:{path}:{weight.st_size}:{weight.st_mtime_ns}"
    revisions = ":".join(f"{weight.name}:{weight.stat().st_size}:{weight.stat().st_mtime_ns}" for weight in weights)
    return f"{model_id(kind)}:{path}:{revisions}"


def _module(kind: str):
    filename = "qwen3_vl_embedding.py" if kind == "embedding" else "qwen3_vl_reranker.py"
    path = model_path(kind) / "scripts" / filename
    spec = importlib.util.spec_from_file_location(f"iib_{kind}_{path.stat().st_mtime_ns}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _Runtime:
    def __init__(self, kind: str):
        self.kind = kind
        self.lock = threading.RLock()
        self.key = ""
        self.engine = None

    def _load(self):
        key = model_key(self.kind)
        if self.key == key and self.engine is not None:
            return
        if self.engine is not None:
            self.clear()
        import torch

        module = _module(self.kind)
        cls = module.Qwen3VLEmbedder if self.kind == "embedding" else module.Qwen3VLReranker
        engine = cls(
            str(model_path(self.kind)),
            torch_dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32,
            local_files_only=True,
            max_pixels=512 * 512,
        )
        self.engine, self.key = engine, key

    def clear(self):
        with self.lock:
            if self.engine is None and not self.key:
                return
            self.engine = None
            self.key = ""
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except ImportError:
                pass

    def vector(self, value, image: bool):
        import numpy as np
        import torch

        with inference_lock, self.lock:
            from scripts.iib.qwen3_vl_instruct import release_loaded_model
            release_loaded_model()
            self._load()
            entry = {"image": value} if image else {"text": value, "instruction": INSTRUCTION}
            with torch.inference_mode():
                vector = self.engine.process([entry])[0].detach().float().cpu().numpy()
            norm = float(np.linalg.norm(vector))
            if not np.isfinite(norm) or norm == 0:
                raise ValueError("Qwen3-VL returned an invalid vector")
            return (vector / norm).astype("<f4", copy=False)

    def rerank(self, query: str, paths: list[str]) -> list[float]:
        import torch

        with inference_lock, self.lock:
            from scripts.iib.qwen3_vl_instruct import release_loaded_model
            release_loaded_model()
            self._load()
            with torch.inference_mode():
                return [float(score) for score in self.engine.process({
                    "instruction": INSTRUCTION,
                    "query": {"text": query},
                    "documents": [{"image": path} for path in paths],
                })]


_embedding = _Runtime("embedding")
_reranker = _Runtime("reranker")


def release_search_models():
    """Free both retrieval models before loading the generation model on a 16 GB GPU."""
    with inference_lock:
        _embedding.clear()
        _reranker.clear()
_job_lock = threading.Lock()
_job = {"running": False, "processed": 0, "total": 0, "failed": 0, "error": ""}


def _set_job(**changes):
    with _job_lock:
        _job.update(changes)


def _run_index(is_path_trusted):
    try:
        conn = DataBase.get_conn()
        key = model_key("embedding")
        rows = conn.execute("""SELECT image.id, image.path, q.model_key, q.mtime_ns, q.file_size
            FROM image LEFT JOIN image_qwen_visual_embedding AS q ON q.image_id = image.id
            ORDER BY image.id""").fetchall()
        candidates = []
        for image_id, path, saved_key, saved_mtime, saved_size in rows:
            if not is_image_file(path) or not is_path_trusted(path):
                continue
            try:
                stat = os.stat(path)
            except OSError:
                continue
            if (saved_key, saved_mtime, saved_size) != (key, stat.st_mtime_ns, stat.st_size):
                candidates.append((image_id, path))
        _set_job(total=len(candidates))
        if candidates:
            with inference_lock, _embedding.lock:
                from scripts.iib.qwen3_vl_instruct import release_loaded_model
                release_loaded_model()
                _embedding._load()
        for image_id, path in candidates:
            try:
                before = os.stat(path)
                vector = _embedding.vector(path, image=True)
                after = os.stat(path)
                if (before.st_mtime_ns, before.st_size) != (after.st_mtime_ns, after.st_size):
                    raise ValueError("File changed while indexing")
                with conn:
                    conn.execute("""INSERT INTO image_qwen_visual_embedding
                        (image_id, model_key, mtime_ns, file_size, dim, vec)
                        VALUES (?, ?, ?, ?, ?, ?)
                        ON CONFLICT(image_id) DO UPDATE SET model_key=excluded.model_key,
                        mtime_ns=excluded.mtime_ns, file_size=excluded.file_size,
                        dim=excluded.dim, vec=excluded.vec""",
                        (image_id, key, after.st_mtime_ns, after.st_size, len(vector), vector.tobytes()))
            except Exception as error:  # noqa: BLE001 - a corrupt image must not abort the batch
                logger.warning("Qwen3-VL indexing failed for %s: %s", path, error)
                with _job_lock:
                    _job["failed"] += 1
            finally:
                with _job_lock:
                    _job["processed"] += 1
    except Exception as error:  # noqa: BLE001 - report model/database failures in job status
        logger.exception("Qwen3-VL indexing failed")
        _set_job(error=str(error))
    finally:
        _set_job(running=False)
        if hasattr(DataBase.local, "conn"):
            DataBase.local.conn.close()
            del DataBase.local.conn


class SearchRequest(MediaSearchFilters):
    query: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=200, ge=1, le=500)
    rerank: bool = False
    rerank_limit: int = Field(default=20, ge=1, le=50)


class ConfigRequest(BaseModel):
    model_path: str = Field(max_length=2048)


def search_similar_images(req, query_image, is_path_trusted, excluded_path=None):
    """Use the existing Qwen image index for image-to-image retrieval."""
    state, detail = readiness("embedding")
    if state != "ready":
        raise HTTPException(503, detail=detail)
    import numpy as np
    try:
        vector = _embedding.vector(query_image, image=True)
    except Exception as error:
        logger.exception("Qwen3-VL image query failed")
        raise HTTPException(503, detail=f"Qwen3-VL 图片编码失败：{error}") from error
    conn = DataBase.get_conn()
    clauses, params = req.sql_conditions(conn)
    clauses.append("q.model_key = ?")
    params.append(model_key("embedding"))
    sql = """SELECT image.*, q.dim, q.vec, q.mtime_ns, q.file_size FROM image
        JOIN image_qwen_visual_embedding AS q ON q.image_id = image.id
        WHERE """ + " AND ".join(clauses)
    ranked = []
    checked = skipped = matched = 0
    excluded = os.path.normcase(os.path.realpath(excluded_path)) if excluded_path else None
    for row in conn.execute(sql, params):
        image = Image.from_row(row)
        if excluded and os.path.normcase(os.path.realpath(image.path)) == excluded:
            continue
        if not is_path_trusted(os.path.realpath(image.path)):
            continue
        try:
            stat = os.stat(image.path)
        except OSError:
            skipped += 1
            continue
        if (stat.st_mtime_ns, stat.st_size) != (row[9], row[10]):
            skipped += 1
            continue
        dim, blob = row[7], row[8]
        if dim != len(vector) or len(blob) != dim * 4:
            skipped += 1
            continue
        score = max(0.0, float(np.dot(vector, np.frombuffer(blob, dtype="<f4")))) * 100
        checked += 1
        if score < req.minimum:
            continue
        matched += 1
        item = (score, image.id, image)
        if len(ranked) < req.limit:
            heapq.heappush(ranked, item)
        elif item > ranked[0]:
            heapq.heapreplace(ranked, item)
    files = [{**image.to_file_info(), "similarity": round(score, 1)}
             for score, _, image in sorted(ranked, reverse=True)]
    return {"files": files, "matched": matched, "checked": checked,
            "skipped": skipped, "cached": 0, "method": "qwen"}


def mount_qwen3_vl_routes(app: FastAPI, db_api_base: str, verify_secret, write_permission_required,
                          is_path_trusted):
    @app.get(db_api_base + "/qwen3-vl/{kind}/status", dependencies=[Depends(verify_secret)])
    def status(kind: str):
        if kind not in MODEL_IDS:
            raise HTTPException(404)
        state, detail = readiness(kind)
        conn = DataBase.get_conn()
        saved = GlobalSetting.get_setting(conn, SETTING_KEYS[kind])
        result = {"state": state, "detail": detail, "model": model_id(kind),
                  "model_path": str(model_path(kind)), "config_source": "settings" if saved else "environment",
                  "download_url": "https://huggingface.co/" + model_id(kind)}
        if kind == "embedding":
            count = conn.execute("SELECT COUNT(*) FROM image WHERE " + " OR ".join(
                "lower(path) LIKE ?" for _ in IMAGE_SUFFIXES),
                tuple("%" + suffix for suffix in IMAGE_SUFFIXES)).fetchone()[0]
            key = model_key(kind) if state == "ready" else ""
            indexed = conn.execute("SELECT COUNT(*) FROM image_qwen_visual_embedding WHERE model_key = ?", (key,)).fetchone()[0]
            with _job_lock:
                job = dict(_job)
            result.update(image_count=count, indexed_count=indexed, **job)
        return result

    @app.put(db_api_base + "/qwen3-vl/{kind}/config", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def save_config(kind: str, req: ConfigRequest):
        if kind not in MODEL_IDS:
            raise HTTPException(404)
        value = req.model_path.strip()
        if value and not os.path.isabs(os.path.expanduser(value)):
            raise HTTPException(400, detail="请填写后端运行环境中的绝对目录路径")
        with _job_lock:
            if kind == "embedding" and _job["running"]:
                raise HTTPException(409, detail="正在建立索引，请完成后再修改模型目录")
        conn = DataBase.get_conn()
        runtime = _embedding if kind == "embedding" else _reranker
        runtime.clear()
        if value:
            GlobalSetting.save_setting(conn, SETTING_KEYS[kind], json.dumps(value))
        else:
            GlobalSetting.remove_setting(conn, SETTING_KEYS[kind])
        return {"model_path": str(model_path(kind))}

    @app.post(db_api_base + "/qwen3-vl/embedding/index", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def start_index():
        state, detail = readiness("embedding")
        if state != "ready":
            raise HTTPException(503, detail=detail)
        with _job_lock:
            if _job["running"]:
                return {"running": True}
            _job.update(running=True, processed=0, total=0, failed=0, error="")
        threading.Thread(target=_run_index, args=(is_path_trusted,), daemon=True, name="qwen3-vl-index").start()
        return {"running": True}

    @app.post(db_api_base + "/qwen3-vl/search", dependencies=[Depends(verify_secret)])
    def search(req: SearchRequest):
        for kind in ("embedding", "reranker") if req.rerank else ("embedding",):
            state, detail = readiness(kind)
            if state != "ready":
                raise HTTPException(503, detail=f"{model_id(kind)}：{detail}")
        query = req.query.strip()
        if not query:
            raise HTTPException(400, detail="请输入语义搜索内容")
        import numpy as np
        try:
            vector = _embedding.vector(query, image=False)
        except Exception as error:
            logger.exception("Qwen3-VL embedding model could not be loaded")
            raise HTTPException(503, detail=f"Qwen3-VL 检索模型加载失败：{error}") from error
        conn = DataBase.get_conn()
        clauses, params = req.sql_conditions(conn)
        clauses.append("q.model_key = ?")
        params.append(model_key("embedding"))
        sql = """SELECT image.*, q.dim, q.vec, q.mtime_ns, q.file_size FROM image
            JOIN image_qwen_visual_embedding AS q ON q.image_id = image.id
            WHERE """ + " AND ".join(clauses)
        ranked = []
        checked = 0
        pool_limit = min(req.limit, req.rerank_limit) if req.rerank else req.limit
        for row in conn.execute(sql, params):
            image = Image.from_row(row)
            if not is_path_trusted(image.path):
                continue
            try:
                stat = os.stat(image.path)
            except OSError:
                continue
            if (stat.st_mtime_ns, stat.st_size) != (row[9], row[10]):
                continue
            dim, blob = row[7], row[8]
            if dim != len(vector) or len(blob) != dim * 4:
                continue
            score = float(np.dot(vector, np.frombuffer(blob, dtype="<f4")))
            checked += 1
            item = (score, image.id, image)
            if len(ranked) < pool_limit:
                heapq.heappush(ranked, item)
            elif item > ranked[0]:
                heapq.heapreplace(ranked, item)
        ranked.sort(reverse=True)
        if req.rerank and ranked:
            try:
                scores = _reranker.rerank(query, [image.path for _, _, image in ranked])
                if len(scores) != len(ranked):
                    raise ValueError("重排分数数量与候选图片数量不符")
            except Exception as error:
                logger.exception("Qwen3-VL reranking failed")
                raise HTTPException(503, detail=f"Qwen3-VL 重排模型加载或推理失败：{error}") from error
            ranked = sorted(((score, image_id, image, float(rank_score))
                             for (score, image_id, image), rank_score in zip(ranked, scores)),
                            key=lambda item: (item[3], item[0], item[1]), reverse=True)
            files = [{**image.to_file_info(), "relevance": round(rank_score, 4),
                      "embedding_score": round(score, 4), "rerank_score": round(rank_score, 4)}
                     for score, _, image, rank_score in ranked]
        else:
            files = [{**image.to_file_info(), "relevance": round(score, 4),
                      "embedding_score": round(score, 4)} for score, _, image in ranked]
        return {"files": files, "checked": checked, "partial": _job["running"],
                "mode": "rerank" if req.rerank else "embedding", "candidate_limit": pool_limit}
