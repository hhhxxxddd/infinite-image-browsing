"""Workspace-owned material storage, kept outside the media index."""

import base64
import io
import os
import re
import shutil
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from fastapi import Depends, HTTPException, Response
from fastapi.responses import FileResponse
from PIL import ExifTags, Image
from pydantic import BaseModel, Field

from omnigallery.infrastructure.database import Database
from omnigallery.library.folder_repository import LibraryPath, LibraryPathType
from omnigallery.library.indexing import add_image_data_single
from omnigallery.library.media_repository import Media
from omnigallery.library.tag_repository import MediaTag
from omnigallery.storage.project_files import (
    is_project_storage_path,
    storage_lock,
    storage_operation,
    storage_root,
)
from omnigallery.workspaces.tasks import create_task_table, task_lock


def artifact_root() -> Path:
    return storage_root() / "omnigallery-workspace-artifacts"


def is_artifact_path(path: str) -> bool:
    try:
        return os.path.commonpath((os.path.realpath(path), str(artifact_root()))) == str(
            artifact_root()
        )
    except ValueError:
        return False


ARTIFACT_COLUMNS = (
    "id",
    "workspace_id",
    "name",
    "kind",
    "source",
    "format",
    "width",
    "height",
    "bytes",
    "created_at",
)
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
    conn.execute(
        "CREATE INDEX IF NOT EXISTS workspace_artifact_workspace ON workspace_artifact(workspace_id, created_at)"
    )
    conn.execute("""CREATE TABLE IF NOT EXISTS workspace_artifact_metadata (
        artifact_id TEXT PRIMARY KEY, description TEXT NOT NULL DEFAULT '',
        generation_info TEXT NOT NULL DEFAULT '', inferred_prompt TEXT NOT NULL DEFAULT ''
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS workspace_artifact_tag (
        artifact_id TEXT NOT NULL, tag_id INTEGER NOT NULL,
        PRIMARY KEY (artifact_id, tag_id)
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS workspace_artifact_origin (
        artifact_id TEXT PRIMARY KEY, document_id TEXT NOT NULL, document_revision TEXT NOT NULL
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS workspace_artifact_collection (
        artifact_id TEXT NOT NULL, media_id INTEGER NOT NULL,
        PRIMARY KEY (artifact_id, media_id)
    )""")


def _uuid(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except (ValueError, AttributeError, TypeError) as exc:
        raise HTTPException(422, "无效的工作区或素材编号") from exc


def _row(conn, artifact_id: str):
    row = conn.execute(
        "SELECT * FROM workspace_artifact WHERE id = ?", (_uuid(artifact_id),)
    ).fetchone()
    if not row:
        raise HTTPException(404, "素材不存在")
    return dict(zip(ARTIFACT_COLUMNS, row, strict=False))


def _public(row):
    return dict(zip(ARTIFACT_COLUMNS, row, strict=False))


def _file(row) -> Path:
    path = artifact_root() / row["workspace_id"] / (row["id"] + IMAGE_FORMATS[row["format"]][1])
    if not path.is_file():
        raise HTTPException(404, "素材文件不存在")
    return path


def _source_file(row) -> Path:
    return artifact_root() / row["workspace_id"] / (row["id"] + ".source.png")


class SaveArtifact(BaseModel):
    workspace_id: str
    name: str = Field(min_length=1, max_length=120)
    format: Literal["png", "jpeg", "webp"]
    source: Literal["image_studio", "ai_image_edit"] = "image_studio"
    image_base64: str
    generation_info: str = Field(default="", max_length=50000)
    document_id: str = Field(default="", max_length=80, pattern=r"^[\w-]*$")
    document_revision: str = Field(default="", pattern=r"^(?:[a-f0-9]{64})?$")


class ArtifactMetadataUpdate(BaseModel):
    description: str | None = Field(default=None, max_length=5000)
    generation_info: str | None = Field(default=None, max_length=50000)
    inferred_prompt: str | None = Field(default=None, max_length=5000)


class ArtifactTagUpdate(BaseModel):
    tag_id: int


def _delete_metadata(conn, artifact_ids):
    for table in ("workspace_artifact_origin", "workspace_artifact_collection"):
        conn.executemany(
            f"DELETE FROM {table} WHERE artifact_id = ?",
            ((item,) for item in artifact_ids),
        )
    conn.executemany(
        "DELETE FROM workspace_artifact_tag WHERE artifact_id = ?",
        ((item,) for item in artifact_ids),
    )
    conn.executemany(
        "DELETE FROM workspace_artifact_metadata WHERE artifact_id = ?",
        ((item,) for item in artifact_ids),
    )


def _artifact_metadata(conn, row):
    from omnigallery.library.indexing import get_exif_data

    stored = conn.execute(
        "SELECT description, generation_info, inferred_prompt FROM workspace_artifact_metadata WHERE artifact_id = ?",
        (row["id"],),
    ).fetchone()
    with Image.open(_file(row)) as media:
        exif = {
            "格式": media.format or "",
            "像素尺寸": f"{media.width} × {media.height}",
            "颜色模式": media.mode,
        }
        exif.update(
            {str(ExifTags.TAGS.get(key, key)): str(value) for key, value in media.getexif().items()}
        )
        exif.update(
            {key: str(value) for key, value in media.info.items() if not key.startswith("exif")}
        )
    tags = [
        item[0]
        for item in conn.execute(
            """SELECT tag.id FROM tag
        JOIN workspace_artifact_tag ON tag.id = workspace_artifact_tag.tag_id
        WHERE workspace_artifact_tag.artifact_id = ? AND tag.type = 'custom'""",
            (row["id"],),
        )
    ]
    embedded = get_exif_data(str(_file(row))).raw_info or ""
    if re.fullmatch(r"\s*Negative prompt:\s*Source Identifier: ComfyUI\s*", embedded):
        embedded = ""
    return {
        "description": stored[0] if stored else "",
        "generation_info": stored[1] if stored and stored[1] else embedded,
        "embedded_generation_info": embedded,
        "inferred_prompt": stored[2] if stored else "",
        "tag_ids": tags,
        "exif": exif,
        "source_image_available": _source_file(row).is_file(),
    }


class SyncArtifact(BaseModel):
    directory: str


@storage_operation
def save_workspace_artifact(req: SaveArtifact, source_image_base64: str = ""):
    if bool(req.document_id) != bool(req.document_revision):
        raise HTTPException(422, "作品编号和版本必须同时提供")
    workspace_id = _uuid(req.workspace_id)
    if len(req.image_base64) > 70_000_000:
        raise HTTPException(413, "图片过大")
    try:
        data = base64.b64decode(req.image_base64, validate=True)
        if len(data) > 50_000_000:
            raise ValueError("too large")
        with Image.open(io.BytesIO(data)) as media:
            if media.format != IMAGE_FORMATS[req.format][0]:
                raise ValueError("format mismatch")
            width, height = media.size
            if not width or not height or width * height > 100_000_000:
                raise ValueError("invalid dimensions")
            media.verify()
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
    stamp = datetime.now(UTC).isoformat()
    directory = artifact_root() / workspace_id
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / (artifact_id + suffix)
    source_target = directory / (artifact_id + ".source.png")
    temporary = target.with_suffix(target.suffix + ".tmp")
    conn = Database.get_connection()
    try:
        if source_image_base64:
            if len(source_image_base64) > 70_000_000:
                raise HTTPException(413, "源图过大")
            try:
                source_data = base64.b64decode(source_image_base64, validate=True)
                with Image.open(io.BytesIO(source_data)) as source:
                    if source.width * source.height > 100_000_000:
                        raise ValueError("invalid dimensions")
                    source.save(source_target, format="PNG")
            except (ValueError, OSError, base64.binascii.Error) as exc:
                raise HTTPException(422, "源图数据无效或过大") from exc
        temporary.write_bytes(data)
        temporary.replace(target)
        conn.execute(
            "INSERT INTO workspace_artifact VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                artifact_id,
                workspace_id,
                name,
                "image",
                req.source,
                req.format,
                width,
                height,
                len(data),
                stamp,
            ),
        )
        if req.generation_info:
            conn.execute(
                "INSERT INTO workspace_artifact_metadata (artifact_id, generation_info) VALUES (?, ?)",
                (artifact_id, req.generation_info),
            )
        if req.document_id:
            conn.execute(
                "INSERT INTO workspace_artifact_origin VALUES (?, ?, ?)",
                (artifact_id, req.document_id, req.document_revision),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        temporary.unlink(missing_ok=True)
        target.unlink(missing_ok=True)
        source_target.unlink(missing_ok=True)
        raise
    result = _public(
        (
            artifact_id,
            workspace_id,
            name,
            "image",
            req.source,
            req.format,
            width,
            height,
            len(data),
            stamp,
        )
    )
    return {
        **result,
        "document_id": req.document_id,
        "document_revision": req.document_revision,
        "collected": False,
    }


def mount_workspace_artifact_routes(
    app,
    base: str,
    verify_secret,
    write_permission_required,
    cli_scanned_paths=(),
    check_path_trust: Callable[[str], None] | None = None,
):
    route = base + "/workspace_artifacts"

    @app.get(route, dependencies=[Depends(verify_secret)])
    def list_artifacts(workspace_id: str):
        conn = Database.get_connection()
        rows = conn.execute(
            """SELECT a.*, COALESCE(o.document_id, ''), COALESCE(o.document_revision, ''),
                EXISTS (SELECT 1 FROM workspace_artifact_collection c
                        JOIN media m ON m.id = c.media_id WHERE c.artifact_id = a.id)
                FROM workspace_artifact a
                LEFT JOIN workspace_artifact_origin o ON o.artifact_id = a.id
                WHERE a.workspace_id = ? ORDER BY a.created_at DESC, a.id DESC""",
            (_uuid(workspace_id),),
        ).fetchall()
        return [
            {
                **_public(row),
                "document_id": row[10],
                "document_revision": row[11],
                "collected": bool(row[12]),
            }
            for row in rows
        ]

    @app.post(route, dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def save_artifact(req: SaveArtifact):
        return save_workspace_artifact(req)

    @app.get(route + "/{artifact_id}/file", dependencies=[Depends(verify_secret)])
    def artifact_file(artifact_id: str, download: bool = False):
        row = _row(Database.get_connection(), artifact_id)
        return FileResponse(
            _file(row),
            media_type=IMAGE_FORMATS[row["format"]][2],
            filename=row["name"] if download else None,
            content_disposition_type="attachment" if download else "inline",
        )

    @app.get(route + "/{artifact_id}/thumbnail", dependencies=[Depends(verify_secret)])
    def artifact_thumbnail(artifact_id: str, size: int = 160):
        if size < 32 or size > 1024:
            raise HTTPException(422, "缩略图尺寸无效")
        row = _row(Database.get_connection(), artifact_id)
        with Image.open(_file(row)) as media:
            media.thumbnail((size, size))
            output = io.BytesIO()
            media.save(output, format="PNG")
        return Response(
            output.getvalue(),
            media_type="image/png",
            headers={"Cache-Control": "private, max-age=31536000, immutable"},
        )

    @app.get(route + "/{artifact_id}/source", dependencies=[Depends(verify_secret)])
    def artifact_source(artifact_id: str):
        row = _row(Database.get_connection(), artifact_id)
        source = _source_file(row)
        if not source.is_file():
            raise HTTPException(404, "此结果未保存加工时的源图")
        return FileResponse(source, media_type="image/png")

    @app.get(route + "/{artifact_id}/metadata", dependencies=[Depends(verify_secret)])
    def get_artifact_metadata(artifact_id: str):
        conn = Database.get_connection()
        return _artifact_metadata(conn, _row(conn, artifact_id))

    @app.put(
        route + "/{artifact_id}/metadata",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def update_artifact_metadata(artifact_id: str, req: ArtifactMetadataUpdate):
        conn = Database.get_connection()
        row = _row(conn, artifact_id)
        updates = req.model_dump(exclude_unset=True)
        if updates:
            conn.execute(
                "INSERT OR IGNORE INTO workspace_artifact_metadata (artifact_id) VALUES (?)",
                (row["id"],),
            )
            for key, value in updates.items():
                conn.execute(
                    f"UPDATE workspace_artifact_metadata SET {key} = ? WHERE artifact_id = ?",
                    ((value or "").strip(), row["id"]),
                )
            conn.commit()
        return _artifact_metadata(conn, row)

    @app.post(
        route + "/{artifact_id}/tags",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def toggle_artifact_tag(artifact_id: str, req: ArtifactTagUpdate):
        conn = Database.get_connection()
        row = _row(conn, artifact_id)
        tag = conn.execute(
            "SELECT id FROM tag WHERE id = ? AND type = 'custom'", (req.tag_id,)
        ).fetchone()
        if not tag:
            raise HTTPException(404, "标签不存在")
        removed = (
            conn.execute(
                "DELETE FROM workspace_artifact_tag WHERE artifact_id = ? AND tag_id = ?",
                (row["id"], req.tag_id),
            ).rowcount
            > 0
        )
        if not removed:
            conn.execute(
                "INSERT INTO workspace_artifact_tag VALUES (?, ?)", (row["id"], req.tag_id)
            )
        conn.commit()
        return {"is_remove": removed}

    @app.delete(
        route + "/{artifact_id}",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    @storage_operation
    def delete_artifact(artifact_id: str):
        conn = Database.get_connection()
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
        conn = Database.get_connection()
        with task_lock, storage_lock:
            create_task_table(conn)
            conn.execute("DELETE FROM studio_task WHERE workspace_id = ?", (workspace_id,))
            directory = artifact_root() / workspace_id
            if directory.exists():
                shutil.rmtree(directory)
            ids = [
                item[0]
                for item in conn.execute(
                    "SELECT id FROM workspace_artifact WHERE workspace_id = ?", (workspace_id,)
                )
            ]
            _delete_metadata(conn, ids)
            conn.execute("DELETE FROM workspace_artifact WHERE workspace_id = ?", (workspace_id,))
            conn.commit()
        return {"ok": True}

    @app.post(
        route + "/{artifact_id}/sync",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    @storage_operation
    def sync_artifact(artifact_id: str, req: SyncArtifact):
        conn = Database.get_connection()
        row = _row(conn, artifact_id)
        directory = Path(req.directory).resolve()
        if check_path_trust:
            check_path_trust(str(directory))
        if not directory.is_dir() or is_project_storage_path(str(directory)):
            raise HTTPException(422, "请选择媒体库中的文件夹")
        scanned_paths = [
            entry.path
            for entry in LibraryPath.get_extra_paths(conn)
            if LibraryPathType.scanned.value in entry.types
            or LibraryPathType.scanned_fixed.value in entry.types
        ]
        scanned_paths.extend(cli_scanned_paths)

        def under_scanned_root(root):
            try:
                parent = os.path.realpath(root)
                return (
                    os.path.isdir(parent) and os.path.commonpath((str(directory), parent)) == parent
                )
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
        indexed = Media.get(conn, str(destination))
        if indexed:
            metadata = _artifact_metadata(conn, row)
            if metadata["description"]:
                indexed.update_description(conn, metadata["description"])
            if metadata["generation_info"]:
                indexed.update_exif(conn, metadata["generation_info"])
            if metadata["inferred_prompt"]:
                conn.execute(
                    "INSERT OR REPLACE INTO media_ai_note (media_id, inferred_prompt) VALUES (?, ?)",
                    (indexed.id, metadata["inferred_prompt"]),
                )
            for tag_id in metadata["tag_ids"]:
                if not MediaTag.get_tags_for_image(conn, indexed.id, tag_id=tag_id):
                    MediaTag(indexed.id, tag_id).save(conn)
                    conn.execute("UPDATE tag SET count = count + 1 WHERE id = ?", (tag_id,))
            conn.execute(
                "INSERT OR IGNORE INTO workspace_artifact_collection VALUES (?, ?)",
                (row["id"], indexed.id),
            )
            conn.commit()
        return {"path": str(destination), "collected": bool(indexed)}
