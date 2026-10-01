"""Bounded HTTP ranges and SHA-256 verification for large native artifacts."""

from __future__ import annotations

import hashlib
import json
import re
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

from omnigallery.infrastructure.network_proxy import requests_proxy_kwargs

CHUNK_BYTES = 16 * 1024 * 1024


def download(
    url: str,
    destination: Path,
    size: int,
    checksum: str,
    progress=lambda done, total: None,
    *,
    parallel=False,
):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_file():
        with destination.open("rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
        if digest == checksum:
            return destination
        raise ValueError(f"已有文件校验不匹配：{destination.name}；请移走该文件后重试")
    partial = destination.with_name(destination.name + ".part")
    if parallel and size > CHUNK_BYTES:
        return _parallel(url, destination, partial, size, checksum, progress)
    offset = partial.stat().st_size if partial.exists() else 0
    if offset > size:
        raise ValueError(f"断点文件超过预期大小：{partial.name}")
    with requests.Session() as session, partial.open("ab") as output:
        failures = 0
        while offset < size:
            end = min(size - 1, offset + CHUNK_BYTES - 1)
            try:
                with session.get(
                    url,
                    headers={"Range": f"bytes={offset}-{end}", "Accept-Encoding": "identity"},
                    stream=True,
                    timeout=(20, 30),
                    **requests_proxy_kwargs(),
                ) as response:
                    response.raise_for_status()
                    match = re.fullmatch(
                        r"bytes (\d+)-(\d+)/(\d+)", response.headers.get("Content-Range", "")
                    )
                    if (
                        response.status_code != 206
                        or not match
                        or tuple(map(int, match.groups())) != (offset, end, size)
                    ):
                        raise ValueError(f"下载服务器未返回正确的断点范围：{destination.name}")
                    received = 0
                    expected = end - offset + 1
                    for data in response.iter_content(256 * 1024):
                        if received + len(data) > expected:
                            raise ValueError("下载响应超出预期大小")
                        output.write(data)
                        offset += len(data)
                        received += len(data)
                    output.flush()
                    if received != expected:
                        raise requests.ConnectionError("分段下载提前结束")
                failures = 0
                progress(offset, size)
            except requests.RequestException:
                output.flush()
                failures += 1
                if failures >= 3:
                    raise
    with partial.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    if digest != checksum:
        # Only this downloader's temporary artifact is removed; never user files.
        partial.unlink()
        raise ValueError(f"下载校验失败：{destination.name}；可重新下载")
    partial.replace(destination)
    return destination


def _parallel(url, destination, partial, size, checksum, progress):
    """Six bounded ranges; a journal makes sparse-file resumes unambiguous."""
    journal = partial.with_name(partial.name + ".ranges.json")
    count = (size + CHUNK_BYTES - 1) // CHUNK_BYTES
    if journal.exists():
        data = json.loads(journal.read_text(encoding="utf-8"))
        if (
            data.get("size") != size
            or data.get("sha256") != checksum
            or data.get("chunk_bytes") != CHUNK_BYTES
            or not partial.exists()
        ):
            raise ValueError("下载断点清单不匹配")
        completed = set(data.get("completed", []))
        if any(type(i) is not int or not 0 <= i < count for i in completed):
            raise ValueError("下载断点清单不合法")
    else:
        length = partial.stat().st_size if partial.exists() else 0
        if length > size:
            raise ValueError("下载断点文件超过预期大小")
        completed = set(range(length // CHUNK_BYTES))

    def save():
        data = {
            "size": size,
            "sha256": checksum,
            "chunk_bytes": CHUNK_BYTES,
            "completed": sorted(completed),
        }
        pending = journal.with_name(journal.name + ".tmp")
        pending.write_text(json.dumps(data), encoding="utf-8")
        pending.replace(journal)

    save()  # Persist before extending the file; never mistake sparse space for downloaded bytes.
    proxy = requests_proxy_kwargs()
    lock = threading.Lock()
    stop = threading.Event()
    sessions = []
    local = threading.local()
    with partial.open("r+b" if partial.exists() else "w+b") as output:
        output.truncate(size)
        output.flush()

        def fetch(index):
            if not hasattr(local, "session"):
                local.session = requests.Session()
                with lock:
                    sessions.append(local.session)
            start, end = index * CHUNK_BYTES, min(size, (index + 1) * CHUNK_BYTES) - 1
            for attempt in range(6):
                if stop.is_set():
                    return
                try:
                    with local.session.get(
                        url,
                        headers={"Range": f"bytes={start}-{end}", "Accept-Encoding": "identity"},
                        stream=True,
                        timeout=(20, 30),
                        **proxy,
                    ) as response:
                        response.raise_for_status()
                        expected = f"bytes {start}-{end}/{size}"
                        if (
                            response.status_code != 206
                            or response.headers.get("Content-Range") != expected
                        ):
                            raise ValueError("下载服务器未返回正确的断点范围")
                        buffer = bytearray()
                        for chunk in response.iter_content(256 * 1024):
                            buffer.extend(chunk)
                            if len(buffer) > end - start + 1:
                                raise ValueError("下载响应超出预期大小")
                        if len(buffer) != end - start + 1:
                            raise requests.ConnectionError("分段下载提前结束")
                    with lock:
                        output.seek(start)
                        output.write(buffer)
                        output.flush()
                        completed.add(index)
                        save()
                        done = sum(min(CHUNK_BYTES, size - i * CHUNK_BYTES) for i in completed)
                        progress(done, size)
                    return
                except requests.RequestException:
                    if attempt == 5:
                        raise
                    if stop.wait(min(8, 2**attempt)):
                        return

        try:
            with ThreadPoolExecutor(max_workers=6, thread_name_prefix="artifact-download") as pool:
                futures = [pool.submit(fetch, i) for i in range(count) if i not in completed]
                try:
                    for future in as_completed(futures):
                        future.result()
                except Exception:
                    stop.set()
                    for future in futures:
                        future.cancel()
                    raise
        finally:
            for session in sessions:
                session.close()
    with partial.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    if digest != checksum:
        journal.unlink()
        partial.unlink()
        raise ValueError(f"下载校验失败：{destination.name}；可重新下载")
    partial.replace(destination)
    journal.unlink()
    return destination
