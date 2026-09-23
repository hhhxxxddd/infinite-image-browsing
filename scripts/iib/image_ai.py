"""Provider-neutral image description, prompt and tag generation."""

from __future__ import annotations

import base64
import io
import json
import os
import re
import warnings

import requests
from fastapi import Depends, FastAPI, HTTPException
from PIL import Image as PilImage
from PIL import ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field

from scripts.iib.db.datamodel import DataBase, GlobalSetting
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
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "qwen/qwen3-vl-8b-instruct"
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
    openrouter_model: str = Field(min_length=1, max_length=200)
    prompts: PromptTemplates
    api_key: str | None = Field(default=None, max_length=512)
    clear_api_key: bool = False


def load_config() -> dict:
    saved = GlobalSetting.get_setting(DataBase.get_conn(), SETTING_KEY)
    saved = saved if isinstance(saved, dict) else {}
    prompts = saved.get("prompts") if isinstance(saved.get("prompts"), dict) else {}
    return {
        "provider": saved.get("provider") if saved.get("provider") in ("local", "openrouter") else "local",
        "openrouter_model": saved.get("openrouter_model") or DEFAULT_MODEL,
        "prompts": {key: prompts.get(key) or default for key, default in DEFAULT_PROMPTS.items()},
    }


def openrouter_key() -> tuple[str, str]:
    row = DataBase.get_conn().execute("SELECT value FROM image_ai_secret WHERE name = ?", (SECRET_KEY,)).fetchone()
    if row and row[0]:
        return row[0], "saved"
    key = os.getenv("OPENROUTER_API_KEY", "").strip()
    return key, "environment" if key else "none"


def public_config() -> dict:
    key, source = openrouter_key()
    return {**load_config(), "api_key_configured": bool(key), "api_key_source": source}


def save_config(req: ImageAIConfigRequest) -> dict:
    if req.provider not in ("local", "openrouter"):
        raise HTTPException(400, detail="图片内容处理仅支持本地模型或 OpenRouter")
    model = req.openrouter_model.strip()
    if not re.fullmatch(r"[A-Za-z0-9._~:/-]+", model):
        raise HTTPException(400, detail="OpenRouter 模型 ID 无效")
    prompts = {key: value.strip() for key, value in req.prompts.model_dump().items()}
    if any(not value for value in prompts.values()):
        raise HTTPException(400, detail="系统提示词不能为空")
    conn = DataBase.get_conn()
    if req.api_key and req.clear_api_key:
        raise HTTPException(400, detail="不能同时设置和清除 API Key")
    with conn:
        if req.clear_api_key:
            conn.execute("DELETE FROM image_ai_secret WHERE name = ?", (SECRET_KEY,))
        elif req.api_key and req.api_key.strip():
            conn.execute("""INSERT INTO image_ai_secret(name, value) VALUES (?, ?)
                ON CONFLICT(name) DO UPDATE SET value = excluded.value""", (SECRET_KEY, req.api_key.strip()))
    GlobalSetting.save_setting(conn, SETTING_KEY, json.dumps({
        "provider": req.provider, "openrouter_model": model, "prompts": prompts,
    }, ensure_ascii=False))
    return public_config()


def _openrouter_generate(path: str, prompt: str, model: str, key: str, max_tokens: int) -> str:
    with warnings.catch_warnings():
        warnings.simplefilter("error", PilImage.DecompressionBombWarning)
        with PilImage.open(path) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGB")
            image.thumbnail((1024, 1024))
            buffer = io.BytesIO()
            image.save(buffer, format="JPEG", quality=85)
    data_url = "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")
    image_part = {"type": "image_url", "image_url": {"url": data_url}}
    messages = [
        {"role": "system", "content": prompt},
        {"role": "user", "content": [
            {"type": "text", "text": "Follow the instruction for this image."}, image_part,
        ]},
    ]
    try:
        response = requests.post(OPENROUTER_URL, headers={"Authorization": f"Bearer {key}"},
                                 json={"model": model, "messages": messages, "max_tokens": max_tokens},
                                 timeout=(10, 180))
    except requests.RequestException as error:
        raise HTTPException(502, detail="无法连接 OpenRouter，请检查网络和 API 配置") from error
    if response.status_code != 200:
        raise HTTPException(502, detail=f"OpenRouter 返回 HTTP {response.status_code}；请检查模型、额度与 API Key")
    try:
        content = response.json()["choices"][0]["message"]["content"]
        if isinstance(content, list):
            content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
        if not isinstance(content, str) or not content.strip():
            raise ValueError("empty completion")
        return content.strip()
    except (ValueError, KeyError, IndexError, TypeError) as error:
        raise HTTPException(502, detail="OpenRouter 返回了无法解析的内容") from error


def mount_image_ai_routes(app: FastAPI, db_api_base: str, verify_secret,
                          write_permission_required, is_path_trusted):
    @app.get(db_api_base + "/image-ai/config", dependencies=[Depends(verify_secret)])
    def get_config():
        return public_config()

    @app.put(db_api_base + "/image-ai/config", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def put_config(req: ImageAIConfigRequest):
        return save_config(req)

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
