"""Native image contracts for the supported Comfy Router model families."""

import base64
import io
import ipaddress
import math
import socket
from urllib.parse import urljoin, urlsplit

import requests
from fastapi import HTTPException
from PIL import Image

from omnigallery.ai import image_defaults, image_images
from omnigallery.ai.providers.comfy_cloud import _signed_url
from omnigallery.infrastructure.network_proxy import requests_proxy_kwargs


def _dimensions(ratio: str, resolution: str, *, area: bool) -> tuple[int, int]:
    a, b = map(int, ratio.split(":"))
    side = int(float(resolution.removesuffix("K")) * 1024)
    if not 1 / 16 <= a / b <= 16:
        raise HTTPException(400, "Seedream 图片宽高比需在 1:16 至 16:1 之间")
    scale = side / math.sqrt(a * b)
    # Keep area within the native 1K/2K/3K bounds without rounding below 1K.
    width = max(1, round(a * scale))
    height = max(1, int(side * side / width))
    if side == 1024 and width * height < side * side:
        height += 1
    return width, height


def native_payload(req):
    inputs = ([req.image_base64] if hasattr(req, "image_base64") else []) + list(
        getattr(req, "reference_images_base64", [])
    )
    images, source_size = [], None
    for index, value in enumerate(inputs):
        data, size = image_images._studio_png(value, f"输入图片 {index + 1}")
        source_size = source_size or size
        if req.model == "bfl/flux-3-image" and min(size) < 256:
            raise HTTPException(400, "FLUX 3 输入图片的宽高均需至少 256 像素")
        if req.model.startswith("byteplus/") and min(size) <= 14:
            raise HTTPException(400, "Seedream 输入图片的宽高均需大于 14 像素")
        if req.model.startswith("byteplus/") and len(data) > 10_000_000:
            raise HTTPException(400, "Seedream 单张输入图片不能超过 10 MB")
        images.append(base64.b64encode(data).decode("ascii"))
    options = image_defaults.router_image_options(req.model)
    size = req.image_size or options["image_sizes"][0]
    ratio = req.aspect_ratio or (f"{source_size[0]}:{source_size[1]}" if source_size else "1:1")
    prompt = req.prompt.strip()
    if len(images) > 1:
        prompt += "\n第一张图片是待编辑主图；后续图片仅作参考。"
    if req.model == "bfl/flux-3-image":
        return {
            "prompt": prompt,
            "resolution": size.lower(),
            "aspect_ratio": req.aspect_ratio or "auto",
            **({"images": images} if images else {}),
        }
    uris = ["data:image/png;base64," + value for value in images]
    if req.model.startswith("byteplus/"):
        width, height = _dimensions(ratio, size, area=True)
        return {
            "prompt": prompt,
            "size": f"{width}x{height}",
            "response_format": "b64_json",
            **({"image": uris} if uris else {}),
        }
    if req.model.startswith("openai/gpt-image-"):
        native_size = {"1:1": "1024x1024", "3:2": "1536x1024", "2:3": "1024x1536"}
        return {
            "prompt": prompt,
            "size": native_size.get(req.aspect_ratio, "auto"),
            "output_format": "png",
            "n": 1,
            **({"image": uris} if uris else {}),
        }
    raise HTTPException(400, "不支持的图片模型")


def _public_url(url):
    if not isinstance(url, str) or not _signed_url(url):
        raise ValueError("invalid image URL")
    addresses = socket.getaddrinfo(urlsplit(url).hostname, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
        raise ValueError("private image URL")


def download_result(url):
    """Download expiring output URLs without forwarding any Comfy credentials."""
    for _ in range(4):
        _public_url(url)
        with requests.get(
            url, stream=True, allow_redirects=False, timeout=(10, 60), **requests_proxy_kwargs()
        ) as response:
            if response.status_code in (301, 302, 303, 307, 308):
                url = urljoin(url, response.headers.get("Location", ""))
                continue
            response.raise_for_status()
            chunks, total = [], 0
            for chunk in response.iter_content(65536):
                total += len(chunk)
                if total > 64_000_000:
                    raise ValueError("image too large")
                chunks.append(chunk)
            return b"".join(chunks)
    raise ValueError("too many image redirects")


def parse_images(payload, job_id=""):
    try:
        if not isinstance(payload, dict) or payload.get("error"):
            raise ValueError("provider error")
        entries = []
        if "candidates" in payload:
            for candidate in payload["candidates"]:
                for part in candidate["content"]["parts"]:
                    if part.get("thought"):
                        continue
                    if part.get("inlineData", {}).get("data"):
                        entries.append({"b64_json": part["inlineData"]["data"]})
                    elif part.get("fileData", {}).get("fileUri"):
                        entries.append({"url": part["fileData"]["fileUri"]})
        elif "data" in payload:
            entries = payload["data"]
        elif payload.get("result", {}).get("sample"):
            if payload.get("status") != "Ready":
                raise ValueError("BFL result not ready")
            entries = [{"url": payload["result"]["sample"]}]
        if not isinstance(entries, list) or not 1 <= len(entries) <= 64:
            raise ValueError("no images")
        images, total = [], 0
        for entry in entries:
            encoded = entry.get("b64_json")
            if encoded:
                if not isinstance(encoded, str) or len(encoded) > 85_333_336:
                    raise ValueError("image too large")
                data = base64.b64decode(encoded, validate=True)
            else:
                data = download_result(entry["url"])
            total += len(data)
            if len(data) > 64_000_000 or total > 256_000_000:
                raise ValueError("images too large")
            with Image.open(io.BytesIO(data)) as image:
                mime = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}.get(
                    image.format
                )
                if not mime or getattr(image, "n_frames", 1) != 1:
                    raise ValueError("unsupported image")
                image.verify()
            images.append(
                {"image_base64": base64.b64encode(data).decode("ascii"), "media_type": mime}
            )
        return {**images[0], "images": images, "job_id": job_id}
    except (
        ValueError,
        KeyError,
        IndexError,
        TypeError,
        AttributeError,
        OSError,
        Image.DecompressionBombError,
        requests.RequestException,
    ) as error:
        raise HTTPException(502, "Comfy Router 返回图片无效或无法下载，请检查云端结果") from error
