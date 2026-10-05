"""Bounded FFmpeg progress and cancellation for background media exports."""

import math
import os
import shutil
import subprocess
import threading
import time
from collections import deque

from fastapi import HTTPException


class ExportCancelled(Exception):
    pass


class ExportInterrupted(Exception):
    pass


def run_media_process(args, directory, duration, checkpoint, progress):
    checkpoint()
    activity = {"time": time.monotonic(), "seconds": 0.0}
    errors = deque(maxlen=64)

    def drain(stream, report=False):
        try:
            while line := stream.readline(4096):
                if not report:
                    errors.append(line)
                    continue
                key, _, value = line.partition(b"=")
                if key in (b"out_time_us", b"out_time_ms"):
                    try:
                        seconds = float(value) / 1_000_000
                        if math.isfinite(seconds) and seconds > activity["seconds"]:
                            activity.update(seconds=seconds, time=time.monotonic())
                    except ValueError:
                        pass
        finally:
            stream.close()

    process = subprocess.Popen(
        [*args[:-1], "-nostats", "-progress", "pipe:1", args[-1]],
        cwd=directory,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    readers = [
        threading.Thread(target=drain, args=(process.stdout, True), daemon=True),
        threading.Thread(target=drain, args=(process.stderr,), daemon=True),
    ]
    for reader in readers:
        reader.start()
    began, report_at = time.monotonic(), 0.0
    try:
        while process.poll() is None:
            checkpoint()
            now = time.monotonic()
            if now - activity["time"] > 600 or now - began > 86400:
                raise ExportInterrupted("导出长时间无进展，请检查素材和磁盘后重试")
            if now - report_at > 0.5:
                if shutil.disk_usage(directory).free < 256 * 1024**2:
                    raise HTTPException(507, "可用磁盘空间不足，导出已停止")
                progress(min(99, max(0, activity["seconds"] / duration * 100)))
                report_at = now
            time.sleep(0.1)
        checkpoint()
        if process.returncode:
            raise HTTPException(422, "音频处理失败，请检查素材、FFmpeg 滤镜和可用磁盘空间")
        for reader in readers:
            reader.join(timeout=3)
        return subprocess.CompletedProcess(args, process.returncode, b"", b"".join(errors))
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        for reader in readers:
            reader.join(timeout=3)
