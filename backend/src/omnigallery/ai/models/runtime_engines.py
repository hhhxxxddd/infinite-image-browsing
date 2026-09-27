"""Inference primitives shared by the backend and the isolated desktop worker.

This module deliberately has no application/database imports.
"""

import importlib.util
import warnings
from pathlib import Path


def retrieval_module(path: Path, kind: str):
    filename = "qwen3_vl_embedding.py" if kind == "embedding" else "qwen3_vl_reranker.py"
    path = path / "scripts" / filename
    spec = importlib.util.spec_from_file_location(
        f"omnigallery_{kind}_{path.stat().st_mtime_ns}", path
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_retrieval(path: Path, kind: str):
    import torch

    module = retrieval_module(path, kind)
    cls = module.Qwen3VLEmbedder if kind == "embedding" else module.Qwen3VLReranker
    return cls(
        str(path),
        torch_dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32,
        local_files_only=True,
        max_pixels=512 * 512,
    )


def load_instruct(path: Path, mode: str):
    import torch
    from transformers import AutoProcessor, Qwen3VLForConditionalGeneration

    path = str(path)
    processor = AutoProcessor.from_pretrained(path, local_files_only=True)
    load_options = {
        "local_files_only": True,
        "torch_dtype": torch.bfloat16 if torch.cuda.is_available() else torch.float32,
    }
    if mode != "none":
        from transformers import BitsAndBytesConfig

        load_options["quantization_config"] = BitsAndBytesConfig(
            load_in_8bit=mode == "int8",
            load_in_4bit=mode == "nf4",
            **(
                {
                    "bnb_4bit_quant_type": "nf4",
                    "bnb_4bit_compute_dtype": load_options["torch_dtype"],
                }
                if mode == "nf4"
                else {}
            ),
        )
        load_options["device_map"] = "auto"
    model = Qwen3VLForConditionalGeneration.from_pretrained(path, **load_options)
    if mode == "none":
        model = model.to("cuda" if torch.cuda.is_available() else "cpu")
    model = model.eval()
    return processor, model


def generate_instruct(processor, model, path: str, prompt: str, max_tokens: int, system: bool):
    import torch
    from PIL import Image as PilImage
    from PIL import ImageOps
    from qwen_vl_utils import process_vision_info

    with warnings.catch_warnings():
        warnings.simplefilter("error", PilImage.DecompressionBombWarning)
        with PilImage.open(path) as opened:
            media = ImageOps.exif_transpose(opened).convert("RGB")
            media.thumbnail((1024, 1024))
    image_content = {"type": "image", "image": media, "max_pixels": 512 * 512}
    if system:
        messages = [
            {"role": "system", "content": [{"type": "text", "text": prompt}]},
            {
                "role": "user",
                "content": [
                    image_content,
                    {"type": "text", "text": "Follow the instruction for this image."},
                ],
            },
        ]
    else:
        messages = [{"role": "user", "content": [image_content, {"type": "text", "text": prompt}]}]
    text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    image_inputs, video_inputs = process_vision_info(messages)
    inputs = processor(
        text=[text],
        images=image_inputs,
        videos=video_inputs,
        padding=True,
        return_tensors="pt",
    )
    inputs = {name: value.to(model.device) for name, value in inputs.items()}
    with torch.inference_mode():
        output = model.generate(**inputs, max_new_tokens=max_tokens, do_sample=False)
    generated = output[:, inputs["input_ids"].shape[1] :]
    return processor.batch_decode(
        generated, skip_special_tokens=True, clean_up_tokenization_spaces=False
    )[0].strip()
