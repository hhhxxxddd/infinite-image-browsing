"""Keep workspace references attached to indexed media across file renames."""

import json
import os
import sqlite3


def resolve_media_paths(conn: sqlite3.Connection, ids: list[int], is_path_trusted) -> list[dict]:
    if not ids:
        return []
    rows = conn.execute(f"SELECT id, path FROM image WHERE id IN ({','.join('?' for _ in ids)})", ids)
    return [{"id": media_id, "path": path, "name": os.path.basename(path)}
            for media_id, path in rows if is_path_trusted(path)]


def rename_media_file(conn: sqlite3.Connection, source: str, name: str) -> str:
    """Rename on disk first; roll back both the index and file on DB failure."""
    if not name or name in (".", "..") or any(char in name for char in ("/", "\\", "\0", ":")):
        raise ValueError("请输入单个有效的文件名")
    source = os.path.normpath(source)
    destination = os.path.join(os.path.dirname(source), name)
    if not os.path.isfile(source):
        raise FileNotFoundError(source)
    if destination == source:
        return source
    if os.path.lexists(destination):
        raise FileExistsError(destination)
    os.rename(source, destination)
    try:
        with conn:
            conn.execute("UPDATE image SET path = ? WHERE path = ?", (destination, source))
            row = conn.execute("SELECT setting_json FROM global_setting WHERE name = 'workbench_projects'").fetchone()
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
                                asset.update(path=destination, name=name)
                                changed = True
                if changed:
                    conn.execute("UPDATE global_setting SET setting_json = ? WHERE name = 'workbench_projects'",
                                 (json.dumps(projects, ensure_ascii=False),))
    except Exception:
        os.rename(destination, source)
        raise
    return destination
