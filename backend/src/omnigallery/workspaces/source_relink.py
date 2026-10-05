"""Read-only source health checks and bounded, trusted-directory relink discovery."""

import json
import os
import time
from pathlib import Path
from typing import Literal

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from omnigallery.infrastructure.database import Database
from omnigallery.workspaces.artifacts import _uuid
from omnigallery.workspaces.state import state_snapshot
from omnigallery.workspaces.video_media import SUFFIXES, probe_media, resolve_media

MAX_SCAN_ENTRIES = 50000
MAX_SCAN_DIRECTORIES = 2000
MAX_CANDIDATES = 2048
MAX_SCAN_SECONDS = 8


class RelinkContext(BaseModel):
    workspace_id: str
    document_id: str = Field(min_length=1, max_length=80, pattern=r"^[\w-]+$")
    kind: Literal["audio", "video"]


class SourceReference(BaseModel):
    path: str = Field(min_length=1, max_length=4096)
    kind: Literal["audio", "video", "image"]


class InspectSources(RelinkContext):
    sources: list[SourceReference] = Field(max_length=32)


class FindSources(RelinkContext):
    directory: str = Field(min_length=1, max_length=4096)
    names: list[str] = Field(min_length=1, max_length=1024)
    recursive: bool = True


def require_document(request: RelinkContext):
    workspace_id = _uuid(request.workspace_id)
    entries = state_snapshot(Database.get_connection(), workspace_id)["entries"]
    try:
        state = json.loads(entries.get(f"omnigallery:workspace-works-v2:{workspace_id}", "{}"))
        drafts = [draft for work in state.get("works", []) for draft in work.get("drafts", [])]
        if any(
            draft.get("id") == request.document_id and draft.get("kind") == request.kind
            for draft in drafts
        ):
            return
    except (ValueError, TypeError, AttributeError) as error:
        raise HTTPException(409, "工作区制作文件索引无法读取") from error
    raise HTTPException(409, "制作文件已删除或类型不匹配，请返回工作台")


def inspect_sources(request: InspectSources, check_path_trust):
    require_document(request)
    results = []
    for item in request.sources:
        row = {"path": item.path, "kind": item.kind}
        try:
            source = resolve_media(item.path, request.workspace_id, item.kind, check_path_trust)
            metadata = probe_media(source, item.kind)
            row.update(state="available", metadata=metadata, error="")
        except HTTPException as error:
            state = {404: "missing", 403: "unavailable", 422: "invalid"}.get(
                error.status_code, "error"
            )
            row.update(state=state, error=str(error.detail))
        except OSError:
            row.update(state="unavailable", error="无法读取源文件，请检查磁盘或权限")
        results.append(row)
    # A long probe may finish after the workspace or draft was removed. Never publish stale data.
    require_document(request)
    return {"sources": results}


def find_sources(request: FindSources, check_path_trust):
    require_document(request)
    check_path_trust(request.directory)
    root = Path(request.directory).resolve()
    check_path_trust(str(root))
    if not root.is_dir():
        raise HTTPException(404, "目标目录不存在或无法读取")
    if any(not name or len(name) > 512 or "/" in name or "\\" in name for name in request.names):
        raise HTTPException(422, "请使用素材文件名查找")
    names = {os.path.normcase(name) for name in request.names}
    pending = [root]
    visited = set()
    candidates = []
    scanned = 0
    skipped = 0
    complete = True
    deadline = time.monotonic() + MAX_SCAN_SECONDS
    while pending:
        if len(visited) >= MAX_SCAN_DIRECTORIES or time.monotonic() >= deadline:
            complete = False
            break
        directory = pending.pop()
        canonical = os.path.normcase(str(directory))
        if canonical in visited:
            continue
        visited.add(canonical)
        try:
            check_path_trust(str(directory))
            with os.scandir(directory) as iterator:
                for entry in iterator:
                    scanned += 1
                    if (
                        scanned > MAX_SCAN_ENTRIES
                        or len(candidates) >= MAX_CANDIDATES
                        or time.monotonic() >= deadline
                    ):
                        complete = False
                        break
                    # Never follow symlinks or directory junctions out of the requested tree.
                    if entry.is_symlink():
                        continue
                    target = Path(entry.path).resolve()
                    if not target.is_relative_to(root):
                        continue
                    if entry.is_dir(follow_symlinks=False):
                        if request.recursive:
                            pending.append(target)
                        continue
                    if (
                        not entry.is_file(follow_symlinks=False)
                        or os.path.normcase(entry.name) not in names
                    ):
                        continue
                    kind = next(
                        (
                            key
                            for key, suffixes in SUFFIXES.items()
                            if target.suffix.lower() in suffixes
                        ),
                        None,
                    )
                    if kind:
                        try:
                            check_path_trust(str(target))
                        except HTTPException:
                            skipped += 1
                            continue
                        candidates.append({"path": str(target), "name": entry.name, "kind": kind})
        except (OSError, HTTPException):
            if directory == root:
                raise HTTPException(403, "目标目录无法读取或不在可访问范围") from None
            skipped += 1
        if not complete:
            break
    require_document(request)
    return {
        "candidates": sorted(candidates, key=lambda row: os.path.normcase(row["path"])),
        "complete": complete and not skipped,
        "scanned_entries": scanned,
        "skipped_directories": skipped,
        "case_sensitive": os.name != "nt",
    }


def mount_source_relink_routes(app, base, verify_secret, check_path_trust):
    read = [Depends(verify_secret)]

    @app.post(base + "/source_relink/inspect", dependencies=read)
    def inspect(request: InspectSources):
        return inspect_sources(request, check_path_trust)

    @app.post(base + "/source_relink/candidates", dependencies=read)
    def candidates(request: FindSources):
        return find_sources(request, check_path_trust)
