"""Private stdin/stdout protocol for the application's isolated Python environment."""

import contextlib
import gc
import importlib
import json
import sys
from pathlib import Path

from runtime_engines import generate_instruct, load_instruct, load_retrieval


def check_environment():
    versions = {}
    for name in (
        "torch",
        "torchvision",
        "transformers",
        "qwen_vl_utils",
        "scipy",
        "accelerate",
        "bitsandbytes",
    ):
        module = importlib.import_module(name)
        versions[name] = getattr(module, "__version__", "installed")
    import torch
    from transformers import Qwen3VLForConditionalGeneration  # noqa: F401

    device = "cuda" if torch.cuda.is_available() else "cpu"
    # Check DLL loading and an actual operation, not only package discovery.
    value = torch.ones(2, device=device).sum().item()
    if value != 2:
        raise RuntimeError("推理运行环境自检失败")
    return {
        "versions": versions,
        "cuda": device == "cuda",
        "device": torch.cuda.get_device_name(0) if device == "cuda" else "CPU",
    }


def main():
    engine = None
    loaded_key = None
    output = sys.stdout
    for line in sys.stdin:
        try:
            request = json.loads(line)
            with contextlib.redirect_stdout(sys.stderr):
                if request["action"] == "check":
                    result = check_environment()
                else:
                    import torch

                    kind = request["kind"]
                    key = (kind, request["key"])
                    if key != loaded_key:
                        engine = None
                        loaded_key = None
                        gc.collect()
                        if torch.cuda.is_available():
                            torch.cuda.empty_cache()
                        path = Path(request["model_path"])
                        engine = (
                            load_instruct(path, request["quantization"])
                            if kind == "instruct"
                            else load_retrieval(path, kind)
                        )
                        loaded_key = key
                    if kind == "instruct":
                        result = generate_instruct(
                            *engine,
                            request["path"],
                            request["prompt"],
                            request["max_tokens"],
                            request["system"],
                        )
                    else:
                        with torch.inference_mode():
                            result = engine.process(request["input"])
                            if kind == "embedding":
                                result = result[0].detach().float().cpu().tolist()
                            else:
                                result = [float(score) for score in result]
            reply = {"result": result}
        except Exception as error:
            reply = {"error": str(error)}
        output.write(json.dumps(reply, ensure_ascii=True) + "\n")
        output.flush()


if __name__ == "__main__":
    main()
