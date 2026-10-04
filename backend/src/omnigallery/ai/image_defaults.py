from __future__ import annotations

from omnigallery.ai.models.qwen_instruct import (
    DEFAULT_DESCRIPTION_TEMPLATE,
    DEFAULT_PROMPT_TEMPLATE,
    DEFAULT_TAGS_TEMPLATE,
)

SETTING_KEY = "image_ai_config"


COMFY_SECRET_KEY = "comfy_cloud_api_key"


COMFY_ROUTER_URL = "https://api.comfy.org/v2/models"


COMFY_MODELS = {
    "vertexai/gemini-3.1-flash-lite",
    "vertexai/gemini-3.8-flash",
    "vertexai/gemini-3.1-pro-preview",
    "openai/gpt-6-sol",
    "openai/gpt-6-luna",
    "openai/gpt-6-astra",
}


DEFAULT_COMFY_MODEL = "vertexai/gemini-3.1-flash-lite"


CREATION_SETTING_KEY = "image_ai_creation_config"


STUDIO_WORKFLOWS_KEY = "image_ai_studio_workflows"


CREATION_MODELS = {
    "vertexai/gemini-3.1-flash-lite-image",
    "vertexai/gemini-3.1-flash-image",
    "vertexai/gemini-3-pro-image",
    "bfl/flux-3-image",
    "byteplus/seedream-5-0-260128",
    "byteplus/seedream-5-0-pro-260628",
    "byteplus/seedream-5-0-flash-260915",
    "openai/gpt-image-2.5-flare",
    "openai/gpt-image-2.5-sunburst",
}


ROUTER_IMAGE_RATIOS = {"1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"}


ROUTER_FLASH_EXTRA_RATIOS = {"1:4", "4:1", "1:8", "8:1"}


DEFAULT_CREATION_MODEL = "vertexai/gemini-3.1-flash-image"


ROUTER_VISION_MODEL_LABELS = {
    "vertexai/gemini-3.1-flash-lite": "Gemini 3.1 Flash Lite",
    "vertexai/gemini-3.8-flash": "Gemini 3.8 Flash",
    "vertexai/gemini-3.1-pro-preview": "Gemini 3.1 Pro",
    "openai/gpt-6-sol": "GPT 6 Sol",
    "openai/gpt-6-luna": "GPT 6 Luna",
    "openai/gpt-6-astra": "GPT 6 Astra",
}


ROUTER_CREATION_MODEL_LABELS = {
    "vertexai/gemini-3.1-flash-lite-image": "Nano Banana 2 Lite",
    "vertexai/gemini-3.1-flash-image": "Nano Banana 2",
    "vertexai/gemini-3-pro-image": "Nano Banana Pro",
    "bfl/flux-3-image": "FLUX 3 Image",
    "byteplus/seedream-5-0-260128": "Seedream 5.0 · 260128",
    "byteplus/seedream-5-0-pro-260628": "Seedream 5.0 Pro · 260628",
    "byteplus/seedream-5-0-flash-260915": "Seedream 5.0 Flash · 260915",
    "openai/gpt-image-2.5-flare": "GPT Image 2.5 Flare",
    "openai/gpt-image-2.5-sunburst": "GPT Image 2.5 Sunburst",
}


def router_image_options(model: str) -> dict:
    ratios = sorted(ROUTER_IMAGE_RATIOS)
    sizes, references = ["1K", "2K", "4K"], 13
    if model == "vertexai/gemini-3.1-flash-image":
        ratios += sorted(ROUTER_FLASH_EXTRA_RATIOS)
    elif model == "bfl/flux-3-image":
        references = 9
    elif model == "byteplus/seedream-5-0-260128":
        sizes = ["2K", "3K"]
    elif model.startswith("byteplus/seedream-"):
        sizes, references = ["1K", "2K"], 9
        if "flash" in model:
            sizes = ["1K", "1.5K", "2K"]
    elif model.startswith("openai/gpt-image-"):
        # Expose the documented native sizes, without guessing unsupported combinations.
        ratios, sizes = ["1:1", "3:2", "2:3"], ["1K"]
    return {"aspect_ratios": ratios, "image_sizes": sizes, "reference_limit": references}


DEFAULT_PROMPTS = {
    "description": DEFAULT_DESCRIPTION_TEMPLATE,
    "prompt": DEFAULT_PROMPT_TEMPLATE,
    "tags": DEFAULT_TAGS_TEMPLATE,
}
