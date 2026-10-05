"""Non-destructive audio timelines. Preview and export use the same sample-time mixer."""

import base64
import hashlib
import json
import math
import os
import subprocess
import tempfile
import threading
import uuid
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Literal

import numpy as np
from fastapi import Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator

from omnigallery.infrastructure.database import Database
from omnigallery.infrastructure.media_runtime import binary as media_binary
from omnigallery.storage.project_files import storage_operation, storage_root
from omnigallery.workspaces.artifacts import (
    ARTIFACT_COLUMNS,
    _artifact_name,
    _file,
    _row,
    _uuid,
    artifact_root,
)
from omnigallery.workspaces.audio_processing import (
    AudioProcessing,
    GainPoint,
)
from omnigallery.workspaces.state import state_snapshot

RATE = 48000
HIDDEN = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


class AudioClip(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    id: str = Field(min_length=1, max_length=80)
    path: str = Field(min_length=1, max_length=8192)
    name: str = Field(default="", max_length=256)
    sourceKind: Literal["audio", "video"] = "audio"
    audioStream: int = Field(default=0, ge=0, le=255, strict=True)
    rate: float = Field(default=1, ge=0.25, le=4)
    preservePitch: bool = True
    start: float = Field(ge=0, le=86400)
    sourceIn: float = Field(ge=0, le=86400)
    duration: float = Field(gt=0, le=86400)
    gain: float = Field(default=1, ge=0, le=4)
    fadeIn: float = Field(default=0, ge=0, le=86400)
    fadeOut: float = Field(default=0, ge=0, le=86400)
    fadeCurve: Literal["linear", "smooth", "equalPower"] = "linear"
    channels: Literal["stereo", "swap", "mono", "left", "right"] = "stereo"
    invertPhase: bool = False
    # Envelope stays anchored through split/trim; changing fades starts a new envelope.
    envelopeOffset: float = Field(default=0, ge=0, le=86400)
    envelopeDuration: float = Field(gt=0, le=86400)
    pan: float = Field(default=0, ge=-1, le=1)
    gainPoints: list[GainPoint] = Field(default_factory=list, max_length=128)

    @model_validator(mode="after")
    def valid_envelope(self):
        if (
            self.start + self.duration > 86400
            or self.sourceIn + self.duration * self.rate > 86400 + 1 / RATE
        ):
            raise ValueError("片段超出 24 小时时间线")
        if self.envelopeOffset + self.duration > self.envelopeDuration + 1 / RATE:
            raise ValueError("淡入淡出范围无效")
        if self.fadeIn + self.fadeOut > self.envelopeDuration + 1 / RATE:
            raise ValueError("淡入淡出范围重叠")
        if any(point.time > self.envelopeDuration + 1 / RATE for point in self.gainPoints) or any(
            left.time >= right.time
            for left, right in zip(self.gainPoints, self.gainPoints[1:], strict=False)
        ):
            raise ValueError("音量曲线的时间必须递增且位于片段范围内")
        return self


class AudioTrack(BaseModel):
    pan: float = Field(default=0, ge=-1, le=1)
    role: Literal["sound", "dialogue", "music"] = "sound"
    duck: bool = False
    processing: AudioProcessing = Field(default_factory=AudioProcessing)
    model_config = ConfigDict(allow_inf_nan=False)
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(default="音轨", max_length=120)
    gain: float = Field(default=1, ge=0, le=4)
    muted: bool = False
    solo: bool = False
    locked: bool = False
    clips: list[AudioClip] = Field(default_factory=list, max_length=256)


class TextCue(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    id: str = Field(min_length=1, max_length=80)
    text: str = Field(max_length=5000)
    start: float = Field(ge=0, le=86400)
    duration: float = Field(ge=0.001, le=86400)

    @model_validator(mode="after")
    def valid_time(self):
        if self.start + self.duration > 86400:
            raise ValueError("文字片段超出 24 小时时间线")
        return self


class TextTrack(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(max_length=120)
    visible: bool = True
    locked: bool = False
    cues: list[TextCue] = Field(default_factory=list, max_length=4096)


class AudioDocument(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    version: Literal[1] = 1
    tracks: list[AudioTrack] = Field(max_length=32)
    masterGain: float = Field(default=1, ge=0, le=2)
    # Text is persisted with the document but never enters the audio filter graph.
    textTracks: list[TextTrack] = Field(default_factory=list, max_length=8)
    markers: list["AudioMarker"] = Field(default_factory=list, max_length=256)
    processing: AudioProcessing = Field(default_factory=AudioProcessing)
    groups: list[list[str]] = Field(default_factory=list, max_length=256)

    @model_validator(mode="after")
    def valid_groups(self):
        if any(
            len(group) > 256
            or len(group) != len(set(group))
            or any(not item or len(item) > 80 for item in group)
            for group in self.groups
        ):
            raise ValueError("片段分组数据无效")
        return self


class AudioMarker(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(max_length=120)
    time: float = Field(ge=0, le=86400)
    note: str = Field(default="", strict=True, max_length=2000)


class AudioRender(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    workspace_id: str
    document: AudioDocument
    start: float = Field(default=0, ge=0, le=86400)
    duration: float = Field(gt=0, le=86400)


class AudioExport(AudioRender):
    name: str = Field(min_length=1, max_length=120)
    format: Literal["wav", "mp3"] = "wav"
    document_id: str = Field(min_length=1, max_length=80, pattern=r"^[\w-]+$")
    document_revision: str = Field(pattern=r"^[a-f0-9]{64}$")


def _binary(name):
    path = media_binary(name)
    if not path:
        raise HTTPException(503, f"音频制作需要 {name}，请到设置 → 运行环境检查 FFmpeg")
    return path


def resolve_source(path, workspace_id, check_path_trust):
    if path.startswith("workspace-artifact:"):
        row = _row(Database.get_connection(), path.removeprefix("workspace-artifact:"))
        if row["workspace_id"] != _uuid(workspace_id) or row["kind"] not in {"audio", "video"}:
            raise HTTPException(403, "声音来源不可用或不属于当前工作区")
        source = _file(row)
        if source.is_symlink() or not source.resolve().is_relative_to(
            (artifact_root() / _uuid(workspace_id)).resolve()
        ):
            raise HTTPException(403, "声音产物路径不安全")
        return source
    check_path_trust(path)
    source = Path(path)
    if not source.is_file():
        raise HTTPException(404, "声音源文件不可用，请恢复文件后重试")
    source = source.resolve()
    check_path_trust(str(source))
    return source


def probe_source(path, audio_stream=0):
    stat = path.stat()
    return _probe_source(
        str(path), stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_ino, audio_stream
    )


@lru_cache(maxsize=256)
def _probe_source(path, size, modified, changed, inode, audio_stream=0):
    from omnigallery.workspaces.audio_streams import enumerate_audio_streams, selected_audio_stream

    try:
        result = subprocess.run(
            [
                _binary("ffprobe"),
                "-v",
                "error",
                "-show_entries",
                "stream=index,codec_type,sample_rate,channels,channel_layout,codec_name,duration,start_time:stream_tags=language,title,DURATION:stream_disposition=default:format=duration,start_time,format_name",
                "-of",
                "json",
                str(path),
            ],
            capture_output=True,
            timeout=30,
            creationflags=HIDDEN,
            check=True,
        )
        info = json.loads(result.stdout)
        if not enumerate_audio_streams(info):
            raise HTTPException(422, "素材没有可用音轨，无法添加到音频制作")
        return {
            **selected_audio_stream(info, audio_stream),
            "audio_streams": enumerate_audio_streams(info),
        }
    except OSError as exc:
        raise HTTPException(503, "无法启动 FFprobe 读取音频") from exc
    except (subprocess.SubprocessError, ValueError, KeyError, IndexError) as exc:
        raise HTTPException(422, "无法读取音频，请检查文件和音频编码") from exc


def waveform(path, start=0, duration=None, count=4096, audio_stream=0):
    metadata = probe_source(path, audio_stream)
    if duration is not None and (not math.isfinite(duration) or duration <= 0):
        raise HTTPException(422, "波形时长无效")
    if not math.isfinite(start) or start < 0 or start >= metadata["duration"]:
        raise HTTPException(422, "波形起点超出音频范围")
    length = min(
        metadata["duration"] - start, duration if duration is not None else metadata["duration"]
    )
    if not math.isfinite(length) or length <= 0 or not 32 <= count <= 8192:
        raise HTTPException(422, "波形范围或精度无效")
    stat = path.stat()
    fingerprint = hashlib.sha256(
        f"{path}:{stat.st_size}:{stat.st_mtime_ns}:{stat.st_ctime_ns}:{stat.st_ino}:v6:{audio_stream}:{start:.6f}:{length:.6f}:{count}".encode()
    ).hexdigest()
    cache = storage_root() / "audio-waveforms"
    cache.mkdir(parents=True, exist_ok=True)
    target = cache / (fingerprint + ".json")
    if target.is_file():
        try:
            return json.loads(target.read_text("utf-8"))
        except (OSError, ValueError):
            pass
    channels = np.zeros((2, count), dtype=np.float32)
    samples = max(1, math.ceil(length * RATE))
    gap = min(length, max(0, metadata["start_time"] - start))
    position = round(gap * RATE)
    if gap < length:
        # Stream blocks: source length never determines RAM usage.
        with tempfile.TemporaryFile() as errors:
            try:
                process = subprocess.Popen(
                    [
                        _binary("ffmpeg"),
                        "-nostdin",
                        "-v",
                        "error",
                        "-ss",
                        str(start + gap),
                        "-t",
                        str(max(1 / RATE, length - gap)),
                        "-i",
                        str(path),
                        "-map",
                        f"0:a:{audio_stream}",
                        "-vn",
                        "-ac",
                        "2",
                        "-ar",
                        str(RATE),
                        "-f",
                        "f32le",
                        "pipe:1",
                    ],
                    stdout=subprocess.PIPE,
                    stderr=errors,
                    creationflags=HIDDEN,
                )
            except OSError as exc:
                raise HTTPException(503, "无法启动 FFmpeg 解析音频波形") from exc
            try:
                while block := process.stdout.read(65536):
                    values = np.abs(np.frombuffer(block, dtype="<f4").reshape(-1, 2))
                    indices = np.minimum(
                        (np.arange(len(values)) + position) * count // samples, count - 1
                    )
                    for channel in range(2):
                        np.maximum.at(channels[channel], indices, values[:, channel])
                    position += len(values)
                if process.wait() != 0:
                    raise HTTPException(422, "音频波形解析失败")
            finally:
                process.stdout.close()
                if process.poll() is None:
                    process.kill()
                    process.wait()
    result = {
        **metadata,
        "window_start": start,
        "window_duration": length,
        "peaks": np.round(np.max(channels, axis=0), 5).tolist(),
        "channel_peaks": np.round(channels, 5).tolist(),
    }
    with tempfile.NamedTemporaryFile(dir=cache, delete=False) as output:
        temporary = Path(output.name)
        output.write(json.dumps(result).encode())
    os.replace(temporary, target)
    # This cache is disposable; bound retained files, never touch source audio.
    old = []
    for item in cache.glob("*.json"):
        try:
            old.append((item.stat().st_mtime, item))
        except FileNotFoundError:
            pass
    for _, item in sorted(old, reverse=True)[2048:]:
        item.unlink(missing_ok=True)
    return result


def audible_tracks(document):
    solo = any(track.solo for track in document.tracks)
    return [track for track in document.tracks if not track.muted and (not solo or track.solo)]


@lru_cache(maxsize=4)
def graph_option(ffmpeg):
    # FFmpeg 9 removed filter_complex_script; slash-prefixed options read arguments from files.
    try:
        help_text = subprocess.run(
            [ffmpeg, "-h", "full"],
            capture_output=True,
            timeout=30,
            creationflags=HIDDEN,
            check=True,
        ).stdout
    except (OSError, subprocess.SubprocessError) as exc:
        raise HTTPException(503, "无法检查 FFmpeg 音频滤镜支持") from exc
    return (
        "-filter_complex_script" if b"-filter_complex_script" in help_text else "-/filter_complex"
    )


def tempo_filter(rate):
    factors = []
    while rate < 0.5:
        factors.append("atempo=0.5")
        rate /= 0.5
    while rate > 2:
        factors.append("atempo=2")
        rate /= 2
    factors.append(f"atempo={rate:.9f}")
    return ",".join(factors)


def render_audio(
    request,
    target,
    check_path_trust,
    audio_format="wav",
    meter_target=None,
    runner=None,
    preview_context=False,
    cancelled=None,
    check_cancel=None,
):
    from omnigallery.workspaces.audio_mix_render import (
        export_mix_slice,
        needs_full_mix,
        render_full_mix,
        resolve_mix_sources,
        sound_document,
    )
    from omnigallery.workspaces.video_audio import render_video_audio, source_metadata

    cancelled = cancelled or threading.Event()

    start, duration = round(request.start * RATE) / RATE, round(request.duration * RATE) / RATE
    if duration <= 0 or start + duration > 86400:
        raise HTTPException(422, "导出范围无效")
    with tempfile.TemporaryDirectory(dir=Path(target).parent) as temporary:
        directory = Path(temporary)
        mix = directory / "complete.wav"
        if needs_full_mix("audio", request.document):
            from contextlib import nullcontext

            from omnigallery.workspaces.audio_mix_cache import get_audio_mix_cache_manager

            manager = get_audio_mix_cache_manager()
            lease = (
                manager.lease_ready(request.workspace_id, "audio", request.document)
                if manager
                else nullcontext(None)
            )
            with lease as cached:
                if not cached:
                    if preview_context:
                        raise HTTPException(409, "声音处理需要先准备完整混音，请开始异步混音任务")
                    sources = resolve_mix_sources(
                        "audio", request.document, request.workspace_id, check_path_trust
                    )
                    render_full_mix(
                        "audio",
                        request.document,
                        sources,
                        mix,
                        directory,
                        runner=runner,
                        cancelled=cancelled,
                        check_cancel=check_cancel,
                    )
                return export_mix_slice(
                    cached or mix,
                    target,
                    directory,
                    start,
                    duration,
                    audio_format,
                    runner=runner,
                    check_cancel=check_cancel,
                    float_output=preview_context,
                    meter_target=meter_target,
                )
        sources = resolve_mix_sources(
            "audio", request.document, request.workspace_id, check_path_trust
        )
        # Validation covers silent/out-of-range clips while decoding only bounded windows.
        clips = [clip for track in request.document.tracks for clip in track.clips]
        source_info = []
        for clip, source in zip(clips, sources, strict=True):
            if check_cancel:
                check_cancel()
            metadata = source_metadata(source, directory, cancelled, clip.audioStream, check_cancel)
            source_info.append(metadata)
            if clip.sourceIn + clip.duration * clip.rate > metadata["duration"] + 0.03:
                raise HTTPException(422, f"片段超出源音频范围：{clip.name}")
        render_video_audio(
            sound_document("audio", request.document),
            sources,
            mix,
            directory,
            start,
            duration,
            runner=runner,
            preview=preview_context,
            max_duration=86400,
            source_info=source_info,
            check_cancel=check_cancel,
        )
        return export_mix_slice(
            mix,
            target,
            directory,
            0,
            duration,
            audio_format,
            runner=runner,
            check_cancel=check_cancel,
            float_output=preview_context,
            meter_target=meter_target,
        )


def meter_windows(path):
    values = np.fromfile(path, dtype="<f4").reshape(-1, 2)
    step = RATE // 20
    if not len(values):
        return ""
    padding = (-len(values)) % step
    values = np.pad(values, ((0, padding), (0, 0)))
    peaks = np.max(np.abs(values.reshape(-1, step, 2)), axis=1).astype("<f4")
    return base64.b64encode(peaks.tobytes()).decode("ascii")


def assert_saved_audio_document(conn, request, *, current_revision=True):
    entries = state_snapshot(conn, request.workspace_id)["entries"]
    try:
        works = json.loads(
            entries.get(f"omnigallery:workspace-works-v2:{request.workspace_id}", "{}")
        )
        drafts = [
            draft
            for work in works.get("works", [])
            for draft in work.get("drafts", [])
            if isinstance(draft, dict)
        ]
    except (ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(409, "工作区制作文件索引无法读取") from exc
    if not any(
        draft.get("id") == request.document_id and draft.get("kind") == "audio" for draft in drafts
    ):
        raise HTTPException(409, "音频制作文件已删除，请返回工作台")
    if not current_revision:
        return
    raw = entries.get(f"omnigallery:audio-timeline-v1:{request.workspace_id}:{request.document_id}")
    if not raw or hashlib.sha256(raw.encode()).hexdigest() != request.document_revision:
        raise HTTPException(409, "音频制作文件已变化，请重新保存后导出")
    try:
        # Legacy timelines omit optional defaults such as rate and textTracks.
        if json.loads(raw) != request.document.model_dump(exclude_unset=True):
            raise HTTPException(409, "导出内容与已保存的音频制作文件不一致")
    except (ValueError, TypeError) as exc:
        raise HTTPException(409, "已保存的音频制作文件无法读取") from exc


@storage_operation
def commit_audio(request, temporary, *, current_revision=True, committed=None):
    conn = Database.get_connection()
    artifact_id = str(uuid.uuid4())
    name = _artifact_name(request.name, request.format)
    directory = artifact_root() / _uuid(request.workspace_id)
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / (artifact_id + "." + request.format)
    size = temporary.stat().st_size
    stamp = datetime.now(UTC).isoformat()
    values = (
        artifact_id,
        request.workspace_id,
        name,
        "audio",
        "audio_studio",
        request.format,
        0,
        0,
        size,
        stamp,
    )
    try:
        conn.execute("BEGIN IMMEDIATE")
        assert_saved_audio_document(conn, request, current_revision=current_revision)
        os.replace(temporary, target)
        conn.execute("INSERT INTO workspace_artifact VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", values)
        conn.execute(
            "INSERT INTO workspace_artifact_origin VALUES (?, ?, ?)",
            (artifact_id, request.document_id, request.document_revision),
        )
        if committed:
            committed(
                conn,
                {
                    **dict(zip(ARTIFACT_COLUMNS, values, strict=True)),
                    "document_id": request.document_id,
                    "document_revision": request.document_revision,
                    "collected": False,
                },
            )
        conn.commit()
    except Exception:
        conn.rollback()
        target.unlink(missing_ok=True)
        raise
    return {
        **dict(zip(ARTIFACT_COLUMNS, values, strict=True)),
        "document_id": request.document_id,
        "document_revision": request.document_revision,
        "collected": False,
    }


def mount_audio_studio_routes(
    app, base, verify_secret, write_permission_required, check_path_trust
):
    route = base + "/audio_studio"
    from omnigallery.workspaces.audio_analysis import AudioAnalyses

    analyses = AudioAnalyses()
    app.state.audio_analyses = analyses

    @app.post(route + "/analysis", dependencies=[Depends(verify_secret)])
    def analyze(request: AudioRender):
        request.workspace_id = _uuid(request.workspace_id)
        return analyses.submit(request, check_path_trust)

    @app.post(route + "/analysis/revision", dependencies=[Depends(verify_secret)])
    def analysis_revision(request: AudioRender):
        from omnigallery.workspaces.audio_mix_cache import get_audio_mix_cache_manager

        request.workspace_id = _uuid(request.workspace_id)
        return {
            "revision": get_audio_mix_cache_manager().revision(
                request.workspace_id, "audio", request.document
            )
        }

    @app.get(route + "/analysis/{job_id}", dependencies=[Depends(verify_secret)])
    def analysis(job_id: str, workspace_id: str):
        return analyses.get(job_id, _uuid(workspace_id))

    @app.delete(route + "/analysis/{job_id}", dependencies=[Depends(verify_secret)])
    def cancel_analysis(job_id: str, workspace_id: str):
        return analyses.cancel(job_id, _uuid(workspace_id))

    @app.get(route + "/source", dependencies=[Depends(verify_secret)])
    def source(
        workspace_id: str,
        path: str,
        peaks: bool = False,
        start: float = 0,
        duration: float | None = None,
        samples: int = 4096,
        audio_stream: int = 0,
    ):
        resolved = resolve_source(path, workspace_id, check_path_trust)
        return (
            waveform(resolved, start, duration, samples, audio_stream)
            if peaks
            else probe_source(resolved, audio_stream)
        )

    @app.post(route + "/preview", dependencies=[Depends(verify_secret)])
    async def preview(request: AudioRender, http: Request):
        from omnigallery.workspaces.video_audio import (
            PreviewCancelled,
            cancellable_process,
            preview_slots,
            wait_preview,
        )

        request.workspace_id = _uuid(request.workspace_id)
        if request.duration > 12:
            raise HTTPException(422, "试听每次最多载入 12 秒")
        cancelled = threading.Event()

        def check_cancel():
            if cancelled.is_set():
                raise PreviewCancelled()

        def worker():
            if not preview_slots.acquire(blocking=False):
                raise HTTPException(429, "声音试听繁忙，请稍后重试")
            try:
                with tempfile.TemporaryDirectory() as directory:
                    output = Path(directory) / "preview.wav"
                    levels = Path(directory) / "levels.f32"
                    render_audio(
                        request,
                        output,
                        check_path_trust,
                        meter_target=levels,
                        preview_context=True,
                        cancelled=cancelled,
                        check_cancel=check_cancel,
                        runner=lambda args, stage, span: cancellable_process(
                            args, stage, span, cancelled
                        ),
                    )
                    check_cancel()
                    return Response(
                        output.read_bytes(),
                        media_type="audio/wav",
                        headers={
                            "X-Audio-Level-Peaks": meter_windows(levels),
                            "Access-Control-Expose-Headers": "X-Audio-Level-Peaks",
                        },
                    )
            finally:
                preview_slots.release()

        try:
            return await wait_preview(worker, http.is_disconnected, cancelled)
        except PreviewCancelled as exc:
            raise HTTPException(499, "试听请求已取消") from exc

    @app.post(
        route + "/export", dependencies=[Depends(verify_secret), Depends(write_permission_required)]
    )
    def export(request: AudioExport):
        request.workspace_id = _uuid(request.workspace_id)
        assert_saved_audio_document(Database.get_connection(), request)
        directory = artifact_root() / request.workspace_id
        directory.mkdir(parents=True, exist_ok=True)
        # Temporary and destination live on the same volume for atomic publication.
        with tempfile.TemporaryDirectory(dir=directory) as temporary:
            output = Path(temporary) / ("mix." + request.format)
            peak = render_audio(request, output, check_path_trust, request.format)
            return {**commit_audio(request, output), "mix_peak_dbfs": peak}
