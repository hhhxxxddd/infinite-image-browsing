"""SeedVR2 adapter. Magnification changes pixels, never editor layer geometry."""

import copy
import io

from PIL import Image
from pydantic import Field, field_validator, model_validator

from omnigallery.ai import builtin_tools
from omnigallery.image_editing.cutout import ImageToolRequest


class UpscaleRequest(ImageToolRequest, builtin_tools.UpscaleDefaults):
    # Accept old clients/job requests, but never expose multiplier in new settings.
    multiplier: int | None = Field(default=None, strict=True)

    @field_validator("multiplier")
    @classmethod
    def legacy_multiplier(cls, value):
        if value is not None and value not in (1, 2, 4):
            raise ValueError("倍率仅支持 1、2、4")
        return value

    @model_validator(mode="after")
    def one_size_mode(self):
        if self.multiplier is not None and "target_resolution" in self.model_fields_set:
            raise ValueError("不能同时指定倍率和目标分辨率")
        return self

    @property
    def size_mode(self):
        return self.multiplier if self.multiplier is not None else self.target_resolution


def workflow():
    return builtin_tools.upscale_workflow(), ["1", "4:12", "2"], "SeedVR2 高清化（内置）"


def requested_size(source: dict, mode: str | int) -> tuple[int, int]:
    width, height = source["width"], source["height"]
    if isinstance(mode, int):
        return width * mode, height * mode
    if mode == "original":
        return width, height
    short = {"2K": 2048, "4K": 4096, "8K": 8192}[mode]
    if width >= height:
        return round((width / height) * short), short
    return short, round((height / width) * short)


def validate_size(source: dict, mode: str | int):
    width, height = requested_size(source, mode)
    if min(width, height) < 2:
        raise ValueError("高清化结果的宽高至少需要 2 像素，请提高输出尺寸")
    if max(width, height) > 16384 or width * height > 100_000_000:
        raise ValueError("高清化结果不能超过 16384 像素边长或 1 亿像素，请降低输出尺寸")


def prepare_graph(graph, request: UpscaleRequest, uploaded: str):
    graph = copy.deepcopy(graph)
    graph["1"]["inputs"]["image"] = uploaded
    resize = graph["4:12"]["inputs"]
    for key in list(resize):
        if key.startswith("resize_type."):
            del resize[key]
    if request.multiplier is not None or request.target_resolution == "original":
        resize.update(
            {
                "resize_type": "scale by multiplier",
                "resize_type.multiplier": request.multiplier or 1,
            }
        )
    else:
        resize.update(
            {
                "resize_type": "scale shorter dimension",
                "resize_type.shorter_size": {"2K": 2048, "4K": 4096, "8K": 8192}[
                    request.target_resolution
                ],
            }
        )
    return graph


def validate_result(source: dict, output: bytes, mode: str | int) -> bytes:
    with Image.open(io.BytesIO(output)) as result:
        requested = requested_size(source, mode)
        # SeedVR2PostProcessing restores alpha and rounds down to even dimensions.
        aligned = tuple(value - value % 2 for value in requested)
        if result.size not in (requested, aligned) or getattr(result, "n_frames", 1) != 1:
            raise ValueError("高清化结果尺寸与所选输出尺寸不一致，未修改图层")
        if result.format != "PNG":
            raise ValueError("高清化流程未返回 PNG，未修改图层")
        result.verify()
    # Preserve the workflow's pixels/alpha verbatim. Asset storage verifies decoding too.
    return output
