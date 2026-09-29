"""Workspace-owned material storage, kept outside the media index."""

import base64
import io
import json
import os
import re
import shutil
import tempfile
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
from omnigallery.infrastructure.formatting import get_modified_date
from omnigallery.library.folder_repository import LibraryPath, LibraryPathType
from omnigallery.library.indexing import add_image_data_single, refresh_overwritten_image_data
from omnigallery.library.media_repository import Media
from omnigallery.library.tag_repository import MediaTag
from omnigallery.storage.project_files import (
    is_project_storage_path,
    storage_lock,
    storage_operation,
    storage_root,
)
from omnigallery.workspaces.state import state_snapshot, update_artifact_references
from omnigallery.workspaces.tasks import create_task_table, task_lock


def artifact_root() -> Path:
    return storage_root() / "omnigallery-workspace-artifacts"


def is_artifact_path(path: str) -> bool:
    try:
        root = os.path.normcase(os.path.realpath(artifact_root()))
        return os.path.commonpath((os.path.normcase(os.path.realpath(path)), root)) == root
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
ARTIFACT_FORMATS = {
    **IMAGE_FORMATS,
    "wav": ("WAV", ".wav", "audio/wav"),
    "mp3": ("MP3", ".mp3", "audio/mpeg"),
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
    conn.execute("""CREATE TABLE IF NOT EXISTS workspace_artifact_input (
        artifact_id TEXT PRIMARY KEY, production_id TEXT NOT NULL
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS workspace_artifact_lineage (
        artifact_id TEXT PRIMARY KEY, source_json TEXT NOT NULL
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
    path = artifact_root() / row["workspace_id"] / (row["id"] + ARTIFACT_FORMATS[row["format"]][1])
    if not path.is_file():
        raise HTTPException(404, "素材文件不存在")
    return path


def _source_file(row) -> Path:
    return artifact_root() / row["workspace_id"] / (row["id"] + ".source.png")


class SaveArtifact(BaseModel):
    workspace_id: str
    name: str = Field(min_length=1, max_length=120)
    format: Literal["png", "jpeg", "webp"]
    source: Literal["image_studio", "ai_image_edit", "ai_image_generation"] = "image_studio"
    image_base64: str
    generation_info: str = Field(default="", max_length=50000)
    document_id: str = Field(default="", max_length=80, pattern=r"^[\w-]*$")
    document_revision: str = Field(default="", pattern=r"^(?:[a-f0-9]{64})?$")


class ArtifactMetadataUpdate(BaseModel):
    description: str | None = Field(default=None, max_length=5000)
    generation_info: str | None = Field(default=None, max_length=50000)
    inferred_prompt: str | None = Field(default=None, max_length=5000)


class RenameArtifact(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class SaveInput(SaveArtifact):
    production_id: str = Field(min_length=1, max_length=80, pattern=r"^[\w-]+$")


def production_context(conn, workspace_id, document_id):
    """Capture provenance at submission; later edits cannot rewrite a job's lineage."""
    entries = state_snapshot(conn, workspace_id)["entries"]
    try:
        state = json.loads(entries.get(f"omnigallery:workspace-works-v2:{workspace_id}", "{}"))
        for work in state.get("works", []):
            for draft in work.get("drafts", []):
                if draft.get("id") == document_id:
                    return draft.get("name", ""), draft.get("source") or {}
    except (ValueError, TypeError, AttributeError):
        pass
    return "", {}


def _artifact_name(name: str, image_format: str) -> str:
    name = re.sub(r'[\\/:*?"<>|]', "_", name.strip()).rstrip(". ")
    if not name:
        raise HTTPException(422, "请输入产物名称")
    suffix = ARTIFACT_FORMATS[image_format][1]
    accepted_suffixes = (".jpg", ".jpeg") if image_format == "jpeg" else (suffix,)
    if name.lower().endswith(accepted_suffixes):
        return name
    return re.sub(r"\.(png|jpe?g|webp|wav|mp3)$", "", name, flags=re.I) + suffix


class ArtifactTagUpdate(BaseModel):
    tag_id: int


def _delete_metadata(conn, artifact_ids):
    for table in (
        "workspace_artifact_origin",
        "workspace_artifact_collection",
        "workspace_artifact_input",
        "workspace_artifact_lineage",
    ):
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
    if row["kind"] == "audio":
        from mutagen import File as AudioFile

        audio = AudioFile(_file(row))
        exif = {"格式": row["format"].upper()}
        if audio is not None and audio.info is not None:
            exif.update(
                {
                    "时长": f"{audio.info.length:.3f} 秒",
                    "采样率": str(audio.info.sample_rate),
                    "声道": str(audio.info.channels),
                }
            )
    else:
        exif = _image_artifact_exif(row)
    tags = [
        item[0]
        for item in conn.execute(
            """SELECT tag.id FROM tag
        JOIN workspace_artifact_tag ON tag.id = workspace_artifact_tag.tag_id
        WHERE workspace_artifact_tag.artifact_id = ? AND tag.type = 'custom'""",
            (row["id"],),
        )
    ]
    embedded = (get_exif_data(str(_file(row))).raw_info or "") if row["kind"] == "image" else ""
    if re.fullmatch(r"\s*Negative prompt:\s*Source Identifier: ComfyUI\s*", embedded):
        embedded = ""
    return {
        "description": stored[0] if stored else "",
        "generation_info": stored[1] if stored and stored[1] else embedded,
        "embedded_generation_info": embedded,
        "inferred_prompt": stored[2] if stored else "",
        "tag_ids": tags,
        "exif": exif,
        "source_image_available": row["kind"] == "image" and _source_file(row).is_file(),
    }


def _image_artifact_exif(row):
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
    return exif


class SyncArtifact(BaseModel):
    directory: str = ""
    work_id: str = Field(min_length=1, max_length=80, pattern=r"^[\w-]+$")
    overwrite_media_id: int | None = Field(default=None, gt=0)


def _synced_media(conn, workspace_id):
    result = {}
    for artifact_id, media_id, path in conn.execute(
        """SELECT c.artifact_id, m.id, m.path FROM workspace_artifact_collection c
        JOIN media m ON m.id = c.media_id
        JOIN workspace_artifact a ON a.id = c.artifact_id
        WHERE a.workspace_id = ? ORDER BY m.id DESC""",
        (workspace_id,),
    ):
        result.setdefault(artifact_id, []).append(
            {"id": media_id, "path": path, "name": os.path.basename(path)}
        )
    return result


def _require_work_outcome(conn, row, work_id):
    if conn.execute(
        "SELECT 1 FROM workspace_artifact_input WHERE artifact_id = ?", (row["id"],)
    ).fetchone():
        raise HTTPException(409, "加工输入快照不能选为成果或同步到媒体库")
    entries = state_snapshot(conn, row["workspace_id"])["entries"]
    try:
        state = json.loads(
            entries.get(f"omnigallery:workspace-works-v2:{row['workspace_id']}", "{}")
        )
    except (TypeError, ValueError):
        state = {}
    works = state.get("works", []) if isinstance(state, dict) and state.get("version") == 2 else []
    path = f"workspace-artifact:{row['id']}"
    if isinstance(works, list):
        for work in works:
            if not isinstance(work, dict) or work.get("id") != work_id:
                continue
            outputs = work.get("outputs", [])
            if isinstance(outputs, list) and any(
                isinstance(asset, dict) and asset.get("path") == path for asset in outputs
            ):
                return
    raise HTTPException(409, "请先将产物选为该作品的成果，再同步到媒体库")


@storage_operation
def save_workspace_artifact(
    req: SaveArtifact, source_image_base64: str = "", *, input_owner: str = "", lineage=None
):
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
    name = _artifact_name(req.name, req.format)
    suffix = IMAGE_FORMATS[req.format][1]
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
        if input_owner:
            conn.execute(
                "INSERT INTO workspace_artifact_input VALUES (?, ?)", (artifact_id, input_owner)
            )
        if lineage is None and req.document_id and req.source == "ai_image_edit":
            _, lineage = production_context(conn, workspace_id, req.document_id)
        if lineage:
            conn.execute(
                "INSERT INTO workspace_artifact_lineage VALUES (?, ?)",
                (artifact_id, json.dumps(lineage, ensure_ascii=False)),
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
        "synced_media": [],
        "lineage": lineage or {},
        **({"input_owner": input_owner} if input_owner else {}),
    }


def mount_workspace_artifact_routes(
    app,
    base: str,
    verify_secret,
    write_permission_required,
    cli_scanned_paths=(),
    check_path_trust: Callable[[str], None] | None = None,
):
    from omnigallery.workspaces.home import mount_workspace_home_routes

    mount_workspace_home_routes(app, base, verify_secret, write_permission_required, artifact_root)
    route = base + "/workspace_artifacts"

    @app.get(route, dependencies=[Depends(verify_secret)])
    def list_artifacts(workspace_id: str):
        conn = Database.get_connection()
        workspace_id = _uuid(workspace_id)
        rows = conn.execute(
            """SELECT a.*, COALESCE(o.document_id, ''), COALESCE(o.document_revision, ''),
                EXISTS (SELECT 1 FROM workspace_artifact_collection c
                        JOIN media m ON m.id = c.media_id WHERE c.artifact_id = a.id),
                COALESCE(l.source_json, '{}')
                FROM workspace_artifact a
                LEFT JOIN workspace_artifact_origin o ON o.artifact_id = a.id
                LEFT JOIN workspace_artifact_lineage l ON l.artifact_id = a.id
                LEFT JOIN workspace_artifact_input i ON i.artifact_id = a.id
                WHERE a.workspace_id = ? AND i.artifact_id IS NULL
                ORDER BY a.created_at DESC, a.id DESC""",
            (workspace_id,),
        ).fetchall()
        synced_media = _synced_media(conn, workspace_id)
        return [
            {
                **_public(row),
                "document_id": row[10],
                "document_revision": row[11],
                "collected": bool(row[12]),
                "synced_media": synced_media.get(row[0], []),
                "lineage": json.loads(row[13]),
            }
            for row in rows
        ]

    @app.get(base + "/workspace_inputs", dependencies=[Depends(verify_secret)])
    def list_inputs(workspace_id: str):
        rows = (
            Database.get_connection()
            .execute(
                """SELECT a.*, i.production_id FROM workspace_artifact a
                JOIN workspace_artifact_input i ON i.artifact_id = a.id
                WHERE a.workspace_id = ?""",
                (_uuid(workspace_id),),
            )
            .fetchall()
        )
        return [{**_public(row), "input_owner": row[10]} for row in rows]

    @app.post(
        base + "/workspace_inputs",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def save_input(req: SaveInput):
        return save_workspace_artifact(req, input_owner=req.production_id)

    @app.delete(
        base + "/workspace_inputs",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    @storage_operation
    def delete_inputs(workspace_id: str, production_id: str):
        conn = Database.get_connection()
        workspace_id = _uuid(workspace_id)
        with conn:
            conn.execute("BEGIN IMMEDIATE")
            name, _ = production_context(conn, workspace_id, production_id)
            if name:
                raise HTTPException(409, "请先删除制作文件，再清理其输入快照")
            rows = conn.execute(
                """SELECT a.* FROM workspace_artifact a JOIN workspace_artifact_input i ON i.artifact_id=a.id
                WHERE a.workspace_id=? AND i.production_id=?""",
                (workspace_id, production_id),
            ).fetchall()
            ids = [row[0] for row in rows]
            _delete_metadata(conn, ids)
            conn.executemany("DELETE FROM workspace_artifact WHERE id=?", ((item,) for item in ids))
        for values in rows:
            row = _public(values)
            (artifact_root() / workspace_id / (row["id"] + IMAGE_FORMATS[row["format"]][1])).unlink(
                missing_ok=True
            )
        return {"deleted": len(ids)}

    @app.post(route, dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def save_artifact(req: SaveArtifact):
        return save_workspace_artifact(req)

    @app.put(
        route + "/{artifact_id}",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    @storage_operation
    def rename_artifact(artifact_id: str, req: RenameArtifact):
        conn = Database.get_connection()
        row = _row(conn, artifact_id)
        name = _artifact_name(req.name, row["format"])
        with conn:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute("UPDATE workspace_artifact SET name = ? WHERE id = ?", (name, row["id"]))
            update_artifact_references(conn, row["workspace_id"], row["id"], name)
        return {"name": name}

    @app.get(route + "/{artifact_id}/file", dependencies=[Depends(verify_secret)])
    def artifact_file(artifact_id: str, download: bool = False):
        row = _row(Database.get_connection(), artifact_id)
        return FileResponse(
            _file(row),
            media_type=ARTIFACT_FORMATS[row["format"]][2],
            filename=row["name"] if download else None,
            content_disposition_type="attachment" if download else "inline",
        )

    @app.get(route + "/{artifact_id}/thumbnail", dependencies=[Depends(verify_secret)])
    def artifact_thumbnail(artifact_id: str, size: int = 160):
        if size < 32 or size > 1024:
            raise HTTPException(422, "缩略图尺寸无效")
        row = _row(Database.get_connection(), artifact_id)
        if row["kind"] != "image":
            raise HTTPException(422, "此素材没有图片缩略图")
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
        with conn:
            conn.execute("BEGIN IMMEDIATE")
            update_artifact_references(conn, row["workspace_id"], row["id"])
            _delete_metadata(conn, [row["id"]])
            conn.execute("DELETE FROM workspace_artifact WHERE id = ?", (row["id"],))
            _file(row).unlink()
            _source_file(row).unlink(missing_ok=True)
        return {"ok": True}

    @app.delete(route, dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def delete_workspace_artifacts(workspace_id: str):
        workspace_id = _uuid(workspace_id)
        conn = Database.get_connection()
        with task_lock, storage_lock:
            create_task_table(conn)
            conn.execute("DELETE FROM studio_task WHERE workspace_id = ?", (workspace_id,))
            conn.execute("DELETE FROM studio_task_sequence WHERE workspace_id = ?", (workspace_id,))
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
        _require_work_outcome(conn, row, req.work_id)
        destination = None
        if req.overwrite_media_id is not None:
            synced = conn.execute(
                """SELECT m.path FROM workspace_artifact_collection c
                JOIN media m ON m.id = c.media_id
                WHERE c.artifact_id = ? AND c.media_id = ?""",
                (row["id"], req.overwrite_media_id),
            ).fetchone()
            if not synced:
                raise HTTPException(409, "同步文件已不在媒体库中，请刷新后重新同步")
            destination = Path(synced[0])
            if destination.is_symlink():
                raise HTTPException(422, "同步文件是链接，请重新选择同步目录")
            destination = destination.resolve()
            suffixes = {".jpg", ".jpeg"} if row["format"] == "jpeg" else {"." + row["format"]}
            if destination.suffix.lower() not in suffixes:
                raise HTTPException(422, "同步文件的格式已改变，请重新选择同步目录")
            directory = destination.parent
        else:
            if not req.directory:
                raise HTTPException(422, "请选择媒体库中的文件夹")
            directory = Path(req.directory).resolve()
        if check_path_trust:
            check_path_trust(str(directory))
            if destination is not None:
                check_path_trust(str(destination))
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
                parent = os.path.normcase(os.path.realpath(root))
                return (
                    os.path.isdir(parent)
                    and os.path.commonpath((os.path.normcase(str(directory)), parent)) == parent
                )
            except ValueError:
                return False

        if not any(under_scanned_root(root) for root in scanned_paths):
            raise HTTPException(422, "所选文件夹不在媒体库扫描目录内")
        if destination is not None:
            temporary = None
            try:
                with _file(row).open("rb") as source:
                    with tempfile.NamedTemporaryFile(
                        dir=directory, prefix=".sync-", delete=False
                    ) as output:
                        temporary = Path(output.name)
                        shutil.copyfileobj(source, output)
                os.replace(temporary, destination)
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
            if row["kind"] == "audio":
                # Preserve the linked media row without attaching image dimension tags.
                with conn:
                    conn.execute(
                        "UPDATE media SET size = ?, date = ? WHERE id = ?",
                        (
                            destination.stat().st_size,
                            get_modified_date(str(destination)),
                            req.overwrite_media_id,
                        ),
                    )
            else:
                refresh_overwritten_image_data(str(destination), row["width"], row["height"])
        else:
            suffix = ARTIFACT_FORMATS[row["format"]][1]
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
            if metadata["description"] or req.overwrite_media_id is not None:
                indexed.update_description(conn, metadata["description"])
            if metadata["generation_info"] or req.overwrite_media_id is not None:
                indexed.update_exif(conn, metadata["generation_info"])
            if metadata["inferred_prompt"] or req.overwrite_media_id is not None:
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
        return {
            "path": str(destination),
            "collected": bool(indexed),
            "media_id": indexed.id if indexed else None,
            "overwritten": req.overwrite_media_id is not None,
        }
