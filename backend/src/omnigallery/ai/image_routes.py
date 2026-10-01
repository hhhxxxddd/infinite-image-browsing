from __future__ import annotations

import json
import os
import time
import uuid

from fastapi import Depends, FastAPI, HTTPException
from PIL import Image as PilImage
from PIL import UnidentifiedImageError

from omnigallery.ai import (
    image_configuration,
    image_defaults,
    image_providers,
    image_schemas,
    image_workflows,
)
from omnigallery.ai.models.qwen_instruct import (
    GenerateRequest,
    _runtime,
    parse_tags,
    prompt_for,
    readiness,
)
from omnigallery.ai.providers.comfy_cloud import check_connection
from omnigallery.infrastructure.database import Database
from omnigallery.library.media_types import is_image_file
from omnigallery.storage.settings_repository import SettingsRepository
from omnigallery.workspaces.artifacts import (
    SaveArtifact,
    _uuid,
    production_context,
    save_workspace_artifact,
)
from omnigallery.workspaces.tasks import StudioTasks, task_lock


def mount_image_ai_routes(
    app: FastAPI, api_base: str, verify_secret, write_permission_required, is_path_trusted
):
    def save_task_result(workspace_id, name, result, generation_info):
        formats = {"image/png": "png", "image/jpeg": "jpeg", "image/webp": "webp"}
        return save_workspace_artifact(
            SaveArtifact(
                workspace_id=workspace_id,
                name=name,
                format=formats[result["media_type"]],
                source=result.get("purpose", "image_edit").replace("image_", "ai_image_"),
                image_base64=result["image_base64"],
                generation_info=generation_info,
                document_id=result.get("document_id", ""),
                document_revision=result.get("document_revision", ""),
            ),
            source_image_base64=result.get("source_image_base64", ""),
            lineage=result.get("lineage", {}),
        )

    tasks = StudioTasks(
        Database.get_connection,
        save_task_result,
        image_configuration.public_creation_config()["concurrency"],
    )

    @app.get(api_base + "/image-ai/tasks", dependencies=[Depends(verify_secret)])
    def list_tasks(workspace_id: str):
        return tasks.list(_uuid(workspace_id))

    @app.post(
        api_base + "/image-ai/tasks",
        status_code=202,
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def submit_task(req: image_schemas.TaskRequest):
        workspace_id = _uuid(req.workspace_id)
        if bool(req.document_id) != bool(req.document_revision):
            raise HTTPException(422, "制作文件编号和版本必须同时提供")
        key, _ = image_configuration.comfy_cloud_key()
        if not key:
            raise HTTPException(503, "请先在 AI 接入中配置 Comfy API Key")
        if len(json.dumps(req.request)) > 80_000_000:
            raise HTTPException(413, "本次输入过大，请减少参考图或图片尺寸")
        from pydantic import ValidationError

        try:
            generation = req.purpose == "image_generation"
            if req.mode == "workflow":
                if generation:
                    source = image_schemas.StudioPresetGenerationRequest.model_validate(req.request)
                    if not source.prompt.strip():
                        raise HTTPException(400, "请填写提示词")
                    mapped, preset = image_workflows.prepare_generation_workflow(source)
                else:
                    source = image_schemas.StudioPresetEditRequest.model_validate(req.request)
                    mapped, preset = image_workflows.prepare_studio_workflow(source)
                    image_workflows._validate_studio_workflow(mapped)

                def run():
                    provider = (
                        image_providers._comfy_cloud_studio_generate
                        if generation
                        else image_providers._comfy_cloud_studio_edit
                    )
                    return provider(mapped, key)

                info = {
                    "source": "Comfy Cloud 工作流",
                    "workflow": preset["name"],
                    "workflow_id": source.workflow_id,
                    "parameters": source.parameter_values,
                    "references": len(mapped.reference_images),
                    "mask": bool(mapped.mask_base64),
                    "prompt": mapped.prompt,
                    "negative_prompt": mapped.negative_prompt,
                }
            else:
                schema = (
                    image_schemas.StudioRouterGenerationRequest
                    if generation
                    else image_schemas.StudioRouterEditRequest
                )
                source = schema.model_validate(req.request)
                image_workflows.validate_router_edit(source)

                def run():
                    return image_providers._comfy_router_studio_edit(source, source.model, key)

                info = {
                    "source": "Comfy Router",
                    "model": source.model,
                    "aspect_ratio": source.aspect_ratio,
                    "image_size": source.image_size,
                    "references": len(getattr(source, "reference_images_base64", [])),
                    "prompt": source.prompt,
                }
        except ValidationError as error:
            raise HTTPException(422, "AI 加工参数无效，请检查输入设置") from error
        with task_lock:
            raw = (
                Database.get_connection()
                .execute("SELECT setting_json FROM global_setting WHERE name='workbench_projects'")
                .fetchone()
            )
            if not raw or not any(
                item.get("id") == workspace_id for item in json.loads(raw[0]).get("items", [])
            ):
                raise HTTPException(404, "工作区不存在或已删除")
            production_name, lineage = production_context(
                Database.get_connection(), workspace_id, req.document_id
            )
            return tasks.submit(
                workspace_id,
                production_name or req.name,
                run,
                info,
                getattr(source, "image_base64", ""),
                origin={
                    "document_id": req.document_id,
                    "document_revision": req.document_revision,
                    "lineage": {} if generation else lineage,
                    "purpose": req.purpose,
                },
            )

    @app.get(api_base + "/image-ai/config", dependencies=[Depends(verify_secret)])
    def get_config():
        return image_configuration.public_config()

    @app.put(
        api_base + "/image-ai/config",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def put_config(req: image_schemas.ImageAIConfigRequest):
        return image_configuration.save_config(req)

    @app.patch(
        api_base + "/image-ai/config",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def patch_config(req: image_schemas.ImageAIConfigPatch):
        return image_configuration.patch_config(req)

    @app.get(api_base + "/image-ai/creation/config", dependencies=[Depends(verify_secret)])
    def get_creation_config():
        return image_configuration.public_creation_config()

    @app.put(
        api_base + "/image-ai/creation/config",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def put_creation_config(req: image_schemas.CreationConfigRequest):
        with task_lock:
            saved = image_configuration.save_creation_config(req)
            tasks.set_concurrency(saved["concurrency"])
            return saved

    @app.get(api_base + "/image-ai/studio/workflows", dependencies=[Depends(verify_secret)])
    def list_studio_workflows():
        return [
            image_workflows._workflow_summary(item) for item in image_workflows._studio_workflows()
        ]

    @app.get(
        api_base + "/image-ai/studio/workflows/{workflow_id}", dependencies=[Depends(verify_secret)]
    )
    def get_studio_workflow(workflow_id: str):
        item = next(
            (item for item in image_workflows._studio_workflows() if item["id"] == workflow_id),
            None,
        )
        if not item:
            raise HTTPException(404, detail="工作流不存在")
        return item

    @app.post(
        api_base + "/image-ai/studio/workflows",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def create_studio_workflow(req: image_schemas.StudioWorkflowPresetRequest):
        image_workflows._validate_workflow_preset(req)
        items = image_workflows._studio_workflows()
        if len(items) >= 30:
            raise HTTPException(400, detail="最多保存 30 个工作流")
        now = time.time()
        item = {
            "id": str(uuid.uuid4()),
            **req.model_dump(),
            "name": req.name.strip(),
            "created_at": now,
            "updated_at": now,
        }
        items.append(item)
        SettingsRepository.save_setting(
            Database.get_connection(),
            image_defaults.STUDIO_WORKFLOWS_KEY,
            json.dumps(items, ensure_ascii=False),
        )
        return item

    @app.put(
        api_base + "/image-ai/studio/workflows/{workflow_id}",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def update_studio_workflow(workflow_id: str, req: image_schemas.StudioWorkflowPresetRequest):
        image_workflows._validate_workflow_preset(req)
        items = image_workflows._studio_workflows()
        index = next((index for index, item in enumerate(items) if item["id"] == workflow_id), None)
        if index is None:
            raise HTTPException(404, detail="工作流不存在")
        items[index] = {
            **items[index],
            **req.model_dump(),
            "name": req.name.strip(),
            "updated_at": time.time(),
        }
        SettingsRepository.save_setting(
            Database.get_connection(),
            image_defaults.STUDIO_WORKFLOWS_KEY,
            json.dumps(items, ensure_ascii=False),
        )
        return items[index]

    @app.delete(
        api_base + "/image-ai/studio/workflows/{workflow_id}",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def delete_studio_workflow(workflow_id: str):
        items = image_workflows._studio_workflows()
        remaining = [item for item in items if item["id"] != workflow_id]
        if len(remaining) == len(items):
            raise HTTPException(404, detail="工作流不存在")
        SettingsRepository.save_setting(
            Database.get_connection(),
            image_defaults.STUDIO_WORKFLOWS_KEY,
            json.dumps(remaining, ensure_ascii=False),
        )
        return {"deleted": workflow_id}

    @app.get(api_base + "/image-ai/comfy/status", dependencies=[Depends(verify_secret)])
    def comfy_status():
        key, _ = image_configuration.comfy_cloud_key()
        if not key:
            return {"ready": False, "detail": "请先保存 Comfy API Key"}
        ready, detail = check_connection(key)
        return {"ready": ready, "detail": detail}

    @app.get(api_base + "/image-ai/comfy/models", dependencies=[Depends(verify_secret)])
    def get_comfy_models():
        key, _ = image_configuration.comfy_cloud_key()
        if not key:
            raise HTTPException(503, detail="请先保存 Comfy API Key")
        return image_providers.comfy_router_models(key)

    @app.post(api_base + "/image-ai/generate", dependencies=[Depends(verify_secret)])
    def generate(req: GenerateRequest):
        if req.path.startswith("workspace-artifact:"):
            from omnigallery.workspaces.artifacts import _file, _row

            path = str(
                _file(_row(Database.get_connection(), req.path.removeprefix("workspace-artifact:")))
            )
        else:
            path = os.path.realpath(req.path)
            if not is_path_trusted(path) or not is_image_file(path):
                raise HTTPException(403, detail="无权访问该图片")
        if not os.path.isfile(path):
            raise HTTPException(404, detail="图片不存在")
        if req.task == "tags" and not req.allowed_tags:
            return {"task": req.task, "text": "", "tags": []}
        config = image_configuration.load_config()
        template = (
            req.prompt_template
            if req.task in ("prompt", "description") and req.prompt_template
            else config["prompts"][req.task]
        )
        prompt = prompt_for(req.task, req.max_chars, req.allowed_tags, template)
        try:
            if config["provider"] == "local":
                state, detail = readiness()
                if state != "ready":
                    raise HTTPException(503, detail=detail)
                raw = _runtime.generate(
                    path, prompt, 384 if req.task == "prompt" else 256, system=True
                )
            elif config["provider"] == "comfy_cloud":
                key, _ = image_configuration.comfy_cloud_key()
                if not key:
                    raise HTTPException(503, detail="请先在 AI 接入中配置 Comfy API Key")
                raw = (
                    image_providers._comfy_cloud_workflow_generate(path, prompt, config, key)
                    if config["comfy_mode"] == "workflow"
                    else image_providers._comfy_cloud_generate(
                        path,
                        prompt,
                        config["comfy_model"],
                        key,
                        384 if req.task == "prompt" else 256,
                    )
                )
            else:
                key, _ = image_configuration.openrouter_key()
                if not key:
                    raise HTTPException(503, detail="请先在 AI 接入中配置 OpenRouter API Key")
                raw = image_providers._openrouter_generate(
                    path,
                    prompt,
                    config["openrouter_model"],
                    key,
                    384 if req.task == "prompt" else 256,
                )
        except HTTPException:
            raise
        except (
            OSError,
            ValueError,
            UnidentifiedImageError,
            PilImage.DecompressionBombError,
            PilImage.DecompressionBombWarning,
        ):
            raise HTTPException(400, detail="无法读取参考图片") from None
        except Exception as error:
            raise HTTPException(503, detail=f"图片内容处理失败：{error}") from error
        if req.task == "tags":
            return {"task": req.task, "text": raw, "tags": parse_tags(raw, req.allowed_tags)}
        return {
            "task": req.task,
            "text": raw.strip().strip('"').strip()[: req.max_chars],
            "tags": [],
        }
