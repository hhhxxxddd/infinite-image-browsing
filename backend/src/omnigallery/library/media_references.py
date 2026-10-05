"""Keep workspace references attached to indexed media across file renames."""

import hashlib
import json
import os
import re
import sqlite3
import uuid

from omnigallery.library.file_operations import move_file_exclusive
from omnigallery.library.media_types import is_image_file
from omnigallery.metadata.generation import get_img_geninfo_txt_path
from omnigallery.workspaces.state import remap_workspace_state


def _read_image_task_identity(data):
    try:
        saved = json.loads(data)
        source = saved.get("source_path") if isinstance(saved, dict) else None
        if not isinstance(source, str) or not source:
            return None
        key = saved.get("document_key")
        return {
            "document_key": key
            if isinstance(key, str) and re.fullmatch(r"[a-f0-9]{64}", key)
            else hashlib.sha256(("media:" + source).encode()).hexdigest(),
            "source_path": source,
        }
    except (ValueError, TypeError):
        return None


def media_image_task_identity(conn: sqlite3.Connection, path: str) -> dict:
    """Keep legacy path-hash task receipts attached to the same media after a rename."""
    path = os.path.normpath(path)
    row = conn.execute("SELECT id FROM media WHERE path = ?", (path,)).fetchone()
    path_key = "image_editor_identity:path:" + hashlib.sha256(path.encode()).hexdigest()
    key = f"image_editor_identity:media:{row[0]}" if row else path_key
    saved = conn.execute(
        "SELECT setting_json FROM global_setting WHERE name IN (?, ?) ORDER BY name = ? DESC",
        (key, path_key, key),
    ).fetchall()
    for value in saved:
        identity = _read_image_task_identity(value[0])
        if identity:
            return identity
    # A different media may now occupy a name whose legacy scope moved with its previous owner.
    # Allocate only that reused name; existing task directories and submission receipts stay intact.
    for name, data in conn.execute(
        "SELECT name, setting_json FROM global_setting WHERE name LIKE 'image_editor_identity:%'"
    ):
        identity = _read_image_task_identity(data)
        if name not in (key, path_key) and identity and identity["source_path"] == path:
            token = f"media-id:{row[0]}" if row else f"media:{path}:{uuid.uuid4()}"
            identity = {
                "document_key": hashlib.sha256(token.encode()).hexdigest(),
                "source_path": path,
            }
            conn.execute(
                "INSERT INTO global_setting (name, setting_json) VALUES (?, ?) "
                "ON CONFLICT(name) DO UPDATE SET setting_json = excluded.setting_json",
                (key, json.dumps(identity, ensure_ascii=False)),
            )
            return identity
    return {
        "document_key": hashlib.sha256(("media:" + path).encode()).hexdigest(),
        "source_path": path,
    }


def _retain_image_task_identity(conn, source, destination):
    if not is_image_file(source) and not source.lower().endswith((".tif", ".tiff")):
        return
    identity = media_image_task_identity(conn, source)
    row = conn.execute("SELECT id FROM media WHERE path = ?", (source,)).fetchone()
    # Indexed media retain their ID; directory-only media use their new path as the lookup key.
    key = (
        f"image_editor_identity:media:{row[0]}"
        if row
        else ("image_editor_identity:path:" + hashlib.sha256(destination.encode()).hexdigest())
    )
    conn.execute(
        "INSERT INTO global_setting (name, setting_json) VALUES (?, ?) "
        "ON CONFLICT(name) DO UPDATE SET setting_json = excluded.setting_json",
        (key, json.dumps(identity, ensure_ascii=False)),
    )
    source_key = "image_editor_identity:path:" + hashlib.sha256(source.encode()).hexdigest()
    if source_key != key:
        conn.execute("DELETE FROM global_setting WHERE name = ?", (source_key,))


def resolve_media_paths(conn: sqlite3.Connection, ids: list[int], is_path_trusted) -> list[dict]:
    if not ids:
        return []
    rows = conn.execute(
        f"SELECT id, path FROM media WHERE id IN ({','.join('?' for _ in ids)})", ids
    )
    return [
        {"id": media_id, "path": path, "name": os.path.basename(path)}
        for media_id, path in rows
        if is_path_trusted(path)
    ]


def rename_media_file(conn: sqlite3.Connection, source: str, name: str) -> str:
    """Rename on disk first; roll back both the index and file on DB failure."""
    if not name or name in (".", "..") or any(char in name for char in ("/", "\\", "\0", ":")):
        raise ValueError("请输入单个有效的文件名")
    source = os.path.normpath(source)
    destination = os.path.join(os.path.dirname(source), name)
    return move_media_file(conn, source, destination)


def move_media_file(conn: sqlite3.Connection, source: str, destination: str) -> str:
    """Transfer the media and its sidecar, rolling both back on index failure."""
    source, destination = os.path.normpath(source), os.path.normpath(destination)
    if not os.path.isfile(source):
        raise FileNotFoundError(source)
    if destination == source:
        return source
    if os.path.lexists(destination):
        raise FileExistsError(destination)
    pairs = [(source, destination)]
    sidecar = get_img_geninfo_txt_path(source)
    if sidecar and sidecar != source:
        target_sidecar = os.path.splitext(destination)[0] + ".txt"
        if os.path.normcase(sidecar) != os.path.normcase(target_sidecar):
            if os.path.lexists(target_sidecar) or target_sidecar == destination:
                raise FileExistsError(target_sidecar)
            pairs.append((sidecar, target_sidecar))
    moved = []
    try:
        for original, target in pairs:
            move_file_exclusive(original, target)
            moved.append((original, target))
        with conn:
            _retain_image_task_identity(conn, source, destination)
            conn.execute("UPDATE media SET path = ? WHERE path = ?", (destination, source))
            remap_workspace_state(conn, source, destination)
            row = conn.execute(
                "SELECT setting_json FROM global_setting WHERE name = 'workbench_projects'"
            ).fetchone()
            if row:
                projects = json.loads(row[0])
                changed = False
                items = projects.get("items", []) if isinstance(projects, dict) else []
                for workspace in items if isinstance(items, list) else []:
                    if not isinstance(workspace, dict):
                        continue
                    for role in ("assets", "outputs"):
                        assets = workspace.get(role)
                        for asset in assets if isinstance(assets, list) else []:
                            if isinstance(asset, dict) and asset.get("path") == source:
                                asset.update(path=destination, name=os.path.basename(destination))
                                changed = True
                if changed:
                    conn.execute(
                        "UPDATE global_setting SET setting_json = ? WHERE name = 'workbench_projects'",
                        (json.dumps(projects, ensure_ascii=False),),
                    )
    except Exception:
        for original, target in reversed(moved):
            move_file_exclusive(target, original)
        raise
    return destination
