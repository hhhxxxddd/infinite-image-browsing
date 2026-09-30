"""Verify a packaged backend serves its API and embedded frontend with isolated data."""

from __future__ import annotations

import argparse
import os
import re
import socket
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import ProxyHandler, build_opener


def smoke_backend(binary: Path) -> None:
    binary = binary.resolve(strict=True)
    with socket.socket() as port_socket:
        port_socket.bind(("127.0.0.1", 0))
        port = port_socket.getsockname()[1]
    with tempfile.TemporaryDirectory(prefix="omnigallery-package-check-") as temporary:
        environment = {
            key: value for key, value in os.environ.items() if not key.startswith("OMNIGALLERY_")
        }
        environment["OMNIGALLERY_DATA_DIR"] = temporary
        output_path = Path(temporary) / "server.log"
        with output_path.open("w+", encoding="utf-8") as output:
            process = subprocess.Popen(
                [str(binary), "--host", "127.0.0.1", "--port", str(port)],
                cwd=temporary,
                env=environment,
                stdout=output,
                stderr=subprocess.STDOUT,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            opener = build_opener(ProxyHandler({}))
            base = f"http://127.0.0.1:{port}"
            try:
                deadline = time.monotonic() + 60
                while True:
                    if process.poll() is not None:
                        raise RuntimeError(f"Packaged backend exited with {process.returncode}")
                    try:
                        with opener.open(f"{base}/", timeout=2) as response:
                            document = response.read().decode("utf-8")
                        break
                    except (OSError, URLError):
                        if time.monotonic() >= deadline:
                            raise TimeoutError(
                                "Packaged backend did not start within 60 seconds"
                            ) from None
                        time.sleep(0.2)
                with opener.open(f"{base}/api/global_setting", timeout=10) as response:
                    if response.status != 200:
                        raise RuntimeError("Packaged API is unavailable")
                asset = re.search(r'src="(/static/[^\"]+\.js)"', document)
                if not asset:
                    raise RuntimeError(
                        "Packaged frontend does not reference a /static JavaScript asset"
                    )
                with opener.open(f"{base}{asset.group(1)}", timeout=10) as response:
                    if not response.read(1):
                        raise RuntimeError("Embedded frontend JavaScript asset is empty")
                print("Packaged backend passed: homepage, API, embedded JavaScript")
            except Exception:
                output.flush()
                output.seek(0)
                print(output.read())
                raise
            finally:
                if process.poll() is None:
                    if os.name == "nt":
                        # PyInstaller onefile starts a child process that owns the database.
                        # Terminating only the bootloader leaves that child running.
                        subprocess.run(
                            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                            check=False,
                            capture_output=True,
                        )
                    if process.poll() is None:
                        process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=10)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", type=Path)
    args = parser.parse_args()
    smoke_backend(args.binary)


if __name__ == "__main__":
    main()
