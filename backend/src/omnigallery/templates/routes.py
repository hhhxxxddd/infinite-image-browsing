from collections.abc import Callable
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator

from omnigallery.infrastructure.auth import verify_secret, write_permission_required
from omnigallery.infrastructure.route_context import RouteContext
from omnigallery.storage.filesystem import checked_path
from omnigallery.storage.project_files import storage_lock
from omnigallery.templates import store


class TemplateName(BaseModel):
    name: str = Field(min_length=1, max_length=120)

    @field_validator("name")
    @classmethod
    def trim(cls, value):
        if not value.strip():
            raise ValueError("请输入模板名称")
        return value.strip()


class SaveTemplate(TemplateName):
    type: Literal["text", "layout", "image"] = "text"
    document: dict
    assets: dict[str, str] = Field(default_factory=dict, max_length=500)
    preview: str = Field(default="", max_length=2_000_000)


def checked(operation: Callable):
    try:
        return operation()
    except FileNotFoundError as error:
        raise HTTPException(404, "模板或素材已不存在") from error
    except (ValueError, OSError, KeyError, TypeError) as error:
        raise HTTPException(400, "模板操作失败：" + str(error)) from error


def mount_routes(app: FastAPI, context: RouteContext):
    base = context.api_base
    read = [Depends(verify_secret)]
    write = [*read, Depends(write_permission_required)]

    @app.get(base + "/templates", dependencies=read)
    def list_templates(
        type: Literal["text", "layout", "image"] = "text",
        q: str = Query("", max_length=120),
        offset: int = Query(0, ge=0),
        limit: int = Query(12, ge=1, le=50),
    ):
        return checked(lambda: store.list_templates(q, offset, limit, type))

    @app.post(base + "/templates", dependencies=write)
    def save_template(req: SaveTemplate):
        return checked(
            lambda: store.save(req.name, req.document, req.assets, req.preview, req.type)
        )

    @app.get(base + "/templates/{template_id}", dependencies=read)
    def template_document(template_id: str):
        return checked(lambda: store.public_document(template_id))

    @app.post(base + "/templates/{template_id}/instantiate", dependencies=write)
    def instantiate(template_id: str):
        return checked(lambda: store.public_document(template_id, instantiate=True))

    @app.patch(base + "/templates/{template_id}", dependencies=write)
    def rename(template_id: str, req: TemplateName):
        return checked(lambda: store.rename(template_id, req.name))

    @app.delete(base + "/templates/{template_id}", dependencies=write)
    def delete(template_id: str):
        checked(lambda: store.delete(template_id))
        return Response(status_code=204)

    @app.get(base + "/templates/{template_id}/assets/{asset_id}", dependencies=read)
    def template_asset(template_id: str, asset_id: str):
        def response():
            with storage_lock:
                path = store.asset_path(template_id, asset_id)
                meta = store.read(template_id)["assets"][asset_id]
                return Response(path.read_bytes(), media_type=meta["media_type"])

        return checked(response)

    @app.get(base + "/templates/{template_id}/preview", dependencies=read)
    def preview(template_id: str):
        def response():
            with storage_lock:
                if not store.read(template_id).get("has_preview"):
                    raise FileNotFoundError()
                return Response(
                    checked_path(store.package(template_id) / "preview.png").read_bytes(),
                    media_type="image/png",
                )

        return checked(response)

    @app.get(base + "/template-assets/{asset_id}", dependencies=read)
    def material(asset_id: str):
        def response():
            path = store.material_path(asset_id)
            if not path.is_file():
                raise FileNotFoundError()
            return FileResponse(path, media_type="application/octet-stream")

        return checked(response)
