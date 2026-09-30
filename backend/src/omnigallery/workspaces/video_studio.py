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
from omnigallery.workspaces.audio_studio import HIDDEN, tempo_filter
from omnigallery.workspaces.state import state_snapshot

MAX_SECONDS = 3600
MAX_PIXELS = 3840 * 2160
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".jpe", ".webp", ".avif", ".gif", ".bmp"}
VIDEO_SUFFIXES = {".mp4", ".m4v", ".avi", ".mkv", ".mov", ".wmv", ".flv", ".ts", ".webm"}
AUDIO_SUFFIXES = {".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".wma"}


class VideoClip(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    id: str = Field(min_length=1, max_length=80)
    path: str = Field(min_length=1, max_length=8192)
    name: str = Field(min_length=1, max_length=256)
    kind: Literal["image", "video", "audio"]
    start: float = Field(ge=0, le=86400)
    sourceIn: float = Field(ge=0, le=86400)
    duration: float = Field(gt=0, le=86400)
    sourceDuration: float = Field(gt=0, le=86400)
    rate: float = Field(ge=0.25, le=4)
    gain: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def valid_timing(self):
        if self.start + self.duration > 86400:
            raise ValueError("片段超出 24 小时时间线")
        if (
            self.kind != "image"
            and self.sourceIn + self.duration * self.rate > self.sourceDuration + 0.03
        ):
            raise ValueError("片段超出源文件时长")
        return self


class Caption(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    id: str = Field(min_length=1, max_length=80)
    text: str = Field(max_length=5000)
    start: float = Field(ge=0, le=86400)
    duration: float = Field(gt=0, le=86400)


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
    visuals: list[VideoClip] = Field(max_length=64)
    sounds: list[VideoClip] = Field(max_length=64)
    captions: list[Caption] = Field(max_length=256)
    markers: list[Marker] = Field(max_length=256)

    @model_validator(mode="after")
    def valid_canvas_and_lanes(self):
        if self.width * self.height > MAX_PIXELS or self.width % 2 or self.height % 2:
            raise ValueError("画布尺寸须为偶数，且不超过 3840 × 2160 像素")
        if any(clip.kind == "audio" for clip in self.visuals):
            raise ValueError("声音文件不能放在画面轨")
        if any(clip.kind == "image" for clip in self.sounds):
            raise ValueError("图片不能放在声音轨")
        return self


class VideoExport(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    workspace_id: str
    document_id: str = Field(min_length=1, max_length=80, pattern=r"^[\w-]+$")
    document_revision: str = Field(pattern=r"^[a-f0-9]{64}$")
    document: VideoDocument
    name: str = Field(min_length=1, max_length=120)


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
                "stream=codec_type,duration:format=duration",
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


def _validate_sources(request: VideoExport, check_path_trust) -> tuple[list[Path], list[Path]]:
    visuals: list[Path] = []
    sounds: list[Path] = []
    cache: dict[Path, dict] = {}
    for clip, destinations in [
        *((clip, visuals) for clip in request.document.visuals),
        *((clip, sounds) for clip in request.document.sounds),
    ]:
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
            raw = info.get("format", {}).get("duration")
            try:
                actual_duration = float(raw)
            except (TypeError, ValueError) as exc:
                raise HTTPException(422, f"无法确定源文件时长：{clip.name}") from exc
            if (
                not math.isfinite(actual_duration)
                or clip.sourceIn + clip.duration * clip.rate > actual_duration + 0.1
            ):
                raise HTTPException(422, f"片段超出源文件范围：{clip.name}")
        destinations.append(path)
    return visuals, sounds


def _srt_time(seconds: float) -> str:
    milliseconds = round(seconds * 1000)
    hours, milliseconds = divmod(milliseconds, 3600000)
    minutes, milliseconds = divmod(milliseconds, 60000)
    sec, milliseconds = divmod(milliseconds, 1000)
    return f"{hours:02}:{minutes:02}:{sec:02},{milliseconds:03}"


def _write_subtitles(captions: list[Caption], target: Path) -> bool:
    entries = []
    for cue in sorted(captions, key=lambda item: (item.start, item.id)):
        text = "".join(char for char in cue.text if char == "\n" or char >= " ").strip()
        if not text:
            continue
        # SRT is data in a separate file; never interpolate user text into a filter expression.
        entries.append(
            f"{len(entries) + 1}\n{_srt_time(cue.start)} --> {_srt_time(cue.start + cue.duration)}\n{text}\n"
        )
    if entries:
        target.write_text("\n".join(entries), encoding="utf-8")
    return bool(entries)


def render_video(request: VideoExport, target: Path, directory: Path, check_path_trust) -> None:
    document = request.document
    length = render_duration(document)
    ffmpeg = _binary("ffmpeg")
    filters_available, _ = _runtime_capabilities(ffmpeg)
    visual_paths, sound_paths = _validate_sources(request, check_path_trust)
    subtitles = _write_subtitles(document.captions, directory / "captions.srt")
    if subtitles and not re.search(r"\bsubtitles\b", filters_available):
        raise HTTPException(503, "当前 FFmpeg 缺少字幕滤镜，无法导出含字幕的视频")

    args = [
        ffmpeg,
        "-nostdin",
        "-hide_banner",
        "-v",
        "warning",
        "-y",
        "-f",
        "lavfi",
        "-i",
        f"color=c=black:s={document.width}x{document.height}:r={document.fps}:d={length:.6f}",
    ]
    visual_inputs = []
    sound_inputs = []
    for clip, path in zip(document.visuals, visual_paths, strict=True):
        index = 1 + len(visual_inputs)
        if clip.kind == "image":
            args += ["-i", str(path)]
        else:
            args += [
                "-ss",
                f"{clip.sourceIn:.6f}",
                "-t",
                f"{clip.duration * clip.rate:.6f}",
                "-i",
                str(path),
            ]
        visual_inputs.append(index)
    for clip, path in zip(document.sounds, sound_paths, strict=True):
        index = 1 + len(visual_inputs) + len(sound_inputs)
        args += [
            "-ss",
            f"{clip.sourceIn:.6f}",
            "-t",
            f"{clip.duration * clip.rate:.6f}",
            "-i",
            str(path),
        ]
        sound_inputs.append(index)

    filters = ["[0:v]format=yuv420p[base0]"]
    previous = "base0"
    # A later-starting clip covers an earlier clip; ties preserve the saved list order.
    layers = sorted(enumerate(document.visuals), key=lambda pair: (pair[1].start, pair[0]))
    for order, (position, clip) in enumerate(layers):
        index = visual_inputs[position]
        if clip.kind == "image":
            timing = (
                f"trim=end_frame=1,setpts=PTS-STARTPTS,"
                f"tpad=stop_mode=clone:stop_duration={clip.duration + 1:.6f},"
            )
        else:
            timing = f"setpts=(PTS-STARTPTS)/{clip.rate:.9f},"
        filters.append(
            f"[{index}:v:0]{timing}fps={document.fps},trim=duration={clip.duration:.6f},"
            f"scale={document.width}:{document.height}:force_original_aspect_ratio=decrease:flags=lanczos,"
            f"pad={document.width}:{document.height}:(ow-iw)/2:(oh-ih)/2:color=black,"
            f"setsar=1,format=yuv420p,setpts=PTS+{clip.start:.6f}/TB[layer{order}]"
        )
        next_label = f"base{order + 1}"
        filters.append(
            f"[{previous}][layer{order}]overlay=eof_action=pass:shortest=0:"
            f"enable='gte(t,{clip.start:.6f})*lt(t,{clip.start + clip.duration:.6f})'[{next_label}]"
        )
        previous = next_label
    if subtitles:
        filters.append(f"[{previous}]subtitles=filename=captions.srt[video]")
    else:
        filters.append(f"[{previous}]null[video]")

    filters.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={length:.6f}[silence]")
    sound_labels = ["[silence]"]
    for position, clip in enumerate(document.sounds):
        index = sound_inputs[position]
        label = f"sound{position}"
        filters.append(
            f"[{index}:a:0]aresample=48000,aformat=channel_layouts=stereo,"
            f"{tempo_filter(clip.rate)},atrim=duration={clip.duration:.6f},"
            f"asetpts=PTS-STARTPTS,"
            f"volume={clip.gain:.6f},adelay={round(clip.start * 1000)}:all=1[{label}]"
        )
        sound_labels.append(f"[{label}]")
    filters.append(
        "".join(sound_labels) + f"amix=inputs={len(sound_labels)}:normalize=0:dropout_transition=0,"
        f"apad,atrim=duration={length:.6f}[audio]"
    )

    graph = directory / "graph.txt"
    graph.write_text(";\n".join(filters), encoding="utf-8")
    args += [
        _graph_option(ffmpeg),
        "graph.txt",
        "-map",
        "[video]",
        "-map",
        "[audio]",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "21",
        "-pix_fmt",
        "yuv420p",
        "-r",
        str(document.fps),
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        "-t",
        f"{length:.6f}",
        str(target),
    ]
    try:
        subprocess.run(
            args,
            cwd=directory,
            capture_output=True,
            timeout=max(90, min(7200, length * 15)),
            creationflags=HIDDEN,
            check=True,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(504, "视频渲染超时，请缩短制作文件或降低画布尺寸") from exc
    except (OSError, subprocess.CalledProcessError) as exc:
        stderr = (
            exc.stderr.decode(errors="replace")
            if isinstance(exc, subprocess.CalledProcessError) and exc.stderr
            else ""
        )
        # Keep tool diagnostics concise and avoid echoing absolute source paths to the UI.
        detail = "视频渲染失败，请检查素材编码、字幕滤镜和可用磁盘空间"
        if "No such filter: 'subtitles'" in stderr:
            detail = "当前 FFmpeg 缺少字幕滤镜，无法导出含字幕的视频"
        raise HTTPException(422, detail) from exc
    if not target.is_file() or target.stat().st_size == 0:
        raise HTTPException(422, "视频渲染没有生成文件")


def _saved_document(conn, request: VideoExport) -> None:
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
    raw = entries.get(f"omnigallery:video-timeline-v1:{request.workspace_id}:{request.document_id}")
    if not raw or hashlib.sha256(raw.encode()).hexdigest() != request.document_revision:
        raise HTTPException(409, "视频制作文件已变化，请重新保存后导出")
    try:
        if json.loads(raw) != request.document.model_dump():
            raise HTTPException(409, "导出内容与已保存的视频制作文件不一致")
    except (ValueError, TypeError) as exc:
        raise HTTPException(409, "已保存的视频制作文件无法读取") from exc


@storage_operation
def _commit_video(request: VideoExport, temporary: Path) -> dict:
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
    try:
        conn.execute("BEGIN IMMEDIATE")
        _saved_document(conn, request)
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


def mount_video_studio_routes(
    app, base, verify_secret, write_permission_required, check_path_trust
):
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
