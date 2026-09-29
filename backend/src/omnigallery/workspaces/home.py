"""Small home-page summaries and workspace-owned cover images."""

import base64
import hashlib
import io
import json
import os
import re
import tempfile
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import Depends, HTTPException, Query
from fastapi.responses import FileResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field

from omnigallery.infrastructure.database import Database
from omnigallery.storage.project_files import storage_operation


class UploadWorkspaceCover(BaseModel):
    image_base64: str = Field(max_length=70_000_000)


def workspace_uuid(value):
    try:
        return str(uuid.UUID(value))
    except (ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(422, "无效的工作区编号") from exc


def summarize_works(value):
    empty = {"work_count": 0, "draft_count": 0, "recent_work": None, "recent_draft": None}
    try:
        state = json.loads(value)
    except (ValueError, TypeError):
        return empty
    if not isinstance(state, dict) or state.get("version") != 2:
        return empty
    raw = state.get("works")
    works = (
        [item for item in raw if isinstance(item, dict) and item.get("id") and item.get("name")]
        if isinstance(raw, list)
        else []
    )
    if not works:
        return empty

    def drafts(work):
        rows = work.get("drafts", [])
        return (
            [
                item
                for item in rows
                if isinstance(item, dict) and item.get("id") and item.get("name")
            ]
            if isinstance(rows, list)
            else []
        )

    recent = next((item for item in works if item["id"] == state.get("activeId")), None)
    recent = recent or max(works, key=lambda item: str(item.get("updatedAt", "")))
    candidates = drafts(recent)
    draft = next((item for item in candidates if item["id"] == recent.get("activeDraftId")), None)
    draft = draft or (
        max(candidates, key=lambda item: str(item.get("updatedAt", ""))) if candidates else None
    )
    return {
        "work_count": len(works),
        "draft_count": sum(len(drafts(work)) for work in works),
        "recent_work": {"id": str(recent["id"]), "name": str(recent["name"])[:80]},
        "recent_draft": {"id": str(draft["id"]), "name": str(draft["name"])[:80]}
        if draft
        else None,
    }


def mount_workspace_home_routes(app, base, verify_secret, write_permission_required, artifact_root):
    @app.get(base + "/workspace_overviews", dependencies=[Depends(verify_secret)])
    def workspace_overviews(workspace_ids: Annotated[list[str] | None, Query()] = None):
        workspace_ids = workspace_ids or []
        if len(workspace_ids) > 100:
            raise HTTPException(422, "工作区数量超出限制")
        ids = list(dict.fromkeys(workspace_uuid(item) for item in workspace_ids))
        if not ids:
            return []
        conn = Database.get_connection()
        slots = ",".join("?" for _ in ids)
        states = dict(
            conn.execute(
                f"SELECT workspace_id, value FROM workspace_state WHERE workspace_id IN ({slots}) AND key = 'omnigallery:workspace-works-v2:' || workspace_id",
                ids,
            )
        )
        previews = {}
        for artifact_id, workspace_id in conn.execute(
            f"""SELECT a.id, a.workspace_id FROM workspace_artifact a
            LEFT JOIN workspace_artifact_input i ON i.artifact_id = a.id
            WHERE a.workspace_id IN ({slots}) AND a.kind='image' AND i.artifact_id IS NULL
            ORDER BY a.created_at DESC, a.id DESC""",
            ids,
        ):
            selected = previews.setdefault(workspace_id, [])
            if len(selected) < 3:
                selected.append(artifact_id)
        return [
            {
                "workspace_id": item,
                **summarize_works(states.get(item)),
                "preview_artifacts": previews.get(item, []),
            }
            for item in ids
        ]

    @app.post(
        base + "/workspace_covers/{workspace_id}",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    @storage_operation
    def upload_workspace_cover(workspace_id: str, req: UploadWorkspaceCover):
        workspace_id = workspace_uuid(workspace_id)
        try:
            image_bytes = base64.b64decode(req.image_base64, validate=True)
            if len(image_bytes) > 50 * 1024 * 1024:
                raise ValueError("图片过大")
            with Image.open(io.BytesIO(image_bytes)) as original:
                if original.width * original.height > 80_000_000:
                    raise ValueError("图片尺寸过大")
                image = ImageOps.exif_transpose(original)
                image = image.convert(
                    "RGBA" if "A" in image.getbands() or "transparency" in image.info else "RGB"
                )
                image = ImageOps.fit(image, (960, 600), method=Image.Resampling.LANCZOS)
                output = io.BytesIO()
                image.save(output, "WEBP", quality=84, method=4)
        except (ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError) as exc:
            raise HTTPException(422, "请选择 50MB 以内、尺寸有效的图片") from exc
        data = output.getvalue()
        version = hashlib.sha256(data).hexdigest()
        directory = artifact_root() / workspace_id
        directory.mkdir(parents=True, exist_ok=True)
        destination = directory / f"cover-{version}.webp"
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=directory, prefix=".cover-", delete=False) as file:
                temporary = Path(file.name)
                file.write(data)
            os.replace(temporary, destination)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
        return {"version": version}

    @app.get(
        base + "/workspace_covers/{workspace_id}/{version}", dependencies=[Depends(verify_secret)]
    )
    @storage_operation
    def workspace_cover(workspace_id: str, version: str):
        workspace_id = workspace_uuid(workspace_id)
        if not re.fullmatch(r"[a-f0-9]{64}", version):
            raise HTTPException(422, "无效的封面编号")
        path = artifact_root() / workspace_id / f"cover-{version}.webp"
        if not path.is_file():
            raise HTTPException(404, "封面不存在")
        return FileResponse(
            path,
            media_type="image/webp",
            headers={"Cache-Control": "private, max-age=31536000, immutable"},
        )
