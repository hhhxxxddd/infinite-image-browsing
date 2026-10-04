"""Shared single-layer AI job lifecycle, with the SAM3 mask adapter.

All built-in image tools share the queue and layer exclusion lock. Results remain
editor assets and never become library/workspace artifacts.
"""

import base64
import copy
import hashlib
import io
import json
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Literal

from fastapi import HTTPException
from PIL import Image, ImageChops
from pydantic import BaseModel, Field, model_validator

from omnigallery.ai import builtin_tools
from omnigallery.ai.image_configuration import comfy_cloud_key
from omnigallery.ai.providers.comfy_cloud import ComfyCloudV2
from omnigallery.image_editing import assets
from omnigallery.image_editing.history import _write
from omnigallery.storage.filesystem import checked_path
from omnigallery.storage.project_files import storage_operation, storage_root

PROCESS_ID = str(uuid.uuid4())
ACTIVE = {"queued", "running"}
executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="image-tool")
slots = threading.BoundedSemaphore(8)


class Point(BaseModel):
    x: float = Field(ge=0, le=1, allow_inf_nan=False)
    y: float = Field(ge=0, le=1, allow_inf_nan=False)


class Box(Point):
    width: float = Field(gt=0, le=1, allow_inf_nan=False)
    height: float = Field(gt=0, le=1, allow_inf_nan=False)


class ImageToolRequest(BaseModel):
    id: uuid.UUID
    document_key: str = Field(pattern=r"^[a-f0-9]{64}$")
    layer_id: str = Field(pattern=r"^[\w-]{1,80}$")
    layer_name: str = Field(default="图片", max_length=80)
    source_revision: str = Field(pattern=r"^[a-f0-9]{64}$")
    png_base64: str = Field(max_length=(assets.MAX_BYTES + 2) // 3 * 4)


class CutoutRequest(ImageToolRequest):
    mode: Literal["points", "box"]
    positive: list[Point] = Field(default_factory=list, max_length=64)
    negative: list[Point] = Field(default_factory=list, max_length=64)
    box: Box | None = None
    refine_iterations: int = Field(default=3, ge=0, le=5, strict=True)
    trim_transparent: bool = Field(default=False, strict=True)
    # Current layer rectangle in the original input when editing a previously trimmed result.
    source_bounds: Box | None = None

    @model_validator(mode="after")
    def hints(self):
        if self.mode == "points" and (not self.positive or self.box is not None):
            raise ValueError("点选模式至少需要一个保留点，不能同时提交选框")
        if self.mode == "box" and (not self.box or self.positive or self.negative):
            raise ValueError("框选模式只接受一个选框")
        if self.box and (
            self.box.x + self.box.width > 1.000001 or self.box.y + self.box.height > 1.000001
        ):
            raise ValueError("选框不能超出图片")
        if self.source_bounds and (
            self.source_bounds.x + self.source_bounds.width > 1.000001
            or self.source_bounds.y + self.source_bounds.height > 1.000001
        ):
            raise ValueError("图层范围不能超出抠图输入")
        return self


def workflow():
    return builtin_tools.cutout_workflow(), list(builtin_tools.CUTOUT_NODES), "SAM3 抠图（内置）"


def prepare_graph(graph, ids, request, size, uploaded):
    graph = copy.deepcopy(graph)
    graph[ids[0]]["inputs"] = {"image": uploaded}
    inputs = graph[ids[2]]["inputs"]
    for key in ("conditioning", "bboxes", "positive_coords", "negative_coords"):
        inputs.pop(key, None)
    inputs.update(individual_masks=False, refine_iterations=request.refine_iterations)
    width, height = size
    if request.mode == "points":
        for name, points in (
            ("positive_coords", request.positive),
            ("negative_coords", request.negative),
        ):
            inputs[name] = json.dumps(
                [
                    {
                        "x": min(width - 1, round(p.x * width)),
                        "y": min(height - 1, round(p.y * height)),
                    }
                    for p in points
                ]
            )
    else:
        box = request.box
        inputs["bboxes"] = {
            "x": box.x * width,
            "y": box.y * height,
            "width": box.width * width,
            "height": box.height * height,
        }
    return graph


def compose_mask(source: bytes, mask: bytes, trim_transparent: bool = False):
    with Image.open(io.BytesIO(source)) as original, Image.open(io.BytesIO(mask)) as result:
        if result.size != original.size or getattr(result, "n_frames", 1) != 1:
            raise ValueError("遮罩尺寸与输入图片不一致，未修改图层")
        # MaskToImage outputs grayscale, white = foreground. Never guess mask polarity.
        rgb = result.convert("RGB")
        r, g, b = rgb.split()
        if ImageChops.difference(r, g).getbbox() or ImageChops.difference(r, b).getbbox():
            raise ValueError("工作流返回的不是灰度遮罩，未修改图层")
        if not r.getbbox():
            raise ValueError("未识别到主体，请调整选点或选框")
        rgba = original.convert("RGBA")
        rgba.putalpha(ImageChops.multiply(rgba.getchannel("A"), r))
        bounds = rgba.getchannel("A").getbbox()
        if not bounds:
            raise ValueError("主体位于透明区域，请重新选择")
        if not trim_transparent:
            bounds = (0, 0, rgba.width, rgba.height)
        x, y, right, bottom = bounds
        result_bounds = {
            "x": x / rgba.width,
            "y": y / rgba.height,
            "width": (right - x) / rgba.width,
            "height": (bottom - y) / rgba.height,
        }
        rgba = rgba.crop(bounds)
        stream = io.BytesIO()
        rgba.save(stream, format="PNG")
        return stream.getvalue(), result_bounds


def _path(document_key, job_id):
    if len(document_key) != 64 or any(c not in "0123456789abcdef" for c in document_key):
        raise HTTPException(400, "文档编号无效")
    return checked_path(
        storage_root() / "image-editor-tasks" / document_key / (str(uuid.UUID(job_id)) + ".json")
    )


def _save(record):
    record["updated_at"] = time.time()
    _write(
        _path(record["document_key"], record["id"]), json.dumps(record, ensure_ascii=False).encode()
    )


def _read(document_key, job_id):
    try:
        record = json.loads(_path(document_key, job_id).read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise HTTPException(404, "AI 图片任务不存在") from error
    if record["state"] in ACTIVE and record.get("process_id") != PROCESS_ID:
        record.update(
            state="failed", error="服务已重启；请先检查 Comfy Cloud 中的任务，避免重复提交"
        )
        _save(record)
    return record


def _public(record):
    return {
        key: value for key, value in record.items() if key not in {"process_id", "request_hash"}
    }


@storage_operation
def list_jobs(document_key):
    directory = _path(document_key, str(uuid.UUID(int=0))).parent
    records = [_read(document_key, path.stem) for path in directory.glob("*.json")]
    # One current task and one successful comparison pair per layer/tool. Legacy histories
    # are reduced on read; a pending/failed retry does not discard the last successful pair.
    current, completed, items = set(), set(), []
    for record in sorted(records, key=lambda r: r["created_at"], reverse=True):
        if record.get("superseded"):
            continue
        slot = (record["layer_id"], record.get("tool_id", builtin_tools.CUTOUT_ID))
        success = record["state"] == "completed" and record.get("result")
        if slot not in current or (success and slot not in completed) or record["state"] in ACTIVE:
            items.append(_public(record))
        current.add(slot)
        if success:
            completed.add(slot)
    return items


def _retire_results(record):
    """Keep only the newest pair; retain small receipts for paid-request idempotency."""
    directory = _path(record["document_key"], record["id"]).parent
    recovery = list(record.get("recovery_steps", []))
    retired = []
    for path in directory.glob("*.json"):
        if path.stem == record["id"]:
            continue
        older = _read(record["document_key"], path.stem)
        if (
            older["layer_id"] != record["layer_id"]
            or older.get("tool_id", builtin_tools.CUTOUT_ID)
            != record.get("tool_id", builtin_tools.CUTOUT_ID)
            or older["created_at"] >= record["created_at"]
            or older["state"] in ACTIVE
            or older.get("superseded")
        ):
            continue
        # Pixel assets may still belong to the document, a duplicate layer or undo history.
        # Retiring a tool buffer must not remove these shared files.
        if older["state"] == "completed" and older.get("result"):
            recovery.extend(older.get("recovery_steps", []))
            recovery.append(
                {
                    key: older.get(key)
                    for key in ("source_revision", "source_bounds", "result_bounds", "result")
                }
            )
        for key in (
            "source",
            "result",
            "source_bounds",
            "result_bounds",
            "positive",
            "negative",
            "box",
            "mask_asset",
            "strokes",
            "recovery_steps",
        ):
            older.pop(key, None)
        older.update(superseded=True, handled=True)
        retired.append(older)
    if recovery:
        record["recovery_steps"] = list(
            {json.dumps(step, sort_keys=True): step for step in recovery}.values()
        )
        # Save the compact recovery chain before retiring its predecessors.
        _save(record)
    for older in retired:
        _save(older)


@storage_operation
def finish_job(document_key, job_id, action):
    record = _read(document_key, job_id)
    if record.get("accepted_at"):
        return _public(record)
    if action == "accept":
        if record["state"] != "completed" or not record.get("result") or record.get("superseded"):
            raise HTTPException(409, "此任务没有可采用的结果")
        siblings = [r for r in list_jobs(document_key) if r["layer_id"] == record["layer_id"]]
        if any(
            r["state"] in ACTIVE
            or (r["id"] != job_id and r["state"] == "completed" and not r.get("handled"))
            for r in siblings
        ):
            raise HTTPException(409, "请等待此图层的 AI 任务结束后再采用结果")
        accepted_at = time.time()
        # Adopting establishes a new input for every tool on this layer, even when
        # two tools returned identical pixels. Keep assets for the document/undo.
        for sibling in siblings:
            if sibling["id"] != job_id and sibling["state"] == "completed":
                other = _read(document_key, sibling["id"])
                other.update(accepted_at=accepted_at, handled=True)
                _save(other)
        record.update(accepted_at=accepted_at, handled=True)
    elif action == "cancel":
        record.update(state="canceled", handled=True)
    elif record["state"] == "completed":
        record["handled"] = True
    _save(record)
    return _public(record)


@storage_operation
def _change(document_key, job_id, **changes):
    record = _read(document_key, job_id)
    if record["state"] == "canceled":
        if "cloud_job_id" in changes:
            record["cloud_job_id"] = changes["cloud_job_id"]
            _save(record)
        return False
    record.update(changes)
    _save(record)
    if changes.get("state") == "completed":
        _retire_results(record)
    return True


@storage_operation
def submit(request: ImageToolRequest):
    from omnigallery.image_editing import erase, upscale

    is_upscale = isinstance(request, upscale.UpscaleRequest)
    is_erase = isinstance(request, erase.EraseRequest)
    tool_id = (
        builtin_tools.ERASE_ID
        if is_erase
        else (builtin_tools.UPSCALE_ID if is_upscale else builtin_tools.CUTOUT_ID)
    )
    job_id = str(request.id)
    digest = hashlib.sha256(request.model_dump_json().encode()).hexdigest()
    if _path(request.document_key, job_id).exists():
        existing = _read(request.document_key, job_id)
        if (
            existing["request_hash"] != digest
            or existing.get("tool_id", builtin_tools.CUTOUT_ID) != tool_id
        ):
            raise HTTPException(409, "任务编号已用于其他请求")
        return _public(existing)
    if not comfy_cloud_key()[0]:
        raise HTTPException(400, "请先在设置中配置 Comfy Cloud API Key")
    if any(
        r["layer_id"] == request.layer_id and r["state"] in ACTIVE
        for r in list_jobs(request.document_key)
    ):
        raise HTTPException(409, "此图层正在进行 AI 加工")
    if not slots.acquire(blocking=False):
        raise HTTPException(429, "AI 图片队列已满，请稍后重试")
    try:
        source = assets.save_png(request.png_base64)
        mask_asset = None
        if is_upscale:
            upscale.validate_size(source, request.size_mode)
        elif is_erase:
            mask_asset = erase.validate_input(source, request)
        elif (
            max(source["width"], source["height"]) > 8192
            or source["width"] * source["height"] > 16_000_000
        ):
            raise ValueError("抠图输入不能超过 8192 像素边长或 1600 万像素")
        graph, ids, name = (
            erase.workflow() if is_erase else (upscale.workflow() if is_upscale else workflow())
        )
        record = {
            **request.model_dump(mode="json", exclude={"png_base64", "mask_png_base64"}),
            "request_hash": digest,
            "process_id": PROCESS_ID,
            "source": source,
            "workflow_name": name,
            "tool_id": tool_id,
            "tool_version": builtin_tools.ERASE_VERSION
            if is_erase
            else (builtin_tools.UPSCALE_VERSION if is_upscale else builtin_tools.CUTOUT_VERSION),
            "state": "queued",
            "created_at": time.time(),
            "handled": False,
            "error": "",
        }
        if mask_asset:
            record["mask_asset"] = mask_asset
        if is_upscale:
            # A legacy multiplier is relative to its input, not a short-edge preset.
            record.pop(
                "target_resolution" if request.multiplier is not None else "multiplier", None
            )
        _save(record)
        executor.submit(_run, request, source, graph, ids)
        return _public(record)
    except Exception:
        slots.release()
        raise


def _run(request, source, graph, ids):
    from omnigallery.image_editing import erase, upscale

    is_upscale = isinstance(request, upscale.UpscaleRequest)
    is_erase = isinstance(request, erase.EraseRequest)
    key, job_id = request.document_key, str(request.id)
    try:
        if not _change(key, job_id, state="running"):
            return
        raw = assets.read_png(source["path"].split(":")[1])
        cloud = ComfyCloudV2(comfy_cloud_key()[0])
        uploaded = cloud.upload(raw, "image-source.png", "image/png")
        if not _change(key, job_id, state="running"):
            return
        if is_erase:
            mask = cloud.upload(
                base64.b64decode(request.mask_png_base64, validate=True),
                "erase-mask.png",
                "image/png",
            )
            context = cloud.upload(
                erase.context_png((source["width"], source["height"]), request.context_box),
                "erase-context.png",
                "image/png",
            )
            graph = erase.prepare_graph(graph, request, uploaded, mask, context)
        else:
            graph = (
                upscale.prepare_graph(graph, request, uploaded)
                if is_upscale
                else prepare_graph(
                    graph, ids, request, (source["width"], source["height"]), uploaded
                )
            )
        if not _change(key, job_id, state="running"):
            return
        job = cloud.submit(graph)
        if not _change(key, job_id, cloud_job_id=job["id"]):
            return
        result = cloud.wait(job, timeout=1800 if is_upscale or is_erase else 600)
        if not _change(key, job_id, state="running"):
            return
        output = cloud.output(result, ids[-1], "image")
        if is_erase:
            pixels, _ = cloud.download_image(output, max_bytes=assets.MAX_BYTES)
            composed = erase.validate_result(raw, pixels)
            result_bounds = None
        elif is_upscale:
            pixels, _ = cloud.download_image(output, max_bytes=assets.MAX_BYTES)
            composed = upscale.validate_result(source, pixels, request.size_mode)
            result_bounds = None
        else:
            mask, _ = cloud.download_image(output)
            composed, result_bounds = compose_mask(raw, mask, request.trim_transparent)
        result_asset = assets.save_png(base64.b64encode(composed).decode())
        _change(key, job_id, state="completed", result=result_asset, result_bounds=result_bounds)
    except Exception as error:
        message = (
            str(error.detail)
            if isinstance(error, HTTPException)
            else (
                str(error)
                if isinstance(error, ValueError)
                else "AI 图片处理失败；请检查云端任务后再重试"
            )
        )
        _change(key, job_id, state="failed", error=message)
    finally:
        slots.release()
