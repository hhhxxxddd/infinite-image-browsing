"""Transactional SQLite persistence for works, editor documents and AI draft state."""

import json
import re
from urllib.parse import quote

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from omnigallery.infrastructure.database import Database

STATE_PREFIXES = (
    "audio-timeline-v1",
    "workspace-works-v2",
    "workspace-works-v1",
    "workbench-image-documents-v2",
    "workbench-image-document-v2",
    "ai-image-edit-v1",
    "ai-image-edit-asset-v1",
    "ai-image-edit-recent-v1",
    "ai-image-refs-v1",
    "ai-image-ref-v1",
    "ai-production-session-v1",
    "ai-production-choice-v1",
    "ai-production-parameters-v1",
    "ai-production-prompt-v1",
    "ai-production-negative-v1",
    "ai-production-generation-choice-v1",
    "ai-production-generation-parameters-v1",
    "ai-production-generation-prompt-v1",
    "ai-production-generation-negative-v1",
    "image-studio-recent-v1",
    "studio-production-choice-v1",
    "studio-production-prompt-v1",
    "studio-production-negative-v1",
)


def create_workspace_state_tables(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS workspace_state_revision (
        workspace_id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0,
        imported INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS workspace_state (
        workspace_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
        PRIMARY KEY (workspace_id, key)
    )""")


def _id(workspace_id):
    if not re.fullmatch(r"[\w-]{1,80}", workspace_id):
        raise HTTPException(422, "无效的工作区编号")
    return workspace_id


def _entries(workspace_id, entries):
    prefixes = tuple(f"omnigallery:{kind}:{workspace_id}" for kind in STATE_PREFIXES)
    for key, value in entries.items():
        if len(key) > 8192 or not any(key == p or key.startswith(p + ":") for p in prefixes):
            raise HTTPException(422, "草稿键不属于当前工作区")
        if value is not None and len(value.encode("utf-8")) > 16 * 1024 * 1024:
            raise HTTPException(413, "单份草稿过大")
    if (
        len(entries) > 50000
        or sum(len(v.encode("utf-8")) for v in entries.values() if v) > 64 * 1024 * 1024
    ):
        raise HTTPException(413, "工作区草稿数据过大")


def state_snapshot(conn, workspace_id):
    row = conn.execute(
        "SELECT revision, imported, deleted FROM workspace_state_revision WHERE workspace_id=?",
        (workspace_id,),
    ).fetchone()
    if row and row[2]:
        raise HTTPException(404, "工作区草稿已删除")
    return {
        "revision": row[0] if row else 0,
        "imported": bool(row and row[1]),
        "entries": dict(
            conn.execute(
                "SELECT key, value FROM workspace_state WHERE workspace_id=?", (workspace_id,)
            )
        ),
    }


class StateImport(BaseModel):
    entries: dict[str, str] = Field(default_factory=dict)


class StateUpdate(BaseModel):
    revision: int = Field(ge=0)
    changes: dict[str, str | None]


def import_workspace_state(conn, workspace_id, entries):
    _entries(workspace_id, entries)
    with conn:
        conn.execute("BEGIN IMMEDIATE")
        snapshot = state_snapshot(conn, workspace_id)
        if not entries:
            return snapshot
        if not snapshot["imported"]:
            conn.execute(
                "INSERT OR IGNORE INTO workspace_state_revision(workspace_id) VALUES (?)",
                (workspace_id,),
            )
            conn.executemany(
                "INSERT OR IGNORE INTO workspace_state VALUES (?, ?, ?)",
                [(workspace_id, key, value) for key, value in entries.items()],
            )
            conn.execute(
                "UPDATE workspace_state_revision SET imported=1, revision=revision+1 WHERE workspace_id=?",
                (workspace_id,),
            )
        return state_snapshot(conn, workspace_id)


def update_workspace_state(conn, workspace_id, request):
    _entries(workspace_id, request.changes)
    with conn:
        conn.execute("BEGIN IMMEDIATE")
        snapshot = state_snapshot(conn, workspace_id)
        if snapshot["revision"] != request.revision:
            raise HTTPException(409, "工作区已在其他窗口更新，请刷新后重试；本次修改尚未保存")
        conn.execute(
            "INSERT OR IGNORE INTO workspace_state_revision(workspace_id) VALUES (?)",
            (workspace_id,),
        )
        for key, value in request.changes.items():
            if value is None:
                conn.execute(
                    "DELETE FROM workspace_state WHERE workspace_id=? AND key=?",
                    (workspace_id, key),
                )
            else:
                conn.execute(
                    "INSERT INTO workspace_state VALUES (?, ?, ?) ON CONFLICT(workspace_id,key) DO UPDATE SET value=excluded.value",
                    (workspace_id, key, value),
                )
        conn.execute(
            "UPDATE workspace_state_revision SET imported=1, revision=revision+1 WHERE workspace_id=?",
            (workspace_id,),
        )
        return {"revision": snapshot["revision"] + 1}


def delete_workspace_state(conn, workspace_id):
    with conn:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("DELETE FROM workspace_state WHERE workspace_id=?", (workspace_id,))
        conn.execute(
            """INSERT INTO workspace_state_revision VALUES (?, 1, 1, 1)
            ON CONFLICT(workspace_id) DO UPDATE SET deleted=1, imported=1, revision=revision+1""",
            (workspace_id,),
        )


def update_artifact_references(conn, workspace_id, artifact_id, name=None):
    """Keep outcome names/deletions and AI references in the artifact's transaction.

    Canvas layers remain intact: an unavailable input must never erase a composition.
    """
    path = f"workspace-artifact:{artifact_id}"
    encoded = quote(path, safe="~()*!.'-")
    changed = False
    for key, raw in conn.execute(
        "SELECT key, value FROM workspace_state WHERE workspace_id=?", (workspace_id,)
    ).fetchall():
        kind = key.split(":", 2)[1]
        value = raw
        remove = False
        if kind in {"workspace-works-v1", "workspace-works-v2"}:
            try:
                state = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(state, dict) or not isinstance(state.get("works"), list):
                continue
            touched = False
            for work in state["works"]:
                if not isinstance(work, dict):
                    continue
                for field in ("assets", "outputs"):
                    assets = work.get(field)
                    if not isinstance(assets, list):
                        continue
                    matches = [a for a in assets if isinstance(a, dict) and a.get("path") == path]
                    if not matches:
                        continue
                    touched = True
                    if name is None:
                        work[field] = [a for a in assets if a not in matches]
                    else:
                        for asset in matches:
                            asset["name"] = name
            if touched:
                value = json.dumps(state, ensure_ascii=False, separators=(",", ":"))
        elif name is None:
            if kind in {"ai-image-edit-v1", "ai-image-refs-v1"} and key.endswith(":" + encoded):
                remove = True
            elif kind == "ai-image-ref-v1" and encoded in key.split(":"):
                remove = True
            elif kind == "ai-image-edit-asset-v1" and raw == path:
                remove = True
            elif kind in {"ai-image-refs-v1", "ai-image-edit-recent-v1", "image-studio-recent-v1"}:
                try:
                    paths = json.loads(raw)
                except ValueError:
                    continue
                if isinstance(paths, list) and path in paths:
                    value = json.dumps([p for p in paths if p != path], ensure_ascii=False)
        if remove:
            conn.execute(
                "DELETE FROM workspace_state WHERE workspace_id=? AND key=?", (workspace_id, key)
            )
        elif value != raw:
            conn.execute(
                "UPDATE workspace_state SET value=? WHERE workspace_id=? AND key=?",
                (value, workspace_id, key),
            )
        else:
            continue
        changed = True
    if changed:
        conn.execute(
            """INSERT INTO workspace_state_revision VALUES (?, 1, 1, 0)
            ON CONFLICT(workspace_id) DO UPDATE SET revision=revision+1""",
            (workspace_id,),
        )


def remap_workspace_state(conn, source, destination):
    """Called inside the media rename transaction; never rewrite captions or prompts."""
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE name='workspace_state'").fetchone():
        return
    encoded_source, encoded_destination = (
        quote(source, safe="~()*!.'-"),
        quote(destination, safe="~()*!.'-"),
    )

    def remap(value):
        if isinstance(value, list):
            return [remap(item) for item in value]
        if not isinstance(value, dict):
            return value
        result = {key: remap(item) for key, item in value.items()}
        for key in ("inputPaths", "referencePaths"):
            if isinstance(value.get(key), list):
                result[key] = [destination if item == source else item for item in value[key]]
        if value.get("sourcePath") == source:
            result["sourcePath"] = destination
        if value.get("path") == source:
            result["path"] = destination
            if value.get("name") == re.split(r"[\\/]", source)[-1]:
                result["name"] = re.split(r"[\\/]", destination)[-1]
        return result

    changed = set()
    for workspace_id, key, raw in conn.execute(
        "SELECT workspace_id, key, value FROM workspace_state"
    ).fetchall():
        next_key = ":".join(
            encoded_destination if part == encoded_source else part for part in key.split(":")
        )
        if ":ai-image-edit-asset-v1:" in key:
            value = destination if raw == source else raw
        else:
            try:
                parsed = json.loads(raw)
            except (ValueError, TypeError):
                continue
            if ":ai-image-refs-v1:" in key or "-recent-v1:" in key:
                parsed = (
                    [destination if item == source else item for item in parsed]
                    if isinstance(parsed, list)
                    else parsed
                )
            remapped = remap(parsed)
            if remapped == json.loads(raw) and next_key == key:
                continue
            value = json.dumps(remapped, ensure_ascii=False, separators=(",", ":"))
        if (
            next_key != key
            and conn.execute(
                "SELECT 1 FROM workspace_state WHERE workspace_id=? AND key=?",
                (workspace_id, next_key),
            ).fetchone()
        ):
            continue
        if value != raw or next_key != key:
            conn.execute(
                "UPDATE workspace_state SET key=?, value=? WHERE workspace_id=? AND key=?",
                (next_key, value, workspace_id, key),
            )
            changed.add(workspace_id)
    for workspace_id in changed:
        conn.execute(
            "UPDATE workspace_state_revision SET revision=revision+1 WHERE workspace_id=?",
            (workspace_id,),
        )


def mount_workspace_state_routes(app, api_base, verify_secret, write_permission_required):
    base = f"{api_base}/workspace_state/{{workspace_id}}"
    read = [Depends(verify_secret)]
    write = [Depends(verify_secret), Depends(write_permission_required)]

    @app.get(base, dependencies=read)
    def load_state(workspace_id: str):
        conn = Database.get_connection()
        with conn:
            conn.execute("BEGIN")
            return state_snapshot(conn, _id(workspace_id))

    @app.post(base + "/import", dependencies=write)
    def import_state(workspace_id: str, request: StateImport):
        return import_workspace_state(Database.get_connection(), _id(workspace_id), request.entries)

    @app.patch(base, dependencies=write)
    def save_state(workspace_id: str, request: StateUpdate):
        return update_workspace_state(Database.get_connection(), _id(workspace_id), request)

    @app.delete(base, dependencies=write)
    def remove_state(workspace_id: str):
        delete_workspace_state(Database.get_connection(), _id(workspace_id))
        return {"deleted": True}
