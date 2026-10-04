"""Qwen local erase: independent paint/context masks and source-sized results."""

import copy
import io
import math

from PIL import Image, ImageChops, ImageDraw
from pydantic import BaseModel, ConfigDict, Field, model_validator

from omnigallery.ai import builtin_tools
from omnigallery.image_editing import assets
from omnigallery.image_editing.cutout import ImageToolRequest, Point


class PixelBox(BaseModel):
    model_config = ConfigDict(extra="forbid")
    x: int = Field(strict=True)
    y: int = Field(strict=True)
    width: int = Field(gt=0, le=32768, strict=True)
    height: int = Field(gt=0, le=32768, strict=True)


class Stroke(BaseModel):
    model_config = ConfigDict(extra="forbid")
    points: list[Point] = Field(min_length=1, max_length=20000)
    size: float = Field(gt=0, le=1, allow_inf_nan=False)
    erase: bool = Field(strict=True)


class EraseRequest(ImageToolRequest, builtin_tools.EraseDefaults):
    mask_png_base64: str = Field(max_length=(assets.MAX_BYTES + 2) // 3 * 4)
    context_box: PixelBox
    processing_box: PixelBox
    strokes: list[Stroke] = Field(default_factory=list, max_length=512)

    @model_validator(mode="after")
    def limits(self):
        if sum(len(stroke.points) for stroke in self.strokes) > 100000:
            raise ValueError("笔迹过多，请分次消除")
        if self.context_box.x < 0 or self.context_box.y < 0:
            raise ValueError("参考范围不能超出原图")
        return self


def workflow():
    return builtin_tools.erase_workflow(), ["1", "16", "17", "2"], "Qwen2.1 消除（内置）"


def processing_box(bounds, context: PixelBox, size, blend: int, target):
    """Predict CropAndStitch CPU support, union, aspect expansion and edge shifting.

    With fill/expand/hipass disabled, a blend dilation of kernel ceil(3p/8+1)
    followed by Gaussian sigma=p/8 extends the mask's nonzero bounding box.
    Keep this calculation paired with imageStudioErase.ts and geometry fixtures.
    """
    width, height = size
    x0, y0, x1, y1 = bounds
    if blend:
        kernel = math.ceil(3 * blend / 8 + 1)
        radius = math.floor(blend / 2 + 0.5)
        left, right = kernel // 2 + radius, (kernel - 1) // 2 + radius
        x0, y0 = max(0, x0 - left), max(0, y0 - left)
        x1, y1 = min(width, x1 + right), min(height, y1 + right)
    x, y = min(x0, context.x), min(y0, context.y)
    w = max(x1, context.x + context.width) - x
    h = max(y1, context.y + context.height) - y
    ratio = target[0] / target[1]
    if w / h < ratio:
        grown = int(h * ratio)
        x -= (grown - w) // 2
        w = grown
        x = max(0, min(x, width - w)) if w <= width else -((w - width) // 2)
    else:
        grown = int(w / ratio)
        y -= (grown - h) // 2
        h = grown
        y = max(0, min(y, height - h)) if h <= height else -((h - height) // 2)
    return PixelBox(x=x, y=y, width=w, height=h)


def validate_input(source, request: EraseRequest):
    mask_asset = assets.save_png(request.mask_png_base64)
    size = (source["width"], source["height"])
    with Image.open(io.BytesIO(assets.read_png(mask_asset["path"].split(":")[1]))) as image:
        if image.size != size:
            raise ValueError("消除遮罩尺寸与图片不一致")
        r, g, b = image.convert("RGB").split()
        if ImageChops.difference(r, g).getbbox() or ImageChops.difference(r, b).getbbox():
            raise ValueError("消除遮罩必须为黑白灰度图")
        if image.convert("RGBA").getchannel("A").getextrema() != (255, 255):
            raise ValueError("消除遮罩必须使用不透明的黑白像素")
        bounds = r.getbbox()
    if not bounds:
        raise ValueError("请先涂抹需要消除的区域")
    box = request.context_box
    if box.x + box.width > size[0] or box.y + box.height > size[1]:
        raise ValueError("参考范围不能超出原图")
    actual = processing_box(
        bounds, box, size, request.blend_pixels, (request.output_width, request.output_height)
    )
    if actual != request.processing_box:
        raise ValueError("处理范围预览已变化，请重新调整后提交")
    # Avoid pathological aspect ratios allocating giant padded canvases in the cloud.
    if actual.width * actual.height > 100_000_000 or max(actual.width, actual.height) > 32768:
        raise ValueError("处理范围过大，请调整处理宽高比例")
    mask_asset["bounds"] = {
        "x": bounds[0],
        "y": bounds[1],
        "width": bounds[2] - bounds[0],
        "height": bounds[3] - bounds[1],
    }
    return mask_asset


def context_png(size, box: PixelBox):
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rectangle(
        (box.x, box.y, box.x + box.width - 1, box.y + box.height - 1), fill=255
    )
    stream = io.BytesIO()
    mask.save(stream, "PNG")
    return stream.getvalue()


def prepare_graph(graph, request: EraseRequest, image, mask, context):
    graph = copy.deepcopy(graph)
    graph["1"]["inputs"]["image"] = image
    graph["16"]["inputs"]["image"] = mask
    graph["17"]["inputs"]["image"] = context
    graph["3"]["inputs"]["value"] = request.prompt
    graph["8"]["inputs"].update(
        mask_blend_pixels=request.blend_pixels,
        output_target_width=request.output_width,
        output_target_height=request.output_height,
    )
    return graph


def validate_result(original: bytes, output: bytes):
    with Image.open(io.BytesIO(original)) as source, Image.open(io.BytesIO(output)) as result:
        if (
            result.size != source.size
            or result.format != "PNG"
            or getattr(result, "n_frames", 1) != 1
        ):
            raise ValueError("消除流程返回的图片尺寸或格式不正确，未修改图层")
        result.load()
        # The supplied Qwen graph loads/stitches RGB. Keep an existing layer alpha intact.
        alpha = source.convert("RGBA").getchannel("A")
        if alpha.getextrema() == (255, 255):
            return output
        rgba = result.convert("RGBA")
        rgba.putalpha(alpha)
        stream = io.BytesIO()
        rgba.save(stream, "PNG")
        return stream.getvalue()
