"""Persistent task status with bounded, browser-independent image processing."""

import copy
import json
import logging
import re
import threading
import time
import uuid
from contextlib import contextmanager

from fastapi import HTTPException

task_lock = threading.RLock()
MAX_TASK_CONCURRENCY = 15
TASK_COLUMNS = (
    "id",
    "workspace_id",
    "name",
    "state",
    "created_at",
    "updated_at",
    "error",
    "artifact_id",
)


def create_task_table(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS studio_task (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL,
        state TEXT NOT NULL, created_at REAL NOT NULL, updated_at REAL NOT NULL,
        error TEXT NOT NULL DEFAULT '', artifact_id TEXT NOT NULL DEFAULT '')""")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS studio_task_workspace ON studio_task(workspace_id, created_at)"
    )
    conn.execute("""CREATE TABLE IF NOT EXISTS studio_task_sequence (
        workspace_id TEXT NOT NULL, production_id TEXT NOT NULL, value INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, production_id))""")
    conn.commit()


def ai_output_stem(name):
    stem = re.sub(r"\.(?:png|jpe?g|webp|gif|bmp|tiff?)$", "", name.strip(), flags=re.I)
    stem = re.sub(r"(?:[- _]AI(?:[- _]?(?:结果|产物|\d+))?)+$", "", stem, flags=re.I)
    stem = re.sub(r"\.(?:png|jpe?g|webp|gif|bmp|tiff?)$", "", stem, flags=re.I)
    return (stem.strip("- _") or "未命名图片")[:100]


class StudioTasks:
    def __init__(self, connection, save_result, concurrency=2):
        self.connection = connection
        self.save_result = save_result
        self.condition = threading.Condition()
        self.active = 0
        self.set_concurrency(concurrency)
        conn = connection()
        create_task_table(conn)
        # Never replay an uncertain paid request after process restart.
        conn.execute(
            "UPDATE studio_task SET state='failed', error=?, updated_at=? WHERE state IN ('queued','running')",
            ("本地服务已重启，任务跟踪中断；请先检查云端任务，再决定是否重新提交", time.time()),
        )
        conn.commit()

    def set_concurrency(self, concurrency):
        if type(concurrency) is not int or not 1 <= concurrency <= MAX_TASK_CONCURRENCY:
            raise ValueError(f"Concurrency must be between 1 and {MAX_TASK_CONCURRENCY}")
        with self.condition:
            self.concurrency = concurrency
            self.condition.notify_all()

    @contextmanager
    def slot(self):
        with self.condition:
            self.condition.wait_for(lambda: self.active < self.concurrency)
            self.active += 1
        try:
            yield
        finally:
            with self.condition:
                self.active -= 1
                self.condition.notify_all()

    def list(self, workspace_id):
        rows = (
            self.connection()
            .execute(
                """SELECT * FROM studio_task WHERE workspace_id = ?
            ORDER BY CASE WHEN state IN ('queued','running') THEN 0 ELSE 1 END, created_at DESC LIMIT 100""",
                (workspace_id,),
            )
            .fetchall()
        )
        return [dict(zip(TASK_COLUMNS, row, strict=False)) for row in rows]

    def submit(self, workspace_id, name, run, generation_info, source_image_base64="", origin=None):
        with task_lock:
            conn = self.connection()
            limit = max(4, self.concurrency * 2)
            if (
                conn.execute(
                    "SELECT COUNT(*) FROM studio_task WHERE state IN ('queued','running')"
                ).fetchone()[0]
                >= limit
            ):
                raise HTTPException(429, f"后台已有 {limit} 个任务，请等待其中一个完成后再提交")
            task_id, stamp = str(uuid.uuid4()), time.time()
            with conn:
                conn.execute("BEGIN IMMEDIATE")
                if origin and origin.get("document_id"):
                    sequence = conn.execute(
                        """INSERT INTO studio_task_sequence VALUES (?, ?, 1)
                        ON CONFLICT(workspace_id, production_id) DO UPDATE SET value=value+1
                        RETURNING value""",
                        (workspace_id, origin["document_id"]),
                    ).fetchone()[0]
                    name = f"{ai_output_stem(name)}-AI-{sequence:03d}"
                row = (task_id, workspace_id, name, "queued", stamp, stamp, "", "")
                conn.execute("INSERT INTO studio_task VALUES (?,?,?,?,?,?,?,?)", row)
            threading.Thread(
                target=self._run,
                args=(
                    task_id,
                    workspace_id,
                    name,
                    run,
                    generation_info,
                    source_image_base64,
                    copy.deepcopy(origin or {}),
                ),
                daemon=True,
            ).start()
            return dict(zip(TASK_COLUMNS, row, strict=False))

    def _run(self, task_id, workspace_id, name, run, generation_info, source_image_base64, origin):
        with self.slot():
            conn = self.connection()
            with task_lock:
                changed = conn.execute(
                    "UPDATE studio_task SET state='running', updated_at=? WHERE id=? AND state='queued'",
                    (time.time(), task_id),
                ).rowcount
                conn.commit()
            if not changed:
                return
            try:
                result = run()
                with task_lock:
                    # Deleting a workspace also removes its tasks. Never recreate its files.
                    if not conn.execute(
                        "SELECT 1 FROM studio_task WHERE id=?", (task_id,)
                    ).fetchone():
                        return
                    info = {**generation_info, "job_id": result.get("job_id", "")}
                    description = "\n".join(
                        [
                            info.pop("prompt", ""),
                            "Negative prompt: " + info.pop("negative_prompt", ""),
                            "extraJsonMetaInfo: " + json.dumps(info, ensure_ascii=False),
                        ]
                    )
                    artifact = self.save_result(
                        workspace_id,
                        name,
                        {**result, "source_image_base64": source_image_base64, **origin},
                        description,
                    )
                    conn.execute(
                        "UPDATE studio_task SET state='completed', artifact_id=?, updated_at=? WHERE id=?",
                        (artifact["id"], time.time(), task_id),
                    )
                    conn.commit()
            except Exception as error:
                logging.getLogger(__name__).exception("Background image task %s failed", task_id)
                conn.rollback()
                # Provider errors are already sanitized; do not publish raw exceptions/credentials.
                detail = (
                    str(error.detail)
                    if isinstance(error, HTTPException)
                    else "后台加工或保存结果失败，请检查本地服务日志"
                )
                with task_lock:
                    conn.execute(
                        "UPDATE studio_task SET state='failed', error=?, updated_at=? WHERE id=?",
                        (detail, time.time(), task_id),
                    )
                    conn.commit()
