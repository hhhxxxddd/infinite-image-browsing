"""Hide task history without discarding paid/export submission receipts or media."""

import time

from fastapi import HTTPException


def create_task_record_table(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS task_record_deletion (
        source TEXT NOT NULL, task_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
        deleted_at REAL NOT NULL, PRIMARY KEY (source, task_id))""")


def task_record_deleted(conn, source, task_id):
    return bool(
        conn.execute(
            "SELECT 1 FROM task_record_deletion WHERE source=? AND task_id=?",
            (source, task_id),
        ).fetchone()
    )


def with_task_record_deletion(conn, source, task):
    task = with_task_artifact_availability(conn, task)
    if task_record_deleted(conn, source, task["id"]):
        return {**task, "deleted": True}
    return task


def with_task_artifact_availability(conn, task):
    """Annotate missing results without rewriting the historical submission receipt."""
    artifact = task.get("artifact")
    ids = list(
        dict.fromkeys(
            item
            for item in (
                task.get("artifact_id"),
                artifact.get("id") if isinstance(artifact, dict) else None,
                *(
                    result.get("artifact_id")
                    for result in task.get("results", [])
                    if isinstance(result, dict)
                ),
            )
            if isinstance(item, str) and item
        )
    )
    if (
        not ids
        or not conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='workspace_artifact'"
        ).fetchone()
    ):
        return task
    existing = {
        row[0]
        for row in conn.execute(
            "SELECT id FROM workspace_artifact WHERE id IN (" + ",".join("?" for _ in ids) + ")",
            ids,
        )
    }
    deleted = [artifact_id for artifact_id in ids if artifact_id not in existing]
    return {**task, "deleted_artifact_ids": deleted} if deleted else task


def delete_task_record(conn, source, task):
    """The caller holds the same lock as task state changes and worker publication."""
    if task_record_deleted(conn, source, task["id"]):
        return {"deleted": task["id"]}
    if not task.get(
        "deletable", task["state"] in ("completed", "failed", "cancelled", "interrupted")
    ):
        raise HTTPException(409, "任务尚未确认结束，请等待完成或先取消任务")
    conn.execute(
        "INSERT INTO task_record_deletion VALUES (?,?,?,?) ON CONFLICT(source,task_id) DO NOTHING",
        (source, task["id"], task["workspace_id"], time.time()),
    )
    conn.commit()
    return {"deleted": task["id"]}
