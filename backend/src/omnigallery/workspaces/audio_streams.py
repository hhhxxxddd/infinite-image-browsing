"""Audio stream ordinals and time bounds on the original container's timeline."""

import math

from fastapi import HTTPException


def _number(value, default=0.0):
    try:
        number = float(value)
        return number if math.isfinite(number) else default
    except (TypeError, ValueError):
        return default


def _duration(value):
    if isinstance(value, str) and ":" in value:
        try:
            parts = [float(part) for part in value.split(":")]
            if len(parts) == 3 and all(math.isfinite(part) for part in parts):
                return max(0, parts[0] * 3600 + parts[1] * 60 + parts[2])
        except (TypeError, ValueError):
            return 0
    return max(0, _number(value))


def enumerate_audio_streams(info):
    container = info.get("format") or {}
    container_start = _number(container.get("start_time"))
    container_duration = _duration(container.get("duration"))
    result = []
    for stream in info.get("streams", []):
        if stream.get("codec_type") != "audio":
            continue
        tags = stream.get("tags") or {}
        # An absent stream timestamp is unknown, not absolute zero in a shifted container.
        absolute_start = _number(stream.get("start_time"), container_start)
        start = absolute_start - container_start
        real_duration = _duration(stream.get("duration"))
        tagged_duration = _duration(tags.get("DURATION") or tags.get("duration"))
        if not real_duration and tagged_duration:
            # Matroska stores the final packet timestamp here, including delayed starts.
            # A 2-second track beginning at 3 seconds therefore has DURATION=00:00:05.
            matroska = any(
                name in {"matroska", "webm"}
                for name in str(container.get("format_name") or "").split(",")
            )
            real_duration = (
                max(0, tagged_duration - absolute_start) if matroska else tagged_duration
            )
        if not real_duration and not tagged_duration and container_duration:
            real_duration = max(0, container_duration - start)
        end = max(0, start + real_duration) if real_duration else 0
        if container_duration:
            end = min(end, container_duration)
        rate = max(0, int(_number(stream.get("sample_rate"))))
        title = str(tags.get("title") or "")
        result.append(
            {
                "ordinal": len(result),
                "index": int(_number(stream.get("index"), len(result))),
                "duration": end,
                "start_time": start,
                "real_duration": real_duration,
                "default": bool((stream.get("disposition") or {}).get("default")),
                "sample_rate": rate,
                "sampleRate": rate,
                "channels": max(0, int(_number(stream.get("channels")))),
                "channel_layout": str(stream.get("channel_layout") or ""),
                "codec": str(stream.get("codec_name") or ""),
                "title": title,
                "name": title,
                "language": str(tags.get("language") or ""),
            }
        )
    return result


def selected_audio_stream(info, ordinal=0):
    if isinstance(ordinal, bool) or not isinstance(ordinal, int) or not 0 <= ordinal <= 255:
        raise HTTPException(422, "声音流编号无效")
    streams = enumerate_audio_streams(info)
    if ordinal >= len(streams):
        raise HTTPException(422, f"素材不包含第 {ordinal + 1} 条声音流，请重新选择")
    stream = streams[ordinal]
    if not 0 < stream["duration"] <= 86400:
        raise HTTPException(422, "所选声音流时长未知或超过 24 小时")
    return stream
