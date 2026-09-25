"""Install and select official Qwen3-VL models in a persistent writable directory."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel

from scripts.iib import qwen3_vl_instruct as instruct
from scripts.iib import qwen3_vl_search as search
from scripts.iib.db.datamodel import DataBase, GlobalSetting
from scripts.iib.network_proxy import bundled_download_environment, download_environment
from scripts.iib.qwen_model_memory import inference_lock
from scripts.iib.tool import is_exe_ver

KINDS = ("embedding", "reranker", "instruct")
SIZES = ("2B", "8B")
_lock = threading.Lock()
_job = {"running": False, "kind": "", "size": "", "stage": "", "error": ""}


def repo_id(kind: str, size: str) -> str:
    name = f"Qwen3-VL-{kind.title()}-{size}" if kind != "instruct" else f"Qwen3-VL-{size}-Instruct"
    return f"Qwen/{name}"


def managed_root() -> Path:
    return Path(os.path.expanduser(os.getenv("IIB_MODEL_DIR") or
                str(Path.home() / ".cache" / "infinite-image-browsing" / "models"))).resolve()


def managed_path(kind: str, size: str) -> Path:
    return managed_root() / repo_id(kind, size).split("/", 1)[1]


def current_path(kind: str) -> Path:
    return instruct.model_path() if kind == "instruct" else search.model_path(kind)


def model_files_ready(kind: str, path: Path) -> bool:
    required = instruct.MODEL_FILES if kind == "instruct" else search.MODEL_FILES[kind]
    if not all((path / name).is_file() for name in required):
        return False
    if kind != "instruct":
        return bool(search.weight_files(path))
    if (path / "model.safetensors").is_file():
        return True
    index = path / "model.safetensors.index.json"
    if not index.is_file():
        return False
    try:
        shards = set(json.loads(index.read_text(encoding="utf-8"))["weight_map"].values())
        return bool(shards) and all((path / name).is_file() for name in shards)
    except (OSError, ValueError, KeyError, TypeError):
        return False


def options() -> dict:
    models = {}
    for kind in KINDS:
        active_path = current_path(kind)
        active_id = instruct.model_id() if kind == "instruct" else search.model_id(kind)
        entries = []
        for size in SIZES:
            expected = repo_id(kind, size)
            saved = managed_path(kind, size)
            use_current = active_id == expected and model_files_ready(kind, active_path)
            installed = use_current or model_files_ready(kind, saved)
            entries.append({"size": size, "model": expected, "installed": installed,
                            "active": use_current, "path": str(active_path if use_current else saved)})
        models[kind] = entries
    with _lock:
        job = dict(_job)
    return {"models": models, "job": job, "managed_dir": str(managed_root())}


def activate(kind: str, path: Path):
    with inference_lock:
        if kind == "instruct":
            instruct._runtime.clear()
            setting_key = instruct.SETTING_KEY
        else:
            (search._embedding if kind == "embedding" else search._reranker).clear()
            setting_key = search.SETTING_KEYS[kind]
        GlobalSetting.save_setting(DataBase.get_conn(), setting_key, json.dumps(str(path)))


def _download(kind: str, size: str, path: Path):
    try:
        from huggingface_hub import snapshot_download
        from tqdm.auto import tqdm

        class FileProgress(tqdm):
            def update(self, n=1):
                result = super().update(n)
                if self.total:
                    with _lock:
                        _job["stage"] = f"下载中：{self.n}/{self.total} 个文件；大权重文件可能需要较长时间"
                return result

        with _lock:
            _job["stage"] = "正在从 Hugging Face 下载模型文件；大权重文件可能需要较长时间"
        path.parent.mkdir(parents=True, exist_ok=True)
        if is_exe_ver:
            with bundled_download_environment():
                snapshot_download(repo_id=repo_id(kind, size), local_dir=str(path), max_workers=4,
                                  tqdm_class=FileProgress)
        else:
            result = subprocess.run(
                [sys.executable, str(Path(__file__).with_name("qwen_download_worker.py")),
                 repo_id(kind, size), str(path)],
                env=download_environment(), capture_output=True, text=True, check=False,
            )
            if result.returncode:
                raise RuntimeError(result.stderr.strip()[-500:] or "模型下载失败")
        if not model_files_ready(kind, path):
            raise RuntimeError("下载结束后模型文件仍不完整")
        with _lock:
            _job["stage"] = "正在启用模型"
        activate(kind, path)
        with _lock:
            _job["stage"] = "安装完成"
    except Exception as error:  # noqa: BLE001 - record the background job failure for the UI
        with _lock:
            _job["error"] = str(error)
            _job["stage"] = "安装失败；可重试以续传"
    finally:
        with _lock:
            _job["running"] = False


class ModelRequest(BaseModel):
    kind: Literal["embedding", "reranker", "instruct"]
    size: Literal["2B", "8B"]


def mount_qwen_model_manager_routes(app: FastAPI, db_api_base: str, verify_secret, write_permission_required):
    @app.get(db_api_base + "/qwen-models", dependencies=[Depends(verify_secret)])
    def get_models():
        return options()

    @app.post(db_api_base + "/qwen-models/select", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def select_model(req: ModelRequest):
        with _lock:
            if _job["running"]:
                raise HTTPException(409, detail="模型下载进行中，请稍后切换")
        match = next(item for item in options()["models"][req.kind] if item["size"] == req.size)
        if not match["installed"]:
            raise HTTPException(404, detail="该模型尚未安装，请先下载")
        activate(req.kind, Path(match["path"]))
        return options()

    @app.post(db_api_base + "/qwen-models/install", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def install_model(req: ModelRequest):
        with _lock:
            if _job["running"]:
                raise HTTPException(409, detail="已有模型正在下载")
            _job.update(running=True, kind=req.kind, size=req.size, stage="准备下载", error="")
        path = managed_path(req.kind, req.size)
        threading.Thread(target=_download, args=(req.kind, req.size, path), daemon=True).start()
        return options()
