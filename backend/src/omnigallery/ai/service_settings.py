"""Shared AI connections and model catalog, independent of the consuming media feature."""

from __future__ import annotations

import json

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from omnigallery.ai import image_configuration, image_defaults, image_providers
from omnigallery.ai.providers.comfy_cloud import check_connection
from omnigallery.infrastructure.database import Database
from omnigallery.storage.settings_repository import SettingsRepository

MODELS_KEY = "ai_model_selection"


class ConnectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    api_key: str | None = Field(default=None, max_length=512)
    clear_api_key: bool = False


class ModelSelectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: list[str] = Field(max_length=256)


def connection() -> dict:
    key, source = image_configuration.comfy_cloud_key()
    return {"configured": bool(key), "source": source}


def save_connection(req: ConnectionRequest) -> dict:
    if req.api_key is not None and req.clear_api_key:
        raise HTTPException(400, "不能同时设置和清除密钥")
    key = req.api_key.strip() if req.api_key is not None else None
    if key == "":
        raise HTTPException(400, "密钥不能为空")
    conn = Database.get_connection()
    with conn:
        if req.clear_api_key:
            conn.execute("DELETE FROM ai_secret WHERE name = ?", (image_defaults.COMFY_SECRET_KEY,))
        elif key:
            conn.execute(
                "INSERT INTO ai_secret(name, value) VALUES (?, ?) "
                "ON CONFLICT(name) DO UPDATE SET value = excluded.value",
                (image_defaults.COMFY_SECRET_KEY, key),
            )
    return connection()


def model_catalog() -> list[dict]:
    # Capabilities, rather than a single image-specific model list, drive feature pickers.
    return [
        {
            "id": model,
            "label": label,
            "service": "comfy",
            "media": ["text", "image"],
            "capabilities": ["understanding"],
        }
        for model, label in image_defaults.ROUTER_VISION_MODEL_LABELS.items()
    ] + [
        {
            "id": model,
            "label": label,
            "service": "comfy",
            "media": ["image"],
            "capabilities": ["generation", "editing"],
            "options": image_defaults.router_image_options(model),
        }
        for model, label in image_defaults.ROUTER_CREATION_MODEL_LABELS.items()
    ]


def enabled_models() -> set[str]:
    saved = SettingsRepository.get_setting(Database.get_connection(), MODELS_KEY)
    hidden = saved.get("hidden", []) if isinstance(saved, dict) else []
    return {item["id"] for item in model_catalog()} - set(hidden)


def migrate_legacy_connection():
    """Retire the old provider without discarding prompts or unrelated workflow settings."""
    conn = Database.get_connection()
    saved = SettingsRepository.get_setting(conn, image_defaults.SETTING_KEY)
    if isinstance(saved, dict) and (
        saved.get("provider") == "openrouter" or "openrouter_model" in saved
    ):
        saved = dict(saved)
        saved.pop("openrouter_model", None)
        if saved.get("provider") == "openrouter":
            key, _ = image_configuration.comfy_cloud_key()
            saved["provider"] = "comfy_cloud" if key else "local"
            saved["comfy_mode"] = "router"
        SettingsRepository.save_setting(conn, image_defaults.SETTING_KEY, json.dumps(saved))
    with conn:
        conn.execute("DELETE FROM ai_secret WHERE name = ?", ("openrouter_api_key",))


def mount_routes(app: FastAPI, api_base: str, verify_secret, write_permission_required):
    migrate_legacy_connection()
    root = api_base + "/ai/services"

    @app.get(root + "/comfy", dependencies=[Depends(verify_secret)])
    def get_connection():
        return connection()

    @app.put(
        root + "/comfy",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def put_connection(req: ConnectionRequest):
        return save_connection(req)

    @app.get(root + "/comfy/status/{channel}", dependencies=[Depends(verify_secret)])
    def get_status(channel: str):
        if channel not in ("router", "workflow"):
            raise HTTPException(404, "接入方式不存在")
        key, _ = image_configuration.comfy_cloud_key()
        if not key:
            return {"ready": False, "detail": "尚未配置密钥"}
        if channel == "workflow":
            ready, detail = check_connection(key)
        else:
            try:
                image_providers.comfy_router_models(key)
                ready, detail = True, "模型接口可访问"
            except HTTPException as error:
                ready, detail = False, str(error.detail)
        return {"ready": ready, "detail": detail}

    @app.get(root + "/models", dependencies=[Depends(verify_secret)])
    def get_models(refresh: bool = False):
        available = None
        if refresh:
            key, _ = image_configuration.comfy_cloud_key()
            if not key:
                raise HTTPException(503, "请先在服务连接中配置 Comfy 密钥")
            live = image_providers.comfy_router_models(key)
            available = {item["id"] for group in live.values() for item in group}
        enabled = enabled_models()
        return {
            "models": [
                {
                    **item,
                    "enabled": item["id"] in enabled,
                    "available": item["id"] in available if available is not None else None,
                }
                for item in model_catalog()
            ]
        }

    @app.put(
        root + "/models",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def put_models(req: ModelSelectionRequest):
        known = {item["id"] for item in model_catalog()}
        if not set(req.enabled) <= known:
            raise HTTPException(400, "包含尚未适配的模型")
        SettingsRepository.save_setting(
            Database.get_connection(),
            MODELS_KEY,
            json.dumps({"hidden": sorted(known - set(req.enabled))}),
        )
        return get_models()
