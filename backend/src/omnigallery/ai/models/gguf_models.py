"""Pinned Q6_K multimodal bundles; no executable code from model repositories."""

from __future__ import annotations

import json
from pathlib import Path

import requests

from omnigallery.ai.models import gguf_runtime
from omnigallery.infrastructure.artifact_download import download as download_artifact
from omnigallery.infrastructure.network_proxy import requests_proxy_kwargs

CATALOG = {
    "embedding": {
        "repo": "VesNFF/Qwen3-VL-Embedding-8B-GGUF",
        "revision": "7eed7460dd7d349b94f401fef5df50a3e5ea1236",
        "files": {
            "Qwen3-VL-Embedding-8B-Q6_K.gguf": "10ee47c017d73f5df31e41669d9600abdfe80c701c77630504108d56f79b48d7",
            "mmproj-Qwen3-VL-Embedding-8B-f16.gguf": "6f104e4299dfd0738ef1b44f4eecdde9dc049d10a73ce69472e0bfbbd687a034",
        },
        "sizes": [6215396064, 1162569152],
    },
    "reranker": {
        "repo": "mradermacher/Qwen3-VL-Reranker-8B-GGUF",
        "revision": "a0e8b54c5ac2f0bd9c3e1a2c4eb497c1b98908ed",
        "files": {
            "Qwen3-VL-Reranker-8B.Q6_K.gguf": "9c40c98b602cbdda4cd72bf3b59c0065522ea30458888d31b0236ed9a3f431b7",
            "Qwen3-VL-Reranker-8B.mmproj-f16.gguf": "15cd9bd4882dae771344f0ac204fce07de91b47c1438ada3861dfc817403c31e",
        },
        "sizes": [6725901280, 1159030336],
    },
    "instruct": {
        "repo": "bartowski/Qwen_Qwen3-VL-8B-Instruct-GGUF",
        "revision": "6398fcccbd940691854d2cffd85b435ed8eee4ca",
        "model": "Qwen/Qwen3-VL-8B-Instruct",
        "files": {
            "Qwen_Qwen3-VL-8B-Instruct-Q6_K.gguf": "ce4c02447444176dd261a9f271a0d69eba0b53981185895167a7781ff1055d38",
            "mmproj-Qwen_Qwen3-VL-8B-Instruct-f16.gguf": "8c3872ce326ac133cf3c383c83e84c76f03bd5c35d1789a746fa7b4b13f69229",
        },
        "sizes": [6725900768, 1159029920],
    },
}


def directory(root: Path, kind: str) -> Path:
    name = "Qwen3-VL-8B-Instruct" if kind == "instruct" else f"Qwen3-VL-{kind.title()}-8B"
    return root / f"{name}-GGUF-Q6_K"


def download(kind: str, path: Path, progress=lambda message: None):
    spec = CATALOG[kind]
    path.mkdir(parents=True, exist_ok=True)
    base_url = f"https://huggingface.co/{spec['repo']}/resolve/{spec['revision']}/"
    for (name, checksum), size in zip(spec["files"].items(), spec["sizes"], strict=True):

        def report(done, total, name=name):
            progress(
                f"下载：{name} · {done * 100 // total}% ({done // 1048576}/{total // 1048576} MB)"
            )

        download_artifact(base_url + name, path / name, size, checksum, report, parallel=True)
    with requests.get(
        base_url + "README.md", timeout=(20, 30), **requests_proxy_kwargs()
    ) as response:
        response.raise_for_status()
        (path / "README.md").write_text(response.text, encoding="utf-8")
    main, projector = spec["files"]
    manifest = {
        "kind": kind,
        "model_file": main,
        "projector_file": projector,
        "model": spec.get("model", f"Qwen/Qwen3-VL-{kind.title()}-8B"),
        "quantization": "Q6_K",
        "projector_precision": "F16",
        "repo": spec["repo"],
        "revision": spec["revision"],
        "sha256": spec["files"],
        "protocol": gguf_runtime.PROTOCOL,
    }
    pending = path / "gguf-model.tmp"
    pending.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    pending.replace(path / "gguf-model.json")
    gguf_runtime.bundle(path, kind)
    return path
