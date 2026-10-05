"""Bounded timeline renderer: short windows, two input decoders, original sources only."""

import math
import subprocess

from fastapi import HTTPException

from omnigallery.workspaces.audio_processing import fade_expression as audio_fade_expression
from omnigallery.workspaces.audio_studio import HIDDEN, tempo_filter
from omnigallery.workspaces.video_local_effects import has_local_effects, local_effects_graph

WINDOW_SECONDS = 10
REVERSE_BUFFER_BYTES = 128 * 1024**2


def audio_window(start, duration, rate):
    """Give atempo bounded context, then trim exactly the requested output interval."""
    seek = max(0, start - 0.25 * rate)
    context = start - seek
    length = context + (duration + 0.25) * rate
    filters = [
        "aresample=48000",
        "aformat=channel_layouts=stereo",
        f"apad=pad_dur={0.25 * rate:.9f}",
        tempo_filter(rate),
        f"atrim=start={context / rate:.9f}:duration={duration:.9f}",
        "asetpts=PTS-STARTPTS",
    ]
    return seek, length, filters


def ease_value(value, easing):
    t = max(0, min(1, value))
    return (
        t * t
        if easing == "easeIn"
        else 1 - (1 - t) ** 2
        if easing == "easeOut"
        else t * t * (3 - 2 * t)
        if easing == "easeInOut"
        else t
    )


def ease_expression(progress, easing):
    if easing == "easeIn":
        return f"pow(({progress}),2)"
    if easing == "easeOut":
        return f"(1-pow(1-({progress}),2))"
    if easing == "easeInOut":
        return f"(pow(({progress}),2)*(3-2*({progress})))"
    return progress


def interpolation(clip, field, time="T"):
    """Incoming keyframe easing plus retained subranges after splitting/trimming."""
    base = getattr(clip.transform, field)
    points = [(frame.time, getattr(frame, field), frame) for frame in clip.keyframes]
    points = sorted((stamp, value, frame) for stamp, value, frame in points if value is not None)
    if not points:
        return f"{base:.9f}"
    if points[0][0] > 0:
        points.insert(0, (0, base, None))
    # A sum of clipped ramps avoids a deeply nested conditional expression at 128 keys.
    terms = [f"{points[0][1]:.9f}"]
    for (start, left, _), (end, right, frame) in zip(points, points[1:], strict=False):
        progress = f"clip((({time})-{start:.9f})/{end - start:.9f},0,1)"
        curve = frame.curves.get(field)
        easing = curve.easing if curve else frame.easing
        if curve:
            a, b = ease_value(curve.start, easing), ease_value(curve.end, easing)
            progress = f"(({ease_expression(f'({curve.start:.9f}+{curve.end - curve.start:.9f}*({progress}))', easing)}-{a:.12f})/{max(1e-10, b - a):.12f})"
        else:
            progress = ease_expression(progress, easing)
        terms.append(f"({right - left:.9f})*({progress})")
    # libavutil limits expression recursion. Balance additions so even a dense 128-key
    # curve stays logarithmic in parser depth rather than becoming a 128-node chain.
    while len(terms) > 1:
        terms = [
            f"({terms[index]}+{terms[index + 1]})" if index + 1 < len(terms) else terms[index]
            for index in range(0, len(terms), 2)
        ]
    return terms[0]


def fade_expression(clip, time):
    time = f"(({time})+{clip.envelopeOffset:.9f})"
    result = "1"
    if clip.fadeIn:
        fade = audio_fade_expression(f"({time})/{clip.fadeIn:.9f}", clip.fadeCurve).replace(
            "\\,", ","
        )
        result = f"min({result},{fade})"
    if clip.fadeOut:
        fade = audio_fade_expression(
            f"({clip.envelopeDuration:.9f}-({time}))/{clip.fadeOut:.9f}", clip.fadeCurve
        ).replace("\\,", ",")
        result = f"min({result},{fade})"
    return result


def opacity(clip, time):
    transition = clip.transitionIn
    incoming = (
        ease_expression(
            f"clip((({time})+{transition.offset:.9f})/{transition.duration:.9f},0,1)",
            transition.easing,
        )
        if transition
        else "1"
    )
    return f"({interpolation(clip, 'opacity', time)})*({fade_expression(clip, time)})*({incoming})"


def fitted_filters(clip, document):
    transform, crop = clip.transform, clip.transform.crop
    width, height = document.width, document.height
    filters = [f"crop=iw*{crop.width:.9f}:ih*{crop.height:.9f}:iw*{crop.x:.9f}:ih*{crop.y:.9f}"]
    if transform.fit == "stretch":
        filters.append(f"scale={width}:{height}:flags=lanczos")
    elif transform.fit == "cover":
        filters += [
            f"scale={width}:{height}:force_original_aspect_ratio=increase:flags=lanczos",
            f"crop={width}:{height}",
        ]
    else:
        filters += [
            f"scale={width}:{height}:force_original_aspect_ratio=decrease:flags=lanczos",
            "format=rgba",
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black@0",
        ]
    return filters


def visual_transform_filters(clip, document, offset):
    transform, color = clip.transform, clip.color
    filters = []
    if transform.flipX:
        filters.append("hflip")
    if transform.flipY:
        filters.append("vflip")
    filters += ["setsar=1", "format=gbrap"]
    time = f"(T+{offset:.9f})"
    animated = any(
        any(
            getattr(frame, field) is not None
            for field in ("x", "y", "scale", "rotation", "opacity")
        )
        for frame in clip.keyframes
    )
    moved = transform.x or transform.y or transform.rotation or transform.scale != 1
    faded = clip.fadeIn or clip.fadeOut or transform.opacity != 1 or clip.transitionIn
    colored = color.brightness != 0 or color.contrast != 1 or color.saturation != 1
    if moved or animated or faded or colored:
        # Inverse affine sampling keeps the intermediate raster exactly canvas sized,
        # even at 4x zoom, instead of allocating a 16x-pixel temporary frame.
        x, y, scale = (interpolation(clip, field, time) for field in ("x", "y", "scale"))
        rotation = f"({interpolation(clip, 'rotation', time)})*{math.pi / 180:.12f}"
        trig_cache = f"+st(4,cos({rotation}))+st(5,sin({rotation}))"
        # Keyframe expressions are frame-dependent, not pixel-dependent. Cache them once
        # per scanline in each geq expression context instead of evaluating 128 ramps per pixel.
        cache = f"if(eq(X,0),st(0,{x})+st(1,{y})+st(2,{scale}){trig_cache},0);"
        alpha_cache = f"if(eq(X,0),st(0,{x})+st(1,{y})+st(2,{scale})+st(3,{opacity(clip, time)}){trig_cache},0);"
        x, y, scale = "ld(0)", "ld(1)", "ld(2)"
        dx, dy = f"(X-W/2-W*({x}))", f"(Y-H/2-H*({y}))"
        sx = f"(({dx}*ld(4)+{dy}*ld(5))/({scale})+W/2)"
        sy = f"((-{dx}*ld(5)+{dy}*ld(4))/({scale})+H/2)"
        alpha = f"if(between({sx},0,W-1)*between({sy},0,H-1),alpha({sx},{sy})*ld(3),0)"
        channels = {channel: f"{channel}({sx},{sy})" for channel in "rgb"}
        if colored:
            # Canvas applies CSS filters in sequence and clamps after each primitive.
            # Keeping values outside RGB here changes later contrast/saturation greatly.
            channels = {
                channel: f"clip((clip({value}*{1 + color.brightness:.9f},0,255)-127.5)*{color.contrast:.9f}+127.5,0,255)"
                for channel, value in channels.items()
            }
            luminance = "+".join(
                f"{weight}*{channels[channel]}"
                for channel, weight in zip("rgb", (0.2126, 0.7152, 0.0722), strict=True)
            )
            channels = {
                channel: f"clip(({value})*{color.saturation:.9f}+({luminance})*{1 - color.saturation:.9f},0,255)"
                for channel, value in channels.items()
            }
        filters.append(
            f"geq=r='{cache}{channels['r']}':g='{cache}{channels['g']}':b='{cache}{channels['b']}':a='{alpha_cache}{alpha}'"
        )
    return filters


def visual_filters(clip, document, offset):
    return fitted_filters(clip, document) + visual_transform_filters(clip, document, offset)


def _ass_color(value):
    rgb, alpha = value[1:7], (int(value[7:9], 16) if len(value) == 9 else 255)
    return f"&H{255 - alpha:02X}{rgb[4:6]}{rgb[2:4]}{rgb[:2]}"


def _ass_time(seconds):
    centiseconds = max(0, round(seconds * 100))
    seconds, centiseconds = divmod(centiseconds, 100)
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours}:{minutes:02}:{seconds:02}.{centiseconds:02}"


def write_ass(document, start, end, target):
    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {document.width}",
        f"PlayResY: {document.height}",
        "ScaledBorderAndShadow: yes",
        "WrapStyle: 2",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    ]
    events = []
    for index, cue in enumerate(document.captions):
        left, right = max(start, cue.start), min(end, cue.start + cue.duration)
        if right <= left or not cue.text.strip():
            continue
        style = cue.style
        box = int(style.background[-2:], 16) > 0
        align = {"left": 4, "center": 5, "right": 6}[style.align]
        lines.append(
            f"Style: s{index},{style.fontFamily},{style.fontSize},{_ass_color(style.color)},"
            f"{_ass_color(style.color)},{_ass_color(style.outlineColor)},{_ass_color(style.background)},"
            f"{-1 if style.bold else 0},0,0,0,100,100,0,0,1,"
            f"{style.outlineWidth},0,{align},0,0,0,1"
        )
        # User text is never parsed as ASS override code or filter syntax.
        from omnigallery.workspaces.video_caption_layout import caption_lines

        text = (
            "\n".join(caption_lines(cue, document.width))
            .replace("\\", "＼")
            .replace("{", "｛")
            .replace("}", "｝")
        )
        text = "".join(char for char in text if char == "\n" or char >= " ").replace("\n", r"\N")
        position = rf"{{\pos({style.x * document.width:.3f},{style.y * document.height:.3f})}}"
        if box:
            lines.append(
                f"Style: b{index},{style.fontFamily},{style.fontSize},&HFF000000,&HFF000000,"
                f"{_ass_color(style.background)},{_ass_color(style.background)},"
                f"{-1 if style.bold else 0},0,0,0,100,100,0,0,3,4,0,{align},0,0,0,1"
            )
            events.append(
                f"Dialogue: {index * 2},{_ass_time(left - start)},{_ass_time(right - start)},b{index},,0,0,0,,{position}{text}"
            )
        events.append(
            f"Dialogue: {index * 2 + 1},{_ass_time(left - start)},{_ass_time(right - start)},s{index},,0,0,0,,{position}{text}"
        )
    if not events:
        return False
    lines += [
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        *events,
    ]
    target.write_text("\n".join(lines), encoding="utf-8")
    return True


def track_for(document, clip, kind="video"):
    identifier = clip.trackId or ("video-1" if kind == "video" else "audio-1")
    return next((track for track in document.tracks if track.id == identifier), None)


def enabled_clips(document, clips, kind):
    solo = any(track.solo for track in document.tracks if track.kind == kind)
    result = []
    for index, clip in enumerate(clips):
        track = track_for(document, clip, kind)
        if track and (
            track.hidden or (kind == "audio" and (track.muted or (solo and not track.solo)))
        ):
            continue
        if kind == "audio" and (clip.freeze or (solo and not track)):
            continue
        track_index = next(
            (i for i, value in enumerate(document.tracks) if track and value.id == track.id), -1
        )
        result.append((track_index, clip.start, index, clip))
    return [(index, clip) for _, _, index, clip in sorted(result)]


def windows(document, start, end, visuals, sounds):
    fps = document.fps
    reverse_frames = max(
        1, min(fps, REVERSE_BUFFER_BYTES // (document.width * document.height * 4))
    )
    boundaries = {start, end}
    for _, clip in visuals + sounds:
        for boundary in (clip.start, clip.start + clip.duration):
            if start < boundary < end:
                boundaries.add(start + round((boundary - start) * fps) / fps)
    position = start
    while position < end - 0.000001:
        reverse = any(
            clip.reverse
            and clip.start < position + WINDOW_SECONDS
            and clip.start + clip.duration > position
            for _, clip in visuals + sounds
        )
        step = reverse_frames / fps if reverse else WINDOW_SECONDS
        position = min(end, position + step)
        boundaries.add(position)
    values = sorted(value for value in boundaries if start <= value <= end)
    return [(a, b) for a, b in zip(values, values[1:], strict=False) if b - a > 0.000001]


def render_timeline(
    request, target, directory, visual_paths, sound_paths, *, run_process=None, check_cancel=None
):
    from omnigallery.workspaces.video_studio import _binary, _graph_option, export_bounds

    document = request.document
    start, end = export_bounds(request)
    ffmpeg, graph_option = _binary("ffmpeg"), _graph_option(_binary("ffmpeg"))
    visuals = enabled_clips(document, document.visuals, "video")
    sounds = enabled_clips(document, document.sounds, "audio")
    intervals = windows(document, start, end, visuals, [])
    batches = []
    for left, right in intervals:
        active_v = [
            (index, clip)
            for index, clip in visuals
            if clip.start < right - 1e-7 and clip.start + clip.duration > left + 1e-7
        ]
        active_a = [
            (index, clip)
            for index, clip in sounds
            if clip.start < right - 1e-7 and clip.start + clip.duration > left + 1e-7
        ]
        batches.append((left, right, active_v, active_a))
    from omnigallery.workspaces.audio_mix_render import (
        needs_full_mix,
        render_operations,
        sound_duration,
    )
    from omnigallery.workspaces.video_audio import render_video_audio

    normalize = needs_full_mix("video", document)
    audio_operations = render_operations(
        document,
        0 if normalize else start,
        sound_duration("video", document) if normalize else end - start,
    )
    if normalize:
        audio_operations += 1
    operations = sum(2 + len(v) for _, _, v, _ in batches) + audio_operations + 1
    finished = 0
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
    video_codec = [
        "-c:v",
        "libx264",
        "-threads",
        "2",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-maxrate",
        "60M",
        "-bufsize",
        "120M",
        "-pix_fmt",
        "yuv420p",
        "-r",
        str(document.fps),
    ]

    def run(args, length):
        nonlocal finished
        if check_cancel:
            check_cancel()
        if run_process:
            run_process(
                args,
                directory,
                length,
                progress_start=finished / operations * 99,
                progress_end=(finished + 1) / operations * 99,
            )
        else:
            try:
                subprocess.run(
                    args,
                    cwd=directory,
                    capture_output=True,
                    timeout=max(90, min(7200, length * 30)),
                    creationflags=HIDDEN,
                    check=True,
                )
            except (OSError, subprocess.SubprocessError) as exc:
                raise HTTPException(422, "视频分段渲染失败，请检查素材和 FFmpeg 滤镜") from exc
        finished += 1

    def graph(filters):
        (directory / "graph.txt").write_text(";\n".join(filters), encoding="utf-8")
        return [graph_option, "graph.txt"]

    segments = []
    freeze_metadata = {}
    for batch_index, (left, right, active_v, _active_a) in enumerate(batches):
        length = right - left
        base = directory / "base-0.mp4"
        run(
            common
            + [
                "-f",
                "lavfi",
                "-i",
                f"color=c=black:s={document.width}x{document.height}:r={document.fps}:d={length:.9f}",
                *video_codec,
                "-an",
                "-t",
                f"{length:.9f}",
                str(base),
            ],
            length,
        )
        for order, (index, clip) in enumerate(active_v):
            a, b = max(left, clip.start), min(right, clip.start + clip.duration)
            offset, portion = a - clip.start, b - a
            source_start = (
                clip.sourceIn
                + ((clip.duration - offset - portion) if clip.reverse else offset) * clip.rate
            )
            timing = []
            args = [*common, "-threads", "2", "-i", str(base)]
            if clip.kind == "image":
                args += ["-threads", "2", "-i", str(visual_paths[index])]
            else:
                seek = source_start
                if clip.freeze:
                    from omnigallery.workspaces.video_media import probe_media

                    path = visual_paths[index]
                    if path not in freeze_metadata:
                        freeze_metadata[path] = probe_media(path)
                    source_fps = freeze_metadata[path]["fps"] or document.fps
                    seek = max(0, math.floor(clip.sourceIn * source_fps) / source_fps - 0.000001)
                args += [
                    "-ss",
                    f"{seek:.9f}",
                    "-t",
                    f"{max(0.1, portion * clip.rate):.9f}",
                    "-threads",
                    "2",
                    "-i",
                    str(visual_paths[index]),
                ]
            if clip.kind == "image" or clip.freeze:
                timing += [
                    "trim=end_frame=1",
                    "setpts=PTS-STARTPTS",
                    f"tpad=stop_mode=clone:stop_duration={portion + 1:.9f}",
                ]
            else:
                timing += [f"setpts=(PTS-STARTPTS)/{clip.rate:.9f}"]
            timing += [f"fps={document.fps}", f"trim=duration={portion:.9f}", "setpts=PTS-STARTPTS"]
            if clip.reverse and clip.kind != "image" and not clip.freeze:
                # Scale first: reverse buffers only this small output-pixel-bounded window.
                timing += [
                    f"scale={document.width}:{document.height}:force_original_aspect_ratio=decrease",
                    "reverse",
                    "setpts=PTS-STARTPTS",
                ]
            placement = f"setpts=PTS+{a - left:.9f}/TB"
            if has_local_effects(clip.localEffects):
                # One bounded fitted plane, then regions, then existing color and affine.
                filters = [f"[1:v:0]{','.join(timing + fitted_filters(clip, document))}[fitted]"]
                filters += local_effects_graph(
                    "fitted",
                    "processed",
                    clip.localEffects,
                    document.width,
                    document.height,
                    "local",
                )
                filters += [
                    f"[processed]{','.join(visual_transform_filters(clip, document, offset) + [placement])}[layer]"
                ]
            else:
                filters = [
                    f"[1:v:0]{','.join(timing + visual_filters(clip, document, offset) + [placement])}[layer]"
                ]
            filters.append(
                f"[0:v:0][layer]overlay=eof_action=pass:repeatlast=0:enable='gte(t,{a - left:.9f})*lt(t,{b - left:.9f})'[v]"
            )
            output = directory / f"base-{(order + 1) % 2}.mp4"
            run(
                args
                + graph(filters)
                + ["-map", "[v]", *video_codec, "-an", "-t", f"{length:.9f}", str(output)],
                length,
            )
            base.unlink(missing_ok=True)
            base = output
        segment = directory / f"segment-{batch_index:06d}.mp4"
        args = [*common, "-i", str(base)]
        subtitles = write_ass(document, left, right, directory / "captions.ass")
        args += (
            ["-vf", "subtitles=filename=captions.ass", *video_codec]
            if subtitles
            else ["-c:v", "copy"]
        )
        run(args + ["-an", "-t", f"{length:.9f}", str(segment)], length)
        base.unlink(missing_ok=True)
        segments.append(segment)
    # Preview and export share envelopes and DSP. Stateful filters run across whole
    # tracks; only source decoding and reverse buffers are divided into short windows.
    sound_mix = directory / "sound-mix.wav"
    if normalize:
        from contextlib import nullcontext

        from omnigallery.workspaces.audio_mix_cache import get_audio_mix_cache_manager
        from omnigallery.workspaces.audio_mix_render import export_mix_slice, render_full_mix

        manager = get_audio_mix_cache_manager()
        lease = (
            manager.lease_ready(request.workspace_id, "video", document)
            if manager
            else nullcontext(None)
        )
        with lease as cached:
            full_mix = directory / "full-sound.wav"
            if not cached:
                render_full_mix(
                    "video",
                    document,
                    sound_paths,
                    full_mix,
                    directory,
                    runner=lambda args, stage, span: run(args, span),
                    check_cancel=check_cancel,
                )
            export_mix_slice(
                cached or full_mix,
                sound_mix,
                directory,
                start,
                end - start,
                runner=lambda args, stage, span: run(args, span),
                check_cancel=check_cancel,
                float_output=True,
            )
            full_mix.unlink(missing_ok=True)
    else:
        from omnigallery.workspaces.audio_studio import probe_source

        render_video_audio(
            document,
            sound_paths,
            sound_mix,
            directory,
            start,
            end - start,
            runner=lambda args, stage, span: run(args, span),
            check_cancel=check_cancel,
            source_info=[
                probe_source(path, clip.audioStream)
                for path, clip in zip(sound_paths, document.sounds, strict=True)
            ],
        )
    manifest = directory / "segments.txt"
    manifest.write_text(
        "\n".join(
            f"file '{segment.name}'\nduration {right - left:.9f}"
            for segment, (left, right, _, _) in zip(segments, batches, strict=True)
        ),
        encoding="utf-8",
    )
    run(
        common
        + [
            "-f",
            "concat",
            "-safe",
            "1",
            "-i",
            manifest.name,
            "-i",
            str(sound_mix),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            "-t",
            f"{end - start:.9f}",
            str(target),
        ],
        end - start,
    )
    for segment in segments + [sound_mix]:
        segment.unlink(missing_ok=True)
    if not target.is_file() or not target.stat().st_size:
        raise HTTPException(422, "视频渲染没有生成文件")
