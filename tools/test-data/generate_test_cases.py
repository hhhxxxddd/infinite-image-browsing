"""Supplement existing demos with deterministic image and metadata edge cases.

Generated metadata is synthetic test data, not a claim about image provenance.
Existing files are preserved, including any edits made during manual testing.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import piexif
import piexif.helper
from generate_test_media import ffmpeg, scene
from PIL import Image, PngImagePlugin


def save_image(root: Path, name: str, image: Image.Image, **options) -> Path:
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        image.save(path, **options)
    return path


def comfy_prompt() -> dict:
    return {
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": "Fixture-SDXL.safetensors"},
        },
        "2": {
            "class_type": "LoraLoader",
            "inputs": {
                "model": ["1", 0],
                "clip": ["1", 1],
                "lora_name": "Fixture-Style.safetensors",
                "strength_model": 0.8,
                "strength_clip": 0.6,
            },
        },
        "3": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": "a geometric landscape, sunrise, 测试提示词", "clip": ["2", 1]},
        },
        "4": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": "blurry, watermark", "clip": ["2", 1]},
        },
        "5": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": 1024, "height": 1024, "batch_size": 1},
        },
        "6": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["2", 0],
                "positive": ["3", 0],
                "negative": ["4", 0],
                "latent_image": ["5", 0],
                "seed": 9007199254740993,
                "steps": 24,
                "cfg": 6.5,
                "sampler_name": "euler",
                "scheduler": "normal",
                "denoise": 1.0,
            },
        },
        "7": {"class_type": "VAEDecode", "inputs": {"samples": ["6", 0], "vae": ["1", 2]}},
        "8": {"class_type": "UpscaleModelLoader", "inputs": {"model_name": "Fixture-4x.pth"}},
        "9": {
            "class_type": "ImageUpscaleWithModel",
            "inputs": {"upscale_model": ["8", 0], "image": ["7", 0]},
        },
        "10": {
            "class_type": "SaveImage",
            "inputs": {"images": ["9", 0], "filename_prefix": "Fixture"},
        },
    }


def comfy_workflow(prompt: dict) -> dict:
    """Build a connected UI graph for the same synthetic API prompt."""
    output_types = {
        "CheckpointLoaderSimple": ["MODEL", "CLIP", "VAE"],
        "LoraLoader": ["MODEL", "CLIP"],
        "CLIPTextEncode": ["CONDITIONING"],
        "EmptyLatentImage": ["LATENT"],
        "KSampler": ["LATENT"],
        "VAEDecode": ["IMAGE"],
        "UpscaleModelLoader": ["UPSCALE_MODEL"],
        "ImageUpscaleWithModel": ["IMAGE"],
        "SaveImage": [],
    }
    nodes, links = {}, []
    for order, (key, node) in enumerate(prompt.items()):
        widgets = [value for value in node["inputs"].values() if not isinstance(value, list)]
        if node["class_type"] == "KSampler":
            widgets.insert(1, "fixed")
        nodes[key] = {
            "id": int(key),
            "type": node["class_type"],
            "pos": [(order % 4) * 340, (order // 4) * 300],
            "size": [300, 240],
            "flags": {},
            "order": order,
            "mode": 0,
            "inputs": [],
            "outputs": [
                {"name": kind, "type": kind, "links": []}
                for kind in output_types[node["class_type"]]
            ],
            "properties": {"Node name for S&R": node["class_type"]},
            "widgets_values": widgets,
        }
    for key, node in prompt.items():
        for name, ref in node["inputs"].items():
            if not isinstance(ref, list):
                continue
            source = nodes[ref[0]]["outputs"][ref[1]]
            link_id = len(links) + 1
            links.append(
                [link_id, int(ref[0]), ref[1], int(key), len(nodes[key]["inputs"]), source["type"]]
            )
            nodes[key]["inputs"].append({"name": name, "type": source["type"], "link": link_id})
            source["links"].append(link_id)
    return {
        "last_node_id": len(nodes),
        "last_link_id": len(links),
        "nodes": list(nodes.values()),
        "links": links,
        "groups": [],
        "config": {},
        "extra": {},
        "version": 0.4,
    }


def generate(root: Path) -> list[Path]:
    paths = []
    sizes = [
        ("超宽全景", (2400, 240)),
        ("超长竖图", (240, 2400)),
        ("大图24MP", (6000, 4000)),
        ("奇数尺寸", (641, 359)),
    ]
    for name, size in sizes:
        paths.append(
            save_image(
                root, f"01-尺寸/{name}.jpg", scene(size, "sea", name).convert("RGB"), quality=88
            )
        )
    paths.append(save_image(root, "01-尺寸/单像素.png", Image.new("RGB", (1, 1), "#39a9db")))
    paths.append(save_image(root, "01-尺寸/微型图16x16.png", Image.new("RGB", (16, 16), "#ffcc55")))
    base = scene((800, 600), "geometry", "FORMAT TEST")
    paths.append(
        save_image(
            root, "02-格式/透明叠加.png", scene((800, 600), "geometry", "ALPHA", transparent=True)
        )
    )
    paths.append(save_image(root, "02-格式/灰度.png", base.convert("L")))
    paths.append(save_image(root, "02-格式/印刷CMYK.jpg", base.convert("CMYK")))
    paths.append(save_image(root, "02-格式/位图.bmp", base.convert("RGB")))
    paths.append(save_image(root, "02-格式/静态WebP.webp", base, quality=85))
    paths.append(save_image(root, "02-格式/静态AVIF.avif", base, quality=70))
    exif = piexif.dump(
        {
            "0th": {piexif.ImageIFD.Orientation: 6, piexif.ImageIFD.Make: b"Fixture camera"},
            "Exif": {piexif.ExifIFD.DateTimeOriginal: b"2024:01:02 03:04:05"},
        }
    )
    paths.append(save_image(root, "02-格式/EXIF旋转90度.jpg", base.convert("RGB"), exif=exif))
    for name in [
        "03-文件名/中文 空格 &括号(1) #测试.JPG",
        "03-文件名/emoji-🌈-café-日本語.png",
        "03-文件名/这是一个用于测试卡片省略号以及详情标题换行的较长文件名称-0123456789.png",
        "03-文件名/文件夹A/同名.png",
        "03-文件名/文件夹B/同名.png",
    ]:
        image = base.convert("RGB") if name.lower().endswith(".jpg") else base
        paths.append(save_image(root, name, image))

    parameters = (
        "a geometric landscape, sunrise, soft light, 中文测试\n"
        "Negative prompt: blurry, low quality\n"
        "Steps: 24, Sampler: Euler, Schedule type: normal, CFG scale: 6.5, "
        "Seed: 9007199254740993, Size: 800x600, Model: Fixture-SDXL, "
        "Model hash: abcdef1234, VAE: Fixture-VAE, Clip skip: 2, "
        "Denoising strength: 0.45, Hires upscale: 2, Hires upscaler: Fixture-4x"
    )
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text("parameters", parameters)
    paths.append(save_image(root, "04-生成信息/A1111-完整参数.png", base, pnginfo=metadata))
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text(
        "parameters", "Steps: 1, Sampler: Euler, CFG scale: 0, Seed: 0, Size: 800x600"
    )
    paths.append(save_image(root, "04-生成信息/参数零值无提示词.png", base, pnginfo=metadata))
    for workflow in (True, False):
        metadata = PngImagePlugin.PngInfo()
        prompt = comfy_prompt()
        metadata.add_text("prompt", json.dumps(prompt, ensure_ascii=False))
        if workflow:
            metadata.add_text("workflow", json.dumps(comfy_workflow(prompt), ensure_ascii=False))
        name = "ComfyUI-工作流10节点" if workflow else "ComfyUI-仅API图10节点"
        paths.append(save_image(root, f"04-生成信息/{name}.png", base, pnginfo=metadata))
    exif = piexif.dump(
        {
            "Exif": {
                piexif.ExifIFD.UserComment: piexif.helper.UserComment.dump(
                    parameters, encoding="unicode"
                )
            }
        }
    )
    paths.append(save_image(root, "04-生成信息/EXIF生成参数.jpg", base.convert("RGB"), exif=exif))

    # Small, visibly numbered variants exercise masonry, scrolling and multi-select.
    themes = ["sunrise", "mountain", "sea", "city", "geometry", "retro"]
    for index in range(60):
        size = [(320, 180), (180, 320), (256, 256), (384, 160), (200, 300)][index % 5]
        theme = themes[index % len(themes)]
        image = scene(size, theme, f"TEST {index + 1:02d} · {theme}").convert("RGB")
        paths.append(
            save_image(root, f"05-批量/测试卡片-{index + 1:02d}-{theme}.jpg", image, quality=82)
        )
    for name, duration in [("无音轨-横屏.mp4", "4"), ("进度拖动-30秒.mp4", "30")]:
        path = root / "06-视频" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            ffmpeg(
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=640x360:rate=12",
                "-t",
                duration,
                "-an",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-crf",
                "32",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                str(path),
            )
        paths.append(path)
    return paths


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("test_data/regression-cases"))
    args = parser.parse_args()
    root = args.output.resolve()
    paths = generate(root)
    manifest = {
        "synthetic_metadata": True,
        "files": [str(path.relative_to(root)) for path in paths],
    }
    (root / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Prepared {len(paths)} fixtures in {root}; existing files preserved.")


if __name__ == "__main__":
    main()
