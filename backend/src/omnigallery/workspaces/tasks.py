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

from omnigallery.storage.project_files import storage_lock
from omnigallery.workspaces.task_records import (
    create_task_record_table,
    delete_task_record,
    with_task_artifact_availability,
    with_task_record_deletion,
)

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
    "execution",
)


def create_task_table(conn):
    create_task_record_table(conn)
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
    for name, default in (
        ("results", "[]"),
        ("document_id", ""),
        ("purpose", "image_edit"),
        ("execution", "{}"),
    ):
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
    execution = json.loads(item.pop("execution", "{}"))
    item.update(
        {
            key: execution[key]
            for key in ("phase", "remote_id", "queue_position", "cancel_requested")
            if key in execution
        }
    )
    item["resumable"] = bool(
        execution.get("durable")
        and item["state"] == "interrupted"
        and not execution.get("unrecoverable")
    )
    item["deletable"] = item["state"] in ("completed", "cancelled") or (
        item["state"] == "failed"
        and not execution.get("tracking_uncertain")
        and (not execution.get("submitted_at") or execution.get("remote_done"))
        and "任务跟踪中断" not in item["error"]
    )
    item["results"] = json.loads(item["results"])
    if not item["results"] and item["artifact_id"]:
        item["results"] = [{"artifact_id": item["artifact_id"], "label": "", "node_id": ""}]
    return item


def ai_output_stem(name):
    stem = re.sub(r"\.(?:png|jpe?g|webp|gif|bmp|tiff?)$", "", name.strip(), flags=re.I)
    stem = re.sub(r"(?:[- _]AI(?:[- _]?(?:结果|产物|\d+))?)+$", "", stem, flags=re.I)
    stem = re.sub(r"\.(?:png|jpe?g|webp|gif|bmp|tiff?)$", "", stem, flags=re.I)
    return (stem.strip("- _") or "未命名图片")[:100]


class TaskInterrupted(Exception):
    """Tracking stopped; retain the input and remote handle for recovery."""


class TaskCancelled(Exception):
    pass


class TaskRemoved(Exception):
    pass


class TaskContext:
    def __init__(self, manager, task_id):
        self.manager, self.task_id = manager, task_id

    def read(self):
        row = (
            self.manager.connection()
            .execute("SELECT execution FROM studio_task WHERE id=?", (self.task_id,))
            .fetchone()
        )
        if not row:
            raise TaskRemoved()
        return json.loads(row[0])

    def update(self, **values):
        with task_lock:
            current = self.read()
            current.update(values)
            conn = self.manager.connection()
            conn.execute(
                "UPDATE studio_task SET execution=?, updated_at=? WHERE id=?",
                (json.dumps(current), time.time(), self.task_id),
            )
            conn.commit()
            return current

    def sleep(self, seconds):
        # A cancel request wakes polling, but repeated reads still respect provider backoff.
        cancelled = self.read().get("cancel_requested")
        with self.manager.condition:
            self.manager.condition.wait_for(
                lambda: self.read().get("cancel_requested") != cancelled, timeout=seconds
            )
        self.read()


class StudioTasks:
    def __init__(self, connection, save_result, concurrency=2, *, runner=None, payload_root=None):
        self.connection = connection
        self.save_result = save_result
        self.condition = threading.Condition()
        self.active = 0
        self.runner, self.payload_root = runner, payload_root
        self.set_concurrency(concurrency)
        conn = connection()
        create_task_table(conn)
        pending = conn.execute(
            "SELECT * FROM studio_task WHERE state IN ('queued','running')"
        ).fetchall()
        for row in pending:
            execution = json.loads(row[11])
            if runner and execution.get("durable"):
                conn.execute("UPDATE studio_task SET state='queued' WHERE id=?", (row[0],))
            else:
                conn.execute(
                    "UPDATE studio_task SET state='failed', error=?, updated_at=? WHERE id=?",
                    (
                        "本地服务已重启，任务跟踪中断；请先检查云端任务，再决定是否重新提交",
                        time.time(),
                        row[0],
                    ),
                )
        conn.commit()
        for row in pending:
            if runner and json.loads(row[11]).get("durable"):
                self._start_remote(row[0], row[1], row[2])

    def _payload_path(self, workspace_id, task_id):
        return self.payload_root() / workspace_id / ".tasks" / (task_id + ".json")

    def _clear_snapshot(self, workspace_id, task_id):
        target = self._payload_path(workspace_id, task_id)
        for path in (target, target.with_suffix(".result.json"), target.with_suffix(".result.tmp")):
            path.unlink(missing_ok=True)

    def _start_remote(self, task_id, workspace_id, name):
        def run_saved():
            context = TaskContext(self, task_id)
            execution = context.read()
            if execution.get("cancel_requested") and not execution.get("submitted_at"):
                raise TaskCancelled()
            try:
                with storage_lock:
                    payload = json.loads(
                        self._payload_path(workspace_id, task_id).read_text(encoding="utf-8")
                    )
            except (OSError, ValueError) as error:
                context.update(unrecoverable=True)
                raise TaskInterrupted("任务输入快照不可用；请检查应用数据目录") from error
            # Loading is delayed until a worker slot is available.
            metadata.update(payload["info"])
            origin.update(payload["origin"])
            source[0] = payload["request"].get("image_base64", "")
            result_path = self._payload_path(workspace_id, task_id).with_suffix(".result.json")
            with task_lock, storage_lock:
                if result_path.exists():
                    context.update(phase="saving")
                    return json.loads(result_path.read_text(encoding="utf-8"))
            result = self.runner(payload, context)
            # Keep downloaded outputs until artifact commits finish, even beyond cloud retention.
            with task_lock, storage_lock:
                context.update(phase="saving")  # Also verifies the workspace task still exists.
                temporary = result_path.with_suffix(".tmp")
                with temporary.open("w", encoding="utf-8") as stream:
                    json.dump(result, stream, ensure_ascii=False)
                temporary.replace(result_path)
            return result

        metadata, origin, source = {}, {}, [""]
        threading.Thread(
            target=self._run,
            args=(task_id, workspace_id, name, run_saved, metadata, source, origin),
            daemon=True,
        ).start()

    def get(self, workspace_id, task_id):
        row = (
            self.connection()
            .execute(
                "SELECT * FROM studio_task WHERE id=? AND workspace_id=?", (task_id, workspace_id)
            )
            .fetchone()
        )
        if not row:
            raise HTTPException(404, "任务不存在")
        return with_task_record_deletion(self.connection(), "image-ai", public_task(row))

    def existing(self, workspace_id, task_id, fingerprint):
        if not task_id:
            return None
        row = (
            self.connection().execute("SELECT * FROM studio_task WHERE id=?", (task_id,)).fetchone()
        )
        if not row:
            return None
        if row[1] != workspace_id or json.loads(row[11]).get("fingerprint") != fingerprint:
            raise HTTPException(409, "该提交编号已用于其他输入")
        return with_task_record_deletion(self.connection(), "image-ai", public_task(row))

    def delete(self, workspace_id, task_id):
        with task_lock:
            return delete_task_record(
                self.connection(), "image-ai", self.get(workspace_id, task_id)
            )

    def cancel(self, workspace_id, task_id):
        with task_lock:
            item = self.get(workspace_id, task_id)
            if item["state"] not in ("queued", "running", "interrupted"):
                return item
            context = TaskContext(self, task_id)
            if not context.read().get("durable"):
                raise HTTPException(409, "旧版任务无法从本地取消，请在云端处理")
            context.update(cancel_requested=True)
            if item["state"] == "queued" and not context.read().get("submitted_at"):
                conn = self.connection()
                conn.execute(
                    "UPDATE studio_task SET state='cancelled', error='', updated_at=? WHERE id=?",
                    (time.time(), task_id),
                )
                conn.commit()
                with storage_lock:
                    self._clear_snapshot(workspace_id, task_id)
                return self.get(workspace_id, task_id)
            if item["state"] == "interrupted":
                return self.resume(workspace_id, task_id)
        with self.condition:
            self.condition.notify_all()
        return self.get(workspace_id, task_id)

    def resume(self, workspace_id, task_id):
        with task_lock:
            item = self.get(workspace_id, task_id)
            if item["state"] in ("queued", "running"):
                return item
            if not item["resumable"]:
                raise HTTPException(409, "该任务不能恢复跟踪，请检查云端任务")
            conn = self.connection()
            conn.execute(
                "UPDATE studio_task SET state='queued', error='', updated_at=? WHERE id=?",
                (time.time(), task_id),
            )
            conn.commit()
            self._start_remote(task_id, workspace_id, item["name"])
            return self.get(workspace_id, task_id)

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
                AND NOT EXISTS (SELECT 1 FROM task_record_deletion
                    WHERE source='image-ai' AND task_id=studio_task.id)
            ORDER BY CASE WHEN state IN ('queued','running') THEN 0 ELSE 1 END, created_at DESC LIMIT 100""",
                (workspace_id,),
            )
            .fetchall()
        )
        return [
            with_task_artifact_availability(self.connection(), public_task(row)) for row in rows
        ]

    def submit(
        self,
        workspace_id,
        name,
        run,
        generation_info,
        source_image_base64="",
        origin=None,
        *,
        payload=None,
        task_id=None,
        fingerprint="",
    ):
        with task_lock:
            conn = self.connection()
            if existing := self.existing(workspace_id, task_id, fingerprint):
                return existing
            limit = max(4, self.concurrency * 2)
            if (
                conn.execute(
                    "SELECT COUNT(*) FROM studio_task WHERE state IN ('queued','running')"
                ).fetchone()[0]
                >= limit
            ):
                raise HTTPException(429, f"后台已有 {limit} 个任务，请等待其中一个完成后再提交")
            task_id, stamp = task_id or str(uuid.uuid4()), time.time()
            execution = {}
            if payload is not None:
                if not self.runner or not self.payload_root:
                    raise RuntimeError("Durable task runner is not configured")
                execution = {
                    "durable": True,
                    "fingerprint": fingerprint,
                    "phase": "queued",
                    "mode": payload["mode"],
                }
                with storage_lock:
                    target = self._payload_path(workspace_id, task_id)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    temporary = target.with_suffix(".tmp")
                    temporary.write_text(
                        json.dumps(
                            {**payload, "info": generation_info, "origin": origin or {}},
                            ensure_ascii=False,
                        ),
                        encoding="utf-8",
                    )
                    temporary.replace(target)
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
                    json.dumps(execution),
                )
                conn.execute("INSERT INTO studio_task VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", row)
            if payload is not None:
                self._start_remote(task_id, workspace_id, name)
                return public_task(row)
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
                if changed:
                    saved_results = self.get(workspace_id, task_id)["results"]
                    durable = bool(TaskContext(self, task_id).read().get("durable"))
            if not changed:
                return
            images = []
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
                        if index < len(saved_results):
                            continue
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
                            {
                                **image,
                                "source_image_base64": source_image_base64[0]
                                if isinstance(source_image_base64, list)
                                else source_image_base64,
                                **origin,
                                **(
                                    {"artifact_id": str(uuid.uuid5(uuid.UUID(task_id), str(index)))}
                                    if durable
                                    else {}
                                ),
                            },
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
            except TaskRemoved:
                return
            except (TaskInterrupted, TaskCancelled) as error:
                with task_lock:
                    conn.execute(
                        "UPDATE studio_task SET state=?, error=?, updated_at=? WHERE id=?",
                        (
                            "cancelled" if isinstance(error, TaskCancelled) else "interrupted",
                            str(error),
                            time.time(),
                            task_id,
                        ),
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
                    count = (
                        f"{len(saved_results)} / {len(images)}"
                        if images
                        else str(len(saved_results))
                    )
                    detail = f"已保存 {count} 张图片；" + detail
                with task_lock:
                    if not conn.execute(
                        "SELECT 1 FROM studio_task WHERE id=?", (task_id,)
                    ).fetchone():
                        return
                    state = (
                        "interrupted"
                        if durable and TaskContext(self, task_id).read().get("phase") == "saving"
                        else "failed"
                    )
                    conn.execute(
                        "UPDATE studio_task SET state=?, error=?, updated_at=? WHERE id=?",
                        (state, detail, time.time(), task_id),
                    )
                    conn.commit()
            finally:
                if durable:
                    with task_lock, storage_lock:
                        row = conn.execute(
                            "SELECT state FROM studio_task WHERE id=?", (task_id,)
                        ).fetchone()
                        if not row or row[0] in ("completed", "cancelled", "failed"):
                            self._clear_snapshot(workspace_id, task_id)
