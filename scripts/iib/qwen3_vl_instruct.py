"""On-demand local Qwen3-VL image descriptions, prompt drafts, and tag suggestions."""

from __future__ import annotations

import importlib.util
import json
import os
import re
import threading
import warnings
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException
from PIL import Image as PilImage
from PIL import ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field

from scripts.iib.db.datamodel import DataBase, GlobalSetting, Image
from scripts.iib.logger import logger
from scripts.iib.qwen_model_memory import inference_lock
from scripts.iib.tool import is_image_file

MODEL_ID = "Qwen/Qwen3-VL-2B-Instruct"
MODEL_URL = "https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct"
ENV_VAR = "IIB_QWEN3_VL_INSTRUCT_PATH"
SETTING_KEY = "qwen3_vl_instruct_path"
QUANTIZATION_SETTING_KEY = "qwen3_vl_instruct_quantization"
DEFAULT_PATH = Path.home() / ".cache" / "infinite-image-browsing" / "models" / "Qwen3-VL-2B-Instruct"
MODEL_FILES = ("config.json", "preprocessor_config.json", "tokenizer_config.json", "tokenizer.json")


def model_path() -> Path:
    saved = GlobalSetting.get_setting(DataBase.get_conn(), SETTING_KEY)
    configured = saved if isinstance(saved, str) and saved else os.getenv(ENV_VAR)
    return Path(os.path.expanduser(configured or str(DEFAULT_PATH))).resolve()


def model_id() -> str:
    name = model_path().name
    return "Qwen/" + name if re.fullmatch(r"Qwen3-VL-(?:2B|8B)-Instruct", name) else MODEL_ID


def quantization() -> str:
    saved = GlobalSetting.get_setting(DataBase.get_conn(), QUANTIZATION_SETTING_KEY)
    return saved if saved in ("none", "int8", "nf4") else "none"


def readiness() -> tuple[str, str]:
    path = model_path()
    missing = [name for name in MODEL_FILES if not (path / name).is_file()]
    if not (path / "model.safetensors").is_file():
        index = path / "model.safetensors.index.json"
        if not index.is_file():
            missing.append("model.safetensors 或分片权重")
        else:
            try:
                shards = set(json.loads(index.read_text(encoding="utf-8"))["weight_map"].values())
                missing.extend(name for name in shards if not (path / name).is_file())
            except (OSError, ValueError, KeyError, TypeError):
                missing.append("有效的分片权重索引")
    if missing:
        return "missing_model", "模型目录缺少：" + "、".join(missing)
    packages = ("torch", "torchvision", "transformers", "qwen_vl_utils")
    if quantization() != "none":
        packages += ("accelerate", "bitsandbytes")
    missing = [name for name in packages if importlib.util.find_spec(name) is None]
    if missing:
        return "missing_dependency", "缺少 Python 依赖：" + "、".join(missing)
    return "ready", ""


def model_key() -> str:
    path = model_path()
    weights = sorted(path.glob("*.safetensors"))
    revisions = ":".join(f"{weight.name}:{weight.stat().st_size}:{weight.stat().st_mtime_ns}" for weight in weights)
    return f"{path}:{quantization()}:{revisions}"


DEFAULT_PROMPT_TEMPLATE = (
    "Write an English image-generation prompt of at most {max_chars} characters that recreates the visible image. "
    "Describe subjects, composition, colors, lighting and style. Do not invent a model name, seed, sampler, "
    "artist name or details not visible. Output only the prompt."
)
DEFAULT_DESCRIPTION_TEMPLATE = (
    "请用简体中文客观描述这张图片的可见内容，最多{max_chars}个汉字。"
    "包括主要物体、场景、颜色和显著关系。不要猜测人物身份、地点、创作工具或图片之外的情节。"
    "只输出描述正文，不要标题。"
)
DEFAULT_TAGS_TEMPLATE = (
    "从下列已有标签中挑选确实符合图片内容的标签，最多8个。只能使用列表中的原文。"
    "请只输出 JSON 字符串数组，不要解释。可选标签：{allowed_tags}"
)


def prompt_for(task: str, max_chars: int, allowed_tags: list[str], prompt_template: str | None = None) -> str:
    if task == "description":
        template = prompt_template.strip() if prompt_template and prompt_template.strip() else DEFAULT_DESCRIPTION_TEMPLATE
        instruction = template.replace("{max_chars}", str(max_chars))
        return instruction if "{max_chars}" in template else f"{instruction}\n最多输出{max_chars}个字符。"
    if task == "prompt":
        template = prompt_template.strip() if prompt_template and prompt_template.strip() else DEFAULT_PROMPT_TEMPLATE
        instruction = template.replace("{max_chars}", str(max_chars))
        if "{max_chars}" not in template:
            instruction += f"\nOutput no more than {max_chars} characters."
        return instruction
    if task == "tags":
        template = prompt_template.strip() if prompt_template and prompt_template.strip() else DEFAULT_TAGS_TEMPLATE
        labels = json.dumps(allowed_tags, ensure_ascii=False)
        instruction = template.replace("{allowed_tags}", labels)
        if "{allowed_tags}" not in template:
            instruction += f"\n只能从以下已有标签中挑选：{labels}"
        return instruction
    raise ValueError("Unknown task")


def parse_tags(raw: str, allowed_tags: list[str]) -> list[str]:
    try:
        start, end = raw.index("["), raw.rindex("]") + 1
        values = json.loads(raw[start:end])
    except (ValueError, json.JSONDecodeError):
        return []
    allowed = set(allowed_tags)
    if not isinstance(values, list):
        return []
    return list(dict.fromkeys(value for value in values if isinstance(value, str) and value in allowed))[:8]


class _Runtime:
    def __init__(self):
        self.lock = threading.RLock()
        self.key = ""
        self.model = None
        self.processor = None

    def clear(self):
        with self.lock:
            if self.model is None and not self.key:
                return
            self.model = None
            self.processor = None
            self.key = ""
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except ImportError:
                pass

    def _load(self):
        key = model_key()
        if self.key == key and self.model is not None:
            return
        if self.model is not None:
            self.clear()
        import torch
        from transformers import AutoProcessor, Qwen3VLForConditionalGeneration

        path = str(model_path())
        processor = AutoProcessor.from_pretrained(path, local_files_only=True)
        load_options = {
            "local_files_only": True,
            "torch_dtype": torch.bfloat16 if torch.cuda.is_available() else torch.float32,
        }
        mode = quantization()
        if mode != "none":
            from transformers import BitsAndBytesConfig
            load_options["quantization_config"] = BitsAndBytesConfig(
                load_in_8bit=mode == "int8", load_in_4bit=mode == "nf4",
                **({"bnb_4bit_quant_type": "nf4", "bnb_4bit_compute_dtype": load_options["torch_dtype"]}
                   if mode == "nf4" else {}),
            )
            load_options["device_map"] = "auto"
        model = Qwen3VLForConditionalGeneration.from_pretrained(path, **load_options)
        if mode == "none":
            model = model.to("cuda" if torch.cuda.is_available() else "cpu")
        model = model.eval()
        self.processor, self.model, self.key = processor, model, key

    def generate(self, path: str, prompt: str, max_tokens: int, system: bool = False) -> str:
        import torch
        from qwen_vl_utils import process_vision_info

        from scripts.iib.qwen3_vl_search import release_search_models

        with inference_lock, self.lock:
            release_search_models()
            self._load()
            with warnings.catch_warnings():
                warnings.simplefilter("error", PilImage.DecompressionBombWarning)
                with PilImage.open(path) as opened:
                    image = ImageOps.exif_transpose(opened).convert("RGB")
                    image.thumbnail((1024, 1024))
            image_content = {"type": "image", "image": image, "max_pixels": 512 * 512}
            if system:
                messages = [
                    {"role": "system", "content": [{"type": "text", "text": prompt}]},
                    {"role": "user", "content": [image_content, {"type": "text", "text": "Follow the instruction for this image."}]},
                ]
            else:
                messages = [{"role": "user", "content": [image_content, {"type": "text", "text": prompt}]}]
            text = self.processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
            image_inputs, video_inputs = process_vision_info(messages)
            inputs = self.processor(text=[text], images=image_inputs, videos=video_inputs,
                                    padding=True, return_tensors="pt")
            inputs = {name: value.to(self.model.device) for name, value in inputs.items()}
            with torch.inference_mode():
                output = self.model.generate(**inputs, max_new_tokens=max_tokens, do_sample=False)
            generated = output[:, inputs["input_ids"].shape[1]:]
            return self.processor.batch_decode(generated, skip_special_tokens=True,
                                               clean_up_tokenization_spaces=False)[0].strip()


_runtime = _Runtime()


def release_loaded_model():
    with inference_lock:
        _runtime.clear()


class GenerateRequest(BaseModel):
    path: str = Field(min_length=1, max_length=4096)
    task: Literal["description", "prompt", "tags"]
    max_chars: int = Field(default=120, ge=40, le=1000)
    allowed_tags: list[str] = Field(default_factory=list, max_length=80)
    prompt_template: str | None = Field(default=None, max_length=2000)


class ConfigRequest(BaseModel):
    model_path: str = Field(max_length=2048)


class QuantizationRequest(BaseModel):
    mode: Literal["none", "int8", "nf4"]


class NoteRequest(BaseModel):
    path: str = Field(min_length=1, max_length=4096)
    inferred_prompt: str = Field(max_length=5000)


def mount_qwen3_vl_instruct_routes(app: FastAPI, db_api_base: str, verify_secret,
                                   write_permission_required, is_path_trusted):
    @app.get(db_api_base + "/qwen3-vl/instruct/status", dependencies=[Depends(verify_secret)])
    def status():
        state, detail = readiness()
        saved = GlobalSetting.get_setting(DataBase.get_conn(), SETTING_KEY)
        return {"state": state, "detail": detail, "model": model_id(), "model_path": str(model_path()),
                "quantization": quantization(),
                "config_source": "settings" if saved else "environment", "download_url": "https://huggingface.co/" + model_id()}

    @app.put(db_api_base + "/qwen3-vl/instruct/config", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def save_config(req: ConfigRequest):
        value = req.model_path.strip()
        if value and not os.path.isabs(os.path.expanduser(value)):
            raise HTTPException(400, detail="请填写后端运行环境中的绝对目录路径")
        with inference_lock:
            _runtime.clear()
            conn = DataBase.get_conn()
            if value:
                GlobalSetting.save_setting(conn, SETTING_KEY, json.dumps(value))
            else:
                GlobalSetting.remove_setting(conn, SETTING_KEY)
        return {"model_path": str(model_path())}

    @app.put(db_api_base + "/qwen3-vl/instruct/quantization",
             dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def save_quantization(req: QuantizationRequest):
        with inference_lock:
            _runtime.clear()
            GlobalSetting.save_setting(DataBase.get_conn(), QUANTIZATION_SETTING_KEY, json.dumps(req.mode))
        state, detail = readiness()
        return {"mode": quantization(), "state": state, "detail": detail}

    @app.post(db_api_base + "/qwen3-vl/instruct/generate", dependencies=[Depends(verify_secret)])
    def generate(req: GenerateRequest):
        state, detail = readiness()
        if state != "ready":
            raise HTTPException(503, detail=detail)
        path = os.path.realpath(req.path)
        if not is_path_trusted(path) or not is_image_file(path):
            raise HTTPException(403, detail="无权访问该图片")
        if not os.path.isfile(path):
            raise HTTPException(404, detail="图片不存在")
        if req.task == "tags" and not req.allowed_tags:
            return {"task": req.task, "text": "", "tags": []}
        prompt = prompt_for(req.task, req.max_chars, req.allowed_tags, req.prompt_template)
        try:
            raw = _runtime.generate(path, prompt, 384 if req.task == "prompt" else 256,
                                    system=req.task == "prompt")
        except (OSError, ValueError, UnidentifiedImageError, PilImage.DecompressionBombError, PilImage.DecompressionBombWarning):
            raise HTTPException(400, detail="无法读取参考图片") from None
        except Exception as error:
            logger.exception("Qwen3-VL generation failed")
            raise HTTPException(503, detail=f"视觉语言模型推理失败：{error}") from error
        if req.task == "tags":
            return {"task": req.task, "text": raw, "tags": parse_tags(raw, req.allowed_tags)}
        value = raw.strip().strip('"').strip()
        return {"task": req.task, "text": value[:req.max_chars], "tags": []}

    @app.get(db_api_base + "/image_ai_note", dependencies=[Depends(verify_secret)])
    def get_note(path: str):
        if not is_path_trusted(os.path.realpath(path)):
            raise HTTPException(403, detail="无权访问该图片")
        conn = DataBase.get_conn()
        image = Image.get(conn, path)
        if image is None:
            raise HTTPException(404, detail="图片尚未加入媒体索引")
        row = conn.execute("SELECT inferred_prompt FROM image_ai_note WHERE image_id = ?", (image.id,)).fetchone()
        return {"inferred_prompt": row[0] if row else ""}

    @app.put(db_api_base + "/image_ai_note", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def save_note(req: NoteRequest):
        if not is_path_trusted(os.path.realpath(req.path)):
            raise HTTPException(403, detail="无权访问该图片")
        conn = DataBase.get_conn()
        image = Image.get(conn, req.path)
        if image is None:
            raise HTTPException(404, detail="图片尚未加入媒体索引")
        with conn:
            conn.execute("""INSERT INTO image_ai_note(image_id, inferred_prompt) VALUES (?, ?)
                ON CONFLICT(image_id) DO UPDATE SET inferred_prompt = excluded.inferred_prompt""",
                (image.id, req.inferred_prompt.strip()))
        return {"inferred_prompt": req.inferred_prompt.strip()}
