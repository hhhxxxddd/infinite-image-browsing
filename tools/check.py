"""Run the same model-independent checks used by pull-request CI."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scope", choices=["all", "frontend", "backend"], nargs="?", default="all")
    args = parser.parse_args()
    commands = []
    if args.scope in {"all", "backend"}:
        commands.extend(
            [
                [sys.executable, "-m", "ruff", "check", "backend", "tools"],
                [sys.executable, "-m", "ruff", "format", "--check", "backend", "tools"],
                [sys.executable, "-m", "unittest", "discover", "-s", "backend/tests"],
                [sys.executable, "-m", "unittest", "discover", "-s", "tools/tests"],
            ]
        )
    if args.scope in {"all", "frontend"}:
        npm = shutil.which("npm")
        if not npm:
            parser.error("Node.js 24 and npm must be installed to check the frontend")
        commands.append([npm, "--prefix", "frontend", "run", "check"])
    environment = os.environ.copy()
    environment["PYTHONPATH"] = os.pathsep.join(
        filter(None, [str(ROOT / "backend/src"), environment.get("PYTHONPATH")])
    )
    for command in commands:
        print(f"\n> {subprocess.list2cmdline(command)}", flush=True)
        subprocess.run(command, cwd=ROOT, env=environment, check=True)


if __name__ == "__main__":
    main()
