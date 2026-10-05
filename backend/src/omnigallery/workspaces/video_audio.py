"""Bounded source decoding and one shared audio path for video preview and export."""

import asyncio
import json
import math
import subprocess
import tempfile
import threading
import time
from collections import OrderedDict
from pathlib import Path
from types import SimpleNamespace

from fastapi import Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from omnigallery.workspaces.audio_processing import (
    AudioProcessing,
    channel_filter,
    fade_expression,
    gain_expression,
    pan_filter,
    processing_filters,
)
from omnigallery.workspaces.audio_studio import (
    HIDDEN,
    RATE,
    graph_option,
    meter_windows,
    tempo_filter,
)

WINDOW_SECONDS = 10
PREVIEW_SECONDS = 12
PREVIEW_CONTEXT = 3
preview_slots = threading.BoundedSemaphore(2)
metadata_cache = OrderedDict()
metadata_lock = threading.Lock()


class PreviewCancelled(Exception):
    pass


def source_metadata(path, directory, cancelled, audio_stream=0, check_cancel=None):
    """Stat-keyed, small metadata cache; consecutive preview windows do not reprobe movies."""
    from omnigallery.workspaces.audio_streams import selected_audio_stream
    from omnigallery.workspaces.video_studio import _binary

    if check_cancel:
        signal = cancelled

        class CheckedSignal:
            def is_set(self):
                check_cancel()
                return signal.is_set()

            def wait(self, timeout):
                result = signal.wait(timeout)
                check_cancel()
                return result

        cancelled = CheckedSignal()

    if cancelled.is_set():
        raise PreviewCancelled()
    stat = path.stat()
    key = (
        str(path.resolve()),
        stat.st_size,
        stat.st_mtime_ns,
        stat.st_ctime_ns,
        stat.st_ino,
        audio_stream,
    )
    with metadata_lock:
        cached = metadata_cache.get(key)
        if cached is not None:
            metadata_cache.move_to_end(key)
            return cached
    result = cancellable_process(
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
        directory,
        0,
        cancelled,
        capture_stdout=True,
    )
    info = json.loads(result.stdout)
    value = {**selected_audio_stream(info, audio_stream), "audio": True}
    with metadata_lock:
        metadata_cache[key] = value
        metadata_cache.move_to_end(key)
        while len(metadata_cache) > 256:
            metadata_cache.popitem(last=False)
    return value


def cancellable_process(args, directory, duration, cancelled, *, capture_stdout=False):
    """Spool diagnostic output, poll cancellation, and always reap the actual decoder."""
    if cancelled.is_set():
        raise PreviewCancelled()
    with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
        process = subprocess.Popen(
            args,
            cwd=directory,
            stdin=subprocess.DEVNULL,
            stdout=stdout,
            stderr=stderr,
            creationflags=HIDDEN,
        )
        deadline = time.monotonic() + max(60, min(7200, duration * 30))
        try:
            while process.poll() is None:
                if cancelled.wait(0.025):
                    raise PreviewCancelled()
                if time.monotonic() > deadline:
                    raise HTTPException(504, "视频声音处理超时，请缩短范围")
            if cancelled.is_set():
                raise PreviewCancelled()
            stderr.seek(max(0, stderr.tell() - 16384))
            diagnostics = stderr.read(16384)
            if process.returncode:
                raise HTTPException(422, "视频声音处理失败，请检查源素材和滤镜")
            data = b""
            if capture_stdout:
                stdout.seek(0)
                data = stdout.read(1024 * 1024 + 1)
                if len(data) > 1024 * 1024:
                    raise HTTPException(422, "源媒体信息过大")
            return subprocess.CompletedProcess(args, process.returncode, data, diagnostics)
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=3)


def audio_tracks(document):
    """Legacy single-track documents and explicit hidden/mute/solo lanes share semantics."""
    tracks = [track for track in document.tracks if track.kind == "audio"]
    if not tracks:
        tracks = [
            SimpleNamespace(
                id="audio-1",
                gain=1,
                pan=0,
                muted=False,
                hidden=False,
                solo=False,
                processing=AudioProcessing(),
            )
        ]
    solo = any(track.solo for track in tracks)
    return [
        (
            track,
            [
                (index, clip)
                for index, clip in enumerate(document.sounds)
                if (clip.trackId or "audio-1") == track.id and not clip.freeze
            ],
        )
        for track in tracks
        if not track.muted and not track.hidden and (not solo or track.solo)
    ]


def clip_window(clip, offset, duration, source_info=None):
    """Reverse only the current window, after speed processing; envelopes remain forward."""
    source_start = (
        clip.sourceIn + (clip.duration - offset - duration if clip.reverse else offset) * clip.rate
    )
    stream_start = max(0, (source_info or {}).get("start_time", 0))
    gap = min(duration, max(0, (stream_start - source_start) / clip.rate))
    if gap >= duration:
        return 0, 0, []
    available = duration - gap
    source_start += gap * clip.rate
    seek = max(stream_start, source_start - (0.25 * clip.rate if clip.rate != 1 else 0))
    warmup = (source_start - seek) / clip.rate
    source_length = (warmup + available + (0.25 if clip.rate != 1 else 0)) * clip.rate
    speed = (
        tempo_filter(clip.rate)
        if clip.preservePitch
        else f"asetrate={RATE * clip.rate:.9f},aresample={RATE}"
    )
    chain = [
        f"aresample={RATE}",
        "aformat=channel_layouts=stereo",
        "apad=pad_dur=1",
        speed if clip.rate != 1 else "anull",
        f"atrim=start={warmup:.9f}:duration={available:.9f}",
        "asetpts=PTS-STARTPTS",
        f"adelay={round(gap * RATE)}S:all=1",
        f"apad,atrim=end_sample={round(duration * RATE)}",
    ]
    if clip.reverse:
        chain += ["areverse", "asetpts=PTS-STARTPTS"]
    anchor = clip.envelopeOffset + offset
    time_expression = f"(t+{anchor:.9f})"
    envelope = gain_expression(clip.gainPoints, anchor)
    if clip.fadeIn:
        envelope += "*" + fade_expression(f"{time_expression}/{clip.fadeIn:.9f}", clip.fadeCurve)
    if clip.fadeOut:
        envelope += "*" + fade_expression(
            f"({clip.envelopeDuration:.9f}-{time_expression})/{clip.fadeOut:.9f}", clip.fadeCurve
        )
    chain += [
        f"aeval=val(0)*{clip.gain:.9f}*{envelope}|val(1)*{clip.gain:.9f}*{envelope}:c=stereo",
        channel_filter(clip.channels, clip.invertPhase),
        pan_filter(clip.pan),
    ]
    return seek, source_length, chain


def render_video_audio(
    document,
    sources,
    target,
    directory,
    start,
    duration,
    *,
    runner=None,
    check_cancel=None,
    preview=False,
    meter_target=None,
    max_duration=21600,
    source_info=None,
):
    """Decode <=10s output at once, process whole tracks continuously, then master once.

    At most two media inputs are decoded concurrently. Completed raw track windows are
    streamed from disk and deleted after that track joins the accumulated mix. Temporary
    PCM storage is bounded by three full-duration stereo float mixes, independent of lanes;
    dialogue ducking adds one reusable sidechain mix.
    """
    from omnigallery.workspaces.video_studio import _binary

    start, duration = round(start * RATE) / RATE, round(duration * RATE) / RATE
    if duration <= 0 or start < 0 or start + duration > max_duration + 1 / RATE:
        raise HTTPException(422, "声音范围无效或超出时间线")
    output_length = duration
    context = min(start, PREVIEW_CONTEXT) if preview else 0
    start -= context
    length = min(max_duration - start, duration + context + (PREVIEW_CONTEXT if preview else 0))
    ffmpeg = _binary("ffmpeg")
    common = [
        ffmpeg,
        "-nostdin",
        "-hide_banner",
        "-v",
        "warning",
        "-y",
        "-filter_complex_threads",
        "1",
        "-filter_threads",
        "1",
        "-threads",
        "2",
    ]
    codec = ["-c:a", "pcm_f32le", "-ar", str(RATE), "-ac", "2", "-rf64", "auto"]
    graph_path = directory / "audio-graph.txt"

    def run(args, span):
        if check_cancel:
            check_cancel()
        if runner:
            return runner(args, directory, span)
        try:
            return subprocess.run(
                args,
                cwd=directory,
                capture_output=True,
                check=True,
                timeout=max(60, min(7200, span * 30)),
                creationflags=HIDDEN,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise HTTPException(422, "视频声音处理失败，请检查源素材和滤镜") from exc

    def graph(filters):
        graph_path.write_text(";\n".join(filters), encoding="utf-8")
        return [graph_option(ffmpeg), str(graph_path)]

    lanes = audio_tracks(document)
    dialogue_tracks = [
        track for track, clips in lanes if clips and getattr(track, "role", "sound") == "dialogue"
    ]
    ducking = dialogue_tracks and any(
        clips and getattr(track, "role", "sound") == "music" and getattr(track, "duck", False)
        for track, clips in lanes
    )
    sidechain = None
    if ducking:
        # The sidechain receives exactly the same complete, processed dialogue as the main
        # bus. Render it separately to keep simultaneous decoder inputs bounded at two.
        dialogue_directory = directory / "dialogue"
        dialogue_directory.mkdir(exist_ok=True)
        sidechain = directory / "dialogue-sidechain.wav"
        dialogue_document = SimpleNamespace(
            tracks=dialogue_tracks,
            sounds=document.sounds,
            masterGain=1,
            processing=AudioProcessing(),
        )
        render_video_audio(
            dialogue_document,
            sources,
            sidechain,
            dialogue_directory,
            start,
            length,
            runner=runner,
            check_cancel=check_cancel,
            max_duration=max_duration,
            source_info=source_info,
        )
    accumulated = None
    mixed_tracks = 0
    for track_index, (track, clips) in enumerate(lanes):
        active = [
            (i, c) for i, c in clips if c.start < start + length and c.start + c.duration > start
        ]
        if not active:
            continue
        segments = []
        for batch_index in range(math.ceil(length / WINDOW_SECONDS)):
            left = start + batch_index * WINDOW_SECONDS
            span = min(WINDOW_SECONDS, start + length - left)
            raw = None
            mixed_clips = 0
            for index, clip in active:
                a, b = max(left, clip.start), min(left + span, clip.start + clip.duration)
                if b <= a:
                    continue
                seek, source_length, chain = clip_window(
                    clip, a - clip.start, b - a, source_info[index] if source_info else None
                )
                if source_length <= 0:
                    continue
                args = [*common]
                args += (
                    ["-i", str(raw)]
                    if raw
                    else ["-f", "lavfi", "-i", f"anullsrc=r={RATE}:cl=stereo"]
                )
                args += [
                    "-ss",
                    f"{seek:.9f}",
                    "-t",
                    f"{source_length:.9f}",
                    "-threads",
                    "2",
                    "-i",
                    str(sources[index]),
                ]
                chain += [f"adelay={round((a - left) * RATE)}S:all=1"]
                filters = [
                    f"[1:a:{getattr(clip, 'audioStream', 0)}]{','.join(chain)}[clip]",
                    f"[0:a:0][clip]amix=inputs=2:normalize=0:dropout_transition=0,apad,atrim=duration={span:.9f}[out]",
                ]
                output = directory / f"raw-{track_index}-{batch_index}-{mixed_clips % 2}.wav"
                run(
                    args
                    + graph(filters)
                    + ["-map", "[out]", *codec, "-t", f"{span:.9f}", str(output)],
                    span,
                )
                if raw:
                    raw.unlink(missing_ok=True)
                raw = output
                mixed_clips += 1
            segment = directory / f"track-{track_index}-{batch_index}.wav"
            if raw:
                raw.replace(segment)
            else:
                run(
                    common
                    + [
                        "-f",
                        "lavfi",
                        "-i",
                        f"anullsrc=r={RATE}:cl=stereo",
                        *codec,
                        "-t",
                        f"{span:.9f}",
                        str(segment),
                    ],
                    span,
                )
            segments.append(segment)
        manifest = directory / f"track-{track_index}.txt"
        manifest.write_text("\n".join(f"file '{part.name}'" for part in segments), encoding="utf-8")
        args = [*common, "-f", "concat", "-safe", "1", "-i", manifest.name]
        effects = [
            f"volume={track.gain:.9f}",
            pan_filter(track.pan),
            *processing_filters(track.processing),
        ]
        filters = [
            f"[0:a:0]{','.join(effects)},aresample={RATE}:osf=fltp,apad,atrim=duration={length:.9f}[track]"
        ]
        duck_track = (
            sidechain
            and getattr(track, "role", "sound") == "music"
            and getattr(track, "duck", False)
        )
        if duck_track:
            args += ["-i", str(sidechain)]
            filters.append("[track]asetnsamples=n=1024:p=1[music]")
            filters.append(f"[1:a:0]aresample={RATE}:osf=fltp,asetnsamples=n=1024:p=1[dialogue]")
            filters.append(
                "[music][dialogue]sidechaincompress=threshold=0.025:ratio=8:attack=20:release=400[out]"
            )
        elif accumulated:
            args += ["-i", str(accumulated)]
            filters.append("[1:a:0][track]amix=inputs=2:normalize=0:dropout_transition=0[out]")
        else:
            filters.append("[track]anull[out]")
        output = directory / ("ducked-track.wav" if duck_track else f"mix-{mixed_tracks % 2}.wav")
        run(
            args + graph(filters) + ["-map", "[out]", *codec, "-t", f"{length:.9f}", str(output)],
            length,
        )
        for segment in segments:
            segment.unlink(missing_ok=True)
        manifest.unlink(missing_ok=True)
        if duck_track and accumulated:
            merged = directory / f"mix-{mixed_tracks % 2}.wav"
            run(
                common
                + ["-i", str(accumulated), "-i", str(output)]
                + graph(["[0:a:0][1:a:0]amix=inputs=2:normalize=0:dropout_transition=0[out]"])
                + ["-map", "[out]", *codec, "-t", f"{length:.9f}", str(merged)],
                length,
            )
            output.unlink(missing_ok=True)
            output = merged
        elif duck_track:
            merged = directory / f"mix-{mixed_tracks % 2}.wav"
            output.replace(merged)
            output = merged
        if accumulated:
            accumulated.unlink(missing_ok=True)
        accumulated = output
        mixed_tracks += 1
    args = [*common]
    args += (
        ["-i", str(accumulated)]
        if accumulated
        else ["-f", "lavfi", "-i", f"anullsrc=r={RATE}:cl=stereo"]
    )
    effects = [
        f"volume={document.masterGain:.9f}",
        *(processing_filters(document.processing, "master") if accumulated else []),
    ]
    filters = [
        f"[0:a:0]{','.join(effects)},aresample={RATE},apad,atrim=start_sample={round(context * RATE)}:end_sample={round((context + output_length) * RATE)},asetpts=PTS-STARTPTS"
        + (",asplit=2[out][levels]" if meter_target else "[out]")
    ]
    args += graph(filters) + ["-map", "[out]", *codec, "-t", f"{output_length:.9f}", str(target)]
    if meter_target:
        args += ["-map", "[levels]", "-c:a", "pcm_f32le", "-f", "f32le", str(meter_target)]
    run(args, length)
    if accumulated:
        accumulated.unlink(missing_ok=True)
    if sidechain:
        sidechain.unlink(missing_ok=True)


async def wait_preview(worker, disconnected, cancelled):
    """A fetch abort cancels the worker and its subprocess before temporary files disappear."""
    task = asyncio.create_task(asyncio.to_thread(worker))
    try:
        while not task.done():
            if await disconnected():
                cancelled.set()
            await asyncio.wait({task}, timeout=0.05)
        return await task
    finally:
        cancelled.set()
        if not task.done():
            try:
                await asyncio.shield(task)
            except PreviewCancelled:
                pass


def mount_video_audio_routes(app, base, verify_secret, check_path_trust):
    from omnigallery.workspaces.artifacts import _uuid
    from omnigallery.workspaces.video_studio import VideoDocument, _resolve_source

    class VideoPreviewMix(BaseModel):
        model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
        workspace_id: str
        document: VideoDocument
        start: float = Field(default=0, ge=0, le=21600)
        duration: float = Field(gt=0, le=PREVIEW_SECONDS)

    @app.post(base + "/video_studio/preview-mix", dependencies=[Depends(verify_secret)])
    async def preview_mix(request: VideoPreviewMix, http: Request):
        request.workspace_id = _uuid(request.workspace_id)
        if request.start + request.duration > 21600 + 1 / RATE:
            raise HTTPException(422, "视频声音范围超过 6 小时")
        cancelled = threading.Event()

        def check_cancel():
            if cancelled.is_set():
                raise PreviewCancelled()

        def worker():
            if not preview_slots.acquire(blocking=False):
                raise HTTPException(429, "视频声音试听繁忙，请稍后重试")
            try:
                with tempfile.TemporaryDirectory(prefix="video-audio-preview-") as temporary:
                    directory = Path(temporary)
                    sources, metadata, source_info = [], {}, []
                    for clip in request.document.sounds:
                        check_cancel()
                        path = _resolve_source(clip, request.workspace_id, check_path_trust)
                        key = (path, clip.audioStream)
                        if key not in metadata:
                            metadata[key] = source_metadata(
                                path, directory, cancelled, clip.audioStream
                            )
                        info = metadata[key]
                        source_info.append(info)
                        actual = info["duration"]
                        if not info["audio"]:
                            raise HTTPException(422, f"源文件缺少可用声音：{clip.name}")
                        if (
                            not math.isfinite(actual)
                            or actual <= 0
                            or (clip.freeze and clip.sourceIn >= actual)
                            or (
                                clip.sourceIn + (0 if clip.freeze else clip.duration * clip.rate)
                                > actual + 0.1
                            )
                        ):
                            raise HTTPException(422, f"片段超出源文件范围：{clip.name}")
                        sources.append(path)
                    output, levels = directory / "preview.wav", directory / "levels.f32"
                    from omnigallery.workspaces.audio_mix_render import (
                        export_mix_slice,
                        needs_full_mix,
                    )

                    if needs_full_mix("video", request.document):
                        from contextlib import nullcontext

                        from omnigallery.workspaces.audio_mix_cache import (
                            get_audio_mix_cache_manager,
                        )

                        manager = get_audio_mix_cache_manager()
                        lease = (
                            manager.lease_ready(request.workspace_id, "video", request.document)
                            if manager
                            else nullcontext(None)
                        )
                        with lease as cached:
                            if not cached:
                                raise HTTPException(
                                    409, "声音处理需要先准备完整混音，请开始异步混音任务"
                                )
                            export_mix_slice(
                                cached,
                                output,
                                directory,
                                request.start,
                                request.duration,
                                runner=lambda args, stage, length: cancellable_process(
                                    args, stage, length, cancelled
                                ),
                                check_cancel=check_cancel,
                                float_output=True,
                                meter_target=levels,
                            )
                    else:
                        render_video_audio(
                            request.document,
                            sources,
                            output,
                            directory,
                            request.start,
                            request.duration,
                            runner=lambda args, stage, length: cancellable_process(
                                args, stage, length, cancelled
                            ),
                            check_cancel=check_cancel,
                            preview=True,
                            meter_target=levels,
                            source_info=source_info,
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
            except PreviewCancelled:
                raise
            except OSError as exc:
                raise HTTPException(503, "无法启动 FFmpeg 处理视频声音") from exc
            except (ValueError, KeyError) as exc:
                raise HTTPException(422, "无法读取声音源信息") from exc
            finally:
                preview_slots.release()

        try:
            return await wait_preview(worker, http.is_disconnected, cancelled)
        except PreviewCancelled as exc:
            raise HTTPException(499, "试听请求已取消") from exc
