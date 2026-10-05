"""Render the saved, non-destructive video timeline into a workspace MP4 artifact."""

import hashlib
import json
import math
import os
import re
import subprocess
import tempfile
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

from omnigallery.config import get_cache_dir
from omnigallery.infrastructure.database import Database
from omnigallery.infrastructure.media_runtime import binary as media_binary
from omnigallery.storage.project_files import storage_operation
from omnigallery.workspaces.artifacts import (
    ARTIFACT_COLUMNS,
    _artifact_name,
    _file,
    _row,
    _uuid,
    artifact_root,
)
from omnigallery.workspaces.audio_processing import AudioProcessing, GainPoint
from omnigallery.workspaces.audio_studio import HIDDEN
from omnigallery.workspaces.state import state_snapshot
from omnigallery.workspaces.video_local_effects import LocalVideoEffects

MAX_SECONDS = 6 * 3600
MAX_PIXELS = 3840 * 2160
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".jpe", ".webp", ".avif", ".gif", ".bmp"}
VIDEO_SUFFIXES = {".mp4", ".m4v", ".avi", ".mkv", ".mov", ".wmv", ".flv", ".ts", ".webm"}
AUDIO_SUFFIXES = {".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".wma"}


class Crop(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    x: float = Field(default=0, ge=0, lt=1)
    y: float = Field(default=0, ge=0, lt=1)
    width: float = Field(default=1, gt=0, le=1)
    height: float = Field(default=1, gt=0, le=1)

    @model_validator(mode="after")
    def within_source(self):
        if self.x + self.width > 1.000001 or self.y + self.height > 1.000001:
            raise ValueError("裁剪范围超出原图")
        return self


class Transform(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    x: float = Field(default=0, ge=-2, le=2)
    y: float = Field(default=0, ge=-2, le=2)
    scale: float = Field(default=1, ge=0.05, le=4)
    rotation: float = Field(default=0, ge=-360, le=360)
    flipX: bool = False
    flipY: bool = False
    opacity: float = Field(default=1, ge=0, le=1)
    fit: Literal["contain", "cover", "stretch"] = "contain"
    crop: Crop = Field(default_factory=Crop)


class AnimationCurve(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    easing: Literal["linear", "easeIn", "easeOut", "easeInOut"] = "linear"
    start: float = Field(default=0, ge=0, le=1)
    end: float = Field(default=1, ge=0, le=1)

    @model_validator(mode="after")
    def ordered(self):
        if self.end <= self.start:
            raise ValueError("动画曲线区间无效")
        return self


class Keyframe(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    time: float = Field(ge=0, le=86400)
    x: float | None = Field(default=None, ge=-2, le=2)
    y: float | None = Field(default=None, ge=-2, le=2)
    scale: float | None = Field(default=None, ge=0.05, le=4)
    opacity: float | None = Field(default=None, ge=0, le=1)
    rotation: float | None = Field(default=None, ge=-360, le=360)
    easing: Literal["linear", "easeIn", "easeOut", "easeInOut"] = "linear"
    curves: dict[Literal["x", "y", "scale", "rotation", "opacity"], AnimationCurve] = Field(
        default_factory=dict
    )


class TransitionIn(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    previousId: str = Field(min_length=1, max_length=80)
    duration: float = Field(gt=0, le=30)
    easing: Literal["linear", "easeIn", "easeOut", "easeInOut"] = "linear"
    offset: float = Field(default=0, ge=0, le=30)

    @model_validator(mode="after")
    def valid_offset(self):
        if self.offset >= self.duration:
            raise ValueError("转场偏移超出区间")
        return self


class ClipColor(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    brightness: float = Field(default=0, ge=-1, le=1)
    contrast: float = Field(default=1, ge=0, le=3)
    saturation: float = Field(default=1, ge=0, le=3)


class Track(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    id: str = Field(min_length=1, max_length=80)
    kind: Literal["video", "audio"]
    name: str = Field(default="", max_length=120)
    muted: bool = False
    solo: bool = False
    hidden: bool = False
    locked: bool = False
    gain: float = Field(default=1, ge=0, le=4)
    pan: float = Field(default=0, ge=-1, le=1)
    processing: AudioProcessing = Field(default_factory=AudioProcessing)


class VideoGainPoint(GainPoint):
    time: float = Field(ge=0, le=345600)


class VideoClip(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    id: str = Field(min_length=1, max_length=80)
    path: str = Field(min_length=1, max_length=8192)
    name: str = Field(min_length=1, max_length=256)
    kind: Literal["image", "video", "audio"]
    audioStream: int = Field(default=0, ge=0, le=255, strict=True)
    start: float = Field(ge=0, le=86400)
    sourceIn: float = Field(ge=0, le=86400)
    duration: float = Field(gt=0, le=86400)
    sourceDuration: float = Field(gt=0, le=86400)
    rate: float = Field(ge=0.25, le=4)
    gain: float = Field(ge=0, le=4)
    pan: float = Field(default=0, ge=-1, le=1)
    gainPoints: list[VideoGainPoint] = Field(default_factory=list, max_length=128)
    preservePitch: bool = True
    trackId: str = Field(default="", max_length=80)
    linkId: str = Field(default="", max_length=80)
    transform: Transform = Field(default_factory=Transform)
    keyframes: list[Keyframe] = Field(default_factory=list, max_length=128)
    color: ClipColor = Field(default_factory=ClipColor)
    fadeIn: float = Field(default=0, ge=0, le=345600)
    fadeOut: float = Field(default=0, ge=0, le=345600)
    fadeCurve: Literal["linear", "smooth", "equalPower"] = "linear"
    channels: Literal["stereo", "swap", "mono", "left", "right"] = "stereo"
    invertPhase: bool = False
    envelopeOffset: float = Field(default=0, ge=-345600, le=345600)
    envelopeDuration: float | None = Field(default=None, gt=0, le=345600)
    reverse: bool = False
    freeze: bool = False
    transitionIn: TransitionIn | None = None
    localEffects: LocalVideoEffects | None = None

    @model_validator(mode="after")
    def valid_timing(self):
        if self.envelopeDuration is None:
            if max(self.fadeIn, self.fadeOut) > 30:
                raise ValueError("新设置的淡化最多 30 秒")
            self.envelopeDuration = self.duration
        if max(self.fadeIn, self.fadeOut) > self.envelopeDuration + 1 / 48000:
            raise ValueError("淡化不能超出原包络范围")
        if any(point.time > self.envelopeDuration + 1 / 48000 for point in self.gainPoints) or any(
            left.time >= right.time
            for left, right in zip(self.gainPoints, self.gainPoints[1:], strict=False)
        ):
            raise ValueError("音量曲线的时间必须递增且位于原包络范围内")
        if self.start + self.duration > 86400:
            raise ValueError("片段超出 24 小时时间线")
        if (
            self.kind != "image"
            and not self.freeze
            and self.sourceIn + self.duration * self.rate > self.sourceDuration + 0.03
        ):
            raise ValueError("片段超出源文件时长")
        if self.freeze and self.sourceIn >= self.sourceDuration:
            raise ValueError("定格位置超出源文件")
        if self.reverse and self.duration > 30:
            raise ValueError("单个倒放片段最多 30 秒，请先分割片段")
        if any(frame.time > self.duration for frame in self.keyframes):
            raise ValueError("关键帧超出片段时长")
        times = [frame.time for frame in self.keyframes]
        if len(times) != len(set(times)):
            raise ValueError("关键帧时间不能重复")
        return self


class CaptionStyle(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    fontSize: float = Field(default=32, ge=8, le=300)
    fontFamily: str = Field(default="sans-serif", max_length=120, pattern=r"^[\w \-]+$")
    color: str = Field(default="#ffffff", pattern=r"^#[a-fA-F0-9]{6}$")
    background: str = Field(default="#00000000", pattern=r"^#[a-fA-F0-9]{8}$")
    outlineColor: str = Field(default="#000000", pattern=r"^#[a-fA-F0-9]{6}$")
    outlineWidth: float = Field(default=2, ge=0, le=10)
    bold: bool = False
    align: Literal["left", "center", "right"] = "center"
    x: float = Field(default=0.5, ge=0, le=1)
    y: float = Field(default=0.9, ge=0, le=1)
    maxWidth: float = Field(default=0.9, ge=0.1, le=1)
    wrap: bool = True


class Caption(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    id: str = Field(min_length=1, max_length=80)
    text: str = Field(max_length=5000)
    start: float = Field(ge=0, le=86400)
    duration: float = Field(gt=0, le=86400)
    style: CaptionStyle = Field(default_factory=CaptionStyle)


class Marker(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(max_length=120)
    time: float = Field(ge=0, le=86400)


class VideoDocument(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    version: Literal[1]
    width: int = Field(ge=240, le=3840)
    height: int = Field(ge=240, le=3840)
    fps: int = Field(ge=1, le=60)
    visuals: list[VideoClip] = Field(max_length=256)
    sounds: list[VideoClip] = Field(max_length=256)
    captions: list[Caption] = Field(max_length=4096)
    markers: list[Marker] = Field(max_length=256)
    tracks: list[Track] = Field(default_factory=list, max_length=32)
    masterGain: float = Field(default=1, ge=0, le=2)
    processing: AudioProcessing = Field(default_factory=AudioProcessing)

    @model_validator(mode="after")
    def valid_canvas_and_lanes(self):
        if self.width * self.height > MAX_PIXELS or self.width % 2 or self.height % 2:
            raise ValueError("画布尺寸须为偶数，且不超过 3840 × 2160 像素")
        if any(clip.kind == "audio" for clip in self.visuals):
            raise ValueError("声音文件不能放在画面轨")
        if any(clip.kind == "image" for clip in self.sounds):
            raise ValueError("图片不能放在声音轨")
        tracks = {track.id: track for track in self.tracks}
        if len(tracks) != len(self.tracks):
            raise ValueError("轨道编号不能重复")
        for kind, clips in (("video", self.visuals), ("audio", self.sounds)):
            for clip in clips:
                default_track = "video-1" if kind == "video" else "audio-1"
                if (
                    clip.trackId
                    and not (not tracks and clip.trackId == default_track)
                    and (clip.trackId not in tracks or tracks[clip.trackId].kind != kind)
                ):
                    raise ValueError("片段轨道不存在或类型不匹配")
        return self


class ExportRange(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    start: float = Field(ge=0, le=86400)
    end: float = Field(gt=0, le=86400)

    @model_validator(mode="after")
    def ordered(self):
        if self.end <= self.start:
            raise ValueError("导出选区结束须晚于开始")
        return self


class VideoExport(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    workspace_id: str
    document_id: str = Field(min_length=1, max_length=80, pattern=r"^[\w-]+$")
    document_revision: str = Field(pattern=r"^[a-f0-9]{64}$")
    document: VideoDocument
    name: str = Field(min_length=1, max_length=120)
    range: ExportRange | None = None


def export_bounds(request: VideoExport) -> tuple[float, float]:
    duration = render_duration(request.document)
    if request.range:
        if request.range.end > duration + 0.001:
            raise HTTPException(422, "导出选区超出时间线")
        return request.range.start, min(request.range.end, duration)
    return 0, duration


def render_duration(document: VideoDocument) -> float:
    # Markers aid editing but never extend the finished film.
    end = max(
        [0]
        + [clip.start + clip.duration for clip in document.visuals + document.sounds]
        + [cue.start + cue.duration for cue in document.captions if cue.text.strip()]
    )
    if not 0 < end <= MAX_SECONDS:
        raise HTTPException(422, f"视频须有内容，且成片不能超过 {MAX_SECONDS // 60} 分钟")
    return end


def _binary(name: str) -> str:
    path = media_binary(name)
    if not path:
        raise HTTPException(503, f"视频导出需要 {name}，请到设置 → 运行环境检查 FFmpeg")
    return path


def _runtime_capabilities(ffmpeg: str) -> tuple[str, str]:
    try:
        filters = subprocess.run(
            [ffmpeg, "-hide_banner", "-filters"],
            capture_output=True,
            timeout=30,
            creationflags=HIDDEN,
            check=True,
        ).stdout.decode(errors="replace")
        encoders = subprocess.run(
            [ffmpeg, "-hide_banner", "-encoders"],
            capture_output=True,
            timeout=30,
            creationflags=HIDDEN,
            check=True,
        ).stdout.decode(errors="replace")
    except (OSError, subprocess.SubprocessError) as exc:
        raise HTTPException(503, "无法检查 FFmpeg 视频能力，请到设置 → 运行环境检查") from exc
    if not re.search(r"\blibx264\b", encoders) or not re.search(r"\baac\b", encoders):
        raise HTTPException(503, "当前 FFmpeg 缺少 H.264 或 AAC 编码器")
    for name in ("overlay", "scale", "pad", "amix", "atempo"):
        if not re.search(rf"\b{name}\b", filters):
            raise HTTPException(503, f"当前 FFmpeg 缺少 {name} 滤镜")
    return filters, encoders


def _graph_option(ffmpeg: str) -> str:
    try:
        help_text = subprocess.run(
            [ffmpeg, "-h", "full"],
            capture_output=True,
            timeout=30,
            creationflags=HIDDEN,
            check=True,
        ).stdout
    except (OSError, subprocess.SubprocessError) as exc:
        raise HTTPException(503, "无法检查 FFmpeg 滤镜脚本支持") from exc
    return (
        "-filter_complex_script" if b"-filter_complex_script" in help_text else "-/filter_complex"
    )


def _resolve_source(clip: VideoClip, workspace_id: str, check_path_trust) -> Path:
    if clip.path.startswith("workspace-artifact:"):
        row = _row(Database.get_connection(), clip.path.removeprefix("workspace-artifact:"))
        if row["workspace_id"] != workspace_id or row["kind"] != clip.kind:
            raise HTTPException(403, "素材产物不属于当前工作区或类型不匹配")
        source = _file(row)
        if source.is_symlink() or not source.resolve().is_relative_to(
            (artifact_root() / workspace_id).resolve()
        ):
            raise HTTPException(403, "素材产物路径不安全")
        return source
    check_path_trust(clip.path)
    source = Path(clip.path).resolve()
    check_path_trust(str(source))
    if source.is_relative_to((Path(get_cache_dir()) / "video-proxies").resolve()):
        raise HTTPException(422, "预览代理不能用于导出，请使用原始素材")
    if not source.is_file():
        raise HTTPException(404, f"源文件不可用：{clip.name}")
    accepted = {"image": IMAGE_SUFFIXES, "video": VIDEO_SUFFIXES, "audio": AUDIO_SUFFIXES}[
        clip.kind
    ]
    if source.suffix.lower() not in accepted:
        raise HTTPException(422, f"源文件类型与片段不一致：{clip.name}")
    return source


def _probe_source(path: Path) -> dict:
    try:
        result = subprocess.run(
            [
                _binary("ffprobe"),
                "-v",
                "error",
                "-show_entries",
                "stream=index,codec_type,duration,start_time:stream_tags=DURATION:format=duration,start_time,format_name",
                "-of",
                "json",
                str(path),
            ],
            capture_output=True,
            timeout=30,
            creationflags=HIDDEN,
            check=True,
        )
        return json.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, ValueError) as exc:
        raise HTTPException(422, f"无法读取源媒体：{path.name}") from exc


def _validate_sources(
    request: VideoExport, check_path_trust, check_cancel=None
) -> tuple[list[Path], list[Path]]:
    from omnigallery.workspaces.audio_streams import selected_audio_stream

    visuals: list[Path] = []
    sounds: list[Path] = []
    cache: dict[Path, dict] = {}
    for clip, destinations in [
        *((clip, visuals) for clip in request.document.visuals),
        *((clip, sounds) for clip in request.document.sounds),
    ]:
        if check_cancel:
            check_cancel()
        path = _resolve_source(clip, request.workspace_id, check_path_trust)
        if path not in cache:
            cache[path] = _probe_source(path)
        info = cache[path]
        expected = "video" if destinations is visuals else "audio"
        if not any(stream.get("codec_type") == expected for stream in info.get("streams", [])):
            raise HTTPException(
                422, f"源文件缺少可用{'画面' if expected == 'video' else '声音'}：{clip.name}"
            )
        if clip.kind != "image":
            raw = (
                selected_audio_stream(info, clip.audioStream)["duration"]
                if destinations is sounds
                else info.get("format", {}).get("duration")
            )
            try:
                actual_duration = float(raw)
            except (TypeError, ValueError) as exc:
                raise HTTPException(422, f"无法确定源文件时长：{clip.name}") from exc
            if (
                not math.isfinite(actual_duration)
                or (clip.freeze and clip.sourceIn >= actual_duration)
                or clip.sourceIn + (0 if clip.freeze else clip.duration * clip.rate)
                > actual_duration + 0.1
            ):
                raise HTTPException(422, f"片段超出源文件范围：{clip.name}")
        destinations.append(path)
    return visuals, sounds


def render_video(
    request: VideoExport,
    target: Path,
    directory: Path,
    check_path_trust,
    *,
    run_process=None,
    check_cancel=None,
) -> None:
    from omnigallery.workspaces.video_render import render_timeline

    export_bounds(request)
    ffmpeg = _binary("ffmpeg")
    filters, _ = _runtime_capabilities(ffmpeg)
    if any(cue.text.strip() for cue in request.document.captions) and not re.search(
        r"\bsubtitles\b", filters
    ):
        raise HTTPException(503, "当前 FFmpeg 缺少字幕滤镜，无法导出含字幕的视频")
    visual_paths, sound_paths = _validate_sources(request, check_path_trust, check_cancel)
    render_timeline(
        request,
        target,
        directory,
        visual_paths,
        sound_paths,
        run_process=run_process,
        check_cancel=check_cancel,
    )


def _saved_document(conn, request: VideoExport, *, current_revision=True) -> None:
    entries = state_snapshot(conn, request.workspace_id)["entries"]
    try:
        works = json.loads(
            entries.get(f"omnigallery:workspace-works-v2:{request.workspace_id}", "{}")
        )
        draft_rows = [
            draft
            for work in works.get("works", [])
            for draft in work.get("drafts", [])
            if isinstance(draft, dict)
        ]
    except (ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(409, "工作区制作文件索引无法读取") from exc
    if not any(
        draft.get("id") == request.document_id and draft.get("kind") == "video"
        for draft in draft_rows
    ):
        raise HTTPException(409, "视频制作文件已删除，请返回工作台")
    if not current_revision:
        return
    raw = entries.get(f"omnigallery:video-timeline-v1:{request.workspace_id}:{request.document_id}")
    if not raw or hashlib.sha256(raw.encode()).hexdigest() != request.document_revision:
        raise HTTPException(409, "视频制作文件已变化，请重新保存后导出")
    try:
        if VideoDocument.model_validate_json(raw).model_dump() != request.document.model_dump():
            raise HTTPException(409, "导出内容与已保存的视频制作文件不一致")
    except (ValueError, TypeError) as exc:
        raise HTTPException(409, "已保存的视频制作文件无法读取") from exc


@storage_operation
def _commit_video(
    request: VideoExport, temporary: Path, *, current_revision=True, committed=None
) -> dict:
    conn = Database.get_connection()
    artifact_id = str(uuid.uuid4())
    name = _artifact_name(request.name, "mp4")
    directory = artifact_root() / request.workspace_id
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / (artifact_id + ".mp4")
    values = (
        artifact_id,
        request.workspace_id,
        name,
        "video",
        "video_studio",
        "mp4",
        request.document.width,
        request.document.height,
        temporary.stat().st_size,
        datetime.now(UTC).isoformat(),
    )
    artifact = {
        **dict(zip(ARTIFACT_COLUMNS, values, strict=True)),
        "document_id": request.document_id,
        "document_revision": request.document_revision,
        "collected": False,
    }
    try:
        conn.execute("BEGIN IMMEDIATE")
        _saved_document(conn, request, current_revision=current_revision)
        os.replace(temporary, target)
        conn.execute("INSERT INTO workspace_artifact VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", values)
        conn.execute(
            "INSERT INTO workspace_artifact_origin VALUES (?, ?, ?)",
            (artifact_id, request.document_id, request.document_revision),
        )
        if committed:
            committed(conn, artifact)
        conn.commit()
    except Exception:
        conn.rollback()
        target.unlink(missing_ok=True)
        raise
    return artifact


def mount_video_studio_routes(
    app, base, verify_secret, write_permission_required, check_path_trust
):
    from omnigallery.workspaces.video_audio import mount_video_audio_routes
    from omnigallery.workspaces.video_exports import mount_video_export_routes

    mount_video_export_routes(app, base, verify_secret, write_permission_required, check_path_trust)
    mount_video_audio_routes(app, base, verify_secret, check_path_trust)

    @app.post(
        base + "/video_studio/export",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def export(request: VideoExport):
        request.workspace_id = _uuid(request.workspace_id)
        _saved_document(Database.get_connection(), request)
        directory = artifact_root() / request.workspace_id
        directory.mkdir(parents=True, exist_ok=True)
        # Render in the destination volume, publish only after FFmpeg succeeds.
        with tempfile.TemporaryDirectory(dir=directory, prefix=".video-render-") as temporary:
            stage = Path(temporary)
            output = stage / "render.mp4"
            render_video(request, output, stage, check_path_trust)
            return _commit_video(request, output)
