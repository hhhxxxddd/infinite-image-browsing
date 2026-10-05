"""Disposable, workspace-scoped final PCM mixes with bounded range reads.

This is a disk cache, never a workspace artifact. One worker performs the complete
stateful mix; audition and export lease that same PCM instead of resetting DSP at
each preview boundary. Source metadata is checked before reuse and after rendering.
"""

from __future__ import annotations

import base64
import hashlib
import json
import math
import os
import shutil
import struct
import threading
import time
import uuid
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import numpy as np
from fastapi import Depends, FastAPI, HTTPException, Response
from pydantic import BaseModel, ValidationError

RATE = 48000
FRAME_BYTES = 8
MAX_CHUNK_SECONDS = 12
DEFAULT_BUDGET = 20 * 1024**3
FREE_RESERVE = 512 * 1024**2
FORMAT_VERSION = 1
ACTIVE_STATES = {"queued", "running"}


@dataclass(frozen=True)
class FloatWave:
    offset: int
    frames: int


def inspect_float_wave(path: Path) -> FloatWave:
    """Read only WAV headers, including RF64 and WAVE_FORMAT_EXTENSIBLE."""
    size = path.stat().st_size
    with path.open("rb") as stream:
        header = stream.read(12)
        if len(header) != 12 or header[8:] != b"WAVE" or header[:4] not in (b"RIFF", b"RF64"):
            raise ValueError("混音缓存不是 WAV 文件")
        rf64 = header[:4] == b"RF64"
        data_size = None
        valid_format = False
        # Unknown metadata chunks may be large; seek them without loading them.
        for _ in range(128):
            chunk = stream.read(8)
            if len(chunk) != 8:
                break
            tag, length = struct.unpack("<4sI", chunk)
            position = stream.tell()
            if tag == b"ds64":
                if length < 28 or length > 65536:
                    raise ValueError("RF64 长度头无效")
                value = stream.read(28)
                if len(value) != 28:
                    raise ValueError("RF64 长度头不完整")
                data_size = struct.unpack("<QQQI", value)[1]
            elif tag == b"fmt ":
                if length < 16 or length > 65536:
                    raise ValueError("混音缓存格式头无效")
                value = stream.read(min(length, 40))
                if len(value) < 16:
                    raise ValueError("混音缓存格式头不完整")
                encoding, channels, rate, byte_rate, alignment, bits = struct.unpack(
                    "<HHIIHH", value[:16]
                )
                if encoding == 0xFFFE:
                    if len(value) < 40 or struct.unpack("<H", value[16:18])[0] < 22:
                        raise ValueError("扩展 WAV 格式无效")
                    encoding = struct.unpack("<I", value[24:28])[0]
                    if value[28:40] != bytes.fromhex("00001000800000aa00389b71"):
                        raise ValueError("扩展 WAV 子格式无效")
                valid_format = (
                    encoding == 3
                    and channels == 2
                    and rate == RATE
                    and byte_rate == RATE * FRAME_BYTES
                    and alignment == FRAME_BYTES
                    and bits == 32
                )
            elif tag == b"data":
                count = data_size if rf64 and length == 0xFFFFFFFF else length
                if not valid_format or count is None or count % FRAME_BYTES:
                    raise ValueError("混音缓存必须为 48kHz 双声道浮点 PCM")
                if position + count > size:
                    raise ValueError("混音缓存数据不完整")
                return FloatWave(position, count // FRAME_BYTES)
            next_position = position + length + length % 2
            if next_position > size or next_position <= position:
                break
            stream.seek(next_position)
    raise ValueError("混音缓存缺少音频数据")


def float_wave_bytes(values: np.ndarray) -> bytes:
    data = np.asarray(values, dtype="<f4").tobytes()
    fmt = struct.pack("<HHIIHH", 3, 2, RATE, RATE * FRAME_BYTES, FRAME_BYTES, 32)
    return (
        b"RIFF"
        + struct.pack("<I", 36 + len(data))
        + b"WAVEfmt "
        + struct.pack("<I", 16)
        + fmt
        + b"data"
        + struct.pack("<I", len(data))
        + data
    )


def level_peaks(values: np.ndarray) -> str:
    step = RATE // 20
    padded = np.pad(values, ((0, (-len(values)) % step), (0, 0)))
    peaks = np.max(np.abs(padded.reshape(-1, step, 2)), axis=1).astype("<f4")
    return base64.b64encode(peaks.tobytes()).decode("ascii")


def _default_workspace_check(workspace: str) -> None:
    from omnigallery.infrastructure.database import Database

    # Status/chunk polling must not load the entire workspace's draft documents.
    row = (
        Database.get_connection()
        .execute("SELECT deleted FROM workspace_state_revision WHERE workspace_id=?", (workspace,))
        .fetchone()
    )
    if row and row[0]:
        raise HTTPException(404, "工作区草稿已删除")


def _adapters():
    from omnigallery.workspaces import audio_mix_render

    return audio_mix_render


def _normalize(kind: str, document: Any):
    from omnigallery.workspaces.audio_studio import AudioDocument
    from omnigallery.workspaces.video_studio import VideoDocument

    if kind not in ("audio", "video"):
        raise HTTPException(422, "不支持的声音工程类型")
    model = AudioDocument if kind == "audio" else VideoDocument
    try:
        return model.model_validate(document).model_copy(deep=True)
    except ValidationError as exc:
        raise HTTPException(422, "声音工程参数无效") from exc


@dataclass
class MixJob:
    id: str
    workspace: str
    kind: str
    revision: str
    document: Any
    sources: list[Path]
    fingerprints: list[dict]
    duration: float
    folder: Path
    state: str = "queued"
    phase: str = "queued"
    progress: float = 0
    error: str = ""
    last_access: float = field(default_factory=time.time)
    cancel: threading.Event = field(default_factory=threading.Event)
    pins: int = 0
    clients: dict[str, float] = field(default_factory=dict)
    retired_clients: set[str] = field(default_factory=set)
    legacy_interest: bool = False

    @property
    def path(self) -> Path:
        return self.folder / "mix.wav"

    def status(self) -> dict:
        return {
            key: getattr(self, key)
            for key in ("id", "revision", "state", "phase", "progress", "duration", "error")
        }


class AudioMixCacheManager:
    def __init__(
        self,
        *,
        root: Path | Callable[[], Path] | None = None,
        check_path_trust: Callable[[str], None] | None = None,
        validate_workspace: Callable[[str], None] | None = None,
        renderer=None,
        source_resolver=None,
        revision_payload=None,
        duration_fn=None,
        normalizer=None,
        budget_bytes: int = DEFAULT_BUDGET,
        free_reserve: int = FREE_RESERVE,
        max_active: int = 4,
        max_history: int = 256,
        interest_ttl: float = 300,
    ):
        self.root_provider = root
        self.check_path_trust = check_path_trust or (lambda _: None)
        self.validate_workspace = validate_workspace or _default_workspace_check
        self.renderer = renderer
        self.source_resolver = source_resolver
        self.revision_payload = revision_payload
        self.duration_fn = duration_fn
        self.normalizer = normalizer or _normalize
        self.budget_bytes = budget_bytes
        self.free_reserve = free_reserve
        self.max_active = max_active
        self.max_history = max_history
        self.interest_ttl = interest_ttl
        self.condition = threading.Condition(threading.RLock())
        self.jobs: dict[str, MixJob] = {}
        self.records: dict[str, dict] = {}
        self.blocked: dict[str, int] = {}
        self.worker: threading.Thread | None = None
        self.closed = False
        self.loaded_roots: set[Path] = set()

    def _root(self) -> Path:
        if self.root_provider is None:
            from omnigallery.config import get_cache_dir

            root = Path(get_cache_dir()) / "audio-mixes"
        else:
            root = self.root_provider() if callable(self.root_provider) else self.root_provider
        root = Path(root).absolute()
        if root.is_symlink():
            raise HTTPException(403, "声音缓存目录不能是符号链接")
        root.mkdir(parents=True, exist_ok=True)
        return root.resolve()

    def _workspace(self, workspace: str) -> str:
        try:
            workspace = str(uuid.UUID(workspace))
        except (ValueError, TypeError, AttributeError) as exc:
            raise HTTPException(422, "工作区编号无效") from exc
        self.validate_workspace(workspace)
        return workspace

    def _prepare(self, workspace: str, kind: str, document: Any):
        workspace = self._workspace(workspace)
        normalized = self.normalizer(kind, document)
        adapters = None
        if not all((self.source_resolver, self.duration_fn, self.revision_payload)):
            adapters = _adapters()
        resolver = self.source_resolver or adapters.resolve_mix_sources
        duration_fn = self.duration_fn or adapters.sound_duration
        payload_fn = self.revision_payload or adapters.sound_revision_payload
        sources = resolver(kind, normalized, workspace, self.check_path_trust)
        fingerprints = self._fingerprints(sources)
        duration = float(duration_fn(kind, normalized))
        limit = 86400 if kind == "audio" else 21600
        if not math.isfinite(duration) or duration < 0 or duration > limit:
            raise HTTPException(422, "声音工程时长超出范围")
        duration = max(1, round(duration * RATE)) / RATE
        serialized = json.dumps(
            {
                "version": FORMAT_VERSION,
                "kind": kind,
                "sound": payload_fn(kind, normalized),
                "sources": fingerprints,
            },
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
        revision = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
        return workspace, normalized, list(sources), fingerprints, duration, revision

    def revision(self, workspace_id: str, kind: str, document: Any) -> str:
        """Public sound/source revision for analysis and export audit snapshots."""
        return self._prepare(workspace_id, kind, document)[-1]

    @staticmethod
    def _client(client_id: str | None) -> str | None:
        if client_id is None:
            return None
        try:
            return str(uuid.UUID(client_id))
        except (ValueError, TypeError, AttributeError) as exc:
            raise HTTPException(422, "试听会话编号无效") from exc

    def _register_interest(self, job: MixJob, client: str | None, *, starting=False) -> None:
        now = time.monotonic()
        job.clients = {key: at for key, at in job.clients.items() if now - at < self.interest_ttl}
        if client:
            # A GET already in flight when the viewer releases can arrive after /cancel.
            # It may inspect this task, but cannot recreate the released interest.
            if client in job.retired_clients:
                if starting:
                    raise HTTPException(409, "试听会话已取消，请创建新的会话")
                return
            if client not in job.clients and len(job.clients) >= 64:
                raise HTTPException(429, "共享声音计算会话过多，请稍后重试")
            if client not in job.clients and len(job.clients) + len(job.retired_clients) >= 256:
                raise HTTPException(429, "声音计算会话记录已满，请等待当前任务完成")
            job.clients[client] = now
        elif starting:
            # Old clients have no lease heartbeats. Preserve explicit whole-job cancellation.
            job.legacy_interest = True

    def _cancel_uninterested(self) -> None:
        now = time.monotonic()
        for job in self.jobs.values():
            job.clients = {
                key: at for key, at in job.clients.items() if now - at < self.interest_ttl
            }
            if job.state in ACTIVE_STATES and not job.legacy_interest and not job.clients:
                self._cancel_job(job)

    def _cancel_job(self, job: MixJob) -> None:
        job.cancel.set()
        if job.state == "queued":
            job.state = job.phase = "cancelled"
            self._remove_folder(job.folder, job.folder.parent.parent)
        elif job.state == "running":
            job.phase = "cancelling"

    @staticmethod
    def _fingerprints(sources: list[Path]) -> list[dict]:
        result = []
        for path in sources:
            path = Path(path)
            if path.is_symlink() or not path.is_file():
                raise HTTPException(404, "声音素材不存在或已替换")
            try:
                stat = path.stat()
            except OSError as exc:
                raise HTTPException(409, "声音素材在检查期间变化，请重试") from exc
            result.append(
                {
                    "path": str(path.resolve()),
                    "size": stat.st_size,
                    "mtime": stat.st_mtime_ns,
                    "ctime": stat.st_ctime_ns,
                    "inode": stat.st_ino,
                }
            )
        return result

    def _source_matches(self, job: MixJob) -> bool:
        try:
            self._workspace(job.workspace)
            resolver = self.source_resolver or _adapters().resolve_mix_sources
            sources = resolver(job.kind, job.document, job.workspace, self.check_path_trust)
            return self._fingerprints(sources) == job.fingerprints
        except (HTTPException, OSError, ValueError):
            return False

    def _cache_matches(self, job: MixJob) -> bool:
        return (
            self._safe_folder(job.folder, job.folder.parent.parent)
            and not job.path.is_symlink()
            and job.path.is_file()
        )

    @staticmethod
    def _safe_folder(folder: Path, root: Path) -> bool:
        return (
            not folder.is_symlink()
            and not folder.parent.is_symlink()
            and folder.resolve().is_relative_to(root)
            and folder != root
        )

    def _remove_folder(self, folder: Path, root: Path) -> None:
        if self._safe_folder(folder, root):
            shutil.rmtree(folder, ignore_errors=True)

    def _load(self, root: Path) -> None:
        if root in self.loaded_roots:
            return
        self.loaded_roots.add(root)
        for workspace in root.iterdir():
            if not workspace.is_dir() or workspace.is_symlink():
                continue
            try:
                uuid.UUID(workspace.name)
            except ValueError:
                continue
            for folder in workspace.iterdir():
                if not folder.is_dir() or not self._safe_folder(folder, root):
                    continue
                try:
                    uuid.UUID(folder.name)
                    manifest = folder / "ready.json"
                    if manifest.is_symlink() or manifest.stat().st_size > 65536:
                        raise ValueError("Invalid manifest")
                    record = json.loads(manifest.read_text("utf-8"))
                    if (
                        record["version"] != FORMAT_VERSION
                        or record["id"] != folder.name
                        or record["workspace"] != workspace.name
                        or record["kind"] not in ("audio", "video")
                        or not isinstance(record["revision"], str)
                    ):
                        raise ValueError("Invalid manifest")
                    if (folder / "mix.wav").is_symlink():
                        raise ValueError("Invalid cached PCM")
                    info = inspect_float_wave(folder / "mix.wav")
                    if info.frames != round(float(record["duration"]) * RATE):
                        raise ValueError("Invalid PCM duration")
                    accessed = float(record["last_access"])
                    if not math.isfinite(accessed):
                        raise ValueError("Invalid cache access time")
                    record["last_access"] = max(accessed, manifest.stat().st_mtime)
                    record.update(
                        folder=folder, root=root, size=(folder / "mix.wav").stat().st_size
                    )
                    self.records[record["id"]] = record
                    while len(self.records) > self.max_history:
                        self._evict(
                            min(self.records.values(), key=lambda item: item["last_access"])
                        )
                except (OSError, ValueError, KeyError, TypeError):
                    self._remove_folder(folder, root)

    def _expire(self, job: MixJob, reason: str) -> None:
        job.cancel.set()
        job.state = "expired"
        job.phase = "expired"
        job.error = reason
        if not job.pins:
            record = self.records.pop(job.id, None)
            if record:
                self._remove_folder(job.folder, record["root"])

    def _evict(self, record: dict) -> None:
        job = self.jobs.get(record["id"])
        if job:
            self._expire(job, "声音缓存已回收，可重新计算")
        else:
            self.records.pop(record["id"], None)
            self._remove_folder(record["folder"], record["root"])

    def _ensure_space(self, root: Path, output_bytes: int) -> None:
        if output_bytes > self.budget_bytes:
            raise HTTPException(507, "工程声音缓存超过磁盘容量预算，请缩短工程或增加缓存容量")
        # Ducking may retain one dialogue sidechain and three intermediate PCM copies.
        scratch_bytes = output_bytes * 4 + self.free_reserve
        while True:
            used = sum(record["size"] for record in self.records.values())
            if (
                used + output_bytes <= self.budget_bytes
                and shutil.disk_usage(root).free >= scratch_bytes
                and len(self.records) < self.max_history
            ):
                return
            candidates = sorted(
                (
                    record
                    for record in self.records.values()
                    if not self.jobs.get(record["id"]) or not self.jobs[record["id"]].pins
                ),
                key=lambda item: item["last_access"],
            )
            if not candidates:
                raise HTTPException(507, "声音缓存磁盘空间不足，或已有导出正在使用缓存")
            self._evict(candidates[0])

    def _trim_history(self) -> None:
        terminal = sorted(
            (job for job in self.jobs.values() if job.state not in ACTIVE_STATES and not job.pins),
            key=lambda job: job.last_access,
        )
        while len(self.jobs) >= self.max_history and terminal:
            self.jobs.pop(terminal.pop(0).id, None)

    def start(
        self, workspace_id: str, kind: str, document: Any, client_id: str | None = None
    ) -> dict:
        client = self._client(client_id)
        workspace, normalized, sources, fingerprints, duration, revision = self._prepare(
            workspace_id, kind, document
        )
        with self.condition:
            if self.closed:
                raise HTTPException(503, "声音缓存服务已关闭")
            if self.blocked.get(workspace):
                raise HTTPException(409, "工作区正在清理，请稍后再试")
            # Source resolution happens before this lock; deletion can finish meanwhile.
            self.validate_workspace(workspace)
            self._cancel_uninterested()
            root = self._root()
            self._load(root)
            for job in self.jobs.values():
                if (
                    job.workspace == workspace
                    and job.revision == revision
                    and job.state in ("queued", "running", "ready")
                    and not job.cancel.is_set()
                ):
                    if job.folder.parent.parent == root and self._source_matches(job):
                        if job.state != "ready" or self._cache_matches(job):
                            self._touch(job)
                            self._register_interest(job, client, starting=True)
                            return job.status()
                    if job.state == "ready":
                        self._expire(job, "声音源已变化，请重新计算")
            self._trim_history()
            recovered = next(
                (
                    item
                    for item in self.records.values()
                    if item["workspace"] == workspace
                    and item["kind"] == kind
                    and item["revision"] == revision
                    and item["root"] == root
                    and (not self.jobs.get(item["id"]) or self.jobs[item["id"]].state == "ready")
                ),
                None,
            )
            if recovered:
                job = MixJob(
                    recovered["id"],
                    workspace,
                    kind,
                    revision,
                    normalized,
                    sources,
                    fingerprints,
                    duration,
                    recovered["folder"],
                    state="ready",
                    phase="ready",
                    progress=1,
                )
                self.jobs[job.id] = job
                self._register_interest(job, client, starting=True)
                self._touch(job)
                return job.status()
            if sum(job.state in ACTIVE_STATES for job in self.jobs.values()) >= self.max_active:
                raise HTTPException(429, "声音计算队列已满，请稍后再试")
            estimate = round(duration * RATE) * FRAME_BYTES + 65536
            self._ensure_space(root, estimate)
            key = str(uuid.uuid4())
            folder = root / workspace / key
            folder.parent.mkdir(exist_ok=True)
            if not self._safe_folder(folder, root):
                raise HTTPException(403, "声音缓存路径无效")
            folder.mkdir()
            job = MixJob(
                key, workspace, kind, revision, normalized, sources, fingerprints, duration, folder
            )
            self.jobs[key] = job
            self._register_interest(job, client, starting=True)
            if self.worker is None or not self.worker.is_alive():
                self.worker = threading.Thread(
                    target=self._run, name="audio-final-mix", daemon=True
                )
                self.worker.start()
            self.condition.notify_all()
            return job.status()

    def _touch(self, job: MixJob) -> None:
        job.last_access = time.time()
        record = self.records.get(job.id)
        if record:
            record["last_access"] = job.last_access
            try:
                os.utime(job.folder / "ready.json", None)
            except OSError:
                pass

    def _find(self, key: str, workspace: str) -> MixJob:
        job = self.jobs.get(key)
        if not job or job.workspace != workspace or self.blocked.get(workspace):
            raise HTTPException(404, "声音缓存任务不存在或已过期")
        return job

    def get(self, key: str, workspace_id: str, client_id: str | None = None) -> dict:
        client = self._client(client_id)
        workspace = self._workspace(workspace_id)
        with self.condition:
            job = self._find(key, workspace)
            self._register_interest(job, client)
            self._cancel_uninterested()
            if job.state == "ready" and (
                not self._source_matches(job) or not self._cache_matches(job)
            ):
                self._expire(job, "声音源已变化或缓存已回收，请重新计算")
            return job.status()

    def cancel(self, key: str, workspace_id: str, client_id: str | None = None) -> dict:
        client = self._client(client_id)
        workspace = self._workspace(workspace_id)
        with self.condition:
            job = self._find(key, workspace)
            if job.state in ACTIVE_STATES:
                if client:
                    if (
                        client not in job.clients
                        and client not in job.retired_clients
                        and len(job.clients) + len(job.retired_clients) >= 256
                    ):
                        raise HTTPException(429, "声音计算会话记录已满，请等待当前任务完成")
                    job.clients.pop(client, None)
                    job.retired_clients.add(client)
                    self._cancel_uninterested()
                else:
                    self._cancel_job(job)
            self.condition.notify_all()
            return job.status()

    def _run(self) -> None:
        while True:
            with self.condition:
                while not self.closed:
                    self._cancel_uninterested()
                    job = next((job for job in self.jobs.values() if job.state == "queued"), None)
                    if job:
                        break
                    self.condition.wait(min(5, self.interest_ttl / 2))
                if self.closed:
                    return
                job.state = "running"
                job.phase = "preparing"
            try:
                if job.cancel.is_set() or not self._source_matches(job):
                    raise HTTPException(409, "声音源已变化或任务已取消")
                with self.condition:
                    self._ensure_space(
                        job.folder.parent.parent, round(job.duration * RATE) * FRAME_BYTES + 65536
                    )
                work = job.folder / "work"
                work.mkdir()
                watch_stop = threading.Event()

                def watch_interest(stop=watch_stop):
                    while not stop.wait(min(0.5, self.interest_ttl / 2)):
                        with self.condition:
                            self._cancel_uninterested()

                watcher = threading.Thread(target=watch_interest, name="mix-interests", daemon=True)
                watcher.start()

                def progress(phase: str, value: float, current=job):
                    with self.condition:
                        if current.state == "running" and not current.cancel.is_set():
                            current.phase = str(phase)[:128]
                            if math.isfinite(value):
                                current.progress = max(current.progress, min(0.99, max(0, value)))

                renderer = self.renderer or _adapters().render_full_mix
                try:
                    renderer(
                        job.kind,
                        job.document,
                        job.sources,
                        job.path,
                        work,
                        cancelled=job.cancel,
                        on_progress=progress,
                    )
                finally:
                    watch_stop.set()
                    watcher.join(timeout=1)
                if job.cancel.is_set():
                    raise HTTPException(409, "声音计算已取消")
                if not self._source_matches(job):
                    raise HTTPException(409, "声音源在计算期间变化，请重新计算")
                info = inspect_float_wave(job.path)
                if info.frames != round(job.duration * RATE):
                    raise ValueError("完整混音的时长与工程声音时长不一致")
                with self.condition:
                    if job.cancel.is_set() or self.blocked.get(job.workspace) or self.closed:
                        raise HTTPException(409, "声音计算已取消")
                    root = job.folder.parent.parent
                    if self._root() != root:
                        raise HTTPException(409, "存储位置已变化，请重新计算")
                    shutil.rmtree(work, ignore_errors=True)
                    record = {
                        "version": FORMAT_VERSION,
                        "id": job.id,
                        "workspace": job.workspace,
                        "kind": job.kind,
                        "revision": job.revision,
                        "duration": job.duration,
                        "last_access": time.time(),
                    }
                    manifest = job.folder / "ready.json"
                    manifest.write_text(json.dumps(record), encoding="utf-8")
                    record.update(folder=job.folder, root=root, size=job.path.stat().st_size)
                    self.records[job.id] = record
                    job.state = job.phase = "ready"
                    job.progress = 1
                    job.last_access = record["last_access"]
            except Exception as exc:
                with self.condition:
                    if job.cancel.is_set() or self.closed or self.blocked.get(job.workspace):
                        job.state = job.phase = "cancelled"
                        job.error = ""
                    else:
                        job.state = job.phase = "failed"
                        job.error = (
                            str(exc.detail)
                            if isinstance(exc, HTTPException)
                            else (
                                str(exc)
                                if isinstance(exc, ValueError)
                                else "完整声音计算失败，请检查素材与磁盘"
                            )
                        )
                    self._remove_folder(job.folder, job.folder.parent.parent)
            finally:
                with self.condition:
                    self.condition.notify_all()

    @contextmanager
    def _lease_job(self, job: MixJob):
        with self.condition:
            available = (
                job.state == "ready"
                and not self.blocked.get(job.workspace)
                and self._source_matches(job)
                and self._cache_matches(job)
            )
            if not available:
                if job.state == "ready":
                    self._expire(job, "声音源已变化或缓存已回收，请重新计算")
            else:
                job.pins += 1
                self._touch(job)
        if not available:
            yield None
            return
        try:
            yield job.path
        finally:
            with self.condition:
                job.pins -= 1
                if job.state == "expired" and not job.pins:
                    record = self.records.pop(job.id, None)
                    if record:
                        self._remove_folder(job.folder, record["root"])
                self.condition.notify_all()

    @contextmanager
    def lease_ready(self, workspace_id: str, kind: str, document: Any):
        try:
            workspace, _, _, _, _, revision = self._prepare(workspace_id, kind, document)
        except (HTTPException, OSError, ValueError):
            yield None
            return
        with self.condition:
            job = next(
                (
                    job
                    for job in self.jobs.values()
                    if job.workspace == workspace
                    and job.kind == kind
                    and job.revision == revision
                    and job.state == "ready"
                ),
                None,
            )
        if not job:
            yield None
            return
        with self._lease_job(job) as path:
            yield path

    def chunk(
        self, key: str, workspace_id: str, start: float, duration: float
    ) -> tuple[bytes, str]:
        workspace = self._workspace(workspace_id)
        with self.condition:
            job = self._find(key, workspace)
        limit = 86400 if job.kind == "audio" else 21600
        if (
            not math.isfinite(start)
            or not math.isfinite(duration)
            or start < 0
            or duration <= 0
            or duration > MAX_CHUNK_SECONDS
            or start + duration > limit + 1 / RATE
        ):
            raise HTTPException(422, "试听范围必须在工程时长内且不超过 12 秒")
        first = round(start * RATE)
        count = round(duration * RATE)
        if count < 1:
            raise HTTPException(422, "试听范围至少需要一个采样点")
        with self._lease_job(job) as path:
            if path is None:
                raise HTTPException(409, "完整声音尚未就绪或缓存已过期")
            try:
                info = inspect_float_wave(path)
                values = np.zeros((count, 2), dtype="<f4")
                available = min(count, max(0, info.frames - first))
                if available:
                    with path.open("rb") as stream:
                        stream.seek(info.offset + first * FRAME_BYTES)
                        data = stream.read(available * FRAME_BYTES)
                    if len(data) != available * FRAME_BYTES:
                        raise ValueError("声音缓存读取不完整")
                    values[:available] = np.frombuffer(data, dtype="<f4").reshape(-1, 2)
                if not np.isfinite(values).all():
                    raise ValueError("声音缓存采样无效")
                if not self._source_matches(job):
                    with self.condition:
                        self._expire(job, "声音源已变化，请重新计算")
                    raise HTTPException(409, "声音源已变化，请重新计算")
                return float_wave_bytes(values), level_peaks(values)
            except (OSError, ValueError) as exc:
                with self.condition:
                    self._expire(job, "声音缓存损坏，请重新计算")
                raise HTTPException(409, "声音缓存损坏，请重新计算") from exc

    @contextmanager
    def removing_workspace(self, workspace_id: str):
        workspace = str(uuid.UUID(workspace_id))
        with self.condition:
            self._load(self._root())
            self.blocked[workspace] = self.blocked.get(workspace, 0) + 1
            for job in self.jobs.values():
                if job.workspace == workspace and job.state in ACTIVE_STATES:
                    job.cancel.set()
                    if job.state == "queued":
                        job.state = job.phase = "cancelled"
            self.condition.notify_all()
        try:
            deadline = time.monotonic() + 30
            with self.condition:
                while any(
                    job.workspace == workspace and (job.state == "running" or job.pins)
                    for job in self.jobs.values()
                ):
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise HTTPException(409, "声音任务仍在退出，请稍后重试工作区清理")
                    self.condition.wait(min(0.25, remaining))
                for job in list(self.jobs.values()):
                    if job.workspace == workspace:
                        self._expire(job, "工作区声音缓存已清理")
                        self._remove_folder(job.folder, job.folder.parent.parent)
                for record in list(self.records.values()):
                    if record["workspace"] == workspace:
                        self._evict(record)
            yield
        finally:
            with self.condition:
                self.blocked[workspace] -= 1
                if not self.blocked[workspace]:
                    del self.blocked[workspace]
                self.condition.notify_all()

    def close(self) -> None:
        with self.condition:
            self.closed = True
            for job in self.jobs.values():
                if job.state in ACTIVE_STATES:
                    job.cancel.set()
                    if job.state == "queued":
                        job.state = job.phase = "cancelled"
                        self._remove_folder(job.folder, job.folder.parent.parent)
            self.condition.notify_all()
            worker = self.worker
        if worker and worker is not threading.current_thread():
            worker.join(timeout=15)


_singleton: AudioMixCacheManager | None = None
_singleton_lock = threading.Lock()


def get_audio_mix_cache_manager() -> AudioMixCacheManager:
    global _singleton
    with _singleton_lock:
        if _singleton is None or _singleton.closed:
            _singleton = AudioMixCacheManager()
        return _singleton


class StartMix(BaseModel):
    workspace_id: str
    kind: Literal["audio", "video"]
    document: dict
    client_id: str | None = None


def mount_audio_mix_cache_routes(
    app: FastAPI,
    base: str,
    verify_secret,
    check_path_trust,
    validate_workspace=None,
    *,
    manager: AudioMixCacheManager | None = None,
) -> AudioMixCacheManager:
    manager = manager or get_audio_mix_cache_manager()
    manager.check_path_trust = check_path_trust
    if validate_workspace:
        manager.validate_workspace = validate_workspace

    @app.post(base + "/audio_mix_cache/start", dependencies=[Depends(verify_secret)])
    def start_mix(request: StartMix):
        return manager.start(
            request.workspace_id, request.kind, request.document, request.client_id
        )

    @app.get(base + "/audio_mix_cache/{key}", dependencies=[Depends(verify_secret)])
    def get_mix(key: str, workspace_id: str, client_id: str | None = None):
        return manager.get(key, workspace_id, client_id)

    @app.post(base + "/audio_mix_cache/{key}/cancel", dependencies=[Depends(verify_secret)])
    def cancel_mix(key: str, workspace_id: str, client_id: str | None = None):
        return manager.cancel(key, workspace_id, client_id)

    @app.get(base + "/audio_mix_cache/{key}/chunk", dependencies=[Depends(verify_secret)])
    def mix_chunk(key: str, workspace_id: str, start: float = 0, duration: float = 12):
        body, peaks = manager.chunk(key, workspace_id, start, duration)
        return Response(
            body,
            media_type="audio/wav",
            headers={
                "X-Audio-Level-Peaks": peaks,
                "Access-Control-Expose-Headers": "X-Audio-Level-Peaks",
                "Cache-Control": "no-store",
            },
        )

    return manager
