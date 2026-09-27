"""Build the backend executable and place a target-named copy next to Tauri."""

from __future__ import annotations

import argparse
import platform
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NAME = "omnigallery_api_server"
MODEL_PACKAGES = ("twelvelabs", "torch", "torchvision", "transformers", "qwen_vl_utils")


def build_command(
    packager: str, with_models: bool, output: Path, with_search_index: bool = False
) -> list[str]:
    """Keep resource paths and optional model dependencies identical across packagers."""
    entry = ROOT / "tools/packaging/backend_entry.py"
    assets = ROOT / "frontend/dist"
    packages = ["av", "imageio", "huggingface_hub"]
    if with_models:
        packages.extend(MODEL_PACKAGES)
    if with_search_index:
        packages.append("hnswlib")
    excluded_packages = ([] if with_models else list(MODEL_PACKAGES)) + (
        [] if with_search_index else ["hnswlib"]
    )
    if packager == "nuitka":
        return [
            sys.executable,
            "-m",
            "nuitka",
            "--mode=onefile",
            "--assume-yes-for-downloads",
            f"--output-dir={output}",
            f"--output-filename={NAME}{'.exe' if sys.platform == 'win32' else ''}",
            "--include-package=omnigallery",
            "--include-module=imageio.plugins.pyav",
            *[f"--include-package={package}" for package in packages if package != "hnswlib"],
            *(["--include-module=hnswlib"] if with_search_index else []),
            *[f"--nofollow-import-to={package}" for package in excluded_packages],
            f"--include-data-dir={assets}=frontend/dist",
            str(entry),
        ]
    return [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--onefile",
        "--name",
        NAME,
        "--distpath",
        str(output),
        "--workpath",
        str(output / "work"),
        "--specpath",
        str(output),
        "--paths",
        str(ROOT / "backend/src"),
        "--additional-hooks-dir",
        str(ROOT / "tools/packaging/hooks"),
        "--collect-submodules",
        "omnigallery",
        "--hidden-import=imageio.plugins.pyav",
        *[arg for package in packages for arg in ("--collect-all", package)],
        *[arg for package in excluded_packages for arg in ("--exclude-module", package)],
        "--add-data",
        f"{assets}:frontend/dist",
        str(entry),
    ]


def target_triple() -> str:
    machine = platform.machine().lower()
    arch = "aarch64" if machine in {"arm64", "aarch64"} else "x86_64"
    suffix = {
        "win32": "pc-windows-msvc",
        "linux": "unknown-linux-gnu",
        "darwin": "apple-darwin",
    }.get(sys.platform)
    if not suffix:
        raise ValueError(f"Unsupported sidecar platform: {sys.platform}")
    return f"{arch}-{suffix}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("packager", choices=["nuitka", "pyinstaller"])
    parser.add_argument(
        "--with-models", action="store_true", help="Bundle optional local AI engines"
    )
    parser.add_argument(
        "--with-search-index", action="store_true", help="Bundle optional HNSW acceleration"
    )
    parser.add_argument("--dry-run", action="store_true", help="Print the packaging command only")
    args = parser.parse_args()
    output = ROOT / ".local/build/backend" / args.packager
    command = build_command(args.packager, args.with_models, output, args.with_search_index)
    print(subprocess.list2cmdline(command))
    if args.dry_run:
        return
    if not (ROOT / "frontend/dist/index.html").is_file():
        parser.error("Build the frontend first: npm --prefix frontend run build")
    output.mkdir(parents=True, exist_ok=True)
    subprocess.run(command, cwd=ROOT, check=True)
    extension = ".exe" if sys.platform == "win32" else ""
    binary = output / f"{NAME}{extension}"
    sidecar = ROOT / "frontend/src-tauri" / f"{NAME}-{target_triple()}{extension}"
    shutil.copy2(binary, sidecar)
    print(f"Backend: {binary}\nSidecar: {sidecar}")


if __name__ == "__main__":
    main()
