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
    "results",
    "document_id",
    "purpose",
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
    columns = {row[1] for row in conn.execute("PRAGMA table_info(studio_task)")}
    for name, default in (("results", "[]"), ("document_id", ""), ("purpose", "image_edit")):
        if name not in columns:
            conn.execute(
                f"ALTER TABLE studio_task ADD COLUMN {name} TEXT NOT NULL DEFAULT '{default}'"
            )
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "workspace_artifact_origin" in tables:
        conn.execute("""UPDATE studio_task SET document_id=COALESCE(
            (SELECT document_id FROM workspace_artifact_origin WHERE artifact_id=studio_task.artifact_id),'')
            WHERE document_id='' AND artifact_id!=''""")
    if "workspace_artifact" in tables:
        conn.execute("""UPDATE studio_task SET purpose='image_generation' WHERE artifact_id IN
            (SELECT id FROM workspace_artifact WHERE source='ai_image_generation')""")
    conn.commit()


def public_task(row):
    item = dict(zip(TASK_COLUMNS, row, strict=False))
    item["results"] = json.loads(item["results"])
    if not item["results"] and item["artifact_id"]:
        item["results"] = [{"artifact_id": item["artifact_id"], "label": "", "node_id": ""}]
    return item


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
        return [public_task(row) for row in rows]

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
                row = (
                    task_id,
                    workspace_id,
                    name,
                    "queued",
                    stamp,
                    stamp,
                    "",
                    "",
                    "[]",
                    (origin or {}).get("document_id", ""),
                    (origin or {}).get("purpose", "image_edit"),
                )
                conn.execute("INSERT INTO studio_task VALUES (?,?,?,?,?,?,?,?,?,?,?)", row)
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
            return public_task(row)

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
            saved_results = []
            try:
                result = run()
                images = result.get("images", [result])
                if not images or len(images) > 64:
                    raise HTTPException(502, "云端没有返回图片或图片数量超过 64 张")
                with task_lock:
                    # Deleting a workspace also removes its tasks. Never recreate its files.
                    if not conn.execute(
                        "SELECT 1 FROM studio_task WHERE id=?", (task_id,)
                    ).fetchone():
                        return
                    for index, image in enumerate(images):
                        label = image.get("output_label", "").strip()
                        info = {
                            **generation_info,
                            "job_id": result.get("job_id", ""),
                            "task_id": task_id,
                            "output_index": index + 1,
                            "output_count": len(images),
                            "output_node_id": image.get("output_node_id", ""),
                            "output_label": label,
                        }
                        description = "\n".join(
                            [
                                info.pop("prompt", ""),
                                "Negative prompt: " + info.pop("negative_prompt", ""),
                                "extraJsonMetaInfo: " + json.dumps(info, ensure_ascii=False),
                            ]
                        )
                        suffix = f"-{index + 1:02d}" if len(images) > 1 else ""
                        suffix += "-" + label if label else ""
                        sequence = re.search(r"-AI-\d+$", name)
                        batch_suffix = sequence.group() if sequence else ""
                        stem = name[: -len(batch_suffix)] if batch_suffix else name
                        output_name = (
                            f"{stem[: 120 - len(batch_suffix) - len(suffix)]}{batch_suffix}{suffix}"
                        )
                        artifact = self.save_result(
                            workspace_id,
                            output_name,
                            {**image, "source_image_base64": source_image_base64, **origin},
                            description,
                        )
                        saved_results.append(
                            {
                                "artifact_id": artifact["id"],
                                "label": label,
                                "node_id": image.get("output_node_id", ""),
                            }
                        )
                        # Persist each saved file so a later save failure never hides partial results.
                        conn.execute(
                            "UPDATE studio_task SET artifact_id=?, results=?, updated_at=? WHERE id=?",
                            (
                                saved_results[0]["artifact_id"],
                                json.dumps(saved_results, ensure_ascii=False),
                                time.time(),
                                task_id,
                            ),
                        )
                        conn.commit()
                    conn.execute(
                        "UPDATE studio_task SET state='completed', artifact_id=?, updated_at=? WHERE id=?",
                        (saved_results[0]["artifact_id"], time.time(), task_id),
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
                if saved_results:
                    detail = f"已保存 {len(saved_results)} / {len(images)} 张图片；" + detail
                with task_lock:
                    conn.execute(
                        "UPDATE studio_task SET state='failed', error=?, updated_at=? WHERE id=?",
                        (detail, time.time(), task_id),
                    )
                    conn.commit()
