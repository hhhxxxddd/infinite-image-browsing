"""Workspace-owned material storage, kept outside the media index."""

import base64
import io
import os
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import Depends, HTTPException, Response
from fastapi.responses import FileResponse
from PIL import ExifTags, Image
from pydantic import BaseModel, Field

from scripts.iib.db.datamodel import DataBase, ExtraPath, ExtraPathType, ImageTag
from scripts.iib.db.datamodel import Image as DbImg
from scripts.iib.db.update_image_data import add_image_data_single
from scripts.iib.studio_tasks import create_task_table, task_lock


def artifact_root() -> Path:
    return Path(DataBase.get_db_file_path()).resolve().parent / "iib-workspace-artifacts"


def is_artifact_path(path: str) -> bool:
    try:
        return os.path.commonpath((os.path.realpath(path), str(artifact_root()))) == str(artifact_root())
    except ValueError:
        return False


ARTIFACT_COLUMNS = ("id", "workspace_id", "name", "kind", "source", "format",
                    "width", "height", "bytes", "created_at")
IMAGE_FORMATS = {
    "png": ("PNG", ".png", "image/png"),
    "jpeg": ("JPEG", ".jpg", "image/jpeg"),
    "webp": ("WEBP", ".webp", "image/webp"),
}


def create_workspace_artifact_table(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS workspace_artifact (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL,
        kind TEXT NOT NULL, source TEXT NOT NULL, format TEXT NOT NULL,
        width INTEGER NOT NULL, height INTEGER NOT NULL, bytes INTEGER NOT NULL,
        created_at TEXT NOT NULL
    )""")
    conn.execute("CREATE INDEX IF NOT EXISTS workspace_artifact_workspace ON workspace_artifact(workspace_id, created_at)")
    conn.execute("""CREATE TABLE IF NOT EXISTS workspace_artifact_metadata (
        artifact_id TEXT PRIMARY KEY, description TEXT NOT NULL DEFAULT '',
        generation_info TEXT NOT NULL DEFAULT '', inferred_prompt TEXT NOT NULL DEFAULT ''
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS workspace_artifact_tag (
        artifact_id TEXT NOT NULL, tag_id INTEGER NOT NULL,
        PRIMARY KEY (artifact_id, tag_id)
    )""")


def _uuid(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except (ValueError, AttributeError, TypeError) as exc:
        raise HTTPException(422, "无效的工作区或素材编号") from exc


def _row(conn, artifact_id: str):
    row = conn.execute("SELECT * FROM workspace_artifact WHERE id = ?", (_uuid(artifact_id),)).fetchone()
    if not row:
        raise HTTPException(404, "素材不存在")
    return dict(zip(ARTIFACT_COLUMNS, row))


def _public(row):
    return dict(zip(ARTIFACT_COLUMNS, row))


def _file(row) -> Path:
    path = artifact_root() / row["workspace_id"] / (row["id"] + IMAGE_FORMATS[row["format"]][1])
    if not path.is_file():
        raise HTTPException(404, "素材文件不存在")
    return path


def _source_file(row) -> Path:
    return artifact_root() / row['workspace_id'] / (row['id'] + '.source.png')


class SaveArtifact(BaseModel):
    workspace_id: str
    name: str = Field(min_length=1, max_length=120)
    format: Literal["png", "jpeg", "webp"]
    source: Literal["image_studio", "ai_image_edit"] = "image_studio"
    image_base64: str
    generation_info: str = Field(default="", max_length=50000)


class ArtifactMetadataUpdate(BaseModel):
    description: str | None = Field(default=None, max_length=5000)
    generation_info: str | None = Field(default=None, max_length=50000)
    inferred_prompt: str | None = Field(default=None, max_length=5000)


class ArtifactTagUpdate(BaseModel):
    tag_id: int


def _delete_metadata(conn, artifact_ids):
    conn.executemany("DELETE FROM workspace_artifact_tag WHERE artifact_id = ?", ((item,) for item in artifact_ids))
    conn.executemany("DELETE FROM workspace_artifact_metadata WHERE artifact_id = ?", ((item,) for item in artifact_ids))


def _artifact_metadata(conn, row):
    from scripts.iib.db.update_image_data import get_exif_data
    stored = conn.execute("SELECT description, generation_info, inferred_prompt FROM workspace_artifact_metadata WHERE artifact_id = ?",
                          (row["id"],)).fetchone()
    with Image.open(_file(row)) as image:
        exif = {"格式": image.format or "", "像素尺寸": f"{image.width} × {image.height}", "颜色模式": image.mode}
        exif.update({str(ExifTags.TAGS.get(key, key)): str(value) for key, value in image.getexif().items()})
        exif.update({key: str(value) for key, value in image.info.items() if not key.startswith("exif")})
    tags = [item[0] for item in conn.execute("""SELECT tag.id FROM tag
        JOIN workspace_artifact_tag ON tag.id = workspace_artifact_tag.tag_id
        WHERE workspace_artifact_tag.artifact_id = ? AND tag.type = 'custom'""", (row["id"],))]
    embedded = get_exif_data(str(_file(row))).raw_info or ""
    if re.fullmatch(r"\s*Negative prompt:\s*Source Identifier: ComfyUI\s*", embedded):
        embedded = ""
    return {"description": stored[0] if stored else "",
            "generation_info": stored[1] if stored and stored[1] else embedded,
            "embedded_generation_info": embedded,
            "inferred_prompt": stored[2] if stored else "", "tag_ids": tags, "exif": exif,
            "source_image_available": _source_file(row).is_file()}


class SyncArtifact(BaseModel):
    directory: str


def save_workspace_artifact(req: SaveArtifact, source_image_base64: str = ''):
    workspace_id = _uuid(req.workspace_id)
    if len(req.image_base64) > 70_000_000:
        raise HTTPException(413, "图片过大")
    try:
        data = base64.b64decode(req.image_base64, validate=True)
        if len(data) > 50_000_000:
            raise ValueError("too large")
        with Image.open(io.BytesIO(data)) as image:
            if image.format != IMAGE_FORMATS[req.format][0]:
                raise ValueError("format mismatch")
            width, height = image.size
            if not width or not height or width * height > 100_000_000:
                raise ValueError("invalid dimensions")
            image.verify()
    except (ValueError, OSError, base64.binascii.Error) as exc:
        raise HTTPException(422, "图片数据无效或过大") from exc
    artifact_id = str(uuid.uuid4())
    name = re.sub(r'[\\/:*?"<>|]', "_", req.name.strip()).rstrip(". ")
    if not name:
        raise HTTPException(422, "请输入素材名称")
    suffix = IMAGE_FORMATS[req.format][1]
    accepted_suffixes = (".jpg", ".jpeg") if req.format == "jpeg" else (suffix,)
    if not name.lower().endswith(accepted_suffixes):
        name += suffix
    stamp = datetime.now(timezone.utc).isoformat()
    directory = artifact_root() / workspace_id
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / (artifact_id + suffix)
    source_target = directory / (artifact_id + '.source.png')
    temporary = target.with_suffix(target.suffix + ".tmp")
    conn = DataBase.get_conn()
    try:
        if source_image_base64:
            if len(source_image_base64) > 70_000_000:
                raise HTTPException(413, '源图过大')
            try:
                source_data = base64.b64decode(source_image_base64, validate=True)
                with Image.open(io.BytesIO(source_data)) as source:
                    if source.width * source.height > 100_000_000:
                        raise ValueError('invalid dimensions')
                    source.save(source_target, format='PNG')
            except (ValueError, OSError, base64.binascii.Error) as exc:
                raise HTTPException(422, '源图数据无效或过大') from exc
        temporary.write_bytes(data)
        temporary.replace(target)
        conn.execute("INSERT INTO workspace_artifact VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                     (artifact_id, workspace_id, name, "image", req.source, req.format,
                      width, height, len(data), stamp))
        if req.generation_info:
            conn.execute("INSERT INTO workspace_artifact_metadata (artifact_id, generation_info) VALUES (?, ?)",
                         (artifact_id, req.generation_info))
        conn.commit()
    except Exception:
        conn.rollback()
        temporary.unlink(missing_ok=True)
        target.unlink(missing_ok=True)
        source_target.unlink(missing_ok=True)
        raise
    return _public((artifact_id, workspace_id, name, "image", req.source, req.format,
                    width, height, len(data), stamp))


def mount_workspace_artifact_routes(app, base: str, verify_secret, write_permission_required, cli_scanned_paths=()):
    route = base + "/workspace_artifacts"

    @app.get(route, dependencies=[Depends(verify_secret)])
    def list_artifacts(workspace_id: str):
        conn = DataBase.get_conn()
        rows = conn.execute("SELECT * FROM workspace_artifact WHERE workspace_id = ? ORDER BY created_at DESC, id DESC",
                            (_uuid(workspace_id),)).fetchall()
        return [_public(row) for row in rows]

    @app.post(route, dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def save_artifact(req: SaveArtifact):
        return save_workspace_artifact(req)

    @app.get(route + "/{artifact_id}/file", dependencies=[Depends(verify_secret)])
    def artifact_file(artifact_id: str, download: bool = False):
        row = _row(DataBase.get_conn(), artifact_id)
        return FileResponse(_file(row), media_type=IMAGE_FORMATS[row["format"]][2],
                            filename=row["name"] if download else None,
                            content_disposition_type="attachment" if download else "inline")

    @app.get(route + "/{artifact_id}/thumbnail", dependencies=[Depends(verify_secret)])
    def artifact_thumbnail(artifact_id: str, size: int = 160):
        if size < 32 or size > 1024:
            raise HTTPException(422, "缩略图尺寸无效")
        row = _row(DataBase.get_conn(), artifact_id)
        with Image.open(_file(row)) as image:
            image.thumbnail((size, size))
            output = io.BytesIO()
            image.save(output, format="PNG")
        return Response(output.getvalue(), media_type="image/png",
                        headers={"Cache-Control": "private, max-age=31536000, immutable"})

    @app.get(route + "/{artifact_id}/source", dependencies=[Depends(verify_secret)])
    def artifact_source(artifact_id: str):
        row = _row(DataBase.get_conn(), artifact_id)
        source = _source_file(row)
        if not source.is_file():
            raise HTTPException(404, '此结果未保存加工时的源图')
        return FileResponse(source, media_type='image/png')

    @app.get(route + "/{artifact_id}/metadata", dependencies=[Depends(verify_secret)])
    def get_artifact_metadata(artifact_id: str):
        conn = DataBase.get_conn()
        return _artifact_metadata(conn, _row(conn, artifact_id))

    @app.put(route + "/{artifact_id}/metadata", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def update_artifact_metadata(artifact_id: str, req: ArtifactMetadataUpdate):
        conn = DataBase.get_conn()
        row = _row(conn, artifact_id)
        updates = req.model_dump(exclude_unset=True)
        if updates:
            conn.execute("INSERT OR IGNORE INTO workspace_artifact_metadata (artifact_id) VALUES (?)", (row["id"],))
            for key, value in updates.items():
                conn.execute(f"UPDATE workspace_artifact_metadata SET {key} = ? WHERE artifact_id = ?",
                             ((value or "").strip(), row["id"]))
            conn.commit()
        return _artifact_metadata(conn, row)

    @app.post(route + "/{artifact_id}/tags", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def toggle_artifact_tag(artifact_id: str, req: ArtifactTagUpdate):
        conn = DataBase.get_conn()
        row = _row(conn, artifact_id)
        tag = conn.execute("SELECT id FROM tag WHERE id = ? AND type = 'custom'", (req.tag_id,)).fetchone()
        if not tag:
            raise HTTPException(404, "标签不存在")
        removed = conn.execute("DELETE FROM workspace_artifact_tag WHERE artifact_id = ? AND tag_id = ?",
                               (row["id"], req.tag_id)).rowcount > 0
        if not removed:
            conn.execute("INSERT INTO workspace_artifact_tag VALUES (?, ?)", (row["id"], req.tag_id))
        conn.commit()
        return {"is_remove": removed}

    @app.delete(route + "/{artifact_id}", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def delete_artifact(artifact_id: str):
        conn = DataBase.get_conn()
        row = _row(conn, artifact_id)
        _file(row).unlink()
        _source_file(row).unlink(missing_ok=True)
        _delete_metadata(conn, [row["id"]])
        conn.execute("DELETE FROM workspace_artifact WHERE id = ?", (row["id"],))
        conn.commit()
        return {"ok": True}

    @app.delete(route, dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def delete_workspace_artifacts(workspace_id: str):
        workspace_id = _uuid(workspace_id)
        conn = DataBase.get_conn()
        with task_lock:
            create_task_table(conn)
            conn.execute('DELETE FROM studio_task WHERE workspace_id = ?', (workspace_id,))
            directory = artifact_root() / workspace_id
            if directory.exists():
                shutil.rmtree(directory)
            ids = [item[0] for item in conn.execute("SELECT id FROM workspace_artifact WHERE workspace_id = ?", (workspace_id,))]
            _delete_metadata(conn, ids)
            conn.execute("DELETE FROM workspace_artifact WHERE workspace_id = ?", (workspace_id,))
            conn.commit()
        return {"ok": True}

    @app.post(route + "/{artifact_id}/sync", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def sync_artifact(artifact_id: str, req: SyncArtifact):
        conn = DataBase.get_conn()
        row = _row(conn, artifact_id)
        directory = Path(req.directory).resolve()
        if not directory.is_dir() or is_artifact_path(str(directory)):
            raise HTTPException(422, "请选择媒体库中的文件夹")
        scanned_paths = [entry.path for entry in ExtraPath.get_extra_paths(conn)
                         if ExtraPathType.scanned.value in entry.types or ExtraPathType.scanned_fixed.value in entry.types]
        scanned_paths.extend(cli_scanned_paths)
        def under_scanned_root(root):
            try:
                parent = os.path.realpath(root)
                return os.path.isdir(parent) and os.path.commonpath((str(directory), parent)) == parent
            except ValueError:
                return False
        if not any(under_scanned_root(root) for root in scanned_paths):
            raise HTTPException(422, "所选文件夹不在媒体库扫描目录内")
        suffix = IMAGE_FORMATS[row["format"]][1]
        stem = Path(row["name"]).stem[:100] or "素材"
        destination = directory / (stem + suffix)
        index = 2
        while True:
            try:
                with destination.open("xb") as output, _file(row).open("rb") as source:
                    shutil.copyfileobj(source, output)
                break
            except FileExistsError:
                destination = directory / f"{stem}-{index}{suffix}"
                index += 1
            except Exception:
                destination.unlink(missing_ok=True)
                raise
        add_image_data_single(str(destination))
        indexed = DbImg.get(conn, str(destination))
        if indexed:
            metadata = _artifact_metadata(conn, row)
            if metadata["description"]:
                indexed.update_description(conn, metadata["description"])
            if metadata["generation_info"]:
                indexed.update_exif(conn, metadata["generation_info"])
            if metadata["inferred_prompt"]:
                conn.execute("INSERT OR REPLACE INTO image_ai_note (image_id, inferred_prompt) VALUES (?, ?)",
                             (indexed.id, metadata["inferred_prompt"]))
            for tag_id in metadata["tag_ids"]:
                if not ImageTag.get_tags_for_image(conn, indexed.id, tag_id=tag_id):
                    ImageTag(indexed.id, tag_id).save(conn)
                    conn.execute("UPDATE tag SET count = count + 1 WHERE id = ?", (tag_id,))
            conn.commit()
        return {"path": str(destination)}
