"""Run backend hot reload under interactive terminals or hidden Windows workers."""

from __future__ import annotations

import logging
from pathlib import Path

import uvicorn
from watchfiles import PythonFilter, run_process

ROOT = Path(__file__).resolve().parents[2]


def serve() -> None:
    uvicorn.run("omnigallery.app:create_app", factory=True, host="127.0.0.1", port=7877)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    # Watchfiles manages the child directly. Uvicorn's own Windows reloader
    # broadcasts console control events, which can stop a hidden PowerShell host.
    run_process(ROOT / "backend" / "src", target=serve, watch_filter=PythonFilter())


if __name__ == "__main__":
    main()
