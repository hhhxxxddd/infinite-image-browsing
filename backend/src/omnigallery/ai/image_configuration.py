from __future__ import annotations

import json
import os
import re
import threading

from fastapi import HTTPException

from omnigallery.ai import image_defaults, image_schemas
from omnigallery.infrastructure.database import Database
from omnigallery.storage.settings_repository import SettingsRepository
from omnigallery.workspaces.tasks import MAX_TASK_CONCURRENCY

_config_lock = threading.RLock()


def load_config() -> dict:
    saved = SettingsRepository.get_setting(Database.get_connection(), image_defaults.SETTING_KEY)
    saved = saved if isinstance(saved, dict) else {}
    prompts = saved.get("prompts") if isinstance(saved.get("prompts"), dict) else {}
    return {
        "provider": saved.get("provider")
        if saved.get("provider") in ("local", "openrouter", "comfy_cloud")
        else "local",
        "openrouter_model": saved.get("openrouter_model") or image_defaults.DEFAULT_MODEL,
        "comfy_model": saved.get("comfy_model")
        if saved.get("comfy_model") in image_defaults.COMFY_MODELS
        else image_defaults.DEFAULT_COMFY_MODEL,
        "comfy_mode": saved.get("comfy_mode")
        if saved.get("comfy_mode") in ("router", "workflow")
        else "router",
        "comfy_workflow": saved.get("comfy_workflow")
        if isinstance(saved.get("comfy_workflow"), dict)
        else None,
        "comfy_workflow_name": saved.get("comfy_workflow_name") or "",
        "comfy_image_node_id": saved.get("comfy_image_node_id") or "",
        "comfy_image_input": saved.get("comfy_image_input") or "image",
        "comfy_prompt_node_id": saved.get("comfy_prompt_node_id") or "",
        "comfy_prompt_input": saved.get("comfy_prompt_input") or "prompt",
        "comfy_output_node_id": saved.get("comfy_output_node_id") or "",
        "prompts": {
            key: prompts.get(key) or default
            for key, default in image_defaults.DEFAULT_PROMPTS.items()
        },
    }


def openrouter_key() -> tuple[str, str]:
    row = (
        Database.get_connection()
        .execute("SELECT value FROM ai_secret WHERE name = ?", (image_defaults.SECRET_KEY,))
        .fetchone()
    )
    if row and row[0]:
        return row[0], "saved"
    key = os.getenv("OPENROUTER_API_KEY", "").strip()
    return key, "environment" if key else "none"


def comfy_cloud_key() -> tuple[str, str]:
    row = (
        Database.get_connection()
        .execute("SELECT value FROM ai_secret WHERE name = ?", (image_defaults.COMFY_SECRET_KEY,))
        .fetchone()
    )
    if row and row[0]:
        return row[0], "saved"
    key = os.getenv("COMFY_API_KEY", "").strip()
    return key, "environment" if key else "none"


def public_config() -> dict:
    key, source = openrouter_key()
    comfy_key, comfy_source = comfy_cloud_key()
    return {
        **load_config(),
        "api_key_configured": bool(key),
        "api_key_source": source,
        "comfy_api_key_configured": bool(comfy_key),
        "comfy_api_key_source": comfy_source,
    }


def public_creation_config() -> dict:
    saved = SettingsRepository.get_setting(
        Database.get_connection(), image_defaults.CREATION_SETTING_KEY
    )
    saved = saved if isinstance(saved, dict) else {}
    key, source = comfy_cloud_key()
    return {
        "mode": saved.get("mode") if saved.get("mode") in ("router", "workflow") else "workflow",
        "model": saved.get("model")
        if saved.get("model") in image_defaults.CREATION_MODELS
        else image_defaults.DEFAULT_CREATION_MODEL,
        "concurrency": saved.get("concurrency")
        if type(saved.get("concurrency")) is int
        and 1 <= saved["concurrency"] <= MAX_TASK_CONCURRENCY
        else 2,
        "comfy_api_key_configured": bool(key),
        "comfy_api_key_source": source,
    }


def save_creation_config(req: image_schemas.CreationConfigRequest) -> dict:
    if req.mode not in ("router", "workflow"):
        raise HTTPException(400, detail="AI 创作接入方式无效")
    if req.model not in image_defaults.CREATION_MODELS:
        raise HTTPException(400, detail="请选择支持的 Comfy Router 图像模型")
    if req.comfy_api_key and req.clear_comfy_api_key:
        raise HTTPException(400, detail="不能同时设置和清除 API Key")
    conn = Database.get_connection()
    with conn:
        if req.clear_comfy_api_key:
            conn.execute("DELETE FROM ai_secret WHERE name = ?", (image_defaults.COMFY_SECRET_KEY,))
        elif req.comfy_api_key and req.comfy_api_key.strip():
            conn.execute(
                """INSERT INTO ai_secret(name, value) VALUES (?, ?)
                ON CONFLICT(name) DO UPDATE SET value = excluded.value""",
                (image_defaults.COMFY_SECRET_KEY, req.comfy_api_key.strip()),
            )
    concurrency = (
        req.concurrency if req.concurrency is not None else public_creation_config()["concurrency"]
    )
    SettingsRepository.save_setting(
        conn,
        image_defaults.CREATION_SETTING_KEY,
        json.dumps(
            {"mode": req.mode, "model": req.model, "concurrency": concurrency}, ensure_ascii=False
        ),
    )
    return public_creation_config()


def patch_config(req: image_schemas.ImageAIConfigPatch) -> dict:
    changes = req.model_dump(exclude_unset=True)
    if any(key in changes and changes[key] is None for key in ("provider", "prompts")):
        raise HTTPException(400, detail="服务来源和提示词模板不能为空")
    with _config_lock:
        merged = {**load_config(), **changes}
        request = image_schemas.ImageAIConfigRequest(**merged)
        workflow_changed = any(
            key.startswith("comfy_") and key not in ("comfy_api_key",) for key in changes
        )
        return save_config(
            request,
            validate_workflow=request.provider == "comfy_cloud" or workflow_changed,
        )


def save_config(req: image_schemas.ImageAIConfigRequest, *, validate_workflow: bool = True) -> dict:
    with _config_lock:
        return _save_config(req, validate_workflow=validate_workflow)


def _save_config(req: image_schemas.ImageAIConfigRequest, *, validate_workflow: bool) -> dict:
    if req.provider not in ("local", "openrouter", "comfy_cloud"):
        raise HTTPException(400, detail="图片内容处理接入方式无效")
    model = req.openrouter_model.strip() or (
        image_defaults.DEFAULT_MODEL if req.provider != "openrouter" else ""
    )
    if not re.fullmatch(r"[A-Za-z0-9._~:/-]+", model):
        raise HTTPException(400, detail="OpenRouter 模型 ID 无效")
    if req.comfy_model not in image_defaults.COMFY_MODELS:
        raise HTTPException(400, detail="请选择受支持的 Comfy Cloud 视觉模型")
    if req.comfy_mode not in ("router", "workflow"):
        raise HTTPException(400, detail="Comfy Cloud 模式无效")
    workflow = req.comfy_workflow
    if workflow is not None:
        if ("nodes" in workflow and "links" in workflow) or not workflow or len(workflow) > 256:
            raise HTTPException(
                400, detail="请导入 ComfyUI 导出的 API 格式工作流 JSON，不支持界面格式"
            )
        if len(json.dumps(workflow, ensure_ascii=False)) > 1_000_000:
            raise HTTPException(400, detail="工作流 JSON 不能超过 1 MB")
        if any(
            not isinstance(node, dict)
            or not isinstance(node.get("class_type"), str)
            or not isinstance(node.get("inputs"), dict)
            for node in workflow.values()
        ):
            raise HTTPException(400, detail="工作流节点需要 class_type 和 inputs")
    if req.comfy_mode == "workflow" and validate_workflow:
        if not workflow:
            raise HTTPException(400, detail="请先导入 API 格式工作流 JSON")
        for node_id, input_name in (
            (req.comfy_image_node_id, req.comfy_image_input),
            (req.comfy_prompt_node_id, req.comfy_prompt_input),
        ):
            if node_id not in workflow or input_name not in workflow[node_id]["inputs"]:
                raise HTTPException(400, detail="请选择工作流中有效的图片和提示词输入")
        if req.comfy_output_node_id not in workflow:
            raise HTTPException(400, detail="请选择工作流的文本输出节点")
    prompts = {key: value.strip() for key, value in req.prompts.model_dump().items()}
    if any(not value for value in prompts.values()):
        raise HTTPException(400, detail="系统提示词不能为空")
    conn = Database.get_connection()
    if req.api_key and req.clear_api_key:
        raise HTTPException(400, detail="不能同时设置和清除 API Key")
    if req.comfy_api_key and req.clear_comfy_api_key:
        raise HTTPException(400, detail="不能同时设置和清除 Comfy API Key")
    with conn:
        if req.clear_api_key:
            conn.execute("DELETE FROM ai_secret WHERE name = ?", (image_defaults.SECRET_KEY,))
        elif req.api_key and req.api_key.strip():
            conn.execute(
                """INSERT INTO ai_secret(name, value) VALUES (?, ?)
                ON CONFLICT(name) DO UPDATE SET value = excluded.value""",
                (image_defaults.SECRET_KEY, req.api_key.strip()),
            )
        if req.clear_comfy_api_key:
            conn.execute("DELETE FROM ai_secret WHERE name = ?", (image_defaults.COMFY_SECRET_KEY,))
        elif req.comfy_api_key and req.comfy_api_key.strip():
            conn.execute(
                """INSERT INTO ai_secret(name, value) VALUES (?, ?)
                ON CONFLICT(name) DO UPDATE SET value = excluded.value""",
                (image_defaults.COMFY_SECRET_KEY, req.comfy_api_key.strip()),
            )
    SettingsRepository.save_setting(
        conn,
        image_defaults.SETTING_KEY,
        json.dumps(
            {
                "provider": req.provider,
                "openrouter_model": model,
                "comfy_model": req.comfy_model,
                "prompts": prompts,
                "comfy_mode": req.comfy_mode,
                "comfy_workflow": workflow,
                "comfy_workflow_name": req.comfy_workflow_name,
                "comfy_image_node_id": req.comfy_image_node_id,
                "comfy_image_input": req.comfy_image_input,
                "comfy_prompt_node_id": req.comfy_prompt_node_id,
                "comfy_prompt_input": req.comfy_prompt_input,
                "comfy_output_node_id": req.comfy_output_node_id,
            },
            ensure_ascii=False,
        ),
    )
    return public_config()
