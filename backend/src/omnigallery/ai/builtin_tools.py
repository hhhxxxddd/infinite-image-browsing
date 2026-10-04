"""Versioned system tools. User defaults are separate from the immutable graphs."""

from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from omnigallery.ai.erase_workflow import erase_workflow
from omnigallery.ai.image_configuration import comfy_cloud_key
from omnigallery.infrastructure.database import Database
from omnigallery.storage.settings_repository import SettingsRepository

CUTOUT_ID = "image-cutout-sam3"
CUTOUT_VERSION = 1
UPSCALE_ID = "image-upscale"
UPSCALE_VERSION = 2
ERASE_ID = "image-erase"
ERASE_VERSION = 1
ERASE_PROMPT = "移除涂抹区域内的物体，根据周围环境自然补全，保持画面风格和光照一致。"
DEFAULTS_KEY = "builtin_tool_defaults:"
CUTOUT_NODES = ["8", "118:116", "118:115", "18", "20"]


class CutoutDefaults(BaseModel):
    model_config = ConfigDict(extra="forbid")
    refine_iterations: int = Field(default=3, ge=0, le=5, strict=True)
    trim_transparent: bool = Field(default=False, strict=True)


class UpscaleDefaults(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target_resolution: Literal["original", "2K", "4K", "8K"] = "4K"


class EraseDefaults(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prompt: str = Field(default=ERASE_PROMPT, min_length=1, max_length=4000)
    blend_pixels: int = Field(default=16, ge=0, le=256, strict=True)
    output_width: int = Field(default=512, ge=64, le=4096, strict=True)
    output_height: int = Field(default=512, ge=64, le=4096, strict=True)

    @field_validator("prompt")
    @classmethod
    def nonempty_prompt(cls, value):
        if not value.strip():
            raise ValueError("请填写消除提示词")
        return value.strip()

    @field_validator("output_width", "output_height")
    @classmethod
    def aligned_size(cls, value):
        if value % 32:
            raise ValueError("处理宽高需要为 32 的倍数")
        return value


def erase_defaults() -> dict:
    value = SettingsRepository.get_setting(Database.get_connection(), DEFAULTS_KEY + ERASE_ID)
    return EraseDefaults.model_validate(value or {}).model_dump()


def upscale_defaults() -> dict:
    value = SettingsRepository.get_setting(Database.get_connection(), DEFAULTS_KEY + UPSCALE_ID)
    if value and "multiplier" in value:
        value = {"target_resolution": "original" if value["multiplier"] == 1 else "4K"}
    return UpscaleDefaults.model_validate(value or {}).model_dump()


def upscale_workflow() -> dict:
    """SeedVR2 v2: the supplied API graph; even 1× traverses the sampler."""
    return {
        "1": {"class_type": "LoadImage", "inputs": {"image": ""}},
        "2": {
            "class_type": "SaveImage",
            "inputs": {"filename_prefix": "seedvr2_after/image", "images": ["4:14", 0]},
        },
        "4:6": {
            "class_type": "VAEEncodeTiled",
            "inputs": {
                "tile_size": 512,
                "overlap": 128,
                "temporal_size": 4096,
                "temporal_overlap": 8,
                "pixels": ["4:13", 0],
                "vae": ["4:8", 0],
            },
        },
        "4:7": {
            "class_type": "JoinImageWithAlpha",
            "inputs": {"image": ["1", 0], "alpha": ["1", 1]},
        },
        "4:8": {
            "class_type": "VAELoader",
            "inputs": {"vae_name": "seedvr2_ema_vae_fp16.safetensors"},
        },
        "4:9": {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": "seedvr2_7b_int8_convrot.safetensors",
                "weight_dtype": "default",
            },
        },
        "4:10": {
            "class_type": "KSampler",
            "inputs": {
                "seed": 959948902156062,
                "steps": 1,
                "cfg": 1,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": 1,
                "model": ["4:9", 0],
                "positive": ["4:15", 0],
                "negative": ["4:15", 1],
                "latent_image": ["4:6", 0],
            },
        },
        "4:11": {
            "class_type": "VAEDecodeTiled",
            "inputs": {
                "tile_size": 512,
                "overlap": 128,
                "temporal_size": 4096,
                "temporal_overlap": 8,
                "samples": ["4:10", 0],
                "vae": ["4:8", 0],
            },
        },
        "4:12": {
            "class_type": "ResizeImageMaskNode",
            "inputs": {
                "resize_type": "scale shorter dimension",
                "resize_type.shorter_size": 4096,
                "scale_method": "lanczos",
                "input": ["4:7", 0],
            },
        },
        "4:13": {"class_type": "SeedVR2Preprocess", "inputs": {"resized_images": ["4:12", 0]}},
        "4:14": {
            "class_type": "SeedVR2PostProcessing",
            "inputs": {
                "color_correction_method": "none",
                "images": ["4:11", 0],
                "original_resized_images": ["4:12", 0],
            },
        },
        "4:15": {
            "class_type": "SeedVR2Conditioning",
            "inputs": {"model": ["4:9", 0], "vae_conditioning": ["4:6", 0]},
        },
    }


def cutout_defaults() -> dict:
    value = SettingsRepository.get_setting(Database.get_connection(), DEFAULTS_KEY + CUTOUT_ID)
    return CutoutDefaults.model_validate(value or {}).model_dump()


def cutout_workflow() -> dict:
    # Return a fresh graph for every job/copy; point/box input never uses text conditioning.
    return {
        "8": {"class_type": "LoadImage", "inputs": {"image": ""}},
        "118:116": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": "sam3.1_multiplex_fp16.safetensors"},
        },
        "118:115": {
            "class_type": "SAM3_Detect",
            "inputs": {
                "model": ["118:116", 0],
                "image": ["8", 0],
                "threshold": 0.55,
                "individual_masks": False,
                "refine_iterations": 3,
                "positive_coords": "[]",
                "negative_coords": "[]",
            },
        },
        "18": {"class_type": "MaskToImage", "inputs": {"mask": ["118:115", 0]}},
        "20": {
            "class_type": "SaveImage",
            "inputs": {"images": ["18", 0], "filename_prefix": "mask"},
        },
    }


def catalog() -> list[dict]:
    return [
        {
            "id": CUTOUT_ID,
            "name": "抠图",
            "engine": "SAM3",
            "version": CUTOUT_VERSION,
            "status": "available",
            "connection_configured": bool(comfy_cloud_key()[0]),
            "defaults": cutout_defaults(),
            "factory_defaults": CutoutDefaults().model_dump(),
        },
        {
            "id": ERASE_ID,
            "name": "消除",
            "engine": "Qwen2.1",
            "version": ERASE_VERSION,
            "status": "available",
            "connection_configured": bool(comfy_cloud_key()[0]),
            "defaults": erase_defaults(),
            "factory_defaults": EraseDefaults().model_dump(),
        },
        {
            "id": UPSCALE_ID,
            "name": "高清化",
            "engine": "SeedVR2",
            "version": UPSCALE_VERSION,
            "status": "available",
            "connection_configured": bool(comfy_cloud_key()[0]),
            "defaults": upscale_defaults(),
            "factory_defaults": UpscaleDefaults().model_dump(),
        },
    ]


def require_tool(tool_id: str):
    if tool_id not in (CUTOUT_ID, UPSCALE_ID, ERASE_ID):
        raise HTTPException(404, "工具不存在或暂未开放")


def save_defaults(tool_id: str, payload: dict) -> dict:
    require_tool(tool_id)
    model = {CUTOUT_ID: CutoutDefaults, UPSCALE_ID: UpscaleDefaults, ERASE_ID: EraseDefaults}[
        tool_id
    ]
    try:
        request = model.model_validate(payload)
    except ValidationError as error:
        raise HTTPException(422, error.errors(include_context=False)) from error
    SettingsRepository.save_setting(
        Database.get_connection(), DEFAULTS_KEY + tool_id, request.model_dump_json()
    )
    return request.model_dump()


def workflow_copy(tool_id: str) -> dict:
    require_tool(tool_id)
    if tool_id == ERASE_ID:
        # Custom editor has a single paint-mask input; use automatic context there.
        graph = erase_workflow()
        graph.pop("17")
        graph["8"]["inputs"].pop("optional_context_mask")
        graph["8"]["inputs"]["context_from_mask_extend_factor"] = 1.2
        return {
            "name": "Qwen2.1 消除（自定义副本）",
            "purpose": "image_edit",
            "workflow": graph,
            "image_node_id": "1",
            "image_input": "image",
            "output_node_id": "2",
            "output_mappings": [{"node_id": "2", "label": "消除后的图片"}],
            "mask_node_id": "16",
            "mask_input": "image",
            "mask_enabled": True,
            "prompt_node_id": "3",
            "prompt_input": "value",
            "negative_prompt_node_id": "",
            "negative_prompt_input": "",
            "reference_slots": [],
            "parameters": [],
        }
    upscale = tool_id == UPSCALE_ID
    return {
        "name": "SeedVR2 高清化（自定义副本）" if upscale else "SAM3 抠图（自定义副本）",
        "purpose": "image_edit",
        "workflow": upscale_workflow() if upscale else cutout_workflow(),
        "image_node_id": "1" if upscale else "8",
        "image_input": "image",
        "output_node_id": "2" if upscale else "20",
        "output_mappings": [{"node_id": "2", "label": "高清图片"}]
        if upscale
        else [{"node_id": "20", "label": "主体遮罩"}],
        "mask_node_id": "",
        "mask_input": "",
        "mask_enabled": False,
        "prompt_node_id": "",
        "prompt_input": "",
        "negative_prompt_node_id": "",
        "negative_prompt_input": "",
        "reference_slots": [],
        "parameters": [],
    }


def studio_unavailable_reason(preset: dict) -> str:
    """Legacy SAM mask presets stay editable but cannot run in the general image editor."""
    graph = preset.get("workflow", {})
    outputs = preset.get("output_mappings") or [{"node_id": preset.get("output_node_id", "")}]
    for output in outputs:
        link = graph.get(output["node_id"], {}).get("inputs", {}).get("images")
        if not isinstance(link, list) or len(link) != 2:
            continue
        mask = graph.get(str(link[0]), {})
        source = mask.get("inputs", {}).get("mask")
        if (
            mask.get("class_type") == "MaskToImage"
            and isinstance(source, list)
            and len(source) == 2
            and graph.get(str(source[0]), {}).get("class_type") == "SAM3_Detect"
        ):
            return "此流程输出 SAM3 主体遮罩，请在图片编辑器的 AI 工具中使用抠图。"
    return ""
