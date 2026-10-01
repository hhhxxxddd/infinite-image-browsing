"""Install and select Qwen3-VL Safetensors or pinned GGUF bundles."""

from __future__ import annotations

import json
import subprocess
import sys
import threading
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel

from omnigallery.ai.models import gguf_models, gguf_runtime
from omnigallery.ai.models import qwen_instruct as instruct
from omnigallery.ai.models.memory import inference_lock
from omnigallery.config import get_model_root, is_exe_ver
from omnigallery.infrastructure.database import Database
from omnigallery.infrastructure.network_proxy import (
    bundled_download_environment,
    download_environment,
)
from omnigallery.search import qwen as search
from omnigallery.storage.settings_repository import SettingsRepository

KINDS = ("embedding", "reranker", "instruct")
SIZES = ("2B", "8B")
_lock = threading.Lock()
_job = {"running": False, "kind": "", "size": "", "stage": "", "error": ""}


def repo_id(kind: str, size: str) -> str:
    name = f"Qwen3-VL-{kind.title()}-{size}" if kind != "instruct" else f"Qwen3-VL-{size}-Instruct"
    return f"Qwen/{name}"


def managed_root() -> Path:
    return get_model_root()


def managed_path(kind: str, size: str) -> Path:
    return managed_root() / repo_id(kind, size).split("/", 1)[1]


def current_path(kind: str) -> Path:
    return instruct.model_path() if kind == "instruct" else search.model_path(kind)


def registered_gguf_path(kind: str) -> Path:
    saved = SettingsRepository.get_setting(
        Database.get_connection(), f"qwen3_vl_{kind}_gguf_installed_path"
    )
    if isinstance(saved, str) and Path(saved).is_absolute():
        path = Path(saved)
        if model_files_ready(kind, path):
            return path
    return gguf_models.directory(managed_root(), kind)


def register_gguf(kind: str, path: Path):
    gguf_runtime.bundle(path, kind)
    SettingsRepository.save_setting(
        Database.get_connection(),
        f"qwen3_vl_{kind}_gguf_installed_path",
        json.dumps(str(path.resolve())),
    )


def model_files_ready(kind: str, path: Path) -> bool:
    if gguf_runtime.is_gguf(path):
        try:
            gguf_runtime.bundle(path, kind)
            return True
        except (OSError, ValueError, KeyError, TypeError):
            return False
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
    gguf_models_state = {}
    for kind in KINDS:
        active_path = current_path(kind)
        active_id = instruct.model_id() if kind == "instruct" else search.model_id(kind)
        entries = []
        for size in SIZES:
            expected = repo_id(kind, size)
            saved = managed_path(kind, size)
            use_current = (
                active_id == expected
                and not gguf_runtime.is_gguf(active_path)
                and model_files_ready(kind, active_path)
            )
            installed = use_current or model_files_ready(kind, saved)
            entries.append(
                {
                    "size": size,
                    "model": expected,
                    "installed": installed,
                    "active": use_current,
                    "path": str(active_path if use_current else saved),
                }
            )
        models[kind] = entries
        current_gguf = gguf_runtime.is_gguf(active_path) and model_files_ready(kind, active_path)
        saved = registered_gguf_path(kind)
        gguf_models_state[kind] = [
            {
                "size": "8B",
                "model": repo_id(kind, "8B"),
                "installed": current_gguf or model_files_ready(kind, saved),
                "active": current_gguf,
                "path": str(active_path if current_gguf else saved),
            }
        ]
    with _lock:
        job = dict(_job)
    return {
        "models": models,
        "gguf_models": gguf_models_state,
        "job": job,
        "managed_dir": str(managed_root()),
    }


def activate(kind: str, path: Path):
    with search._job_lock:
        if kind == "embedding" and search._job["running"]:
            raise HTTPException(409, "正在建立索引，请完成后再切换检索模型")
    with inference_lock, search._job_lock:
        if kind == "embedding" and search._job["running"]:
            raise HTTPException(409, "正在建立索引，请完成后再切换检索模型")
        if kind == "instruct":
            instruct._runtime.clear()
            setting_key = instruct.SETTING_KEY
        else:
            (search._embedding if kind == "embedding" else search._reranker).clear()
            setting_key = search.SETTING_KEYS[kind]
        SettingsRepository.save_setting(
            Database.get_connection(), setting_key, json.dumps(str(path))
        )


def _download(kind: str, size: str, path: Path):
    try:
        from huggingface_hub import snapshot_download
        from tqdm.auto import tqdm

        class FileProgress(tqdm):
            def update(self, n=1):
                result = super().update(n)
                if self.total:
                    with _lock:
                        _job["stage"] = (
                            f"下载中：{self.n}/{self.total} 个文件；大权重文件可能需要较长时间"
                        )
                return result

        with _lock:
            _job["stage"] = "正在从 Hugging Face 下载模型文件；大权重文件可能需要较长时间"
        path.parent.mkdir(parents=True, exist_ok=True)
        if is_exe_ver:
            with bundled_download_environment():
                snapshot_download(
                    repo_id=repo_id(kind, size),
                    local_dir=str(path),
                    max_workers=4,
                    tqdm_class=FileProgress,
                )
        else:
            result = subprocess.run(
                [
                    sys.executable,
                    str(Path(__file__).with_name("download_worker.py")),
                    repo_id(kind, size),
                    str(path),
                ],
                env=download_environment(),
                capture_output=True,
                text=True,
                check=False,
            )
            if result.returncode:
                raise RuntimeError(result.stderr.strip()[-500:] or "模型下载失败")
        if not model_files_ready(kind, path):
            raise RuntimeError("下载结束后模型文件仍不完整")
        with _lock:
            _job["stage"] = "正在选择模型"
        activate(kind, path)
        with _lock:
            _job["stage"] = "模型文件已下载并选中"
    except Exception as error:  # noqa: BLE001 - record the background job failure for the UI
        with _lock:
            _job["error"] = str(error)
            _job["stage"] = "模型下载失败；可重试以续传"
    finally:
        with _lock:
            _job["running"] = False


class ModelRequest(BaseModel):
    kind: Literal["embedding", "reranker", "instruct"]
    size: Literal["2B", "8B"]
    format: Literal["transformers", "gguf"] = "transformers"
    download_dir: str = ""
    model_path: str = ""


def _download_gguf(kind: str, path: Path):
    try:

        def progress(message):
            with _lock:
                _job["stage"] = message

        gguf_models.download(kind, path, progress)
        register_gguf(kind, path)
        activate(kind, path)
        with _lock:
            _job["stage"] = "GGUF 模型已下载并选中" + (
                "；检索模型需要重建图片索引" if kind == "embedding" else ""
            )
    except Exception as error:  # noqa: BLE001 - surface background failures in settings
        with _lock:
            _job.update(error=str(error), stage="GGUF 下载失败；可重试以续传")
    finally:
        with _lock:
            _job["running"] = False


def _validate_request(req: ModelRequest):
    if req.format == "gguf" and req.size != "8B":
        raise HTTPException(400, "GGUF 托管下载目前提供 Embedding / Reranker / Instruct 8B Q6_K")
    if req.download_dir and not Path(req.download_dir).expanduser().is_absolute():
        raise HTTPException(400, "下载目录必须是后端本机的绝对路径")
    if req.model_path:
        path = Path(req.model_path).expanduser()
        if req.format != "gguf":
            raise HTTPException(400, "自定义下载路径目前用于 GGUF 模型")
        if not path.is_absolute():
            raise HTTPException(400, "模型路径必须是后端本机的绝对路径")
        if path.suffix.lower() == ".gguf" or (path.exists() and not path.is_dir()):
            raise HTTPException(400, "下载时请填写模型目录；使用已有 GGUF 主文件请保存模型路径")


def mount_qwen_model_manager_routes(
    app: FastAPI, api_base: str, verify_secret, write_permission_required
):
    @app.get(api_base + "/qwen-models", dependencies=[Depends(verify_secret)])
    def get_models():
        return options()

    @app.post(
        api_base + "/qwen-models/select",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def select_model(req: ModelRequest):
        _validate_request(req)
        with _lock:
            if _job["running"]:
                raise HTTPException(409, detail="模型下载进行中，请稍后切换")
        group = "gguf_models" if req.format == "gguf" else "models"
        match = next(item for item in options()[group][req.kind] if item["size"] == req.size)
        if not match["installed"]:
            raise HTTPException(404, detail="该模型尚未安装，请先下载")
        activate(req.kind, Path(match["path"]))
        return options()

    @app.post(
        api_base + "/qwen-models/install",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def install_model(req: ModelRequest):
        _validate_request(req)
        with _lock:
            if _job["running"]:
                raise HTTPException(409, detail="已有模型正在下载")
            _job.update(running=True, kind=req.kind, size=req.size, stage="准备下载", error="")
        if req.format == "gguf":
            root = (
                Path(req.download_dir).expanduser().resolve()
                if req.download_dir
                else managed_root()
            )
            path = (
                Path(req.model_path).expanduser().resolve()
                if req.model_path
                else gguf_models.directory(root, req.kind)
            )
            threading.Thread(target=_download_gguf, args=(req.kind, path), daemon=True).start()
        else:
            path = managed_path(req.kind, req.size)
            threading.Thread(target=_download, args=(req.kind, req.size, path), daemon=True).start()
        return options()
