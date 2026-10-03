"""Transactional, application-owned AI runtime for Windows source and desktop builds."""

from __future__ import annotations

import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import threading
import uuid
import zipfile
from contextlib import contextmanager
from pathlib import Path
from typing import Literal

import requests
from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel

from omnigallery.config import DATA_ROOT, RESOURCE_ROOT, is_exe_ver
from omnigallery.infrastructure.network_proxy import download_environment, requests_proxy_kwargs

RUNTIME_ROOT = DATA_ROOT / "ai-runtime"
RECIPE = "qwen-2026.10.1-python3.14.8"
PYTHON_URL = "https://www.python.org/ftp/python/3.14.8/python-3.14.8-embed-amd64.zip"
PYTHON_SHA256 = "a93abe456ab01bd96d7a085b3cdb6566b3063f4241360d114142fbdb07f0a310"
PIP_URL = "https://files.pythonhosted.org/packages/69/00/5ac7aa77688ec4d34148b423d34dc0c9bc4febe0d872a9a1ad9860b2f6f1/pip-26.0-py3-none-any.whl"
PIP_SHA256 = "98436feffb9e31bc9339cf369fd55d3331b1580b6a6f1173bacacddcf9c34754"
PACKAGES = [
    "transformers==4.57.6",
    "qwen-vl-utils==0.0.14",
    "scipy==1.18.1",
    "accelerate==1.12.0",
    "bitsandbytes==0.49.2",
]
_lock = threading.RLock()
_job = {"running": False, "stage": "", "error": "", "progress": 0}
_checked: dict = {}
_spawn_lock = threading.Lock()


@contextmanager
def external_dll_search():
    """Undo PyInstaller's inherited DLL path only while starting external Python."""
    if not is_exe_ver or os.name != "nt":
        yield
        return
    import ctypes

    with _spawn_lock:
        kernel = ctypes.windll.kernel32
        buffer = ctypes.create_unicode_buffer(32768)
        kernel.GetDllDirectoryW(len(buffer), buffer)
        kernel.SetDllDirectoryW(None)
        try:
            yield
        finally:
            kernel.SetDllDirectoryW(buffer.value or None)


def supported() -> bool:
    return os.name == "nt" and platform.machine().lower() in {"amd64", "x86_64"}


def uses_managed_runtime() -> bool:
    # Source builds keep their current interpreter until an isolated environment is installed.
    return is_exe_ver or (supported() and active_runtime() is not None)


def worker_source(name: str) -> Path:
    return RESOURCE_ROOT / "ai-worker" / name if is_exe_ver else Path(__file__).with_name(name)


def active_runtime() -> Path | None:
    try:
        name = (RUNTIME_ROOT / "active.json").read_text(encoding="utf-8")
        name = json.loads(name)["directory"]
        if (
            not isinstance(name, str)
            or len(name) != 32
            or any(c not in "0123456789abcdef" for c in name)
        ):
            return None
        path = RUNTIME_ROOT / name
        return path if (path / "python.exe").is_file() else None
    except (OSError, ValueError, KeyError, TypeError):
        return None


def process_options() -> dict:
    # Never inherit the frozen app's Python/DLL search paths into real Python.
    env = download_environment()
    for name in list(env):
        if name.startswith(("PYTHON", "_PYI", "PIP_")) or name in {
            "VIRTUAL_ENV",
            "LD_LIBRARY_PATH",
        }:
            env.pop(name, None)
    env.update(
        PYTHONIOENCODING="utf-8", PIP_CONFIG_FILE=os.devnull, PIP_DISABLE_PIP_VERSION_CHECK="1"
    )
    return {"env": env, "creationflags": subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0}


def probe(path: Path) -> dict:
    with external_dll_search():
        process = subprocess.Popen(
            [str(path / "python.exe"), "-I", str(path / "worker/runtime_worker.py")],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            **process_options(),
        )
    try:
        stdout, stderr = process.communicate('{"action":"check"}\n', timeout=180)
    except subprocess.TimeoutExpired:
        process.kill()
        process.communicate()
        raise RuntimeError("运行环境检查超时") from None
    if process.returncode:
        raise RuntimeError(stderr[-1200:] or "运行环境检查失败")
    reply = json.loads(stdout)
    if reply.get("error"):
        raise RuntimeError(reply["error"])
    return reply["result"]


def status() -> dict:
    path = active_runtime()
    ensure_checked()
    manifest = {}
    if path:
        try:
            manifest = json.loads((path / "manifest.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
    with _lock:
        return {
            "supported": supported(),
            "installed": bool(path),
            "path": str(path or RUNTIME_ROOT),
            "source": "managed" if path else "missing" if is_exe_ver else "python",
            "python_path": str(path / "python.exe")
            if path
            else ""
            if is_exe_ver
            else sys.executable,
            "recipe": RECIPE,
            "update_available": bool(path) and manifest.get("recipe") != RECIPE,
            "variant": (_job.get("variant") if _job["running"] else None)
            or manifest.get("variant", "cu128"),
            "check": dict(_checked),
            "job": dict(_job),
        }


def _progress(stage: str, progress: int):
    with _lock:
        _job.update(stage=stage, progress=progress)


def download(url: str, checksum: str, destination: Path):
    digest = hashlib.sha256()
    with requests.get(url, stream=True, timeout=(20, 90), **requests_proxy_kwargs()) as response:
        response.raise_for_status()
        with destination.open("wb") as output:
            for chunk in response.iter_content(1024 * 1024):
                digest.update(chunk)
                output.write(chunk)
    if digest.hexdigest() != checksum:
        raise RuntimeError("运行环境下载校验失败，请重试")


def unpack(archive: Path, destination: Path):
    with zipfile.ZipFile(archive) as source:
        for item in source.infolist():
            if not (destination / item.filename).resolve().is_relative_to(destination.resolve()):
                raise ValueError("运行环境压缩包包含非法路径")
        source.extractall(destination)


def run_pip(path: Path, arguments: list[str]):
    with (path / "install.log").open("a", encoding="utf-8") as log:
        with external_dll_search():
            process = subprocess.Popen(
                [str(path / "python.exe"), "-I", "-m", "pip", *arguments],
                stdout=log,
                stderr=subprocess.STDOUT,
                **process_options(),
            )
        try:
            process.wait(timeout=7200)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
            raise RuntimeError("依赖下载或安装超时，请检查网络后重试") from None
    if process.returncode:
        tail = (path / "install.log").read_text(encoding="utf-8", errors="replace")[-1600:]
        raise RuntimeError(f"依赖安装失败：{tail}")


def prepare_runtime(path: Path, variant: str):
    _progress("下载独立 Python 运行环境", 5)
    download(PYTHON_URL, PYTHON_SHA256, path / "python.zip")
    unpack(path / "python.zip", path)
    # The embedded distribution isolates sys.path via this explicit file.
    (path / "python314._pth").write_text(
        "python314.zip\n.\nLib/site-packages\nworker\nimport site\n", encoding="utf-8"
    )
    site = path / "Lib/site-packages"
    site.mkdir(parents=True, exist_ok=True)
    _progress("准备依赖安装工具", 10)
    download(PIP_URL, PIP_SHA256, path / "pip.whl")
    unpack(path / "pip.whl", site)
    worker = path / "worker"
    worker.mkdir()
    if is_exe_ver:
        unpack(RESOURCE_ROOT / "ai-worker.zip", worker)
    else:
        for name in ("runtime_worker.py", "runtime_engines.py"):
            shutil.copy2(worker_source(name), worker / name)
    _progress("安装 PyTorch（首次下载可能需要数分钟）", 20)
    run_pip(
        path,
        [
            "install",
            "--only-binary=:all:",
            "torch==2.11.0",
            "torchvision==0.26.0",
            "--index-url",
            f"https://download.pytorch.org/whl/{variant}",
        ],
    )
    _progress("安装视觉模型与量化依赖", 70)
    run_pip(
        path,
        ["install", "--only-binary=:all:", "--index-url", "https://pypi.org/simple", *PACKAGES],
    )
    run_pip(path, ["check"])
    _progress("检查依赖加载与推理设备", 90)
    checked = probe(path)
    if variant == "cu128" and not checked["cuda"]:
        raise RuntimeError(
            "CUDA 运行环境未检测到可用 NVIDIA GPU；请更新显卡驱动或选择 CPU 环境重试"
        )
    (path / "manifest.json").write_text(
        json.dumps({"recipe": RECIPE, "variant": variant}), encoding="utf-8"
    )
    return checked


def install(variant: str):
    stage = None
    try:
        RUNTIME_ROOT.mkdir(parents=True, exist_ok=True)
        stage = RUNTIME_ROOT / uuid.uuid4().hex
        stage.mkdir()
        checked = prepare_runtime(stage, variant)
        # Serialize only the final switch with inference; old runtime stays usable during download.
        from omnigallery.ai.models.memory import inference_lock
        from omnigallery.ai.models.qwen_instruct import release_loaded_model
        from omnigallery.ai.models.runtime_client import client
        from omnigallery.search.qwen import release_search_models

        _progress("等待当前推理完成并切换运行环境", 95)
        with inference_lock:
            # Clear source-mode models before changing dispatch to the isolated worker.
            release_search_models()
            release_loaded_model()
            client.close()
            pointer = RUNTIME_ROOT / "active.next.json"
            pointer.write_text(json.dumps({"directory": stage.name}), encoding="utf-8")
            pointer.replace(RUNTIME_ROOT / "active.json")
            with _lock:
                _checked.clear()
                _checked.update(ready=True, **checked)
        _progress("运行环境已就绪", 100)
    except Exception as error:
        with _lock:
            _job.update(stage="安装失败，可重试", error=str(error)[-1800:])
        # Preserve diagnostics, but don't accumulate multi-GB failed environments.
        if stage and stage.resolve().parent == RUNTIME_ROOT.resolve() and stage != active_runtime():
            if (stage / "install.log").is_file():
                shutil.copy2(stage / "install.log", RUNTIME_ROOT / "last-install.log")
            shutil.rmtree(stage, ignore_errors=True)
    finally:
        with _lock:
            _job["running"] = False


def check():
    try:
        path = active_runtime()
        if path is None:
            raise RuntimeError("尚未安装独立 AI 运行环境")
        from omnigallery.ai.models.memory import inference_lock
        from omnigallery.ai.models.runtime_client import client

        with inference_lock:
            client.close()
            checked = probe(path)
        manifest = json.loads((path / "manifest.json").read_text(encoding="utf-8"))
        if manifest.get("variant") == "cu128" and not checked["cuda"]:
            raise RuntimeError("未检测到可用 NVIDIA GPU，请检查显卡驱动或安装 CPU 环境")
        with _lock:
            _checked.clear()
            _checked.update(ready=True, **checked)
        _progress("检查完成", 100)
    except Exception as error:
        with _lock:
            _checked.clear()
            _checked.update(ready=False, detail=str(error)[-1800:])
            _job.update(stage="检查失败", error=str(error)[-1800:])
    finally:
        with _lock:
            _job["running"] = False


def readiness() -> tuple[str, str]:
    if not active_runtime():
        return "missing_dependency", "请先安装 AI 运行环境"
    with _lock:
        ensure_checked()
        if not _checked:
            return "missing_dependency", "正在检查 AI 运行环境，请稍后重试"
        if _checked.get("ready") is False:
            return "missing_dependency", _checked.get("detail", "请修复 AI 运行环境")
    return "ready", ""


def ensure_checked():
    with _lock:
        if supported() and active_runtime() and not _checked and not _job["running"]:
            _job.update(running=True, stage="正在检查运行环境", error="", progress=0, variant=None)
            threading.Thread(target=_background_task, args=(check,), daemon=True).start()


def _background_task(target, *args):
    try:
        target(*args)
    finally:
        from omnigallery.infrastructure.database import Database

        if hasattr(Database.local, "conn"):
            Database.local.conn.close()
            del Database.local.conn


class InstallRequest(BaseModel):
    variant: Literal["cpu", "cu128"] = "cu128"


def mount_runtime_routes(app: FastAPI, api_base: str, verify_secret, write_permission_required):
    @app.get(api_base + "/ai-runtime", dependencies=[Depends(verify_secret)])
    def get_status():
        return status()

    def start(target, *args):
        if not supported():
            raise HTTPException(400, detail="独立 AI 运行环境的自动安装目前支持 Windows x64")
        with _lock:
            if _job["running"]:
                raise HTTPException(409, detail="运行环境任务进行中")
            _job.update(
                running=True,
                stage="准备中",
                error="",
                progress=0,
                variant=args[0] if args else None,
            )
        threading.Thread(target=_background_task, args=(target, *args), daemon=True).start()
        return status()

    @app.post(
        api_base + "/ai-runtime/install",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def install_runtime(req: InstallRequest):
        return start(install, req.variant)

    @app.post(
        api_base + "/ai-runtime/check",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def check_runtime():
        return start(check)
