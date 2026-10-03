"""Keep workspace references attached to indexed media across file renames."""

import json
import os
import sqlite3

from omnigallery.library.file_operations import move_file_exclusive
from omnigallery.metadata.generation import get_img_geninfo_txt_path
from omnigallery.workspaces.state import remap_workspace_state


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
