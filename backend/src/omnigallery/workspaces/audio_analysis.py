"""Cancellable loudness inspection of the exact complete editor/export mix."""

import math
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

from fastapi import HTTPException


class AnalysisCancelled(Exception):
    pass


def inspect_audio(request, check_path_trust, cancel=None):
    from omnigallery.config import get_cache_dir
    from omnigallery.workspaces.audio_mix_cache import get_audio_mix_cache_manager
    from omnigallery.workspaces.audio_mix_render import (
        render_full_mix,
        resolve_mix_sources,
        sound_duration,
    )
    from omnigallery.workspaces.audio_studio import HIDDEN, RATE, _binary
    from omnigallery.workspaces.video_audio import PreviewCancelled

    cancel = cancel or threading.Event()
    if request.start + request.duration > 86400:
        raise HTTPException(422, "响度分析范围超出 24 小时时间线")
    if cancel.is_set():
        raise AnalysisCancelled("分析已取消")
    report = {}

    def run(args, directory, length):
        with tempfile.TemporaryFile() as logs:
            process = subprocess.Popen(
                args, stdout=subprocess.DEVNULL, stderr=logs, cwd=directory, creationflags=HIDDEN
            )
            deadline = time.monotonic() + max(60, length * 2)
            try:
                while process.poll() is None:
                    if cancel.wait(0.1):
                        raise AnalysisCancelled("分析已取消")
                    if time.monotonic() > deadline:
                        raise HTTPException(504, "响度分析超时")
                if process.returncode:
                    raise HTTPException(422, "响度分析失败，请检查声音素材")
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
            logs.seek(0)
            # Keep only the summary; verbose frame logs never determine memory usage.
            tail = b""
            while block := logs.read(65536):
                tail = (tail + block)[-16384:]
        text = tail.decode("utf-8", errors="replace")

        def last(pattern):
            matches = re.findall(pattern, text)
            value = float(matches[-1]) if matches else math.nan
            return value if math.isfinite(value) else None

        intervals, count, peak, position = [], 0, -math.inf, 0
        with (directory / "peaks.txt").open(encoding="utf-8") as peaks:
            for line in peaks:
                if "pts_time:" in line:
                    position = float(line.rsplit("pts_time:", 1)[1]) + request.start
                elif "lavfi.astats.Overall.Peak_level=" in line:
                    level = float(line.split("=", 1)[1])
                    peak = max(peak, level)
                    if level > 0:
                        count += 1
                        if intervals and position - intervals[-1]["end"] <= 0.03:
                            intervals[-1]["end"] = min(
                                request.start + request.duration, position + 1024 / RATE
                            )
                        elif len(intervals) < 128:
                            intervals.append(
                                {
                                    "start": position,
                                    "end": min(
                                        request.start + request.duration, position + 1024 / RATE
                                    ),
                                }
                            )
        report.update(
            {
                "integrated_lufs": last(r"I:\s+([-+\w.]+) LUFS"),
                "loudness_range_lu": last(r"LRA:\s+([-+\w.]+) LU"),
                "true_peak_dbfs": last(r"Peak:\s+([-+\w.]+) dBFS"),
                "sample_peak_dbfs": peak if math.isfinite(peak) else None,
                "overload_ranges": intervals,
                "overload_windows": count,
                "start": request.start,
                "duration": request.duration,
            }
        )
        return subprocess.CompletedProcess(args, 0, stderr=b"")

    manager = get_audio_mix_cache_manager()
    revision = manager.revision(request.workspace_id, "audio", request.document)
    cache_directory = Path(get_cache_dir())
    cache_directory.mkdir(parents=True, exist_ok=True)
    with manager.lease_ready(request.workspace_id, "audio", request.document) as cached:
        with tempfile.TemporaryDirectory(
            dir=cache_directory, prefix="audio-analysis-"
        ) as temporary:
            directory = Path(temporary)
            full = cached or directory / "complete.wav"
            if not cached:
                duration = sound_duration("audio", request.document)
                if shutil.disk_usage(directory).free < duration * RATE * 8 * 4 + 256 * 1024**2:
                    raise HTTPException(507, "响度分析所需混音空间不足，请释放缓存空间")
                try:
                    render_full_mix(
                        "audio",
                        request.document,
                        resolve_mix_sources(
                            "audio", request.document, request.workspace_id, check_path_trust
                        ),
                        full,
                        directory,
                        cancelled=cancel,
                    )
                except PreviewCancelled as exc:
                    raise AnalysisCancelled("分析已取消") from exc
            if cancel.is_set():
                raise AnalysisCancelled("分析已取消")
            length = max(1, round(request.duration * RATE)) / RATE
            start = round(request.start * RATE) / RATE
            args = [_binary("ffmpeg"), "-nostdin", "-hide_banner", "-v", "info"]
            if start >= round(sound_duration("audio", request.document) * RATE) / RATE:
                args += ["-f", "lavfi", "-i", f"anullsrc=r={RATE}:cl=stereo"]
            else:
                args += ["-ss", f"{start:.9f}", "-t", f"{length:.9f}", "-i", str(full)]
            filters = (
                f"aresample={RATE},apad,atrim=end_sample={round(length * RATE)},asetpts=PTS-STARTPTS,"
                "asetnsamples=n=1024:p=0,astats=metadata=1:measure_perchannel=none:measure_overall=Peak_level:reset=1,"
                "ametadata=mode=print:key=lavfi.astats.Overall.Peak_level:file=peaks.txt,"
                "ebur128=peak=true:framelog=verbose"
            )
            run(
                args + ["-map", "0:a:0", "-af", filters, "-t", f"{length:.9f}", "-f", "null", "-"],
                directory,
                length,
            )
    if revision != manager.revision(request.workspace_id, "audio", request.document):
        raise HTTPException(409, "分析期间声音素材已修改，请重新检查")
    report["sound_revision"] = revision
    return report


class AudioAnalyses:
    def __init__(self):
        self.lock = threading.Lock()
        self.jobs = {}
        self.running = False
        self.blocked = set()
        self.closed = False

    def submit(self, request, check_path_trust):
        with self.lock:
            if self.closed:
                raise HTTPException(503, "响度分析服务正在关闭")
            if request.workspace_id in self.blocked:
                raise HTTPException(409, "工作区正在清理，请稍后再试")
            if self.running:
                raise HTTPException(409, "已有响度分析正在进行，请稍后再试")
            self.running = True
            for key in list(self.jobs):
                if self.jobs[key]["created"] < time.monotonic() - 3600:
                    del self.jobs[key]
            while len(self.jobs) >= 32:
                del self.jobs[next(iter(self.jobs))]
            key = str(uuid.uuid4())
            job = {
                "id": key,
                "workspace_id": request.workspace_id,
                "state": "running",
                "created": time.monotonic(),
                "cancel": threading.Event(),
                "result": None,
                "error": "",
            }
            self.jobs[key] = job

        def execute():
            try:
                result = inspect_audio(request, check_path_trust, job["cancel"])
                with self.lock:
                    job.update(
                        state="cancelled" if job["cancel"].is_set() else "completed",
                        result=None if job["cancel"].is_set() else result,
                    )
            except AnalysisCancelled:
                with self.lock:
                    job["state"] = "cancelled"
            except Exception as exc:
                with self.lock:
                    job.update(
                        state="failed",
                        error=exc.detail if isinstance(exc, HTTPException) else "响度分析失败",
                    )
            finally:
                with self.lock:
                    self.running = False

        worker = threading.Thread(target=execute, daemon=True, name="audio-loudness")
        with self.lock:
            job["thread"] = worker
            worker.start()
        return self.get(key, request.workspace_id)

    def get(self, key, workspace):
        with self.lock:
            job = self.jobs.get(key)
            if not job or job["workspace_id"] != workspace:
                raise HTTPException(404, "响度分析不存在或已过期")
            return {name: job[name] for name in ("id", "state", "result", "error")}

    def cancel(self, key, workspace):
        with self.lock:
            job = self.jobs.get(key)
            if not job or job["workspace_id"] != workspace:
                raise HTTPException(404, "响度分析不存在或已过期")
            job["cancel"].set()
        return self.get(key, workspace)

    @contextmanager
    def removing_workspace(self, workspace):
        with self.lock:
            self.blocked.add(workspace)
            jobs = [job for job in self.jobs.values() if job["workspace_id"] == workspace]
            for job in jobs:
                job["cancel"].set()
        try:
            for job in jobs:
                worker = job.get("thread")
                if worker and worker is not threading.current_thread():
                    worker.join(timeout=15)
                    if worker.is_alive():
                        raise HTTPException(409, "响度分析尚在停止，请稍后清理工作区")
            with self.lock:
                for job in jobs:
                    self.jobs.pop(job["id"], None)
            yield
        finally:
            with self.lock:
                self.blocked.discard(workspace)

    def close(self):
        with self.lock:
            self.closed = True
            jobs = list(self.jobs.values())
            for job in jobs:
                job["cancel"].set()
        for job in jobs:
            worker = job.get("thread")
            if worker and worker is not threading.current_thread():
                worker.join(timeout=15)
