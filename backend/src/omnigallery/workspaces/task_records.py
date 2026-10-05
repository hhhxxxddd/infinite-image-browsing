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
    if task_record_deleted(conn, source, task["id"]):
        return {**task, "deleted": True}
    return task


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
