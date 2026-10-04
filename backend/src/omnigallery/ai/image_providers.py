from __future__ import annotations

import base64
import json
import uuid

import requests
from fastapi import HTTPException

from omnigallery.ai import (
    image_defaults,
    image_images,
    image_schemas,
    image_workflows,
)
from omnigallery.ai.providers.comfy_cloud import ComfyCloudV2
from omnigallery.infrastructure.network_proxy import requests_proxy_kwargs


def _comfy_get(url: str, **kwargs):
    return requests.get(url, **kwargs, **requests_proxy_kwargs())


def _comfy_post(url: str, **kwargs):
    return requests.post(url, **kwargs, **requests_proxy_kwargs())


def comfy_router_models(key: str) -> dict:
    """Read the live Router catalog; only expose models whose native schema we implement."""
    found: set[str] = set()
    cursor = None
    try:
        for _ in range(10):
            params = {"limit": 100}
            if cursor:
                params["cursor"] = cursor
            response = _comfy_get(
                image_defaults.COMFY_ROUTER_URL,
                headers={"X-API-Key": key},
                params=params,
                timeout=(5, 20),
            )
            if response.status_code != 200:
                raise HTTPException(
                    502, detail=f"Comfy Router 模型列表返回 HTTP {response.status_code}"
                )
            page = response.json()
            if not isinstance(page.get("data"), list):
                raise HTTPException(502, detail="Comfy Router 模型列表格式不符合预期")
            found.update(
                item.get("id")
                for item in page["data"]
                if isinstance(item, dict) and isinstance(item.get("id"), str)
            )
            if not page.get("has_more"):
                break
            next_cursor = page.get("next_cursor")
            if not isinstance(next_cursor, str) or not next_cursor or next_cursor == cursor:
                raise HTTPException(502, detail="Comfy Router 模型列表分页格式无效")
            cursor = next_cursor
        else:
            raise HTTPException(502, detail="Comfy Router 模型列表分页过多")
    except requests.exceptions.JSONDecodeError as error:
        raise HTTPException(502, detail="Comfy Router 返回的模型列表不是有效 JSON") from error
    except requests.exceptions.Timeout as error:
        raise HTTPException(
            504, detail="查询 Comfy Router 模型列表超时；请检查通用设置中的网络代理或后端网络"
        ) from error
    except requests.RequestException as error:
        raise HTTPException(502, detail="无法连接 Comfy Router 模型列表") from error
    except (ValueError, TypeError, AttributeError) as error:
        raise HTTPException(502, detail="Comfy Router 模型列表格式不符合预期") from error
    return {
        "vision": [
            {"id": model, "label": label}
            for model, label in image_defaults.ROUTER_VISION_MODEL_LABELS.items()
            if model in found
        ],
        "creation": [
            {"id": model, "label": label}
            for model, label in image_defaults.ROUTER_CREATION_MODEL_LABELS.items()
            if model in found
        ],
    }


def _comfy_cloud_generate(path: str, prompt: str, model: str, key: str, max_tokens: int) -> str:
    # Comfy Router uses each model's native request/response format.
    encoded_image = image_images._image_jpeg_base64(path)
    payload = {
        "systemInstruction": {"parts": [{"text": prompt}]},
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": "Follow the instruction for this image."},
                    {
                        "inlineData": {
                            "mimeType": "image/jpeg",
                            "data": encoded_image,
                        }
                    },
                ],
            }
        ],
        "generationConfig": {
            "maxOutputTokens": max(1024, max_tokens),
            "responseModalities": ["TEXT"],
        },
    }
    if model.startswith("openai/"):
        payload = {
            "instructions": prompt,
            "input": [
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": "Follow the instruction for this image."},
                        {
                            "type": "input_image",
                            "image_url": "data:image/jpeg;base64," + encoded_image,
                        },
                    ],
                }
            ],
            "max_output_tokens": max(4096, max_tokens),
            "store": False,
        }
    try:
        response = _comfy_post(
            f"{image_defaults.COMFY_ROUTER_URL}/{model}",
            headers={"X-API-Key": key, "Idempotency-Key": str(uuid.uuid4())},
            json=payload,
            timeout=(10, 240),
        )
    except requests.RequestException as error:
        raise HTTPException(
            502, detail="无法连接 Comfy Router；若请求已提交，请先检查 Comfy 账单记录再重试"
        ) from error
    if response.status_code != 200:
        hints = {
            401: "API Key 无效",
            402: "额度不足",
            403: "当前账号无权调用该模型",
            429: "请求过于频繁",
        }
        raise HTTPException(
            502,
            detail=f"Comfy Router 返回 HTTP {response.status_code}：{hints.get(response.status_code, '请检查模型与网络')}",
        )
    try:
        body = response.json()
        if model.startswith("openai/"):
            if body.get("status") != "completed" or body.get("error"):
                raise ValueError("incomplete response")
            result = "".join(
                part.get("text", "")
                for item in body.get("output", [])
                if item.get("type") == "message"
                for part in item.get("content", [])
                if part.get("type") == "output_text"
            )
        else:
            parts = body["candidates"][0]["content"]["parts"]
            result = "".join(
                part.get("text", "")
                for part in parts
                if isinstance(part, dict) and not part.get("thought")
            )
        if not result.strip():
            raise ValueError("empty completion")
        return result.strip()
    except (ValueError, KeyError, IndexError, TypeError, AttributeError) as error:
        raise HTTPException(
            502, detail="Comfy Router 未返回可用文本；请检查模型响应或内容限制"
        ) from error


def _comfy_cloud_workflow_generate(path: str, prompt: str, config: dict, key: str) -> str:
    graph = json.loads(json.dumps(config["comfy_workflow"]))
    graph[config["comfy_prompt_node_id"]]["inputs"][config["comfy_prompt_input"]] = prompt
    cloud = ComfyCloudV2(key)
    try:
        graph[config["comfy_image_node_id"]]["inputs"][config["comfy_image_input"]] = cloud.upload(
            image_images._image_jpeg_bytes(path), "reference.jpg", "image/jpeg"
        )
        job = cloud.wait(cloud.submit(graph))
        result = cloud.download_text(cloud.output(job, config["comfy_output_node_id"], "text"))
        if result:
            return result
    except requests.RequestException as error:
        raise HTTPException(
            502, detail="无法连接 Comfy Cloud；若任务已提交，请先检查云端任务再重试"
        ) from error
    raise HTTPException(502, detail="工作流没有返回可读文本；请指定保存文本的输出节点")


def _comfy_cloud_studio_edit(req: image_schemas.StudioEditRequest, key: str) -> dict:
    return _comfy_cloud_studio_run(req, key)


def _comfy_cloud_studio_generate(req: image_schemas.StudioEditRequest, key: str) -> dict:
    return _comfy_cloud_studio_run(req, key, generation=True)


def prepare_cloud_studio(req, cloud, *, generation=False):
    graph = image_workflows._validate_studio_workflow(req, require_image=not generation)
    image_bytes, image_size = (
        (None, None) if generation else image_images._studio_png(req.image_base64, "合成图")
    )
    mask_bytes = None
    if req.mask_base64:
        mask_bytes, mask_size = image_images._studio_png(req.mask_base64, "遮罩")
        if mask_size != image_size:
            raise HTTPException(400, detail="遮罩尺寸必须与合成图一致")
    mask_from_image = image_workflows._workflow_mask_from_main_image(graph, req.image_node_id)
    if mask_from_image and mask_bytes:
        image_bytes = image_images._studio_image_with_alpha_mask(image_bytes, mask_bytes)
    references = [
        image_images._studio_png(reference.image_base64, f"参考图 {index}")[0]
        for index, reference in enumerate(req.reference_images, 1)
    ]
    if image_bytes:
        graph[req.image_node_id]["inputs"][req.image_input] = cloud.upload(
            image_bytes, "studio-source.png", "image/png"
        )
    if req.prompt_node_id:
        graph[req.prompt_node_id]["inputs"][req.prompt_input] = req.prompt.strip()
    if req.negative_prompt_node_id:
        graph[req.negative_prompt_node_id]["inputs"][req.negative_prompt_input] = (
            req.negative_prompt.strip()
        )
    if req.mask_node_id and mask_bytes:
        mask_upload_bytes = (
            image_images._studio_image_with_alpha_mask(mask_bytes, mask_bytes)
            if graph[req.mask_node_id]["inputs"]["channel"] == "alpha"
            else mask_bytes
        )
        graph[req.mask_node_id]["inputs"][req.mask_input] = cloud.upload(
            mask_upload_bytes, "studio-mask.png", "image/png"
        )
    for index, (reference, data) in enumerate(
        zip(req.reference_images, references, strict=False), 1
    ):
        graph[reference.node_id]["inputs"][reference.input] = cloud.upload(
            data, f"studio-reference-{index}.png", "image/png"
        )
    return graph


def collect_cloud_studio(req, cloud, job):
    images, total_bytes = [], 0
    for mapping in image_workflows.output_mappings(req.model_dump()):
        try:
            outputs = cloud.outputs(job, mapping["node_id"], "image")
        except HTTPException as error:
            label = mapping["label"].strip() or f"节点 {mapping['node_id']}"
            raise HTTPException(
                502, detail=f"图片结果“{label}”未返回图片；请检查结果映射"
            ) from error
        for output in outputs:
            if len(images) >= 64:
                raise HTTPException(502, detail="本次返回超过 64 张图片，请减少输出数量")
            data, mime = cloud.download_image(output)
            total_bytes += len(data)
            if total_bytes > 256_000_000:
                raise HTTPException(502, detail="本次输出图片总计超过 256 MB，请减少输出数量")
            images.append(
                {
                    "image_base64": base64.b64encode(data).decode("ascii"),
                    "media_type": mime,
                    "output_node_id": mapping["node_id"],
                    "output_label": mapping["label"].strip(),
                }
            )
    return {**images[0], "images": images, "job_id": job["id"]}


def _comfy_cloud_studio_run(req, key, *, generation=False):
    cloud = ComfyCloudV2(key)
    try:
        graph = prepare_cloud_studio(req, cloud, generation=generation)
        return collect_cloud_studio(req, cloud, cloud.wait(cloud.submit(graph)))
    except requests.RequestException as error:
        raise HTTPException(
            502, detail="无法连接 Comfy Cloud；若任务已提交，请先检查云端任务再重试"
        ) from error


def router_studio_payload(req):
    if not req.model.startswith("vertexai/"):
        from omnigallery.ai.router_images import native_payload

        return native_payload(req)
    image_bytes = (
        image_images._studio_png(req.image_base64, "合成图")[0]
        if isinstance(req, image_schemas.StudioRouterEditRequest)
        else None
    )
    references = [
        image_images._studio_png(value, f"参考图 {index}")[0]
        for index, value in enumerate(getattr(req, "reference_images_base64", []), 1)
    ]
    image_config = {}
    if req.aspect_ratio:
        image_config["aspectRatio"] = req.aspect_ratio
    if req.image_size:
        image_config["imageSize"] = req.image_size
    parts = [
        {
            "text": req.prompt.strip()
            + ("\n第一张图片是待编辑主图；后续图片仅作参考。" if references else "")
        },
    ]
    if image_bytes:
        parts.append(
            {
                "inlineData": {
                    "mimeType": "image/png",
                    "data": base64.b64encode(image_bytes).decode("ascii"),
                }
            }
        )
    for index, data in enumerate(references, 1):
        parts.extend(
            (
                {"text": f"参考图 {index}"},
                {
                    "inlineData": {
                        "mimeType": "image/png",
                        "data": base64.b64encode(data).decode("ascii"),
                    }
                },
            )
        )
    return {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            **({"imageConfig": image_config} if image_config else {}),
        },
    }


def parse_router_studio_result(payload, job_id=""):
    from omnigallery.ai.router_images import parse_images

    return parse_images(payload, job_id)


def _comfy_router_studio_edit(req, model, key):
    payload = router_studio_payload(req)
    try:
        response = _comfy_post(
            f"{image_defaults.COMFY_ROUTER_URL}/{model}",
            headers={"X-API-Key": key, "Idempotency-Key": str(uuid.uuid4())},
            json=payload,
            timeout=(10, 600),
        )
    except requests.RequestException as error:
        raise HTTPException(
            502, detail="无法连接 Comfy Router；若任务已提交，请先检查云端任务再重试"
        ) from error
    if response.status_code != 200:
        hints = {
            401: "API Key 无效",
            402: "额度不足",
            403: "当前账号无权调用该模型",
            413: "输入图片过大",
            422: "模型不接受当前输入",
            429: "请求过于频繁",
        }
        raise HTTPException(
            502,
            detail=f"Comfy Router 返回 HTTP {response.status_code}：{hints.get(response.status_code, '请检查模型与网络')}",
        )
    try:
        payload = response.json()
    except ValueError as error:
        raise HTTPException(502, detail="Comfy Router 返回了无法解析的图片") from error
    return parse_router_studio_result(payload, response.headers.get("X-Comfy-Request-Id", ""))
