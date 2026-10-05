from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Response
from pydantic import BaseModel, Field

from omnigallery.image_editing import assets as editor_assets
from omnigallery.image_editing import cutout, erase, upscale
from omnigallery.image_editing import history as image_edit_history
from omnigallery.image_editing.service import edit_image_copy
from omnigallery.infrastructure.auth import verify_secret, write_permission_required
from omnigallery.infrastructure.route_context import RouteContext
from omnigallery.library.file_info import get_file_info_by_path
from omnigallery.library.indexing import (
    add_image_data_single,
    inherit_edited_image_data,
    refresh_overwritten_image_data,
)


class ImageCropRect(BaseModel):
    x: float
    y: float
    width: float
    height: float


class EditorAssetRequest(BaseModel):
    png_base64: str = Field(max_length=(editor_assets.MAX_BYTES + 2) // 3 * 4)


class ImageEditRequest(BaseModel):
    path: str
    crop: ImageCropRect
    width: int
    height: int
    overwrite: bool = False
    rendered_base64: str | None = None
    editor_document: dict | None = None
    export_area: Literal["content", "canvas"] = "content"
    parent_revision: str | None = None
    copy_name: str | None = None


def mount_routes(app: FastAPI, context: RouteContext):
    check_path_trust = context.check_path_trust
    api_base = context.api_base

    @app.get(api_base + "/image-cutout/config", dependencies=[Depends(verify_secret)])
    def cutout_config():
        _, _, name = cutout.workflow()
        return {
            "ready": bool(cutout.comfy_cloud_key()[0]),
            "workflow_name": name,
            "defaults": cutout.builtin_tools.cutout_defaults(),
        }

    @app.get(api_base + "/image-upscale/config", dependencies=[Depends(verify_secret)])
    def upscale_config():
        return {
            "ready": bool(cutout.comfy_cloud_key()[0]),
            "workflow_name": upscale.workflow()[2],
            "defaults": cutout.builtin_tools.upscale_defaults(),
        }

    @app.get(api_base + "/image-erase/config", dependencies=[Depends(verify_secret)])
    def erase_config():
        return {
            "ready": bool(cutout.comfy_cloud_key()[0]),
            "workflow_name": erase.workflow()[2],
            "defaults": cutout.builtin_tools.erase_defaults(),
            "factory_defaults": cutout.builtin_tools.EraseDefaults().model_dump(),
        }

    @app.post(
        api_base + "/image-erase/tasks",
        status_code=202,
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def start_erase(req: erase.EraseRequest):
        try:
            return cutout.submit(req)
        except (ValueError, OSError) as error:
            raise HTTPException(400, str(error)) from error

    @app.get(api_base + "/image-ai-tools/tasks", dependencies=[Depends(verify_secret)])
    @app.get(api_base + "/image-cutout/tasks", dependencies=[Depends(verify_secret)])
    def cutout_tasks(document_key: str):
        return {"items": cutout.list_jobs(document_key)}

    @app.delete(
        api_base + "/image-ai-tools/tasks/{job_id}",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    @app.delete(
        api_base + "/image-cutout/tasks/{job_id}",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def delete_image_tool_task(job_id: str, document_key: str):
        try:
            return cutout.delete_job(document_key, job_id)
        except ValueError as error:
            raise HTTPException(400, "AI 图片任务编号无效") from error

    @app.post(
        api_base + "/image-cutout/tasks",
        status_code=202,
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def start_cutout(req: cutout.CutoutRequest):
        try:
            return cutout.submit(req)
        except (ValueError, OSError) as error:
            raise HTTPException(400, str(error)) from error

    @app.post(
        api_base + "/image-upscale/tasks",
        status_code=202,
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def start_upscale(req: upscale.UpscaleRequest):
        try:
            return cutout.submit(req)
        except (ValueError, OSError) as error:
            raise HTTPException(400, str(error)) from error

    @app.post(
        api_base + "/image-ai-tools/tasks/{job_id}/{action}",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    @app.post(
        api_base + "/image-cutout/tasks/{job_id}/{action}",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def finish_cutout(
        job_id: str, action: Literal["cancel", "handled", "accept"], document_key: str
    ):
        try:
            return cutout.finish_job(document_key, job_id, action)
        except ValueError as error:
            raise HTTPException(400, "AI 图片任务编号无效") from error

    @app.post(
        api_base + "/image-editor-assets",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def save_editor_asset(req: EditorAssetRequest):
        try:
            return editor_assets.save_png(req.png_base64)
        except (ValueError, OSError) as error:
            raise HTTPException(400, str(error)) from error

    @app.get(api_base + "/image-editor-assets/{asset_id}", dependencies=[Depends(verify_secret)])
    def get_editor_asset(asset_id: str):
        try:
            return Response(editor_assets.read_png(asset_id), media_type="image/png")
        except (ValueError, OSError) as error:
            raise HTTPException(404, "合成素材不可用") from error

    @app.get(api_base + "/image_edit_history", dependencies=[Depends(verify_secret)])
    def get_image_edit_history(path: str, revision: str | None = None):
        check_path_trust(path)
        try:
            with image_edit_history.history_lock:
                record = image_edit_history.resolve_revision(path, revision)
                if record:
                    for asset_id in record["assets"]:
                        if not image_edit_history.snapshot_path(record, asset_id).is_file():
                            raise ValueError("素材快照缺失，请从备份恢复编辑数据目录")
                return {
                    "record": image_edit_history.public_record(record, path) if record else None,
                    "revision": image_edit_history.digest_file(path),
                }
        except (OSError, ValueError, KeyError) as error:
            raise HTTPException(400, "无法读取编辑记录：" + str(error)) from error

    @app.get(api_base + "/image_edit_asset", dependencies=[Depends(verify_secret)])
    def get_image_edit_asset(path: str, revision: str, asset: str):
        check_path_trust(path)
        try:
            with image_edit_history.history_lock:
                record = image_edit_history.resolve_revision(path, revision)
                snapshot = image_edit_history.snapshot_path(record, asset)
                return Response(
                    snapshot.read_bytes(), media_type=record["assets"][asset]["media_type"]
                )
        except (OSError, ValueError, KeyError) as error:
            raise HTTPException(404, "编辑素材快照不可用") from error

    @app.post(
        api_base + "/edit_image",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def save_edited_image(req: ImageEditRequest):
        check_path_trust(req.path)
        try:
            if req.editor_document is not None and req.rendered_base64 is None:
                raise ValueError("编辑文档必须与合成图片一起保存")
            if req.editor_document is not None and req.overwrite and not req.parent_revision:
                raise ValueError("缺少原图版本，请重新打开图片")
            if req.editor_document is not None:
                destination = image_edit_history.save_edit(
                    req.path,
                    req.editor_document,
                    req.export_area,
                    check_path_trust,
                    req.parent_revision,
                    crop=req.crop.model_dump(),
                    target_width=req.width,
                    target_height=req.height,
                    overwrite=req.overwrite,
                    rendered_base64=req.rendered_base64,
                    copy_name=req.copy_name,
                )
            else:
                destination = edit_image_copy(
                    req.path,
                    req.crop.model_dump(),
                    req.width,
                    req.height,
                    overwrite=req.overwrite,
                    rendered_base64=req.rendered_base64,
                    copy_name=req.copy_name,
                )
        except FileNotFoundError as error:
            raise HTTPException(404, "原图不存在") from error
        except (ValueError, OSError) as error:
            raise HTTPException(400, str(error)) from error
        if req.overwrite:
            refresh_overwritten_image_data(destination, req.width, req.height)
        else:
            add_image_data_single(destination)
            inherit_edited_image_data(req.path, destination, req.width, req.height)
        file = get_file_info_by_path(destination)
        file.update(width=req.width, height=req.height)
        saved_record = (
            image_edit_history.latest(destination) if req.editor_document is not None else None
        )
        return {
            "file": file,
            "record": image_edit_history.public_record(saved_record, destination)
            if saved_record
            else None,
        }
