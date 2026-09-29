from __future__ import annotations

import json
import math
from typing import Any

from fastapi import HTTPException

from omnigallery.ai import image_defaults, image_schemas
from omnigallery.infrastructure.database import Database
from omnigallery.storage.settings_repository import SettingsRepository


def _studio_workflows() -> list[dict]:
    value = SettingsRepository.get_setting(
        Database.get_connection(), image_defaults.STUDIO_WORKFLOWS_KEY
    )
    return value if isinstance(value, list) else []


def output_mappings(preset: dict) -> list[dict]:
    """An explicit list is authoritative, including an intentionally empty list."""
    mappings = preset.get("output_mappings")
    if mappings is not None:
        return mappings
    node_id = preset.get("output_node_id", "")
    return [{"node_id": node_id, "label": ""}] if node_id else []


def _workflow_mask_from_main_image(graph: dict, image_node_id: str) -> bool:
    """A LoadImage MASK output reads the inverse alpha of its uploaded PNG."""
    source = graph.get(image_node_id)
    if not isinstance(source, dict) or source.get("class_type") != "LoadImage":
        return False
    return any(
        isinstance(node, dict)
        and isinstance(node.get("inputs"), dict)
        and any(
            "mask" in name.lower() and value == [image_node_id, 1]
            for name, value in node["inputs"].items()
        )
        for node in graph.values()
    )


def _single_image_mask_nodes(graph: dict) -> list[dict]:
    return [
        node
        for node in graph.values()
        if node["class_type"] == "OpenAIGPTImageNodeV2"
        and isinstance(node["inputs"].get("model.mask"), list)
    ]


def _linked_image_count(node: dict) -> int:
    return sum(
        name.startswith("model.images.image_") and isinstance(value, list)
        for name, value in node["inputs"].items()
    )


def _workflow_mask_reference_limit(preset: dict) -> int:
    """Find how many reference slots remain usable when the mask is connected."""
    slots = preset["reference_slots"]
    if not preset.get("mask_enabled", True):
        return len(slots)
    for count in range(1, len(slots) + 1):
        graph = _studio_graph_for_run(preset, True, count)
        if any(_linked_image_count(node) != 1 for node in _single_image_mask_nodes(graph)):
            return count - 1
    return len(slots)


def _workflow_summary(item: dict) -> dict:
    summary = {
        key: item[key]
        for key in (
            "id",
            "name",
            "created_at",
            "updated_at",
            "image_node_id",
            "mask_node_id",
            "prompt_node_id",
            "output_node_id",
            "reference_slots",
        )
    }
    summary["negative_prompt_node_id"] = item.get("negative_prompt_node_id", "")
    summary["output_mappings"] = output_mappings(item)
    summary["purpose"] = item.get("purpose", "image_edit")
    summary["mask_from_image"] = _workflow_mask_from_main_image(
        item["workflow"], item["image_node_id"]
    )
    summary["mask_enabled"] = item.get("mask_enabled", True)
    summary["mask_reference_limit"] = _workflow_mask_reference_limit(item)
    summary["parameters"] = item.get("parameters", [])
    summary["parameter_defaults"] = {
        parameter["id"]: [
            item["workflow"][target["node_id"]]["inputs"][target["input"]]
            for target in parameter["targets"]
        ]
        for parameter in summary["parameters"]
    }
    return summary


def _parameter_value(value: Any, original: Any) -> str | int | float | bool:
    if isinstance(original, bool):
        if isinstance(value, bool):
            return value
        if isinstance(value, str) and value.lower() in ("true", "false"):
            return value.lower() == "true"
    elif isinstance(original, int):
        try:
            number = float(value)
            if not isinstance(value, bool) and math.isfinite(number) and number.is_integer():
                return int(number)
        except (TypeError, ValueError, OverflowError):
            pass
    elif isinstance(original, float):
        try:
            number = float(value)
            if not isinstance(value, bool) and math.isfinite(number):
                return number
        except (TypeError, ValueError, OverflowError):
            pass
    elif isinstance(original, str) and isinstance(value, str):
        return value
    raise HTTPException(400, detail="可调参数的值与节点输入类型不匹配")


def _validate_workflow_parameters(req: image_schemas.StudioWorkflowPresetRequest) -> None:
    ids: set[str] = set()
    mapped: set[tuple[str, str]] = set()
    for parameter in req.parameters:
        if not parameter.id.strip() or parameter.id in ids or not parameter.name.strip():
            raise HTTPException(400, detail="可调参数的名称和编号必须有效且唯一")
        ids.add(parameter.id)
        if parameter.number_display == "slider" and parameter.kind != "number":
            raise HTTPException(400, detail="滑块显示方式只能用于数值参数")
        if parameter.kind != "select" and len(parameter.targets) != 1:
            raise HTTPException(400, detail="数值、文本和开关参数只能映射一个节点字段")
        if parameter.kind == "select" and not parameter.options:
            raise HTTPException(400, detail="选项参数至少需要一个选项")
        if parameter.kind == "number":
            for value in (parameter.minimum, parameter.maximum, parameter.step):
                if value is not None and not math.isfinite(value):
                    raise HTTPException(400, detail="数值参数的范围必须是有限数字")
            if parameter.step is not None and parameter.step <= 0:
                raise HTTPException(400, detail="数值参数步长必须大于零")
            if (
                parameter.minimum is not None
                and parameter.maximum is not None
                and parameter.minimum > parameter.maximum
            ):
                raise HTTPException(400, detail="数值参数最小值不能大于最大值")
        for target in parameter.targets:
            field = (target.node_id, target.input)
            node = req.workflow.get(target.node_id)
            if field in mapped or not node or target.input not in node["inputs"]:
                raise HTTPException(400, detail="可调参数映射了重复或不存在的节点字段")
            mapped.add(field)
            original = node["inputs"][target.input]
            if not isinstance(original, (str, int, float, bool)):
                raise HTTPException(400, detail="可调参数只能映射未连接的文本、数值或开关字段")
            if parameter.kind == "number" and (
                isinstance(original, bool) or not isinstance(original, (int, float))
            ):
                raise HTTPException(400, detail="数值参数必须映射到数值字段")
            if parameter.kind == "text" and not isinstance(original, str):
                raise HTTPException(400, detail="文本参数必须映射到文本字段")
            if parameter.kind == "boolean" and not isinstance(original, bool):
                raise HTTPException(400, detail="开关参数必须映射到布尔字段")
        for option in parameter.options:
            if len(option.values) != len(parameter.targets) or not option.name.strip():
                raise HTTPException(400, detail="每个选项都需要为全部目标字段设置值和名称")
            for target, value in zip(parameter.targets, option.values, strict=False):
                _parameter_value(value, req.workflow[target.node_id]["inputs"][target.input])
    reserved = {
        (req.image_node_id, req.image_input),
        (req.prompt_node_id, req.prompt_input),
        (req.negative_prompt_node_id, req.negative_prompt_input),
        (req.mask_node_id, req.mask_input),
    }
    reserved.update((slot.node_id, slot.input) for slot in req.reference_slots)
    reserved.discard(("", ""))
    if mapped & reserved:
        raise HTTPException(400, detail="可调参数不能与主图、参考图、遮罩或提示词映射到同一字段")


def _apply_workflow_parameters(graph: dict, preset: dict, values: dict[str, Any]) -> None:
    parameters = {item["id"]: item for item in preset.get("parameters", [])}
    if len(values) > len(parameters) or any(
        parameter_id not in parameters for parameter_id in values
    ):
        raise HTTPException(400, detail="包含未配置的可调参数")
    for parameter_id, chosen in values.items():
        parameter = parameters[parameter_id]
        targets = parameter["targets"]
        if parameter["kind"] == "select":
            if (
                isinstance(chosen, bool)
                or not isinstance(chosen, int)
                or not 0 <= chosen < len(parameter["options"])
            ):
                raise HTTPException(400, detail=f"{parameter['name']}的选项无效")
            updates = parameter["options"][chosen]["values"]
        else:
            updates = [chosen]
        for target, value in zip(targets, updates, strict=False):
            node = graph.get(target["node_id"])
            if not node or target["input"] not in node["inputs"]:
                raise HTTPException(400, detail=f"{parameter['name']}映射的节点在本次运行中不可用")
            original = node["inputs"][target["input"]]
            converted = _parameter_value(value, original)
            if parameter["kind"] == "number":
                minimum, maximum = parameter.get("minimum"), parameter.get("maximum")
                if (
                    minimum is not None
                    and converted < minimum
                    or maximum is not None
                    and converted > maximum
                ):
                    raise HTTPException(400, detail=f"{parameter['name']}超出允许范围")
            node["inputs"][target["input"]] = converted


def _studio_graph_for_run(preset: dict, use_mask: bool, reference_count: int) -> dict:
    """Create a run-specific graph without disabled image links; never modify the saved preset."""
    graph = json.loads(json.dumps(preset["workflow"]))
    excluded: set[str] = {slot["node_id"] for slot in preset["reference_slots"][reference_count:]}
    if not use_mask and preset.get("mask_node_id"):
        excluded.add(preset["mask_node_id"])
    for node in graph.values():
        for name, value in list(node["inputs"].items()):
            if not isinstance(value, list) or len(value) != 2:
                continue
            source = str(value[0])
            if source in excluded or (
                not use_mask
                and source == preset["image_node_id"]
                and value[1] == 1
                and "mask" in name.lower()
            ):
                del node["inputs"][name]
    for node_id in excluded:
        graph.pop(node_id, None)
    return graph


def _validate_workflow_preset(req: image_schemas.StudioWorkflowPresetRequest) -> None:
    if not req.name.strip():
        raise HTTPException(400, detail="请填写工作流名称")
    if (
        not req.workflow
        or len(req.workflow) > 256
        or len(json.dumps(req.workflow, ensure_ascii=False)) > 1_000_000
    ):
        raise HTTPException(400, detail="请导入不超过 1 MB 的 API 格式工作流")
    if any(
        not isinstance(node, dict)
        or not isinstance(node.get("class_type"), str)
        or not isinstance(node.get("inputs"), dict)
        for node in req.workflow.values()
    ):
        raise HTTPException(400, detail="工作流节点需要 class_type 和 inputs")
    _validate_workflow_parameters(req)
    if req.purpose == "image_generation":
        _validate_studio_workflow(
            _generation_mapping(req.model_dump(), "校验"),
            require_output=False,
            require_image=False,
        )
        return
    if req.purpose != "image_edit":
        return
    if bool(req.image_node_id) != bool(req.image_input):
        raise HTTPException(400, detail="主图节点和字段需要同时设置")
    if bool(req.prompt_node_id) != bool(req.prompt_input):
        raise HTTPException(400, detail="正向提示词节点和字段需要同时设置")
    if bool(req.mask_node_id) != bool(req.mask_input):
        raise HTTPException(400, detail="遮罩节点和字段需要同时设置")
    if bool(req.negative_prompt_node_id) != bool(req.negative_prompt_input):
        raise HTTPException(400, detail="负向提示词节点和字段需要同时设置")
    if any(not slot.node_id or not slot.input for slot in req.reference_slots):
        raise HTTPException(400, detail="请设置每张参考图的节点和字段")
    sample = req.model_dump()
    variants = [(False, len(req.reference_slots))]
    if req.mask_enabled and (
        req.mask_node_id or _workflow_mask_from_main_image(req.workflow, req.image_node_id)
    ):
        variants.append((True, 0))
    for use_mask, reference_count in variants:
        graph = _studio_graph_for_run(sample, use_mask, reference_count)
        _validate_studio_workflow(
            image_schemas.StudioEditRequest(
                image_base64="",
                mask_base64="x" if use_mask else None,
                prompt="校验",
                workflow=graph,
                image_node_id=req.image_node_id,
                image_input=req.image_input,
                mask_node_id=req.mask_node_id if use_mask else "",
                mask_input=req.mask_input if use_mask else "",
                prompt_node_id=req.prompt_node_id,
                prompt_input=req.prompt_input,
                negative_prompt_node_id=req.negative_prompt_node_id,
                negative_prompt_input=req.negative_prompt_input,
                output_node_id=req.output_node_id,
                output_mappings=req.output_mappings,
                reference_images=[
                    image_schemas.StudioReferenceImage(
                        image_base64="", node_id=slot.node_id, input=slot.input
                    )
                    for slot in req.reference_slots[:reference_count]
                ],
            ),
            require_output=False,
        )


def _validate_studio_workflow(
    req: image_schemas.StudioEditRequest, *, require_output: bool = True, require_image: bool = True
) -> dict:
    graph = req.workflow
    if not graph or len(graph) > 256 or len(json.dumps(graph, ensure_ascii=False)) > 1_000_000:
        raise HTTPException(400, detail="请导入不超过 1 MB 的 API 格式工作流")
    if any(
        not isinstance(node, dict)
        or not isinstance(node.get("class_type"), str)
        or not isinstance(node.get("inputs"), dict)
        for node in graph.values()
    ):
        raise HTTPException(400, detail="工作流节点需要 class_type 和 inputs")
    if require_image and (not req.image_node_id or not req.image_input):
        raise HTTPException(400, detail="请设置主图输入节点和字段")
    if not require_image:
        if any(node["class_type"] in ("LoadImage", "LoadImageMask") for node in graph.values()):
            raise HTTPException(400, detail="纯文字生图工作流不能包含图片或遮罩输入节点")
        if require_output and not req.prompt_node_id:
            raise HTTPException(400, detail="运行前请设置生图提示词输入")
    if bool(req.prompt_node_id) != bool(req.prompt_input):
        raise HTTPException(400, detail="正向提示词节点和字段需要同时设置")
    outputs = output_mappings(req.model_dump())
    if require_output and not outputs:
        raise HTTPException(400, detail="运行前请设置图片结果节点")
    output_ids = [item["node_id"] for item in outputs]
    if len(set(output_ids)) != len(output_ids):
        raise HTTPException(
            400, detail="图片结果节点不能重复映射；一个节点返回的多张图片会自动全部保存"
        )
    mappings = [(req.image_node_id, req.image_input)] if require_image else []
    if req.prompt_node_id:
        mappings.append((req.prompt_node_id, req.prompt_input))
    if req.negative_prompt_node_id or req.negative_prompt_input:
        mappings.append((req.negative_prompt_node_id, req.negative_prompt_input))
    if req.mask_node_id or req.mask_input:
        mappings.append((req.mask_node_id, req.mask_input))
    mappings.extend((reference.node_id, reference.input) for reference in req.reference_images)
    if len(set(mappings)) != len(mappings):
        raise HTTPException(400, detail="图片、参考图、遮罩和提示词不能映射到同一个输入字段")
    if any(node_id not in graph for node_id in output_ids) or any(
        node_id not in graph or input_name not in graph[node_id]["inputs"]
        for node_id, input_name in mappings
    ):
        raise HTTPException(400, detail="图片、参考图、遮罩、提示词或输出节点映射无效")
    if req.negative_prompt_node_id and not isinstance(
        graph[req.negative_prompt_node_id]["inputs"][req.negative_prompt_input], str
    ):
        raise HTTPException(400, detail="负向提示词必须映射到文本输入字段")
    if not require_image:
        if req.prompt_node_id and not isinstance(
            graph[req.prompt_node_id]["inputs"][req.prompt_input], str
        ):
            raise HTTPException(400, detail="生图提示词必须映射到文本输入字段")
        return json.loads(json.dumps(graph))
    mask_from_image = _workflow_mask_from_main_image(graph, req.image_node_id)
    if mask_from_image and (req.mask_node_id or req.mask_input):
        raise HTTPException(400, detail="主图节点已输出遮罩，无需再映射独立遮罩节点")
    if mask_from_image or req.mask_node_id or req.mask_input:
        if not req.mask_base64:
            raise HTTPException(400, detail="当前工作流需要遮罩 PNG")
    elif req.mask_base64:
        raise HTTPException(400, detail="当前工作流没有连接遮罩输入")
    if req.mask_node_id and (
        graph.get(req.mask_node_id, {}).get("class_type") != "LoadImageMask"
        or req.mask_input != "image"
    ):
        raise HTTPException(400, detail="独立遮罩只能映射到 LoadImageMask 的 image 字段")
    if req.mask_node_id and graph[req.mask_node_id]["inputs"].get("channel") not in (
        "alpha",
        "red",
        "green",
        "blue",
    ):
        raise HTTPException(400, detail="LoadImageMask 需要有效的 channel 字段")
    if mask_from_image and req.image_input != "image":
        raise HTTPException(400, detail="主图 Alpha 遮罩必须映射到 LoadImage 的 image 字段")
    for node in _single_image_mask_nodes(graph):
        mask_link = node["inputs"]["model.mask"]
        mask_source = (
            graph.get(mask_link[0]) if mask_link and isinstance(mask_link[0], str) else None
        )
        if (
            isinstance(mask_source, dict)
            and mask_source["class_type"] == "ImageToMask"
            and "image" not in mask_source["inputs"]
        ):
            raise HTTPException(
                400,
                detail="ImageToMask 缺少图片输入；可将 LoadImage 的 MASK 输出直接连接到 model.mask",
            )
        if _linked_image_count(node) != 1:
            raise HTTPException(400, detail="当前工作流使用遮罩时只能连接一张输入图")
    return json.loads(json.dumps(graph))


def prepare_studio_workflow(req: image_schemas.StudioPresetEditRequest):
    preset = next((item for item in _studio_workflows() if item["id"] == req.workflow_id), None)
    if not preset:
        raise HTTPException(404, detail="工作流不存在或已删除")
    if preset.get("purpose", "image_edit") != "image_edit":
        raise HTTPException(400, detail="请选择图片编辑工作流")
    if not output_mappings(preset):
        raise HTTPException(400, detail="运行前请在工作流管理中设置图片结果节点")
    slots = preset["reference_slots"]
    if len(req.reference_images_base64) > len(slots):
        raise HTTPException(400, detail=f"当前工作流最多接收 {len(slots)} 张参考图")
    mask_from_image = _workflow_mask_from_main_image(preset["workflow"], preset["image_node_id"])
    if req.mask_base64 and not (
        preset.get("mask_enabled", True) and (preset["mask_node_id"] or mask_from_image)
    ):
        raise HTTPException(400, detail="当前工作流没有遮罩输入位")
    reference_images = (
        req.reference_images_base64[: _workflow_mask_reference_limit(preset)]
        if req.mask_base64
        else req.reference_images_base64
    )
    graph = _studio_graph_for_run(preset, bool(req.mask_base64), len(reference_images))
    _apply_workflow_parameters(graph, preset, req.parameter_values)
    mapped = image_schemas.StudioEditRequest(
        image_base64=req.image_base64,
        mask_base64=req.mask_base64,
        prompt=req.prompt,
        negative_prompt=req.negative_prompt,
        workflow=graph,
        image_node_id=preset["image_node_id"],
        image_input=preset["image_input"],
        mask_node_id=preset["mask_node_id"] if req.mask_base64 else "",
        mask_input=preset["mask_input"] if req.mask_base64 else "",
        prompt_node_id=preset["prompt_node_id"],
        prompt_input=preset["prompt_input"],
        negative_prompt_node_id=preset.get("negative_prompt_node_id", ""),
        negative_prompt_input=preset.get("negative_prompt_input", ""),
        output_node_id=preset["output_node_id"],
        output_mappings=output_mappings(preset),
        reference_images=[
            image_schemas.StudioReferenceImage(
                image_base64=media, node_id=slots[index]["node_id"], input=slots[index]["input"]
            )
            for index, media in enumerate(reference_images)
        ],
    )
    return mapped, preset


def _generation_mapping(preset: dict, prompt: str, negative_prompt: str = ""):
    return image_schemas.StudioEditRequest(
        image_base64="",
        image_node_id="",
        image_input="",
        workflow=preset["workflow"],
        prompt=prompt,
        negative_prompt=negative_prompt,
        prompt_node_id=preset.get("prompt_node_id", ""),
        prompt_input=preset.get("prompt_input", ""),
        negative_prompt_node_id=preset.get("negative_prompt_node_id", ""),
        negative_prompt_input=preset.get("negative_prompt_input", ""),
        output_node_id=preset.get("output_node_id", ""),
        output_mappings=output_mappings(preset),
    )


def prepare_generation_workflow(req: image_schemas.StudioPresetGenerationRequest):
    preset = next((item for item in _studio_workflows() if item["id"] == req.workflow_id), None)
    if not preset:
        raise HTTPException(404, detail="工作流不存在或已删除")
    if preset.get("purpose") != "image_generation":
        raise HTTPException(400, detail="请选择图片生成工作流")
    mapped = _generation_mapping(preset, req.prompt, req.negative_prompt)
    mapped.workflow = _validate_studio_workflow(mapped, require_image=False)
    _apply_workflow_parameters(mapped.workflow, preset, req.parameter_values)
    _validate_studio_workflow(mapped, require_image=False)
    return mapped, preset


def validate_router_edit(
    req: image_schemas.StudioRouterEditRequest | image_schemas.StudioRouterGenerationRequest,
):
    if not req.prompt.strip():
        raise HTTPException(400, detail="请填写提示词")
    if req.model not in image_defaults.CREATION_MODELS:
        raise HTTPException(400, detail="请选择支持的 Comfy Router 图像模型")
    allowed_ratios = image_defaults.ROUTER_IMAGE_RATIOS | (
        image_defaults.ROUTER_FLASH_EXTRA_RATIOS
        if req.model == "vertexai/gemini-3.1-flash-image"
        else set()
    )
    if req.aspect_ratio is not None and req.aspect_ratio not in allowed_ratios:
        raise HTTPException(400, detail="该模型不支持所选输出比例")
    if req.image_size is not None and (
        req.model not in image_defaults.ROUTER_RESIZABLE_MODELS
        or req.image_size not in ("1K", "2K", "4K")
    ):
        raise HTTPException(400, detail="该模型不支持所选输出分辨率")
    if (
        req.model == "vertexai/gemini-2.5-flash-image"
        and len(getattr(req, "reference_images_base64", [])) > 2
    ):
        raise HTTPException(400, detail="Gemini 2.5 Flash Image 最多使用 2 张参考图")
