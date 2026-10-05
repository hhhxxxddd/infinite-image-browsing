"""One bounded, complete sound path for editor caches and exports.

Full-track/master DSP runs once on disk. Preview chunks are slices of the finalized
float mix, so loudness normalization never depends on the requested playback window.
"""

import math
import re
import threading
from pathlib import Path
from types import SimpleNamespace

from fastapi import HTTPException

from omnigallery.workspaces.audio_studio import RATE, _binary
from omnigallery.workspaces.video_audio import (
    PreviewCancelled,
    audio_tracks,
    cancellable_process,
    render_video_audio,
    source_metadata,
)

CLIP_SOUND_FIELDS = (
    "path",
    "audioStream",
    "start",
    "sourceIn",
    "duration",
    "rate",
    "preservePitch",
    "gain",
    "pan",
    "gainPoints",
    "fadeIn",
    "fadeOut",
    "fadeCurve",
    "channels",
    "invertPhase",
    "envelopeOffset",
    "envelopeDuration",
    "reverse",
    "freeze",
)


def sound_document(kind, document):
    if kind == "video":
        return document
    if kind != "audio":
        raise HTTPException(422, "声音工程类型无效")
    tracks, sounds = [], []
    for index, track in enumerate(document.tracks):
        track_id = f"sound-{index}"
        tracks.append(
            SimpleNamespace(
                **track.model_dump(exclude={"id", "clips"}),
                id=track_id,
                kind="audio",
                hidden=False,
            )
        )
        for clip in track.clips:
            adapted_clip = SimpleNamespace(
                **clip.model_dump(),
                trackId=track_id,
                reverse=False,
                freeze=False,
            )
            adapted_clip.gainPoints = clip.gainPoints
            sounds.append(adapted_clip)
    # Preserve typed DSP settings after adapting track/clip containers.
    for track, original in zip(tracks, document.tracks, strict=True):
        track.processing = original.processing
    return SimpleNamespace(
        tracks=tracks, sounds=sounds, masterGain=document.masterGain, processing=document.processing
    )


def sound_duration(kind, document):
    adapted = sound_document(kind, document)
    return max(
        [1 / RATE]
        + [clip.start + clip.duration for _, clips in audio_tracks(adapted) for _, clip in clips]
    )


def sound_revision_payload(kind, document):
    """Only audible semantics; changing names, ids, pictures or captions cannot change sound."""
    adapted = sound_document(kind, document)
    tracks = []
    for track, clips in audio_tracks(adapted):
        if not clips:
            continue
        values = []
        for _, clip in clips:
            value = {field: getattr(clip, field) for field in CLIP_SOUND_FIELDS}
            value["gainPoints"] = [
                point.model_dump() if hasattr(point, "model_dump") else point
                for point in value["gainPoints"]
            ]
            values.append(value)
        tracks.append(
            {
                "gain": track.gain,
                "pan": track.pan,
                "processing": track.processing.model_dump(),
                "role": getattr(track, "role", "sound"),
                "duck": getattr(track, "duck", False),
                "clips": values,
            }
        )
    return {
        "version": 1,
        "duration": sound_duration(kind, document),
        "tracks": tracks,
        "masterGain": adapted.masterGain,
        "processing": adapted.processing.model_dump(),
    }


def resolve_mix_sources(kind, document, workspace_id, check_path_trust):
    if kind == "audio":
        from omnigallery.workspaces.audio_studio import resolve_source

        return [
            resolve_source(clip.path, workspace_id, check_path_trust)
            for track in document.tracks
            for clip in track.clips
        ]
    from omnigallery.workspaces.video_studio import _resolve_source

    return [_resolve_source(clip, workspace_id, check_path_trust) for clip in document.sounds]


def needs_full_mix(kind, document):
    adapted = sound_document(kind, document)
    lanes = audio_tracks(adapted)
    # atempo has a phase/history state. Restarting it at an arbitrary seek or
    # preview chunk cannot reproduce the same samples as the finalized mix.
    if any(clip.rate != 1 and clip.preservePitch for _, clips in lanes for _, clip in clips):
        return True
    processors = [adapted.processing] + [track.processing for track, _ in lanes]
    for value in processors:
        if value.bypass:
            continue
        equalizer = value.equalizer != "flat" and (
            value.equalizer != "custom" or any((value.eq.low, value.eq.mid, value.eq.high))
        )
        if (
            value.denoise != "off"
            or equalizer
            or value.compressor != "off"
            or value.deess
            or value.normalize != "off"
            or value.limiter
        ):
            return True
    dialogue = any(
        clips and getattr(track, "role", "sound") == "dialogue" for track, clips in lanes
    )
    return dialogue and any(
        clips and getattr(track, "role", "sound") == "music" and getattr(track, "duck", False)
        for track, clips in lanes
    )


def render_operations(document, start, length):
    count = 1
    lanes = audio_tracks(document)
    for _, clips in lanes:
        active = [
            clip
            for _, clip in clips
            if clip.start < start + length and clip.start + clip.duration > start
        ]
        if not active:
            continue
        count += 1
        for index in range(math.ceil(length / 10)):
            left, right = start + index * 10, min(start + length, start + (index + 1) * 10)
            count += max(
                1, sum(clip.start < right and clip.start + clip.duration > left for clip in active)
            )
    dialogue = [
        track for track, clips in lanes if clips and getattr(track, "role", "sound") == "dialogue"
    ]
    ducked = [
        track
        for track, clips in lanes
        if clips and getattr(track, "role", "sound") == "music" and getattr(track, "duck", False)
    ]
    if dialogue and ducked:
        dialogue_doc = SimpleNamespace(tracks=dialogue, sounds=document.sounds)
        count += render_operations(dialogue_doc, start, length) + len(ducked)
    return count


def render_full_mix(
    kind,
    document,
    sources,
    target,
    directory,
    *,
    cancelled=None,
    on_progress=None,
    runner=None,
    check_cancel=None,
):
    cancelled = cancelled or threading.Event()
    adapted = sound_document(kind, document)
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    maximum = 86400 if kind == "audio" else 21600
    duration = round(sound_duration(kind, document) * RATE) / RATE
    if duration > maximum:
        raise HTTPException(422, "声音片段超出时间线")
    if len(sources) != len(adapted.sounds):
        raise HTTPException(422, "声音来源与片段不匹配")

    def checkpoint():
        if cancelled.is_set():
            raise PreviewCancelled()
        if check_cancel:
            check_cancel()

    metadata, source_info = {}, []
    for index, (clip, source) in enumerate(zip(adapted.sounds, sources, strict=True)):
        checkpoint()
        key = (source, clip.audioStream)
        if key not in metadata:
            metadata[key] = source_metadata(
                source, directory, cancelled, clip.audioStream, checkpoint
            )
        info = metadata[key]
        source_info.append(info)
        if not info["audio"] or not math.isfinite(info["duration"]) or info["duration"] <= 0:
            raise HTTPException(422, f"源文件缺少可用声音：{clip.name}")
        if (
            clip.sourceIn >= info["duration"]
            if clip.freeze
            else clip.sourceIn + clip.duration * clip.rate > info["duration"] + 0.03
        ):
            raise HTTPException(422, f"片段超出源声音范围：{clip.name}")
        if on_progress:
            on_progress("checking", 0.02 * (index + 1) / len(sources))
    operations, finished = render_operations(adapted, 0, duration), 0

    def run(args, working, span):
        nonlocal finished
        checkpoint()
        if on_progress:
            on_progress("mixing", 0.02 + 0.96 * finished / operations)
        result = (
            runner(args, working, span)
            if runner
            else cancellable_process(args, working, span, cancelled)
        )
        finished += 1
        return result

    render_video_audio(
        adapted,
        sources,
        target,
        directory,
        0,
        duration,
        runner=run,
        check_cancel=checkpoint,
        max_duration=maximum,
        source_info=source_info,
    )
    checkpoint()
    if on_progress:
        on_progress("ready", 1)


def export_mix_slice(
    source,
    target,
    directory,
    start,
    duration,
    audio_format="wav",
    *,
    runner=None,
    check_cancel=None,
    float_output=False,
    meter_target=None,
):
    """Seek the finalized sound, pad picture/text-only tails, and encode exactly one range."""
    start, duration = round(start * RATE) / RATE, round(duration * RATE) / RATE
    if start < 0 or duration <= 0 or start + duration > 86400 + 1 / RATE:
        raise HTTPException(422, "声音输出范围无效")
    if check_cancel:
        check_cancel()
    # Seeking beyond EOF produces no filter frames. An explicit silence input ensures
    # text/visual-only ranges still have the requested sample count.
    filters = f"[0:a:0][1:a:0]amix=inputs=2:normalize=0:dropout_transition=0,atrim=duration={duration:.9f},astats=measure_perchannel=none:measure_overall=Peak_level:reset=0"
    filters += ",asplit=2[out][levels]" if meter_target else "[out]"
    args = [
        _binary("ffmpeg"),
        "-nostdin",
        "-hide_banner",
        "-v",
        "info",
        "-y",
        "-filter_complex_threads",
        "1",
        "-threads",
        "2",
        "-ss",
        f"{start:.9f}",
        "-t",
        f"{duration:.9f}",
        "-i",
        str(source),
        "-f",
        "lavfi",
        "-i",
        f"anullsrc=r={RATE}:cl=stereo",
        "-filter_complex",
        filters,
        "-map",
        "[out]",
        "-ar",
        str(RATE),
        "-ac",
        "2",
        "-c:a",
        ("pcm_f32le" if float_output else "pcm_s16le") if audio_format == "wav" else "libmp3lame",
    ]
    if audio_format == "wav":
        args += ["-rf64", "auto"]
    else:
        args += ["-b:a", "192k"]
    args += ["-t", f"{duration:.9f}", "-f", audio_format, str(target)]
    if meter_target:
        args += [
            "-map",
            "[levels]",
            "-c:a",
            "pcm_f32le",
            "-f",
            "f32le",
            "-t",
            f"{duration:.9f}",
            str(meter_target),
        ]
    result = (
        runner(args, directory, duration)
        if runner
        else cancellable_process(args, directory, duration, threading.Event())
    )
    peaks = re.findall(rb"Peak level dB:\s+([-+\w.]+)", getattr(result, "stderr", b"") or b"")
    peak = float(peaks[-1]) if peaks else -math.inf
    return peak if math.isfinite(peak) else None
