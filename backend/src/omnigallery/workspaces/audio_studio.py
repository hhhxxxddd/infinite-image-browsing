"""Non-destructive audio timelines. Preview and export use the same sample-time mixer."""

import base64
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import uuid
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Literal

import numpy as np
from fastapi import Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator

from omnigallery.infrastructure.database import Database
from omnigallery.storage.project_files import storage_operation, storage_root
from omnigallery.workspaces.artifacts import (
    ARTIFACT_COLUMNS,
    _artifact_name,
    _file,
    _row,
    _uuid,
    artifact_root,
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
    rate: float = Field(default=1, ge=0.25, le=4)
    preservePitch: bool = True
    start: float = Field(ge=0, le=86400)
    sourceIn: float = Field(ge=0, le=86400)
    duration: float = Field(gt=0, le=86400)
    gain: float = Field(default=1, ge=0, le=4)
    fadeIn: float = Field(default=0, ge=0, le=86400)
    fadeOut: float = Field(default=0, ge=0, le=86400)
    # Envelope stays anchored through split/trim; changing fades starts a new envelope.
    envelopeOffset: float = Field(default=0, ge=0, le=86400)
    envelopeDuration: float = Field(gt=0, le=86400)

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
        return self


class AudioTrack(BaseModel):
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


class AudioMarker(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(max_length=120)
    time: float = Field(ge=0, le=86400)


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
    path = shutil.which(name)
    if not path:
        raise HTTPException(503, f"音频制作需要 {name}，请安装 FFmpeg 并加入 PATH")
    return path


def resolve_source(path, workspace_id, check_path_trust):
    if path.startswith("workspace-artifact:"):
        row = _row(Database.get_connection(), path.removeprefix("workspace-artifact:"))
        if row["workspace_id"] != _uuid(workspace_id) or row["kind"] != "audio":
            raise HTTPException(403, "音频产物不属于当前工作区")
        return _file(row)
    check_path_trust(path)
    source = Path(path)
    if not source.is_file():
        raise HTTPException(404, "声音源文件不可用，请恢复文件后重试")
    return source.resolve()


def probe_source(path):
    stat = path.stat()
    return _probe_source(str(path), stat.st_size, stat.st_mtime_ns)


@lru_cache(maxsize=256)
def _probe_source(path, size, modified):
    try:
        result = subprocess.run(
            [
                _binary("ffprobe"),
                "-v",
                "error",
                "-select_streams",
                "a:0",
                "-show_entries",
                "stream=sample_rate,channels,codec_name,duration:format=duration",
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
        if not info.get("streams"):
            raise HTTPException(422, "素材没有可用音轨，无法添加到音频制作")
        stream = info["streams"][0]
        duration = float(stream.get("duration") or info["format"]["duration"])
        if not math.isfinite(duration) or not 0 < duration <= 86400:
            raise ValueError("音频时长无效或超过 24 小时")
        return {
            "duration": duration,
            "sampleRate": int(stream["sample_rate"]),
            "channels": int(stream["channels"]),
            "codec": stream["codec_name"],
        }
    except (subprocess.SubprocessError, ValueError, KeyError, IndexError) as exc:
        raise HTTPException(422, "无法读取音频，请检查文件和音频编码") from exc


def waveform(path):
    stat = path.stat()
    fingerprint = hashlib.sha256(
        f"{path}:{stat.st_size}:{stat.st_mtime_ns}:v3".encode()
    ).hexdigest()
    cache = storage_root() / "audio-waveforms"
    cache.mkdir(parents=True, exist_ok=True)
    target = cache / (fingerprint + ".json")
    if target.is_file():
        return json.loads(target.read_text("utf-8"))
    metadata = probe_source(path)
    count = 4096
    peaks = np.zeros(count, dtype=np.float32)
    samples = max(1, math.ceil(metadata["duration"] * RATE))
    position = 0
    # Stream blocks: source length never determines RAM usage.
    with tempfile.TemporaryFile() as errors:
        process = subprocess.Popen(
            [
                _binary("ffmpeg"),
                "-nostdin",
                "-v",
                "error",
                "-i",
                str(path),
                "-map",
                "0:a:0",
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
        try:
            while block := process.stdout.read(65536):
                values = np.max(np.abs(np.frombuffer(block, dtype="<f4").reshape(-1, 2)), axis=1)
                indices = np.minimum(
                    (np.arange(len(values)) + position) * count // samples, count - 1
                )
                np.maximum.at(peaks, indices, values)
                position += len(values)
            if process.wait() != 0:
                raise HTTPException(422, "音频波形解析失败")
        finally:
            process.stdout.close()
            if process.poll() is None:
                process.kill()
                process.wait()
    result = {**metadata, "peaks": np.round(peaks, 5).tolist()}
    with tempfile.NamedTemporaryFile(dir=cache, delete=False) as output:
        temporary = Path(output.name)
        output.write(json.dumps(result).encode())
    os.replace(temporary, target)
    # This cache is disposable; bound retained files, never touch source audio.
    old = sorted(cache.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True)
    for item in old[2048:]:
        item.unlink(missing_ok=True)
    return result


def audible_tracks(document):
    solo = any(track.solo for track in document.tracks)
    return [track for track in document.tracks if not track.muted and (not solo or track.solo)]


@lru_cache(maxsize=1)
def graph_option():
    # FFmpeg 9 removed filter_complex_script; slash-prefixed options read arguments from files.
    help_text = subprocess.run(
        [_binary("ffmpeg"), "-h", "full"],
        capture_output=True,
        timeout=30,
        creationflags=HIDDEN,
        check=True,
    ).stdout
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


def render_audio(request, target, check_path_trust, audio_format="wav", meter_target=None):
    """Intersect first, seek sources, apply their original envelopes, then mix on 48 kHz samples."""
    start = round(request.start * RATE) / RATE
    length = round(request.duration * RATE) / RATE
    if length <= 0 or start + length > 86400:
        raise HTTPException(422, "导出范围无效")
    args = [_binary("ffmpeg"), "-nostdin", "-v", "info", "-y"]
    filters, labels = [], []
    for track in audible_tracks(request.document):
        for clip in track.clips:
            path = resolve_source(clip.path, request.workspace_id, check_path_trust)
            # Validate even silent/out-of-range clips: incomplete documents cannot export.
            metadata = probe_source(path)
            if clip.sourceIn + clip.duration * clip.rate > metadata["duration"] + 0.03:
                raise HTTPException(422, f"片段超出源音频范围：{clip.name}")
            left, right = max(start, clip.start), min(start + length, clip.start + clip.duration)
            if right <= left:
                continue
            if len(labels) >= 256:
                raise HTTPException(422, "同一导出范围最多支持 256 个音频片段")
            offset = left - clip.start
            duration = round((right - left) * RATE) / RATE
            index = len(labels)
            # Short context around a preview window gives the tempo filter time to settle.
            warmup = min(offset, 0.25) if clip.rate != 1 and clip.preservePitch else 0
            lookahead = (
                min(0.25, clip.duration - offset - duration) if warmup or clip.rate != 1 else 0
            )
            source_start = clip.sourceIn + (offset - warmup) * clip.rate
            source_length = (duration + warmup + max(0, lookahead)) * clip.rate
            args += ["-ss", str(source_start), "-t", str(source_length), "-i", str(path)]
            speed = ""
            if clip.rate != 1:
                speed = (
                    tempo_filter(clip.rate)
                    if clip.preservePitch
                    else f"asetrate={RATE * clip.rate:.9f},aresample={RATE}"
                ) + ","
            time = f"(t+{clip.envelopeOffset + offset:.9f})"
            envelope = "1"
            if clip.fadeIn:
                envelope += f"*min(1\\,{time}/{clip.fadeIn:.9f})"
            if clip.fadeOut:
                envelope += (
                    f"*max(0\\,min(1\\,({clip.envelopeDuration:.9f}-{time})/{clip.fadeOut:.9f}))"
                )
            gain = clip.gain * track.gain
            delay = round((left - start) * RATE)
            label = f"clip{index}"
            filters.append(
                f"[{index}:a:0]aresample={RATE},aformat=channel_layouts=stereo,"
                f"{speed}atrim=start={warmup:.9f}:duration={duration:.9f},asetpts=PTS-STARTPTS,"
                f"aeval=val(0)*{gain:.9f}*{envelope}|val(1)*{gain:.9f}*{envelope}:c=stereo,"
                f"adelay={delay}S:all=1[{label}]"
            )
            labels.append(f"[{label}]")
    if labels:
        filters.append(
            "".join(labels) + f"amix=inputs={len(labels)}:normalize=0:dropout_transition=0,"
            f"volume={request.document.masterGain},apad,atrim=duration={length:.9f}[mixed]"
        )
    else:
        filters.append(f"anullsrc=r={RATE}:cl=stereo,atrim=duration={length:.9f}[mixed]")
    filters.append(
        "[mixed]astats=measure_perchannel=none:measure_overall=Peak_level:reset=0"
        + (",asplit=2[out][levels]" if meter_target else "[out]")
    )
    with tempfile.TemporaryDirectory() as directory:
        graph = Path(directory) / "mix.txt"
        graph.write_text(";\n".join(filters), "utf-8")
        args += [
            graph_option(),
            str(graph),
            "-map",
            "[out]",
            "-ar",
            str(RATE),
            "-c:a",
            "pcm_s16le" if audio_format == "wav" else "libmp3lame",
        ]
        if audio_format == "mp3":
            args += ["-b:a", "192k"]
        args += ["-f", audio_format, str(target)]
        if meter_target:
            args += ["-map", "[levels]", "-c:a", "pcm_f32le", "-f", "f32le", str(meter_target)]
        try:
            result = subprocess.run(
                args,
                capture_output=True,
                timeout=max(60, length * 2),
                creationflags=HIDDEN,
                check=True,
            )
        except subprocess.SubprocessError as exc:
            raise HTTPException(422, "音频处理失败，请检查素材或缩短导出范围") from exc
        peaks = re.findall(rb"Peak level dB:\s+([-+\w.]+)", result.stderr)
        peak = float(peaks[-1]) if peaks else -math.inf
        return peak if math.isfinite(peak) else None


def meter_windows(path):
    values = np.fromfile(path, dtype="<f4").reshape(-1, 2)
    step = RATE // 20
    if not len(values):
        return ""
    padding = (-len(values)) % step
    values = np.pad(values, ((0, padding), (0, 0)))
    peaks = np.max(np.abs(values.reshape(-1, step, 2)), axis=1).astype("<f4")
    return base64.b64encode(peaks.tobytes()).decode("ascii")


def assert_audio_draft(conn, request):
    state = state_snapshot(conn, request.workspace_id)
    works = json.loads(
        state["entries"].get(f"omnigallery:workspace-works-v2:{request.workspace_id}", "{}")
    )
    if not any(
        draft.get("id") == request.document_id and draft.get("kind") == "audio"
        for work in works.get("works", [])
        for draft in work.get("drafts", [])
    ):
        raise HTTPException(409, "音频制作文件已删除，请返回工作台")


@storage_operation
def commit_audio(request, temporary):
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
        assert_audio_draft(conn, request)
        os.replace(temporary, target)
        conn.execute("INSERT INTO workspace_artifact VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", values)
        conn.execute(
            "INSERT INTO workspace_artifact_origin VALUES (?, ?, ?)",
            (artifact_id, request.document_id, request.document_revision),
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

    @app.get(route + "/source", dependencies=[Depends(verify_secret)])
    def source(workspace_id: str, path: str, peaks: bool = False):
        resolved = resolve_source(path, workspace_id, check_path_trust)
        return waveform(resolved) if peaks else probe_source(resolved)

    @app.post(route + "/preview", dependencies=[Depends(verify_secret)])
    def preview(request: AudioRender):
        if request.duration > 12:
            raise HTTPException(422, "试听每次最多载入 12 秒")
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "preview.wav"
            levels = Path(directory) / "levels.f32"
            render_audio(request, output, check_path_trust, meter_target=levels)
            return Response(
                output.read_bytes(),
                media_type="audio/wav",
                headers={
                    "X-Audio-Level-Peaks": meter_windows(levels),
                    "Access-Control-Expose-Headers": "X-Audio-Level-Peaks",
                },
            )

    @app.post(
        route + "/export", dependencies=[Depends(verify_secret), Depends(write_permission_required)]
    )
    def export(request: AudioExport):
        request.workspace_id = _uuid(request.workspace_id)
        assert_audio_draft(Database.get_connection(), request)
        directory = artifact_root() / request.workspace_id
        directory.mkdir(parents=True, exist_ok=True)
        # Temporary and destination live on the same volume for atomic publication.
        with tempfile.TemporaryDirectory(dir=directory) as temporary:
            output = Path(temporary) / ("mix." + request.format)
            peak = render_audio(request, output, check_path_trust, request.format)
            return {**commit_audio(request, output), "mix_peak_dbfs": peak}
