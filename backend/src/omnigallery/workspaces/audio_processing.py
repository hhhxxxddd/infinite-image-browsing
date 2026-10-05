"""Shared, bounded DSP presets for timeline preview and final rendering."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class EqualizerSettings(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")
    low: float = Field(default=0, ge=-12, le=12)
    mid: float = Field(default=0, ge=-12, le=12)
    high: float = Field(default=0, ge=-12, le=12)


class CompressorSettings(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")
    thresholdDb: float = Field(default=-18, ge=-60, le=0)
    ratio: float = Field(default=2, ge=1, le=20)
    attack: float = Field(default=15, ge=0.1, le=200)
    release: float = Field(default=180, ge=10, le=2000)
    makeupDb: float = Field(default=0, ge=0, le=24)


class AudioProcessing(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")
    denoise: Literal["off", "light", "strong"] = "off"
    equalizer: Literal["flat", "voice", "warm", "bright", "custom"] = "flat"
    compressor: Literal["off", "gentle", "voice", "custom"] = "off"
    deess: bool = False
    normalize: Literal["off", "voice", "music"] = "off"
    limiter: bool = False
    bypass: bool = False
    eq: EqualizerSettings = Field(default_factory=EqualizerSettings)
    compression: CompressorSettings = Field(default_factory=CompressorSettings)


class GainPoint(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")
    time: float = Field(ge=0, le=86400)
    gain: float = Field(ge=0, le=4)


def processing_filters(processing: AudioProcessing, scope="track"):
    if processing.bypass:
        return []
    filters = []
    if processing.denoise != "off":
        filters.append("afftdn=nr=" + ("8" if processing.denoise == "light" else "16"))
    filters += {
        "flat": [],
        "voice": ["highpass=f=80", "equalizer=f=2500:t=q:w=0.8:g=2"],
        "warm": ["bass=g=3:f=160:w=0.6", "treble=g=-1.5:f=5000:w=0.6"],
        "bright": ["treble=g=3:f=4000:w=0.6"],
        "custom": [
            f"bass=g={processing.eq.low:.6f}:f=160:w=0.6",
            f"equalizer=f=1000:t=q:w=0.8:g={processing.eq.mid:.6f}",
            f"treble=g={processing.eq.high:.6f}:f=5000:w=0.6",
        ],
    }[processing.equalizer]
    if processing.deess:
        filters.append("deesser=i=0.4:m=0.5:f=0.5")
    if processing.compressor == "custom":
        settings = processing.compression
        filters.append(
            f"acompressor=threshold={10 ** (settings.thresholdDb / 20):.9f}:ratio={settings.ratio:.6f}"
            f":attack={settings.attack:.6f}:release={settings.release:.6f}:makeup={10 ** (settings.makeupDb / 20):.9f}"
        )
    elif processing.compressor != "off":
        filters.append(
            "acompressor=threshold=0.18:ratio=2:attack=15:release=180:makeup=1.2"
            if processing.compressor == "gentle"
            else "acompressor=threshold=0.12:ratio=3:attack=8:release=180:makeup=1.4"
        )
    if processing.normalize != "off":
        target = -16 if processing.normalize == "voice" else -14
        filters.append(f"loudnorm=I={target}:TP=-1.5:LRA=11:linear=false")
    if processing.limiter:
        filters.append("alimiter=limit=0.891251:attack=5:release=50:level=false:latency=true")
    return filters


def pan_filter(pan: float):
    """Stereo balance: center is bit-identical, extremes silence the opposite channel."""
    left, right = min(1, 1 - pan), min(1, 1 + pan)
    return (
        f"aformat=sample_fmts=fltp,pan=stereo|c0={left:.9f}*c0|c1={right:.9f}*c1"
        if pan
        else "anull"
    )


def gain_expression(points: list[GainPoint], envelope_offset=0):
    if not points:
        return "1"
    time = f"(t+{envelope_offset:.9f})"
    terms = [f"{points[0].gain:.9f}"]
    # Sum clamped ramps instead of nesting conditionals: 128 points remain shallow
    # enough for FFmpeg's expression parser and hold endpoint gains outside the curve.
    for left, right in zip(points, points[1:], strict=False):
        slope = (right.gain - left.gain) / (right.time - left.time)
        terms.append(f"{slope:.9f}*clip({time}-{left.time:.9f}\\,0\\,{right.time - left.time:.9f})")
    while len(terms) > 1:
        terms = [
            f"({terms[index]}+{terms[index + 1]})" if index + 1 < len(terms) else terms[index]
            for index in range(0, len(terms), 2)
        ]
    return terms[0]


def fade_expression(progress: str, curve: str):
    t = f"clip({progress}\\,0\\,1)"
    if curve == "smooth":
        return f"({t}*{t}*(3-2*{t}))"
    if curve == "equalPower":
        return f"sin({t}*PI/2)"
    return t


def channel_filter(channels: str, invert: bool):
    mapping = {
        "stereo": "c0=c0|c1=c1",
        "swap": "c0=c1|c1=c0",
        "mono": "c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1",
        "left": "c0=c0|c1=c0",
        "right": "c0=c1|c1=c1",
    }[channels]
    return f"pan=stereo|{mapping}" + (",volume=-1" if invert else "")
