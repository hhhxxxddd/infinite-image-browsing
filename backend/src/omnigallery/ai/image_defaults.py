from __future__ import annotations

from omnigallery.ai.models.qwen_instruct import (
    DEFAULT_DESCRIPTION_TEMPLATE,
    DEFAULT_PROMPT_TEMPLATE,
    DEFAULT_TAGS_TEMPLATE,
)

SETTING_KEY = "image_ai_config"


SECRET_KEY = "openrouter_api_key"


COMFY_SECRET_KEY = "comfy_cloud_api_key"


OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


COMFY_ROUTER_URL = "https://api.comfy.org/v2/models"


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


DEFAULT_PROMPTS = {
    "description": DEFAULT_DESCRIPTION_TEMPLATE,
    "prompt": DEFAULT_PROMPT_TEMPLATE,
    "tags": DEFAULT_TAGS_TEMPLATE,
}
