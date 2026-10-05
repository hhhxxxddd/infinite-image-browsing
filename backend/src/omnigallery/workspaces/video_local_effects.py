"""Bounded, frame-local color and region effects, before clip affine transforms.

The input has already been cropped/fitted to the document dimensions. Regions
use that unflipped plane. No new input or temporal buffering is introduced.
"""

import math
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class LocalVideoRegion(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    id: str = Field(min_length=1, max_length=80)
    shape: Literal["rectangle", "ellipse"] = "rectangle"
    effect: Literal["mask", "blur", "mosaic"] = "blur"
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(ge=0.001, le=1)
    height: float = Field(ge=0.001, le=1)
    invert: bool = False
    feather: float = Field(default=0, ge=0, le=0.25)
    strength: float = Field(default=0.5, ge=0, le=1)

    @model_validator(mode="after")
    def inside_frame(self):
        if self.x + self.width > 1 + 1e-9 or self.y + self.height > 1 + 1e-9:
            raise ValueError("局部区域超出画面")
        return self


class LocalVideoEffects(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    exposure: float = Field(default=0, ge=-2, le=2)
    temperature: float = Field(default=0, ge=-1, le=1)
    tint: float = Field(default=0, ge=-1, le=1)
    gamma: float = Field(default=1, ge=0.25, le=4)
    regions: list[LocalVideoRegion] = Field(default_factory=list, max_length=8)

    @model_validator(mode="after")
    def unique_regions(self):
        if len({region.id for region in self.regions}) != len(self.regions):
            raise ValueError("局部区域标识重复")
        return self


def has_local_effects(effects: LocalVideoEffects | None) -> bool:
    return bool(
        effects
        and (
            effects.exposure
            or effects.temperature
            or effects.tint
            or effects.gamma != 1
            or any(region.effect == "mask" or region.strength > 0 for region in effects.regions)
        )
    )


def color_channel(value: float, channel: int, effects: LocalVideoEffects) -> float:
    balance = (
        1 + effects.temperature * 0.25 - effects.tint * 0.125,
        1 + effects.tint * 0.25,
        1 - effects.temperature * 0.25 - effects.tint * 0.125,
    )[channel]
    return 255 * min(1, max(0, value / 255 * 2**effects.exposure * balance)) ** (1 / effects.gamma)


def region_coverage(region: LocalVideoRegion, x: int, y: int, width: int, height: int) -> float:
    """Reference equation shared by Canvas and the generated FFmpeg expression."""
    px, py = x + 0.5, y + 0.5
    left, top = region.x * width, region.y * height
    rw, rh = region.width * width, region.height * height
    if region.shape == "rectangle":
        distance = min(px - left, left + rw - px, py - top, top + rh - py)
    else:
        distance = (
            (1 - math.hypot((px - left - rw / 2) / (rw / 2), (py - top - rh / 2) / (rh / 2)))
            * min(rw, rh)
            / 2
        )
    feather = region.feather * min(width, height)
    inside = min(1, max(0, distance / feather + 0.5)) if feather else float(distance >= 0)
    return 1 - inside if region.invert else inside


def coverage_expression(region: LocalVideoRegion, width: int, height: int) -> str:
    left, top = region.x * width, region.y * height
    rw, rh = region.width * width, region.height * height
    if region.shape == "rectangle":
        distance = f"min(min(X+0.5-{left:.9f},{left + rw:.9f}-X-0.5),min(Y+0.5-{top:.9f},{top + rh:.9f}-Y-0.5))"
    else:
        distance = f"((1-hypot((X+0.5-{left + rw / 2:.9f})/{rw / 2:.9f},(Y+0.5-{top + rh / 2:.9f})/{rh / 2:.9f}))*{min(rw, rh) / 2:.9f})"
    feather = region.feather * min(width, height)
    inside = f"clip(({distance})/{feather:.9f}+0.5,0,1)" if feather else f"gte({distance},0)"
    return f"(1-({inside}))" if region.invert else inside


def _geq(channels: dict[str, str], alpha="alpha(X,Y)"):
    return (
        "geq=" + ":".join(f"{channel}='{channels[channel]}'" for channel in "rgb") + f":a='{alpha}'"
    )


def local_effects_graph(
    input_label: str,
    output_label: str,
    effects: LocalVideoEffects | None,
    width: int,
    height: int,
    prefix: str,
) -> list[str]:
    """Return semicolon-joinable graph nodes, including input/output labels.

    Apply after fit/pad, before flips/affine and existing CSS-like clip.color.
    Color precedes regions; regions are sequential. A mask erases its selected
    area (inverse erases outside), retaining alpha for the final composition.
    Blur branches only the current frame and rejoins before the next region.
    """
    if not all(
        re.fullmatch(r"[A-Za-z0-9_:]+", label) for label in (input_label, output_label, prefix)
    ):
        raise ValueError("无效滤镜标签")
    if width < 1 or height < 1 or width * height > 3840 * 2160:
        raise ValueError("局部效果超出画布尺寸限制")
    if not has_local_effects(effects):
        return [f"[{input_label}]null[{output_label}]"]
    assert effects is not None
    graph, current = [], input_label
    colored = effects.exposure or effects.temperature or effects.tint or effects.gamma != 1
    if colored:
        balances = (
            1 + effects.temperature * 0.25 - effects.tint * 0.125,
            1 + effects.tint * 0.25,
            1 - effects.temperature * 0.25 - effects.tint * 0.125,
        )
        channels = {
            channel: f"255*pow(clip({channel}(X,Y)/255*{2**effects.exposure * balance:.12f},0,1),{1 / effects.gamma:.12f})"
            for channel, balance in zip("rgb", balances, strict=True)
        }
        label = f"{prefix}_color"
        graph.append(f"[{current}]format=gbrap,{_geq(channels)}[{label}]")
        current = label
    for index, region in enumerate(effects.regions):
        if region.effect != "mask" and region.strength == 0:
            continue
        label = f"{prefix}_r{index}"
        coverage = coverage_expression(region, width, height)
        original = {channel: f"{channel}(X,Y)" for channel in "rgb"}
        if region.effect == "mask":
            graph.append(
                f"[{current}]format=gbrap,{_geq(original, f'alpha(X,Y)*(1-({coverage}))')}[{label}]"
            )
        elif region.effect == "mosaic":
            block = max(2, math.floor(region.strength * 0.08 * min(width, height) + 0.5))
            sx, sy = (
                f"min(W-1,floor(X/{block})*{block}+{block // 2})",
                f"min(H-1,floor(Y/{block})*{block}+{block // 2})",
            )
            channels = {
                channel: f"st(0,{coverage});{channel}(X,Y)*(1-ld(0))+{channel}({sx},{sy})*ld(0)"
                for channel in "rgb"
            }
            graph.append(f"[{current}]format=gbrap,{_geq(channels)}[{label}]")
        else:
            radius = min(
                min(width, height) // 2,
                max(1, math.floor(region.strength * 0.04 * min(width, height) + 0.5)),
            )
            graph += [
                f"[{current}]format=gbrap,split=3[{label}_base][{label}_work][{label}_mask]",
                f"[{label}_work]boxblur=lr={radius}:lp=1:cr={radius}:cp=1:ar=0:ap=0[{label}_blur]",
                f"[{label}_mask]{_geq(dict.fromkeys('rgb', f'255*({coverage})'), '255')}[{label}_coverage]",
                f"[{label}_base][{label}_blur][{label}_coverage]maskedmerge=planes=7[{label}]",
            ]
        current = label
    graph.append(f"[{current}]format=gbrap[{output_label}]")
    return graph
