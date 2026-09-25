"""Provider-neutral image description, prompt and tag generation."""

from __future__ import annotations

import base64
import io
import ipaddress
import json
import math
import os
import re
import time
import uuid
import warnings
from typing import Annotated, Any, Literal
from urllib.parse import urlsplit

import requests
from fastapi import Depends, FastAPI, HTTPException
from PIL import Image as PilImage
from PIL import ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field

from scripts.iib.db.datamodel import DataBase, GlobalSetting
from scripts.iib.network_proxy import requests_proxy_kwargs
from scripts.iib.qwen3_vl_instruct import (
    DEFAULT_DESCRIPTION_TEMPLATE,
    DEFAULT_PROMPT_TEMPLATE,
    DEFAULT_TAGS_TEMPLATE,
    GenerateRequest,
    _runtime,
    parse_tags,
    prompt_for,
    readiness,
)
from scripts.iib.tool import is_image_file

SETTING_KEY = "image_ai_config"
SECRET_KEY = "openrouter_api_key"
COMFY_SECRET_KEY = "comfy_cloud_api_key"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
COMFY_ROUTER_URL = "https://api.comfy.org/v2/models"
COMFY_CLOUD_USER_URL = "https://cloud.comfy.org/api/user"
COMFY_CLOUD_API_URL = "https://cloud.comfy.org/api"
COMFY_MODELS = {
    "vertexai/gemini-3.1-flash-lite",
    "vertexai/gemini-3.7-flash",
    "vertexai/gemini-3.8-flash",
    "vertexai/gemini-3.1-pro-preview",
}
DEFAULT_COMFY_MODEL = "vertexai/gemini-3.1-flash-lite"
CREATION_SETTING_KEY = "image_ai_creation_config"
STUDIO_WORKFLOWS_KEY = "image_ai_studio_workflows"
CREATION_MODELS = {
    "vertexai/gemini-3.1-flash-lite-image",
    "vertexai/gemini-3.1-flash-image",
    "vertexai/gemini-3-pro-image",
    "vertexai/gemini-2.5-flash-image",
}
ROUTER_IMAGE_RATIOS = {"1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"}
ROUTER_FLASH_EXTRA_RATIOS = {"1:4", "4:1", "1:8", "8:1"}
ROUTER_RESIZABLE_MODELS = {"vertexai/gemini-3.1-flash-image", "vertexai/gemini-3-pro-image"}
DEFAULT_CREATION_MODEL = "vertexai/gemini-3.1-flash-image"
ROUTER_VISION_MODEL_LABELS = {
    "vertexai/gemini-3.1-flash-lite": "Gemini 3.1 Flash Lite",
    "vertexai/gemini-3.7-flash": "Gemini 3.7 Flash",
    "vertexai/gemini-3.8-flash": "Gemini 3.8 Flash",
    "vertexai/gemini-3.1-pro-preview": "Gemini 3.1 Pro",
}
ROUTER_CREATION_MODEL_LABELS = {
    "vertexai/gemini-3.1-flash-lite-image": "Nano Banana 2 Lite",
    "vertexai/gemini-3.1-flash-image": "Nano Banana 2",
    "vertexai/gemini-3-pro-image": "Nano Banana Pro",
    "vertexai/gemini-2.5-flash-image": "Gemini 2.5 Flash Image",
}
DEFAULT_MODEL = "qwen/qwen3-vl-8b-instruct"
GGUF_DEFAULT_URL = "http://127.0.0.1:8080/v1"


def _comfy_get(url: str, **kwargs):
    return requests.get(url, **kwargs, **requests_proxy_kwargs())


def _comfy_post(url: str, **kwargs):
    return requests.post(url, **kwargs, **requests_proxy_kwargs())
DEFAULT_PROMPTS = {
    "description": DEFAULT_DESCRIPTION_TEMPLATE,
    "prompt": DEFAULT_PROMPT_TEMPLATE,
    "tags": DEFAULT_TAGS_TEMPLATE,
}


class PromptTemplates(BaseModel):
    description: str = Field(min_length=1, max_length=2000)
    prompt: str = Field(min_length=1, max_length=2000)
    tags: str = Field(min_length=1, max_length=2000)


class ImageAIConfigRequest(BaseModel):
    provider: str
    openrouter_model: str = Field(default=DEFAULT_MODEL, max_length=200)
    gguf_base_url: str = Field(default=GGUF_DEFAULT_URL, max_length=200)
    gguf_model: str = Field(default="", max_length=200)
    comfy_model: str = Field(default=DEFAULT_COMFY_MODEL, max_length=200)
    comfy_mode: str = "router"
    comfy_workflow: dict[str, Any] | None = None
    comfy_workflow_name: str = Field(default="", max_length=200)
    comfy_image_node_id: str = ""
    comfy_image_input: str = "image"
    comfy_prompt_node_id: str = ""
    comfy_prompt_input: str = "prompt"
    comfy_output_node_id: str = ""
    prompts: PromptTemplates
    api_key: str | None = Field(default=None, max_length=512)
    clear_api_key: bool = False
    comfy_api_key: str | None = Field(default=None, max_length=512)
    clear_comfy_api_key: bool = False


class StudioReferenceImage(BaseModel):
    image_base64: str = Field(max_length=16_000_000)
    node_id: str = Field(max_length=128)
    input: str = Field(max_length=128)


class StudioEditRequest(BaseModel):
    image_base64: str = Field(max_length=16_000_000)
    mask_base64: str | None = Field(default=None, max_length=16_000_000)
    prompt: str = Field(default="", max_length=8000)
    workflow: dict[str, Any]
    image_node_id: str
    image_input: str
    mask_node_id: str = ""
    mask_input: str = ""
    prompt_node_id: str = ""
    prompt_input: str = ""
    negative_prompt: str = Field(default="", max_length=8000)
    negative_prompt_node_id: str = ""
    negative_prompt_input: str = ""
    output_node_id: str = ""
    reference_images: list[StudioReferenceImage] = Field(default_factory=list, max_length=13)


class StudioWorkflowSlot(BaseModel):
    node_id: str = Field(max_length=128)
    input: str = Field(max_length=128)


class StudioParameterOption(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    values: list[str] = Field(min_length=1, max_length=12)


class StudioWorkflowParameter(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=80)
    kind: Literal["number", "text", "boolean", "select"]
    targets: list[StudioWorkflowSlot] = Field(min_length=1, max_length=12)
    options: list[StudioParameterOption] = Field(default_factory=list, max_length=32)
    minimum: float | None = None
    maximum: float | None = None
    step: float | None = None


class StudioWorkflowPresetRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    purpose: Literal["image_generation", "image_edit", "audio_creation", "video_creation"] = "image_edit"
    workflow: dict[str, Any]
    image_node_id: str = Field(default="", max_length=128)
    image_input: str = Field(default="", max_length=128)
    mask_node_id: str = Field(default="", max_length=128)
    mask_input: str = Field(default="", max_length=128)
    mask_enabled: bool = True
    prompt_node_id: str = Field(default="", max_length=128)
    prompt_input: str = Field(default="", max_length=128)
    negative_prompt_node_id: str = Field(default="", max_length=128)
    negative_prompt_input: str = Field(default="", max_length=128)
    output_node_id: str = Field(default="", max_length=128)
    reference_slots: list[StudioWorkflowSlot] = Field(default_factory=list, max_length=13)
    parameters: list[StudioWorkflowParameter] = Field(default_factory=list, max_length=32)


class StudioPresetEditRequest(BaseModel):
    workflow_id: str
    image_base64: str = Field(max_length=16_000_000)
    mask_base64: str | None = Field(default=None, max_length=16_000_000)
    prompt: str = Field(default="", max_length=8000)
    negative_prompt: str = Field(default="", max_length=8000)
    reference_images_base64: list[Annotated[str, Field(max_length=16_000_000)]] = Field(default_factory=list, max_length=13)
    parameter_values: dict[str, Any] = Field(default_factory=dict)


def _studio_workflows() -> list[dict]:
    value = GlobalSetting.get_setting(DataBase.get_conn(), STUDIO_WORKFLOWS_KEY)
    return value if isinstance(value, list) else []


def _workflow_mask_from_main_image(graph: dict, image_node_id: str) -> bool:
    """A LoadImage MASK output reads the inverse alpha of its uploaded PNG."""
    source = graph.get(image_node_id)
    if not isinstance(source, dict) or source.get("class_type") != "LoadImage":
        return False
    return any(
        isinstance(node, dict) and isinstance(node.get("inputs"), dict)
        and any("mask" in name.lower() and value == [image_node_id, 1]
                for name, value in node["inputs"].items())
        for node in graph.values()
    )


def _workflow_summary(item: dict) -> dict:
    summary = {key: item[key] for key in ("id", "name", "created_at", "updated_at", "image_node_id",
                                          "mask_node_id", "prompt_node_id", "output_node_id", "reference_slots")}
    summary["negative_prompt_node_id"] = item.get("negative_prompt_node_id", "")
    summary["purpose"] = item.get("purpose", "image_edit")
    summary["mask_from_image"] = _workflow_mask_from_main_image(item["workflow"], item["image_node_id"])
    summary["mask_enabled"] = item.get("mask_enabled", True)
    summary["parameters"] = item.get("parameters", [])
    summary["parameter_defaults"] = {parameter["id"]: [
        item["workflow"][target["node_id"]]["inputs"][target["input"]]
        for target in parameter["targets"]]
        for parameter in summary["parameters"]}
    return summary


def _parameter_value(value: Any, original: Any) -> str | int | float | bool:
    if isinstance(original, bool):
        if isinstance(value, bool):
            return value
        if isinstance(value, str) and value.lower() in ("true", "false"):
            return value.lower() == "true"
    elif isinstance(original, int):
        try:
            number = float(value)
            if not isinstance(value, bool) and math.isfinite(number) and number.is_integer():
                return int(number)
        except (TypeError, ValueError, OverflowError):
            pass
    elif isinstance(original, float):
        try:
            number = float(value)
            if not isinstance(value, bool) and math.isfinite(number):
                return number
        except (TypeError, ValueError, OverflowError):
            pass
    elif isinstance(original, str) and isinstance(value, str):
        return value
    raise HTTPException(400, detail="可调参数的值与节点输入类型不匹配")


def _validate_workflow_parameters(req: StudioWorkflowPresetRequest) -> None:
    ids: set[str] = set()
    mapped: set[tuple[str, str]] = set()
    for parameter in req.parameters:
        if not parameter.id.strip() or parameter.id in ids or not parameter.name.strip():
            raise HTTPException(400, detail="可调参数的名称和编号必须有效且唯一")
        ids.add(parameter.id)
        if parameter.kind != "select" and len(parameter.targets) != 1:
            raise HTTPException(400, detail="数值、文本和开关参数只能映射一个节点字段")
        if parameter.kind == "select" and not parameter.options:
            raise HTTPException(400, detail="选项参数至少需要一个选项")
        if parameter.kind == "number":
            for value in (parameter.minimum, parameter.maximum, parameter.step):
                if value is not None and not math.isfinite(value):
                    raise HTTPException(400, detail="数值参数的范围必须是有限数字")
            if parameter.step is not None and parameter.step <= 0:
                raise HTTPException(400, detail="数值参数步长必须大于零")
            if parameter.minimum is not None and parameter.maximum is not None and parameter.minimum > parameter.maximum:
                raise HTTPException(400, detail="数值参数最小值不能大于最大值")
        for target in parameter.targets:
            field = (target.node_id, target.input)
            node = req.workflow.get(target.node_id)
            if field in mapped or not node or target.input not in node["inputs"]:
                raise HTTPException(400, detail="可调参数映射了重复或不存在的节点字段")
            mapped.add(field)
            original = node["inputs"][target.input]
            if not isinstance(original, (str, int, float, bool)):
                raise HTTPException(400, detail="可调参数只能映射未连接的文本、数值或开关字段")
            if parameter.kind == "number" and (isinstance(original, bool) or not isinstance(original, (int, float))):
                raise HTTPException(400, detail="数值参数必须映射到数值字段")
            if parameter.kind == "text" and not isinstance(original, str):
                raise HTTPException(400, detail="文本参数必须映射到文本字段")
            if parameter.kind == "boolean" and not isinstance(original, bool):
                raise HTTPException(400, detail="开关参数必须映射到布尔字段")
        for option in parameter.options:
            if len(option.values) != len(parameter.targets) or not option.name.strip():
                raise HTTPException(400, detail="每个选项都需要为全部目标字段设置值和名称")
            for target, value in zip(parameter.targets, option.values):
                _parameter_value(value, req.workflow[target.node_id]["inputs"][target.input])
    reserved = {(req.image_node_id, req.image_input), (req.prompt_node_id, req.prompt_input),
                (req.negative_prompt_node_id, req.negative_prompt_input), (req.mask_node_id, req.mask_input)}
    reserved.update((slot.node_id, slot.input) for slot in req.reference_slots)
    reserved.discard(("", ""))
    if mapped & reserved:
        raise HTTPException(400, detail="可调参数不能与主图、参考图、遮罩或提示词映射到同一字段")


def _apply_workflow_parameters(graph: dict, preset: dict, values: dict[str, Any]) -> None:
    parameters = {item["id"]: item for item in preset.get("parameters", [])}
    if len(values) > len(parameters) or any(parameter_id not in parameters for parameter_id in values):
        raise HTTPException(400, detail="包含未配置的可调参数")
    for parameter_id, chosen in values.items():
        parameter = parameters[parameter_id]
        targets = parameter["targets"]
        if parameter["kind"] == "select":
            if isinstance(chosen, bool) or not isinstance(chosen, int) or not 0 <= chosen < len(parameter["options"]):
                raise HTTPException(400, detail=f"{parameter['name']}的选项无效")
            updates = parameter["options"][chosen]["values"]
        else:
            updates = [chosen]
        for target, value in zip(targets, updates):
            node = graph.get(target["node_id"])
            if not node or target["input"] not in node["inputs"]:
                raise HTTPException(400, detail=f"{parameter['name']}映射的节点在本次运行中不可用")
            original = node["inputs"][target["input"]]
            converted = _parameter_value(value, original)
            if parameter["kind"] == "number":
                minimum, maximum = parameter.get("minimum"), parameter.get("maximum")
                if minimum is not None and converted < minimum or maximum is not None and converted > maximum:
                    raise HTTPException(400, detail=f"{parameter['name']}超出允许范围")
            node["inputs"][target["input"]] = converted


def _studio_graph_for_run(preset: dict, use_mask: bool, reference_count: int) -> dict:
    """Create a run-specific graph without disabled image links; never modify the saved preset."""
    graph = json.loads(json.dumps(preset["workflow"]))
    excluded: set[str] = {slot["node_id"] for slot in preset["reference_slots"][reference_count:]}
    if not use_mask and preset.get("mask_node_id"):
        excluded.add(preset["mask_node_id"])
    for node in graph.values():
        for name, value in list(node["inputs"].items()):
            if not isinstance(value, list) or len(value) != 2:
                continue
            source = str(value[0])
            if source in excluded or (not use_mask and source == preset["image_node_id"]
                                      and value[1] == 1 and "mask" in name.lower()):
                del node["inputs"][name]
    for node_id in excluded:
        graph.pop(node_id, None)
    return graph


def _validate_workflow_preset(req: StudioWorkflowPresetRequest) -> None:
    if not req.name.strip():
        raise HTTPException(400, detail="请填写工作流名称")
    if not req.workflow or len(req.workflow) > 256 or len(json.dumps(req.workflow, ensure_ascii=False)) > 1_000_000:
        raise HTTPException(400, detail="请导入不超过 1 MB 的 API 格式工作流")
    if any(not isinstance(node, dict) or not isinstance(node.get("class_type"), str)
           or not isinstance(node.get("inputs"), dict) for node in req.workflow.values()):
        raise HTTPException(400, detail="工作流节点需要 class_type 和 inputs")
    _validate_workflow_parameters(req)
    if req.purpose != "image_edit":
        return
    if bool(req.image_node_id) != bool(req.image_input):
        raise HTTPException(400, detail="主图节点和字段需要同时设置")
    if bool(req.prompt_node_id) != bool(req.prompt_input):
        raise HTTPException(400, detail="正向提示词节点和字段需要同时设置")
    if bool(req.mask_node_id) != bool(req.mask_input):
        raise HTTPException(400, detail="遮罩节点和字段需要同时设置")
    if bool(req.negative_prompt_node_id) != bool(req.negative_prompt_input):
        raise HTTPException(400, detail="负向提示词节点和字段需要同时设置")
    if any(not slot.node_id or not slot.input for slot in req.reference_slots):
        raise HTTPException(400, detail="请设置每张参考图的节点和字段")
    sample = req.model_dump()
    variants = [(False, len(req.reference_slots))]
    if req.mask_enabled and (req.mask_node_id or _workflow_mask_from_main_image(req.workflow, req.image_node_id)):
        variants.append((True, 0))
    for use_mask, reference_count in variants:
        graph = _studio_graph_for_run(sample, use_mask, reference_count)
        _validate_studio_workflow(StudioEditRequest(
            image_base64="", mask_base64="x" if use_mask else None, prompt="校验",
            workflow=graph, image_node_id=req.image_node_id, image_input=req.image_input,
            mask_node_id=req.mask_node_id if use_mask else "", mask_input=req.mask_input if use_mask else "",
            prompt_node_id=req.prompt_node_id, prompt_input=req.prompt_input,
            negative_prompt_node_id=req.negative_prompt_node_id,
            negative_prompt_input=req.negative_prompt_input,
            output_node_id=req.output_node_id,
            reference_images=[StudioReferenceImage(image_base64="", node_id=slot.node_id, input=slot.input)
                              for slot in req.reference_slots[:reference_count]],
        ), require_output=False)


class CreationConfigRequest(BaseModel):
    mode: str = "workflow"
    model: str = DEFAULT_CREATION_MODEL
    comfy_api_key: str | None = Field(default=None, max_length=512)
    clear_comfy_api_key: bool = False


class StudioRouterEditRequest(BaseModel):
    image_base64: str = Field(max_length=16_000_000)
    prompt: str = Field(min_length=1, max_length=8000)
    model: str
    aspect_ratio: str | None = None
    image_size: str | None = None
    reference_images_base64: list[Annotated[str, Field(max_length=16_000_000)]] = Field(default_factory=list, max_length=13)


def _studio_png(value: str, label: str) -> tuple[bytes, tuple[int, int]]:
    try:
        data = base64.b64decode(value, validate=True)
        if len(data) > 12_000_000:
            raise ValueError()
        with PilImage.open(io.BytesIO(data)) as image:
            if image.format != "PNG" or not 1 <= image.width <= 2048 or not 1 <= image.height <= 2048:
                raise ValueError()
            image.verify()
        with PilImage.open(io.BytesIO(data)) as image:
            return data, image.size
    except (ValueError, OSError, UnidentifiedImageError, PilImage.DecompressionBombError,
            PilImage.DecompressionBombWarning) as error:
        raise HTTPException(400, detail=f"{label}必须是 2048 像素以内的有效 PNG") from error


def _studio_image_with_alpha_mask(image_bytes: bytes, mask_bytes: bytes) -> bytes:
    """Pack the app's white-edit mask into ComfyUI LoadImage's inverse-alpha format."""
    with PilImage.open(io.BytesIO(image_bytes)) as source, PilImage.open(io.BytesIO(mask_bytes)) as mask:
        combined = source.convert("RGB").convert("RGBA")
        combined.putalpha(ImageOps.invert(mask.convert("L")))
        output = io.BytesIO()
        combined.save(output, format="PNG")
        return output.getvalue()


def _validate_studio_workflow(req: StudioEditRequest, *, require_output: bool = True) -> dict:
    graph = req.workflow
    if not graph or len(graph) > 256 or len(json.dumps(graph, ensure_ascii=False)) > 1_000_000:
        raise HTTPException(400, detail="请导入不超过 1 MB 的 API 格式工作流")
    if any(not isinstance(node, dict) or not isinstance(node.get("class_type"), str)
           or not isinstance(node.get("inputs"), dict) for node in graph.values()):
        raise HTTPException(400, detail="工作流节点需要 class_type 和 inputs")
    if not req.image_node_id or not req.image_input:
        raise HTTPException(400, detail="请设置主图输入节点和字段")
    if bool(req.prompt_node_id) != bool(req.prompt_input):
        raise HTTPException(400, detail="正向提示词节点和字段需要同时设置")
    if require_output and not req.output_node_id:
        raise HTTPException(400, detail="运行前请设置图片结果节点")
    mappings = [(req.image_node_id, req.image_input)]
    if req.prompt_node_id:
        mappings.append((req.prompt_node_id, req.prompt_input))
    if req.negative_prompt_node_id or req.negative_prompt_input:
        mappings.append((req.negative_prompt_node_id, req.negative_prompt_input))
    if req.mask_node_id or req.mask_input:
        mappings.append((req.mask_node_id, req.mask_input))
    mappings.extend((reference.node_id, reference.input) for reference in req.reference_images)
    if len(set(mappings)) != len(mappings):
        raise HTTPException(400, detail="图片、参考图、遮罩和提示词不能映射到同一个输入字段")
    if (req.output_node_id and req.output_node_id not in graph) or any(
            node_id not in graph or input_name not in graph[node_id]["inputs"]
            for node_id, input_name in mappings):
        raise HTTPException(400, detail="图片、参考图、遮罩、提示词或输出节点映射无效")
    if req.negative_prompt_node_id and not isinstance(
            graph[req.negative_prompt_node_id]["inputs"][req.negative_prompt_input], str):
        raise HTTPException(400, detail="负向提示词必须映射到文本输入字段")
    mask_from_image = _workflow_mask_from_main_image(graph, req.image_node_id)
    if mask_from_image and (req.mask_node_id or req.mask_input):
        raise HTTPException(400, detail="主图节点已输出遮罩，无需再映射独立遮罩节点")
    if mask_from_image or req.mask_node_id or req.mask_input:
        if not req.mask_base64:
            raise HTTPException(400, detail="当前工作流需要遮罩 PNG")
    elif req.mask_base64:
        raise HTTPException(400, detail="当前工作流没有连接遮罩输入")
    if req.mask_node_id and (graph.get(req.mask_node_id, {}).get("class_type") != "LoadImageMask"
                             or req.mask_input != "image"):
        raise HTTPException(400, detail="独立遮罩只能映射到 LoadImageMask 的 image 字段")
    if req.mask_node_id and graph[req.mask_node_id]["inputs"].get("channel") not in ("alpha", "red", "green", "blue"):
        raise HTTPException(400, detail="LoadImageMask 需要有效的 channel 字段")
    if mask_from_image and req.image_input != "image":
        raise HTTPException(400, detail="主图 Alpha 遮罩必须映射到 LoadImage 的 image 字段")
    for node in graph.values():
        if node["class_type"] == "OpenAIGPTImageNodeV2" and isinstance(node["inputs"].get("model.mask"), list):
            mask_link = node["inputs"]["model.mask"]
            mask_source = graph.get(mask_link[0]) if mask_link and isinstance(mask_link[0], str) else None
            if isinstance(mask_source, dict) and mask_source["class_type"] == "ImageToMask" \
                    and "image" not in mask_source["inputs"]:
                raise HTTPException(400, detail="ImageToMask 缺少图片输入；可将 LoadImage 的 MASK 输出直接连接到 model.mask")
            image_count = sum(name.startswith("model.images.image_") and isinstance(value, list)
                              for name, value in node["inputs"].items())
            if image_count != 1:
                raise HTTPException(400, detail="GPT Image 工作流使用遮罩时只能连接一张输入图，请移除其他参考图连线")
    return json.loads(json.dumps(graph))


def load_config() -> dict:
    saved = GlobalSetting.get_setting(DataBase.get_conn(), SETTING_KEY)
    saved = saved if isinstance(saved, dict) else {}
    prompts = saved.get("prompts") if isinstance(saved.get("prompts"), dict) else {}
    return {
        "provider": saved.get("provider") if saved.get("provider") in ("local", "local_gguf", "openrouter", "comfy_cloud") else "local",
        "openrouter_model": saved.get("openrouter_model") or DEFAULT_MODEL,
        "gguf_base_url": saved.get("gguf_base_url") or GGUF_DEFAULT_URL,
        "gguf_model": saved.get("gguf_model") or "",
        "comfy_model": saved.get("comfy_model") if saved.get("comfy_model") in COMFY_MODELS else DEFAULT_COMFY_MODEL,
        "comfy_mode": saved.get("comfy_mode") if saved.get("comfy_mode") in ("router", "workflow") else "router",
        "comfy_workflow": saved.get("comfy_workflow") if isinstance(saved.get("comfy_workflow"), dict) else None,
        "comfy_workflow_name": saved.get("comfy_workflow_name") or "",
        "comfy_image_node_id": saved.get("comfy_image_node_id") or "",
        "comfy_image_input": saved.get("comfy_image_input") or "image",
        "comfy_prompt_node_id": saved.get("comfy_prompt_node_id") or "",
        "comfy_prompt_input": saved.get("comfy_prompt_input") or "prompt",
        "comfy_output_node_id": saved.get("comfy_output_node_id") or "",
        "prompts": {key: prompts.get(key) or default for key, default in DEFAULT_PROMPTS.items()},
    }


def openrouter_key() -> tuple[str, str]:
    row = DataBase.get_conn().execute("SELECT value FROM image_ai_secret WHERE name = ?", (SECRET_KEY,)).fetchone()
    if row and row[0]:
        return row[0], "saved"
    key = os.getenv("OPENROUTER_API_KEY", "").strip()
    return key, "environment" if key else "none"


def comfy_cloud_key() -> tuple[str, str]:
    row = DataBase.get_conn().execute("SELECT value FROM image_ai_secret WHERE name = ?", (COMFY_SECRET_KEY,)).fetchone()
    if row and row[0]:
        return row[0], "saved"
    key = os.getenv("COMFY_API_KEY", "").strip()
    return key, "environment" if key else "none"


def public_config() -> dict:
    key, source = openrouter_key()
    comfy_key, comfy_source = comfy_cloud_key()
    return {**load_config(), "api_key_configured": bool(key), "api_key_source": source,
            "comfy_api_key_configured": bool(comfy_key), "comfy_api_key_source": comfy_source}


def public_creation_config() -> dict:
    saved = GlobalSetting.get_setting(DataBase.get_conn(), CREATION_SETTING_KEY)
    saved = saved if isinstance(saved, dict) else {}
    key, source = comfy_cloud_key()
    return {
        "mode": saved.get("mode") if saved.get("mode") in ("router", "workflow") else "workflow",
        "model": saved.get("model") if saved.get("model") in CREATION_MODELS else DEFAULT_CREATION_MODEL,
        "comfy_api_key_configured": bool(key),
        "comfy_api_key_source": source,
    }


def save_creation_config(req: CreationConfigRequest) -> dict:
    if req.mode not in ("router", "workflow"):
        raise HTTPException(400, detail="AI 创作接入方式无效")
    if req.model not in CREATION_MODELS:
        raise HTTPException(400, detail="请选择支持的 Comfy Router 图像模型")
    if req.comfy_api_key and req.clear_comfy_api_key:
        raise HTTPException(400, detail="不能同时设置和清除 API Key")
    conn = DataBase.get_conn()
    with conn:
        if req.clear_comfy_api_key:
            conn.execute("DELETE FROM image_ai_secret WHERE name = ?", (COMFY_SECRET_KEY,))
        elif req.comfy_api_key and req.comfy_api_key.strip():
            conn.execute("""INSERT INTO image_ai_secret(name, value) VALUES (?, ?)
                ON CONFLICT(name) DO UPDATE SET value = excluded.value""", (COMFY_SECRET_KEY, req.comfy_api_key.strip()))
    GlobalSetting.save_setting(conn, CREATION_SETTING_KEY,
                               json.dumps({"mode": req.mode, "model": req.model}, ensure_ascii=False))
    return public_creation_config()


def comfy_router_models(key: str) -> dict:
    """Read the live Router catalog; only expose models whose native schema we implement."""
    found: set[str] = set()
    cursor = None
    try:
        for _ in range(10):
            params = {"limit": 100}
            if cursor:
                params["cursor"] = cursor
            response = _comfy_get(COMFY_ROUTER_URL, headers={"X-API-Key": key},
                                    params=params, timeout=(5, 20))
            if response.status_code != 200:
                raise HTTPException(502, detail=f"Comfy Router 模型列表返回 HTTP {response.status_code}")
            page = response.json()
            if not isinstance(page.get("data"), list):
                raise HTTPException(502, detail="Comfy Router 模型列表格式不符合预期")
            found.update(item.get("id") for item in page["data"]
                         if isinstance(item, dict) and isinstance(item.get("id"), str))
            if not page.get("has_more"):
                break
            next_cursor = page.get("next_cursor")
            if not isinstance(next_cursor, str) or not next_cursor or next_cursor == cursor:
                raise HTTPException(502, detail="Comfy Router 模型列表分页格式无效")
            cursor = next_cursor
        else:
            raise HTTPException(502, detail="Comfy Router 模型列表分页过多")
    except requests.exceptions.JSONDecodeError as error:
        raise HTTPException(502, detail="Comfy Router 返回的模型列表不是有效 JSON") from error
    except requests.exceptions.Timeout as error:
        raise HTTPException(504, detail="查询 Comfy Router 模型列表超时；请检查通用设置中的网络代理或后端网络") from error
    except requests.RequestException as error:
        raise HTTPException(502, detail="无法连接 Comfy Router 模型列表") from error
    except (ValueError, TypeError, AttributeError) as error:
        raise HTTPException(502, detail="Comfy Router 模型列表格式不符合预期") from error
    return {
        "vision": [{"id": model, "label": label} for model, label in ROUTER_VISION_MODEL_LABELS.items() if model in found],
        "creation": [{"id": model, "label": label} for model, label in ROUTER_CREATION_MODEL_LABELS.items() if model in found],
    }


def gguf_base_url(value: str) -> str:
    """Only send local images to a loopback OpenAI-compatible vision service."""
    parsed = urlsplit(value.strip())
    if (parsed.scheme != "http" or parsed.hostname not in ("localhost", "127.0.0.1", "::1")
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path.rstrip("/") not in ("", "/v1")):
        raise HTTPException(400, detail="GGUF 服务地址必须是本机 http://127.0.0.1:端口/v1")
    try:
        port = parsed.port
    except ValueError:
        raise HTTPException(400, detail="GGUF 服务端口无效") from None
    if port == 0:
        raise HTTPException(400, detail="GGUF 服务端口无效")
    host = f"[{parsed.hostname}]" if parsed.hostname == "::1" else parsed.hostname
    return f"http://{host}{f':{port}' if port else ''}/v1"


def save_config(req: ImageAIConfigRequest) -> dict:
    if req.provider not in ("local", "local_gguf", "openrouter", "comfy_cloud"):
        raise HTTPException(400, detail="图片内容处理接入方式无效")
    model = req.openrouter_model.strip() or (DEFAULT_MODEL if req.provider != "openrouter" else "")
    if not re.fullmatch(r"[A-Za-z0-9._~:/-]+", model):
        raise HTTPException(400, detail="OpenRouter 模型 ID 无效")
    gguf_url = gguf_base_url(req.gguf_base_url or GGUF_DEFAULT_URL)
    gguf_model = req.gguf_model.strip()
    if gguf_model and not re.fullmatch(r"[A-Za-z0-9._~:/-]+", gguf_model):
        raise HTTPException(400, detail="GGUF 模型 ID 无效")
    if req.comfy_model not in COMFY_MODELS:
        raise HTTPException(400, detail="请选择受支持的 Comfy Cloud 视觉模型")
    if req.comfy_mode not in ("router", "workflow"):
        raise HTTPException(400, detail="Comfy Cloud 模式无效")
    workflow = req.comfy_workflow
    if workflow is not None:
        if ("nodes" in workflow and "links" in workflow) or not workflow or len(workflow) > 256:
            raise HTTPException(400, detail="请导入 ComfyUI 导出的 API 格式工作流 JSON，不支持界面格式")
        if len(json.dumps(workflow, ensure_ascii=False)) > 1_000_000:
            raise HTTPException(400, detail="工作流 JSON 不能超过 1 MB")
        if any(not isinstance(node, dict) or not isinstance(node.get("class_type"), str)
               or not isinstance(node.get("inputs"), dict) for node in workflow.values()):
            raise HTTPException(400, detail="工作流节点需要 class_type 和 inputs")
    if req.comfy_mode == "workflow":
        if not workflow:
            raise HTTPException(400, detail="请先导入 API 格式工作流 JSON")
        for node_id, input_name in ((req.comfy_image_node_id, req.comfy_image_input),
                                    (req.comfy_prompt_node_id, req.comfy_prompt_input)):
            if node_id not in workflow or input_name not in workflow[node_id]["inputs"]:
                raise HTTPException(400, detail="请选择工作流中有效的图片和提示词输入")
        if req.comfy_output_node_id not in workflow:
            raise HTTPException(400, detail="请选择工作流的文本输出节点")
    prompts = {key: value.strip() for key, value in req.prompts.model_dump().items()}
    if any(not value for value in prompts.values()):
        raise HTTPException(400, detail="系统提示词不能为空")
    conn = DataBase.get_conn()
    if req.api_key and req.clear_api_key:
        raise HTTPException(400, detail="不能同时设置和清除 API Key")
    if req.comfy_api_key and req.clear_comfy_api_key:
        raise HTTPException(400, detail="不能同时设置和清除 Comfy API Key")
    with conn:
        if req.clear_api_key:
            conn.execute("DELETE FROM image_ai_secret WHERE name = ?", (SECRET_KEY,))
        elif req.api_key and req.api_key.strip():
            conn.execute("""INSERT INTO image_ai_secret(name, value) VALUES (?, ?)
                ON CONFLICT(name) DO UPDATE SET value = excluded.value""", (SECRET_KEY, req.api_key.strip()))
        if req.clear_comfy_api_key:
            conn.execute("DELETE FROM image_ai_secret WHERE name = ?", (COMFY_SECRET_KEY,))
        elif req.comfy_api_key and req.comfy_api_key.strip():
            conn.execute("""INSERT INTO image_ai_secret(name, value) VALUES (?, ?)
                ON CONFLICT(name) DO UPDATE SET value = excluded.value""", (COMFY_SECRET_KEY, req.comfy_api_key.strip()))
    GlobalSetting.save_setting(conn, SETTING_KEY, json.dumps({
        "provider": req.provider, "openrouter_model": model, "gguf_base_url": gguf_url,
        "gguf_model": gguf_model, "comfy_model": req.comfy_model, "prompts": prompts,
        "comfy_mode": req.comfy_mode, "comfy_workflow": workflow,
        "comfy_workflow_name": req.comfy_workflow_name,
        "comfy_image_node_id": req.comfy_image_node_id, "comfy_image_input": req.comfy_image_input,
        "comfy_prompt_node_id": req.comfy_prompt_node_id, "comfy_prompt_input": req.comfy_prompt_input,
        "comfy_output_node_id": req.comfy_output_node_id,
    }, ensure_ascii=False))
    return public_config()


def _image_jpeg_bytes(path: str) -> bytes:
    with warnings.catch_warnings():
        warnings.simplefilter("error", PilImage.DecompressionBombWarning)
        with PilImage.open(path) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGB")
            image.thumbnail((1024, 1024))
            buffer = io.BytesIO()
            image.save(buffer, format="JPEG", quality=85)
    return buffer.getvalue()


def _image_jpeg_base64(path: str) -> str:
    return base64.b64encode(_image_jpeg_bytes(path)).decode("ascii")


def _image_messages(path: str, prompt: str) -> list[dict]:
    data_url = "data:image/jpeg;base64," + _image_jpeg_base64(path)
    image_part = {"type": "image_url", "image_url": {"url": data_url}}
    return [
        {"role": "system", "content": prompt},
        {"role": "user", "content": [
            {"type": "text", "text": "Follow the instruction for this image."}, image_part,
        ]},
    ]


def _completion_text(response, provider: str) -> str:
    if response.status_code != 200:
        hint = "请检查模型、额度与 API Key" if provider == "OpenRouter" else "请确认已加载视觉模型及 mmproj"
        raise HTTPException(502, detail=f"{provider} 返回 HTTP {response.status_code}；{hint}")
    try:
        content = response.json()["choices"][0]["message"]["content"]
        if isinstance(content, list):
            content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
        if not isinstance(content, str) or not content.strip():
            raise ValueError("empty completion")
        return content.strip()
    except (ValueError, KeyError, IndexError, TypeError) as error:
        raise HTTPException(502, detail=f"{provider} 返回了无法解析的内容") from error


def _openrouter_generate(path: str, prompt: str, model: str, key: str, max_tokens: int) -> str:
    messages = _image_messages(path, prompt)
    try:
        response = requests.post(OPENROUTER_URL, headers={"Authorization": f"Bearer {key}"},
                                 json={"model": model, "messages": messages, "max_tokens": max_tokens},
                                 timeout=(10, 180))
    except requests.RequestException as error:
        raise HTTPException(502, detail="无法连接 OpenRouter，请检查网络和 API 配置") from error
    return _completion_text(response, "OpenRouter")


def _gguf_generate(path: str, prompt: str, base_url: str, model: str, max_tokens: int) -> str:
    url = gguf_base_url(base_url) + "/chat/completions"
    payload = {"messages": _image_messages(path, prompt), "max_tokens": max_tokens}
    if model:
        payload["model"] = model
    try:
        response = requests.post(url, json=payload, timeout=(5, 180))
    except requests.RequestException as error:
        raise HTTPException(503, detail="无法连接本机 GGUF 服务；请启动带视觉投影文件的 llama-server") from error
    return _completion_text(response, "本机 GGUF 服务")


def _comfy_cloud_generate(path: str, prompt: str, model: str, key: str, max_tokens: int) -> str:
    # Comfy Router uses the model's native Gemini request/response format.
    payload = {
        "systemInstruction": {"parts": [{"text": prompt}]},
        "contents": [{"role": "user", "parts": [
            {"text": "Follow the instruction for this image."},
            {"inlineData": {"mimeType": "image/jpeg", "data": _image_jpeg_base64(path)}},
        ]}],
        "generationConfig": {"maxOutputTokens": max(1024, max_tokens), "responseModalities": ["TEXT"]},
    }
    try:
        response = _comfy_post(f"{COMFY_ROUTER_URL}/{model}",
                                 headers={"X-API-Key": key, "Idempotency-Key": str(uuid.uuid4())},
                                 json=payload, timeout=(10, 240))
    except requests.RequestException as error:
        raise HTTPException(502, detail="无法连接 Comfy Router；若请求已提交，请先检查 Comfy 账单记录再重试") from error
    if response.status_code != 200:
        hints = {401: "API Key 无效", 402: "额度不足", 403: "当前账号无权调用该模型",
                 429: "请求过于频繁"}
        raise HTTPException(502, detail=f"Comfy Router 返回 HTTP {response.status_code}：{hints.get(response.status_code, '请检查模型与网络')}")
    try:
        parts = response.json()["candidates"][0]["content"]["parts"]
        result = "".join(part.get("text", "") for part in parts
                         if isinstance(part, dict) and not part.get("thought"))
        if not result.strip():
            raise ValueError("empty completion")
        return result.strip()
    except (ValueError, KeyError, IndexError, TypeError) as error:
        raise HTTPException(502, detail="Comfy Router 未返回可用文本；请检查模型响应或内容限制") from error


def _comfy_cloud_response(response, action: str):
    if response.status_code != 200:
        hints = {400: "工作流或节点无效", 401: "API Key 无效", 402: "额度不足",
                 403: "账号无权使用此节点或模型", 404: "任务或资源不存在", 429: "请求过于频繁"}
        raise HTTPException(502, detail=f"Comfy Cloud {action}失败（HTTP {response.status_code}）：{hints.get(response.status_code, '请检查工作流与网络')}")
    try:
        return response.json()
    except ValueError as error:
        raise HTTPException(502, detail=f"Comfy Cloud {action}返回内容无效") from error


def _comfy_output_text(output: dict) -> str:
    for key in ("text", "texts"):
        value = output.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, list):
            parts = [item if isinstance(item, str) else item.get("text", "")
                     for item in value if isinstance(item, (str, dict))]
            result = "\n".join(part for part in parts if isinstance(part, str) and part.strip())
            if result.strip():
                return result.strip()
    return ""


def _comfy_cloud_download_text(file_info: dict, key: str) -> str:
    filename = file_info.get("filename", "")
    if not isinstance(filename, str) or not filename.lower().endswith((".txt", ".md", ".json", ".csv")):
        raise HTTPException(502, detail="工作流输出不是文本文件；请选择文本输出节点")
    try:
        response = _comfy_get(f"{COMFY_CLOUD_API_URL}/view", headers={"X-API-Key": key},
                                params={"filename": filename, "subfolder": file_info.get("subfolder", ""),
                                        "type": file_info.get("type", "output")},
                                timeout=(10, 20), allow_redirects=False, stream=True)
        if response.status_code in (301, 302, 303, 307, 308):
            location = response.headers.get("Location", "")
            parsed = urlsplit(location)
            try:
                address = ipaddress.ip_address(parsed.hostname or "")
            except ValueError:
                address = None
            if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
                    or parsed.hostname.lower() == "localhost"
                    or parsed.hostname.lower().endswith((".localhost", ".local"))
                    or (address is not None and not address.is_global)):
                raise HTTPException(502, detail="Comfy Cloud 文件下载地址无效")
            response.close()
            response = _comfy_get(location, timeout=(10, 30), stream=True, allow_redirects=False)
        if response.status_code != 200:
            raise HTTPException(502, detail=f"Comfy Cloud 文本下载失败（HTTP {response.status_code}）")
        chunks = []
        size = 0
        for chunk in response.iter_content(8192):
            size += len(chunk)
            if size > 262_144:
                raise HTTPException(502, detail="Comfy Cloud 文本输出超过 256 KB")
            chunks.append(chunk)
        return b"".join(chunks).decode("utf-8-sig").strip()
    except requests.RequestException as error:
        raise HTTPException(502, detail="无法下载 Comfy Cloud 文本输出") from error
    except UnicodeError as error:
        raise HTTPException(502, detail="Comfy Cloud 文本输出不是 UTF-8") from error
    finally:
        if "response" in locals():
            response.close()


def _comfy_cloud_workflow_generate(path: str, prompt: str, config: dict, key: str) -> str:
    graph = json.loads(json.dumps(config["comfy_workflow"]))
    graph[config["comfy_image_node_id"]]["inputs"][config["comfy_image_input"]] = ""
    graph[config["comfy_prompt_node_id"]]["inputs"][config["comfy_prompt_input"]] = prompt
    headers = {"X-API-Key": key}
    try:
        uploaded = _comfy_post(f"{COMFY_CLOUD_API_URL}/upload/image", headers=headers,
                                 files={"image": ("reference.jpg", _image_jpeg_bytes(path), "image/jpeg")},
                                 data={"type": "input"}, timeout=(10, 60))
        image_name = _comfy_cloud_response(uploaded, "图片上传").get("name")
        if not isinstance(image_name, str) or not image_name:
            raise HTTPException(502, detail="Comfy Cloud 未返回图片文件名")
        graph[config["comfy_image_node_id"]]["inputs"][config["comfy_image_input"]] = image_name
        submitted = _comfy_post(f"{COMFY_CLOUD_API_URL}/prompt", headers=headers,
                                  json={"prompt": graph}, timeout=(10, 60))
        job_id = _comfy_cloud_response(submitted, "工作流提交").get("prompt_id")
        if not isinstance(job_id, str) or not re.fullmatch(r"[a-fA-F0-9-]{36}", job_id):
            raise HTTPException(502, detail="Comfy Cloud 未返回有效的任务编号")
        deadline = time.monotonic() + 240
        while time.monotonic() < deadline:
            job = _comfy_cloud_response(_comfy_get(f"{COMFY_CLOUD_API_URL}/jobs/{job_id}",
                                                      headers=headers, timeout=(10, 20)), "任务查询")
            status = job.get("status")
            if status == "completed":
                outputs = job.get("outputs") or {}
                output = outputs.get(config["comfy_output_node_id"], {})
                if not isinstance(output, dict):
                    break
                result = _comfy_output_text(output)
                if result:
                    return result
                files = output.get("files") or []
                if isinstance(files, list):
                    for file_info in files:
                        if isinstance(file_info, dict) and str(file_info.get("filename", "")).lower().endswith((".txt", ".md", ".json", ".csv")):
                            result = _comfy_cloud_download_text(file_info, key)
                            if result:
                                return result
                break
            if status in ("failed", "error", "cancelled"):
                raise HTTPException(502, detail="Comfy Cloud 工作流执行失败；请在 Comfy Cloud 查看任务详情")
            time.sleep(2)
    except requests.RequestException as error:
        raise HTTPException(502, detail="无法连接 Comfy Cloud；若任务已提交，请先检查云端任务再重试") from error
    if time.monotonic() >= deadline:
        raise HTTPException(504, detail="Comfy Cloud 工作流等待超时；任务可能仍在云端运行")
    raise HTTPException(502, detail="工作流没有返回可读文本；请指定输出文本或文本文件的节点")


def _comfy_cloud_download_image(file_info: dict, key: str) -> tuple[bytes, str]:
    filename = file_info.get("filename", "")
    if not isinstance(filename, str) or not filename.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
        raise HTTPException(502, detail="指定的工作流输出节点没有图片文件")
    response = None
    try:
        response = _comfy_get(f"{COMFY_CLOUD_API_URL}/view", headers={"X-API-Key": key},
                                params={"filename": filename, "subfolder": file_info.get("subfolder", ""),
                                        "type": file_info.get("type", "output")},
                                timeout=(10, 20), allow_redirects=False, stream=True)
        if response.status_code in (301, 302, 303, 307, 308):
            location = response.headers.get("Location", "")
            parsed = urlsplit(location)
            try:
                address = ipaddress.ip_address(parsed.hostname or "")
            except ValueError:
                address = None
            if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
                    or parsed.hostname.lower() == "localhost"
                    or parsed.hostname.lower().endswith((".localhost", ".local"))
                    or (address is not None and not address.is_global)):
                raise HTTPException(502, detail="Comfy Cloud 图片下载地址无效")
            response.close()
            response = _comfy_get(location, timeout=(10, 60), stream=True, allow_redirects=False)
        if response.status_code != 200:
            raise HTTPException(502, detail=f"Comfy Cloud 图片下载失败（HTTP {response.status_code}）")
        chunks, size = [], 0
        for chunk in response.iter_content(65536):
            size += len(chunk)
            if size > 24_000_000:
                raise HTTPException(502, detail="Comfy Cloud 输出图片超过 24 MB")
            chunks.append(chunk)
        data = b"".join(chunks)
        with PilImage.open(io.BytesIO(data)) as image:
            if image.format not in ("PNG", "JPEG", "WEBP"):
                raise HTTPException(502, detail="Comfy Cloud 输出不是支持的图片格式")
            mime = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}[image.format]
            image.verify()
        return data, mime
    except requests.RequestException as error:
        raise HTTPException(502, detail="无法下载 Comfy Cloud 输出图片") from error
    except (OSError, UnidentifiedImageError) as error:
        raise HTTPException(502, detail="Comfy Cloud 输出图片无效") from error
    finally:
        if response is not None:
            response.close()


def _comfy_cloud_studio_edit(req: StudioEditRequest, key: str) -> dict:
    graph = _validate_studio_workflow(req)
    image_bytes, image_size = _studio_png(req.image_base64, "合成图")
    mask_bytes = None
    if req.mask_base64:
        mask_bytes, mask_size = _studio_png(req.mask_base64, "遮罩")
        if mask_size != image_size:
            raise HTTPException(400, detail="遮罩尺寸必须与合成图一致")
    mask_from_image = _workflow_mask_from_main_image(graph, req.image_node_id)
    if mask_from_image and mask_bytes:
        image_bytes = _studio_image_with_alpha_mask(image_bytes, mask_bytes)
    references = [_studio_png(reference.image_base64, f"参考图 {index}")[0]
                  for index, reference in enumerate(req.reference_images, 1)]
    headers = {"X-API-Key": key}
    try:
        uploaded = _comfy_post(f"{COMFY_CLOUD_API_URL}/upload/image", headers=headers,
                                 files={"image": ("studio-source.png", image_bytes, "image/png")},
                                 data={"type": "input"}, timeout=(10, 60))
        image_name = _comfy_cloud_response(uploaded, "图片上传").get("name")
        if not isinstance(image_name, str) or not image_name:
            raise HTTPException(502, detail="Comfy Cloud 未返回图片文件名")
        graph[req.image_node_id]["inputs"][req.image_input] = image_name
        if req.prompt_node_id:
            graph[req.prompt_node_id]["inputs"][req.prompt_input] = req.prompt.strip()
        if req.negative_prompt_node_id:
            graph[req.negative_prompt_node_id]["inputs"][req.negative_prompt_input] = req.negative_prompt.strip()
        if req.mask_node_id and mask_bytes:
            mask_upload_bytes = (_studio_image_with_alpha_mask(mask_bytes, mask_bytes)
                                 if graph[req.mask_node_id]["inputs"]["channel"] == "alpha" else mask_bytes)
            mask_upload = _comfy_post(f"{COMFY_CLOUD_API_URL}/upload/image", headers=headers,
                                        files={"image": ("studio-mask.png", mask_upload_bytes, "image/png")},
                                        data={"type": "input"}, timeout=(10, 60))
            mask_name = _comfy_cloud_response(mask_upload, "遮罩上传").get("name")
            if not isinstance(mask_name, str) or not mask_name:
                raise HTTPException(502, detail="Comfy Cloud 未返回遮罩文件名")
            graph[req.mask_node_id]["inputs"][req.mask_input] = mask_name
        for index, (reference, data) in enumerate(zip(req.reference_images, references), 1):
            uploaded_reference = _comfy_post(f"{COMFY_CLOUD_API_URL}/upload/image", headers=headers,
                                               files={"image": (f"studio-reference-{index}.png", data, "image/png")},
                                               data={"type": "input"}, timeout=(10, 60))
            reference_name = _comfy_cloud_response(uploaded_reference, f"参考图 {index} 上传").get("name")
            if not isinstance(reference_name, str) or not reference_name:
                raise HTTPException(502, detail=f"Comfy Cloud 未返回参考图 {index} 的文件名")
            graph[reference.node_id]["inputs"][reference.input] = reference_name
        submitted = _comfy_post(f"{COMFY_CLOUD_API_URL}/prompt", headers=headers,
                                  json={"prompt": graph, "extra_data": {"api_key_comfy_org": key}},
                                  timeout=(10, 60))
        job_id = _comfy_cloud_response(submitted, "工作流提交").get("prompt_id")
        if not isinstance(job_id, str) or not re.fullmatch(r"[a-fA-F0-9-]{36}", job_id):
            raise HTTPException(502, detail="Comfy Cloud 未返回有效的任务编号")
        deadline = time.monotonic() + 240
        while time.monotonic() < deadline:
            job = _comfy_cloud_response(_comfy_get(f"{COMFY_CLOUD_API_URL}/jobs/{job_id}",
                                                      headers=headers, timeout=(10, 20)), "任务查询")
            status = job.get("status")
            if status in ("completed", "success"):
                outputs = job.get("outputs") or {}
                output = outputs.get(req.output_node_id, {}) if isinstance(outputs, dict) else {}
                if not isinstance(output, dict):
                    break
                files = output.get("images") or output.get("files") or []
                if isinstance(files, list):
                    for file_info in files:
                        if isinstance(file_info, dict) and str(file_info.get("filename", "")).lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                            data, mime = _comfy_cloud_download_image(file_info, key)
                            return {"image_base64": base64.b64encode(data).decode("ascii"),
                                    "media_type": mime, "job_id": job_id}
                break
            if status in ("failed", "error", "non_retryable_error", "lost", "cancelled"):
                raise HTTPException(502, detail="Comfy Cloud 工作流执行失败；请在云端查看任务详情")
            time.sleep(2)
    except requests.RequestException as error:
        raise HTTPException(502, detail="无法连接 Comfy Cloud；若任务已提交，请先检查云端任务再重试") from error
    if time.monotonic() >= deadline:
        raise HTTPException(504, detail="Comfy Cloud 工作流等待超时；任务可能仍在云端运行")
    raise HTTPException(502, detail="指定输出节点没有返回图片；请检查工作流映射")


def _comfy_router_studio_edit(req: StudioRouterEditRequest, model: str, key: str) -> dict:
    image_bytes, _ = _studio_png(req.image_base64, "合成图")
    references = [_studio_png(value, f"参考图 {index}")[0]
                  for index, value in enumerate(req.reference_images_base64, 1)]
    image_config = {}
    if req.aspect_ratio:
        image_config["aspectRatio"] = req.aspect_ratio
    if req.image_size:
        image_config["imageSize"] = req.image_size
    parts = [
        {"text": req.prompt.strip() + ("\n第一张图片是待编辑主图；后续图片仅作参考。" if references else "")},
        {"inlineData": {"mimeType": "image/png", "data": base64.b64encode(image_bytes).decode("ascii")}},
    ]
    for index, data in enumerate(references, 1):
        parts.extend(({"text": f"参考图 {index}"},
                      {"inlineData": {"mimeType": "image/png", "data": base64.b64encode(data).decode("ascii")}}))
    payload = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {"responseModalities": ["IMAGE"],
                             **({"imageConfig": image_config} if image_config else {})},
    }
    try:
        response = _comfy_post(f"{COMFY_ROUTER_URL}/{model}",
                                 headers={"X-API-Key": key, "Idempotency-Key": str(uuid.uuid4())},
                                 json=payload, timeout=(10, 600))
    except requests.RequestException as error:
        raise HTTPException(502, detail="无法连接 Comfy Router；若任务已提交，请先检查云端任务再重试") from error
    if response.status_code != 200:
        hints = {401: "API Key 无效", 402: "额度不足", 403: "当前账号无权调用该模型",
                 413: "输入图片过大", 422: "模型不接受当前输入", 429: "请求过于频繁"}
        raise HTTPException(502, detail=f"Comfy Router 返回 HTTP {response.status_code}：{hints.get(response.status_code, '请检查模型与网络')}")
    try:
        parts = response.json()["candidates"][0]["content"]["parts"]
        for part in parts:
            inline = part.get("inlineData") if isinstance(part, dict) else None
            if not isinstance(inline, dict) or not inline.get("data"):
                continue
            data = base64.b64decode(inline["data"], validate=True)
            if len(data) > 64_000_000:
                raise HTTPException(502, detail="Comfy Router 输出图片超过 64 MB")
            with PilImage.open(io.BytesIO(data)) as image:
                if image.format not in ("PNG", "JPEG", "WEBP"):
                    raise ValueError("unsupported format")
                mime = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}[image.format]
                image.verify()
            return {"image_base64": base64.b64encode(data).decode("ascii"), "media_type": mime,
                    "job_id": response.headers.get("X-Comfy-Request-Id", "")}
    except (ValueError, KeyError, IndexError, TypeError, OSError, UnidentifiedImageError) as error:
        raise HTTPException(502, detail="Comfy Router 返回了无法解析的图片") from error
    raise HTTPException(502, detail="Comfy Router 没有返回图片；请检查模型与提示词")


def mount_image_ai_routes(app: FastAPI, db_api_base: str, verify_secret,
                          write_permission_required, is_path_trusted):
    @app.get(db_api_base + "/image-ai/config", dependencies=[Depends(verify_secret)])
    def get_config():
        return public_config()

    @app.put(db_api_base + "/image-ai/config", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def put_config(req: ImageAIConfigRequest):
        return save_config(req)

    @app.get(db_api_base + "/image-ai/creation/config", dependencies=[Depends(verify_secret)])
    def get_creation_config():
        return public_creation_config()

    @app.put(db_api_base + "/image-ai/creation/config", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def put_creation_config(req: CreationConfigRequest):
        return save_creation_config(req)

    @app.get(db_api_base + "/image-ai/studio/workflows", dependencies=[Depends(verify_secret)])
    def list_studio_workflows():
        return [_workflow_summary(item) for item in _studio_workflows()]

    @app.get(db_api_base + "/image-ai/studio/workflows/{workflow_id}", dependencies=[Depends(verify_secret)])
    def get_studio_workflow(workflow_id: str):
        item = next((item for item in _studio_workflows() if item["id"] == workflow_id), None)
        if not item:
            raise HTTPException(404, detail="工作流不存在")
        return item

    @app.post(db_api_base + "/image-ai/studio/workflows", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def create_studio_workflow(req: StudioWorkflowPresetRequest):
        _validate_workflow_preset(req)
        items = _studio_workflows()
        if len(items) >= 30:
            raise HTTPException(400, detail="最多保存 30 个工作流")
        now = time.time()
        item = {"id": str(uuid.uuid4()), **req.model_dump(), "name": req.name.strip(),
                "created_at": now, "updated_at": now}
        items.append(item)
        GlobalSetting.save_setting(DataBase.get_conn(), STUDIO_WORKFLOWS_KEY, json.dumps(items, ensure_ascii=False))
        return item

    @app.put(db_api_base + "/image-ai/studio/workflows/{workflow_id}", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def update_studio_workflow(workflow_id: str, req: StudioWorkflowPresetRequest):
        _validate_workflow_preset(req)
        items = _studio_workflows()
        index = next((index for index, item in enumerate(items) if item["id"] == workflow_id), None)
        if index is None:
            raise HTTPException(404, detail="工作流不存在")
        items[index] = {**items[index], **req.model_dump(), "name": req.name.strip(), "updated_at": time.time()}
        GlobalSetting.save_setting(DataBase.get_conn(), STUDIO_WORKFLOWS_KEY, json.dumps(items, ensure_ascii=False))
        return items[index]

    @app.delete(db_api_base + "/image-ai/studio/workflows/{workflow_id}", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def delete_studio_workflow(workflow_id: str):
        items = _studio_workflows()
        remaining = [item for item in items if item["id"] != workflow_id]
        if len(remaining) == len(items):
            raise HTTPException(404, detail="工作流不存在")
        GlobalSetting.save_setting(DataBase.get_conn(), STUDIO_WORKFLOWS_KEY, json.dumps(remaining, ensure_ascii=False))
        return {"deleted": workflow_id}

    @app.post(db_api_base + "/image-ai/studio/workflow-edit", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def studio_workflow_edit(req: StudioPresetEditRequest):
        key, _ = comfy_cloud_key()
        if not key:
            raise HTTPException(503, detail="请先在 AI 接入中配置 Comfy API Key")
        preset = next((item for item in _studio_workflows() if item["id"] == req.workflow_id), None)
        if not preset:
            raise HTTPException(404, detail="工作流不存在或已删除")
        if preset.get("purpose", "image_edit") != "image_edit":
            raise HTTPException(400, detail="请选择图片编辑工作流")
        if not preset.get("output_node_id"):
            raise HTTPException(400, detail="运行前请在工作流管理中设置图片结果节点")
        slots = preset["reference_slots"]
        if len(req.reference_images_base64) > len(slots):
            raise HTTPException(400, detail=f"当前工作流最多接收 {len(slots)} 张参考图")
        mask_from_image = _workflow_mask_from_main_image(preset["workflow"], preset["image_node_id"])
        if req.mask_base64 and not (preset.get("mask_enabled", True) and (preset["mask_node_id"] or mask_from_image)):
            raise HTTPException(400, detail="当前工作流没有遮罩输入位")
        graph = _studio_graph_for_run(preset, bool(req.mask_base64), len(req.reference_images_base64))
        _apply_workflow_parameters(graph, preset, req.parameter_values)
        mapped = StudioEditRequest(
            image_base64=req.image_base64, mask_base64=req.mask_base64, prompt=req.prompt,
            negative_prompt=req.negative_prompt,
            workflow=graph, image_node_id=preset["image_node_id"], image_input=preset["image_input"],
            mask_node_id=preset["mask_node_id"] if req.mask_base64 else "",
            mask_input=preset["mask_input"] if req.mask_base64 else "",
            prompt_node_id=preset["prompt_node_id"], prompt_input=preset["prompt_input"],
            negative_prompt_node_id=preset.get("negative_prompt_node_id", ""),
            negative_prompt_input=preset.get("negative_prompt_input", ""),
            output_node_id=preset["output_node_id"],
            reference_images=[StudioReferenceImage(image_base64=image, node_id=slots[index]["node_id"],
                                                    input=slots[index]["input"])
                              for index, image in enumerate(req.reference_images_base64)],
        )
        return _comfy_cloud_studio_edit(mapped, key)

    @app.get(db_api_base + "/image-ai/gguf/status", dependencies=[Depends(verify_secret)])
    def gguf_status():
        url = gguf_base_url(load_config()["gguf_base_url"]) + "/models"
        try:
            response = requests.get(url, timeout=(3, 5))
            response.raise_for_status()
            models = [item.get("id", "") for item in response.json().get("data", []) if isinstance(item, dict)]
            return {"ready": True, "models": models}
        except (requests.RequestException, ValueError, TypeError, AttributeError):
            return {"ready": False, "models": []}

    @app.get(db_api_base + "/image-ai/comfy/status", dependencies=[Depends(verify_secret)])
    def comfy_status():
        key, _ = comfy_cloud_key()
        if not key:
            return {"ready": False, "detail": "请先保存 Comfy API Key"}
        try:
            response = _comfy_get(COMFY_CLOUD_USER_URL, headers={"X-API-Key": key}, timeout=(5, 10))
        except requests.RequestException:
            return {"ready": False, "detail": "无法连接 Comfy Cloud"}
        if response.status_code != 200:
            return {"ready": False, "detail": f"Comfy Cloud 返回 HTTP {response.status_code}"}
        return {"ready": True, "detail": "API Key 有效；模型额度将在实际调用时检查"}

    @app.get(db_api_base + "/image-ai/comfy/models", dependencies=[Depends(verify_secret)])
    def get_comfy_models():
        key, _ = comfy_cloud_key()
        if not key:
            raise HTTPException(503, detail="请先保存 Comfy API Key")
        return comfy_router_models(key)

    @app.post(db_api_base + "/image-ai/studio-edit", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def studio_edit(req: StudioEditRequest):
        key, _ = comfy_cloud_key()
        if not key:
            raise HTTPException(503, detail="请先在 AI 接入中配置 Comfy API Key")
        return _comfy_cloud_studio_edit(req, key)

    @app.post(db_api_base + "/image-ai/studio-router-edit", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def studio_router_edit(req: StudioRouterEditRequest):
        key, _ = comfy_cloud_key()
        if not key:
            raise HTTPException(503, detail="请先在 AI 接入中配置 Comfy API Key")
        if req.model not in CREATION_MODELS:
            raise HTTPException(400, detail="请选择支持的 Comfy Router 图像模型")
        allowed_ratios = ROUTER_IMAGE_RATIOS | (ROUTER_FLASH_EXTRA_RATIOS if req.model == "vertexai/gemini-3.1-flash-image" else set())
        if req.aspect_ratio is not None and req.aspect_ratio not in allowed_ratios:
            raise HTTPException(400, detail="该模型不支持所选输出比例")
        if req.image_size is not None and (req.model not in ROUTER_RESIZABLE_MODELS or req.image_size not in ("1K", "2K", "4K")):
            raise HTTPException(400, detail="该模型不支持所选输出分辨率")
        if req.model == "vertexai/gemini-2.5-flash-image" and len(req.reference_images_base64) > 2:
            raise HTTPException(400, detail="Gemini 2.5 Flash Image 最多使用 2 张参考图")
        return _comfy_router_studio_edit(req, req.model, key)

    @app.post(db_api_base + "/image-ai/generate", dependencies=[Depends(verify_secret)])
    def generate(req: GenerateRequest):
        path = os.path.realpath(req.path)
        if not is_path_trusted(path) or not is_image_file(path):
            raise HTTPException(403, detail="无权访问该图片")
        if not os.path.isfile(path):
            raise HTTPException(404, detail="图片不存在")
        if req.task == "tags" and not req.allowed_tags:
            return {"task": req.task, "text": "", "tags": []}
        config = load_config()
        template = req.prompt_template if req.task == "prompt" and req.prompt_template else config["prompts"][req.task]
        prompt = prompt_for(req.task, req.max_chars, req.allowed_tags, template)
        try:
            if config["provider"] == "local":
                state, detail = readiness()
                if state != "ready":
                    raise HTTPException(503, detail=detail)
                raw = _runtime.generate(path, prompt, 384 if req.task == "prompt" else 256, system=True)
            elif config["provider"] == "local_gguf":
                raw = _gguf_generate(path, prompt, config["gguf_base_url"], config["gguf_model"],
                                     384 if req.task == "prompt" else 256)
            elif config["provider"] == "comfy_cloud":
                key, _ = comfy_cloud_key()
                if not key:
                    raise HTTPException(503, detail="请先在 AI 接入中配置 Comfy API Key")
                raw = (_comfy_cloud_workflow_generate(path, prompt, config, key)
                       if config["comfy_mode"] == "workflow" else
                       _comfy_cloud_generate(path, prompt, config["comfy_model"], key,
                                             384 if req.task == "prompt" else 256))
            else:
                key, _ = openrouter_key()
                if not key:
                    raise HTTPException(503, detail="请先在 AI 接入中配置 OpenRouter API Key")
                raw = _openrouter_generate(path, prompt, config["openrouter_model"], key,
                                           384 if req.task == "prompt" else 256)
        except HTTPException:
            raise
        except (OSError, ValueError, UnidentifiedImageError, PilImage.DecompressionBombError, PilImage.DecompressionBombWarning):
            raise HTTPException(400, detail="无法读取参考图片") from None
        except Exception as error:
            raise HTTPException(503, detail=f"图片内容处理失败：{error}") from error
        if req.task == "tags":
            return {"task": req.task, "text": raw, "tags": parse_tags(raw, req.allowed_tags)}
        return {"task": req.task, "text": raw.strip().strip('"').strip()[:req.max_chars], "tags": []}
