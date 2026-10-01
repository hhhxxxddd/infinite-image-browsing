"""Install a pinned native runtime and resolve local multimodal GGUF bundles."""

from __future__ import annotations

import json
import os
import platform
import re
import shutil
import subprocess
import threading
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel

from omnigallery.ai.models import desktop_runtime
from omnigallery.config import DATA_ROOT
from omnigallery.infrastructure.artifact_download import download

RUNTIME_ROOT = DATA_ROOT / "gguf-runtime"
RECIPE = "llama-b11146-qwen-vl-1"
PROTOCOL = "qwen-vl-gguf-v1-last"
RELEASE_URL = "https://github.com/ggml-org/llama.cpp/releases/download/b11146/"
ARCHIVES = {
    "cpu": [
        (
            "llama-b11146-bin-win-cpu-x64.zip",
            "14cf1303ca9ac3abd94816850532f9f9a69ac66fbaca3776fc6f9061c2fac1d1",
            18560055,
        )
    ],
    "cuda": [
        (
            "llama-b11146-bin-win-cuda-12.4-x64.zip",
            "3c806a6ceccc3dae1c743ceb1a1fb2cce5b76f40bfbd4c6b7b8afb6ef45a5807",
            253869799,
        ),
        (
            "cudart-llama-bin-win-cuda-12.4-x64.zip",
            "8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6",
            391443627,
        ),
    ],
}
_lock = threading.RLock()
_job = {"running": False, "stage": "", "progress": 0, "error": ""}


@dataclass(frozen=True)
class Bundle:
    model: Path
    projector: Path
    kind: str

    def key(self) -> str:
        # Vision weights and preprocessing are part of the vector space, too.
        revisions = ":".join(
            f"{path}:{path.stat().st_size}:{path.stat().st_mtime_ns}"
            for path in (self.model, self.projector)
        )
        return f"{PROTOCOL}:{engine_revision()}:{self.kind}:{revisions}"


def is_gguf(path: Path) -> bool:
    return path.suffix.lower() == ".gguf" or (
        path.is_dir() and ((path / "gguf-model.json").exists() or any(path.glob("*.gguf")))
    )


def bundle(path: Path, kind: str) -> Bundle:
    """Accept a managed manifest, or an unambiguous model/projector pair."""
    directory = path if path.is_dir() else path.parent
    manifest = directory / "gguf-model.json"
    if path.is_dir() and manifest.is_file():
        data = json.loads(manifest.read_text(encoding="utf-8"))
        if data.get("kind") != kind:
            raise ValueError("模型用途不匹配，请选择对应的 Embedding、Reranker 或 Instruct 目录")
        names = [data.get("model_file"), data.get("projector_file")]
        if any(not isinstance(n, str) or Path(n).name != n for n in names):
            raise ValueError("GGUF 清单中的文件名不合法")
        main, projector = (directory / name for name in names)
    else:
        files = list(directory.glob("*.gguf"))
        projectors = [p for p in files if "mmproj" in p.name.lower()]
        models = [p for p in files if p not in projectors]
        if path.suffix.lower() == ".gguf":
            models = [path]
        if len(models) != 1 or len(projectors) != 1:
            raise ValueError(
                "目录应包含一个主模型和一个配套 mmproj；多个文件时请提供 gguf-model.json"
            )
        main, projector = models[0], projectors[0]
    for file in (main, projector):
        if file.suffix.lower() != ".gguf" or not file.is_file():
            raise ValueError(f"缺少 GGUF 文件：{file.name}")
        with file.open("rb") as source:
            if source.read(4) != b"GGUF":
                raise ValueError(f"不是有效的 GGUF 文件：{file.name}")
    if main.resolve() == projector.resolve():
        raise ValueError("主模型和视觉文件不能是同一个文件")
    return Bundle(main.resolve(), projector.resolve(), kind)


def supported() -> bool:
    return os.name == "nt" and platform.machine().lower() in {"amd64", "x86_64"}


def active_runtime() -> Path | None:
    try:
        name = json.loads((RUNTIME_ROOT / "active.json").read_text(encoding="utf-8"))["directory"]
        if not isinstance(name, str) or not re.fullmatch(r"[0-9a-f]{32}", name):
            return None
        path = RUNTIME_ROOT / name
        return path if (path / "bin/llama-server.exe").is_file() else None
    except (OSError, ValueError, KeyError, TypeError):
        return None


def binary() -> str | None:
    override = os.getenv("OMNIGALLERY_LLAMA_SERVER", "")
    if override:
        path = Path(override).expanduser()
        return str(path.resolve()) if path.is_absolute() and path.is_file() else None
    path = active_runtime()
    if path:
        return str(path / "bin/llama-server.exe")
    return shutil.which("llama-server")


def readiness(path: Path, kind: str) -> tuple[str, str]:
    try:
        bundle(path, kind)
    except (OSError, ValueError, KeyError, TypeError) as error:
        return "missing_model", str(error)
    if not binary():
        return "missing_dependency", "GGUF 文件已就绪；请在运行环境安装 GGUF 引擎"
    return "ready", "GGUF · 应用自动管理本地进程"


def engine_revision() -> str:
    executable = binary()
    managed = active_runtime()
    if managed and executable and Path(executable).parent == managed / "bin":
        try:
            value = json.loads((managed / "manifest.json").read_text(encoding="utf-8"))["recipe"]
            return value if isinstance(value, str) else RECIPE
        except (OSError, ValueError, KeyError, TypeError):
            return RECIPE
    if executable:
        try:
            stat = Path(executable).stat()
            return f"external:{stat.st_size}:{stat.st_mtime_ns}"
        except OSError:
            pass
    return "uninstalled"


def probe(executable: str) -> str:
    with desktop_runtime.external_dll_search():
        result = subprocess.run(
            [executable, "--version"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
            check=True,
            **desktop_runtime.process_options(),
        )
    return (result.stdout + result.stderr).strip()[-1200:]


def status() -> dict:
    path = active_runtime()
    manifest = {}
    if path:
        try:
            manifest = json.loads((path / "manifest.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
    with _lock:
        return {
            "supported": supported(),
            "installed": bool(binary()),
            "path": binary() or "",
            "recipe": RECIPE,
            "variant": manifest.get("variant", ""),
            "update_available": bool(path and manifest.get("recipe") != RECIPE),
            "job": dict(_job),
        }


def prepare_runtime(path: Path, variant: str):
    for i, (name, checksum, size) in enumerate(ARCHIVES[variant]):
        with _lock:
            _job.update(stage=f"下载 GGUF 引擎：{name}", progress=10 + i * 35)
        archive = RUNTIME_ROOT / "downloads" / name

        def progress(done, total, name=name, i=i):
            with _lock:
                _job.update(
                    stage=f"下载 GGUF 引擎：{name} · {done * 100 // total}%",
                    progress=10 + i * 35 + done * 35 // total,
                )

        download(RELEASE_URL + name, archive, size, checksum, progress, parallel=True)
        desktop_runtime.unpack(archive, path / "bin")
    server = next((path / "bin").rglob("llama-server.exe"))
    if server.parent != path / "bin":
        # Archives may use a single wrapper directory. Keep the DLLs together.
        for file in server.parent.iterdir():
            if file.is_file():
                shutil.copy2(file, path / "bin" / file.name)
    version = probe(str(path / "bin/llama-server.exe"))
    (path / "manifest.json").write_text(
        json.dumps({"recipe": RECIPE, "variant": variant, "version": version}, ensure_ascii=False),
        encoding="utf-8",
    )


def install(variant: str):
    stage = RUNTIME_ROOT / uuid.uuid4().hex
    try:
        stage.mkdir(parents=True)
        prepare_runtime(stage, variant)
        from omnigallery.ai.models.gguf_client import client
        from omnigallery.ai.models.memory import inference_lock

        with inference_lock:
            client.close()
            pointer = RUNTIME_ROOT / "active.tmp"
            pointer.write_text(json.dumps({"directory": stage.name}), encoding="utf-8")
            pointer.replace(RUNTIME_ROOT / "active.json")
        with _lock:
            _job.update(stage="GGUF 引擎已安装", progress=100)
    except Exception as error:  # noqa: BLE001 - background job reports errors to settings
        with _lock:
            _job.update(error=str(error), stage="安装失败；原运行环境仍可使用")
        # Only remove this owned UUID staging directory, never the active runtime.
        if stage.parent.resolve() == RUNTIME_ROOT.resolve() and stage != active_runtime():
            shutil.rmtree(stage, ignore_errors=True)
    finally:
        with _lock:
            _job["running"] = False


class InstallRequest(BaseModel):
    variant: Literal["cpu", "cuda"] = "cuda"


def mount_gguf_runtime_routes(
    app: FastAPI, api_base: str, verify_secret, write_permission_required
):
    @app.get(api_base + "/gguf-runtime", dependencies=[Depends(verify_secret)])
    def get_status():
        return status()

    @app.post(
        api_base + "/gguf-runtime/install",
        dependencies=[
            Depends(verify_secret),
            Depends(write_permission_required),
        ],
    )
    def install_runtime(req: InstallRequest):
        if not supported():
            raise HTTPException(
                400, "自动安装目前支持 Windows x64；其他系统可配置 llama-server 路径"
            )
        with _lock:
            if _job["running"]:
                raise HTTPException(409, "GGUF 引擎正在安装")
            _job.update(running=True, stage="准备安装", progress=0, error="")
        threading.Thread(target=install, args=(req.variant,), daemon=True).start()
        return status()

    @app.post(
        api_base + "/gguf-runtime/check",
        dependencies=[
            Depends(verify_secret),
            Depends(write_permission_required),
        ],
    )
    def check_runtime():
        executable = binary()
        if not executable:
            raise HTTPException(400, "尚未安装 GGUF 引擎")
        try:
            version = probe(executable)
        except (OSError, subprocess.SubprocessError) as error:
            raise HTTPException(400, f"GGUF 引擎检查失败：{error}") from error
        return {**status(), "version": version}
