"""Durable local export queue; media-specific validation/rendering live in adapters."""

import hashlib
import json
import shutil
import threading
import time
from contextlib import contextmanager
from uuid import UUID

from fastapi import HTTPException

from omnigallery.storage.project_files import storage_lock
from omnigallery.workspaces.artifacts import _uuid, artifact_root
from omnigallery.workspaces.media_export_runtime import ExportCancelled, ExportInterrupted
from omnigallery.workspaces.task_records import (
    create_task_record_table,
    delete_task_record,
    with_task_artifact_availability,
    with_task_record_deletion,
)

FIELDS = "id workspace_id document_id document_revision name state phase progress error created_at updated_at artifact request sources fingerprint".split()


class MediaExportQueue:
    def __init__(self, connection, adapter):
        self.connection, self.adapter = connection, adapter
        # Only programmer-defined names are interpolated into SQL and staging paths.
        if adapter.kind not in ("audio", "video"):
            raise ValueError("Unsupported export kind")
        self.table = adapter.kind + "_export_task"
        self.lock = threading.RLock()
        self.stopping = threading.Event()
        self.started = False
        self.worker = None
        self.removing = set()
        self.active_workspace = None
        self.idle = threading.Event()
        self.idle.set()

    def start(self):
        with self.lock:
            if self.started:
                return
            conn = self.connection()
            create_task_record_table(conn)
            conn.execute(f"""CREATE TABLE IF NOT EXISTS {self.table} (
                id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, document_id TEXT NOT NULL,
                document_revision TEXT NOT NULL, name TEXT NOT NULL, state TEXT NOT NULL,
                phase TEXT NOT NULL, progress REAL NOT NULL, error TEXT NOT NULL,
                created_at REAL NOT NULL, updated_at REAL NOT NULL, artifact TEXT NOT NULL,
                request TEXT NOT NULL, sources TEXT NOT NULL, fingerprint TEXT NOT NULL)""")
            conn.execute(
                f"UPDATE {self.table} SET state='interrupted',phase='interrupted',error=?,updated_at=? WHERE state='running'",
                ("本地服务已重启，导出中断；可重新导出", time.time()),
            )
            conn.commit()
            for workspace, task_id in conn.execute(
                f"SELECT workspace_id,id FROM {self.table} WHERE state NOT IN ('queued','running')"
            ).fetchall():
                self._cleanup(workspace, task_id)
            self.started = True
            self._wake()

    @staticmethod
    def public(row):
        item = dict(zip(FIELDS, row, strict=True))
        for key in ("request", "sources", "fingerprint"):
            item.pop(key)
        item["artifact"] = json.loads(item["artifact"]) if item["artifact"] else None
        return item

    def _stage(self, workspace, task_id):
        return artifact_root() / _uuid(workspace) / f".{self.adapter.kind}-export-{UUID(task_id)}"

    def _cleanup(self, workspace, task_id):
        path = self._stage(workspace, task_id)
        if path.exists() and not path.is_symlink():
            shutil.rmtree(path, ignore_errors=True)

    def get(self, workspace, task_id):
        self.start()
        with self.lock:
            row = (
                self.connection()
                .execute(
                    f"SELECT * FROM {self.table} WHERE workspace_id=? AND id=?",
                    (_uuid(workspace), str(UUID(task_id))),
                )
                .fetchone()
            )
            if not row:
                raise HTTPException(404, "导出任务不存在")
            return with_task_record_deletion(
                self.connection(), self.adapter.kind + "-export", self.public(row)
            )

    def delete(self, workspace, task_id):
        with self.lock:
            return delete_task_record(
                self.connection(), self.adapter.kind + "-export", self.get(workspace, task_id)
            )

    def list(self, workspace, document_id=""):
        self.start()
        with self.lock:
            return [
                with_task_artifact_availability(self.connection(), self.public(row))
                for row in self.connection()
                .execute(
                    f"SELECT * FROM {self.table} WHERE workspace_id=? AND (?='' OR document_id=?) "
                    "AND NOT EXISTS (SELECT 1 FROM task_record_deletion "
                    f"WHERE source=? AND task_id={self.table}.id) ORDER BY created_at DESC LIMIT 100",
                    (_uuid(workspace), document_id, document_id, self.adapter.kind + "-export"),
                )
                .fetchall()
            ]

    def submit(self, submission):
        self.start()
        # Preserve omitted defaults for saved-document equality on legacy timelines.
        request = self.adapter.request.model_validate(
            submission.model_dump(exclude={"task_id"}, exclude_unset=True)
        )
        request.workspace_id = _uuid(request.workspace_id)
        payload = request.model_dump_json(exclude_unset=True)
        fingerprint = hashlib.sha256(payload.encode()).hexdigest()
        task_id = str(submission.task_id)
        with self.lock, storage_lock:
            conn = self.connection()
            row = conn.execute(f"SELECT * FROM {self.table} WHERE id=?", (task_id,)).fetchone()
            if row:
                if row[1] != request.workspace_id or row[-1] != fingerprint:
                    raise HTTPException(409, "该提交编号已用于其他导出")
                return with_task_record_deletion(
                    conn, self.adapter.kind + "-export", self.public(row)
                )
            try:
                if self.stopping.is_set() or request.workspace_id in self.removing:
                    raise HTTPException(409, "导出服务正在关闭或工作区正在清理")
                if (
                    conn.execute(
                        f"SELECT count(*) FROM {self.table} WHERE state IN ('queued','running')"
                    ).fetchone()[0]
                    >= 4
                ):
                    raise HTTPException(429, "后台已有 4 个导出任务，请等待完成")
                self.adapter.validate(conn, request)
                sources = self.adapter.sources(request)
                directory = artifact_root() / request.workspace_id
                directory.mkdir(parents=True, exist_ok=True)
                if shutil.disk_usage(directory).free < self.adapter.disk_bytes(request):
                    raise HTTPException(507, "预计导出空间不足，请释放磁盘空间或缩短范围")
            except HTTPException as exc:
                raise HTTPException(
                    exc.status_code,
                    {"type": self.adapter.kind + "_export_not_created", "message": str(exc.detail)},
                ) from exc
            now = time.time()
            row = (
                task_id,
                request.workspace_id,
                request.document_id,
                request.document_revision,
                request.name,
                "queued",
                "queued",
                0,
                "",
                now,
                now,
                "",
                payload,
                json.dumps(sources),
                fingerprint,
            )
            conn.execute(f"INSERT INTO {self.table} VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", row)
            conn.commit()
            self._wake()
            return self.public(row)

    def cancel(self, workspace, task_id):
        with self.lock:
            task = self.get(workspace, task_id)
            if task["state"] in ("queued", "running"):
                conn = self.connection()
                conn.execute(
                    f"UPDATE {self.table} SET state='cancelled',phase='cancelled',updated_at=? WHERE id=?",
                    (time.time(), task["id"]),
                )
                conn.commit()
            return self.get(workspace, task_id)

    def close(self):
        self.stopping.set()
        if self.worker and self.worker is not threading.current_thread():
            self.worker.join(timeout=10)

    @contextmanager
    def removing_workspace(self, workspace):
        self.start()
        workspace = _uuid(workspace)
        with self.lock:
            self.removing.add(workspace)
            conn = self.connection()
            conn.execute(f"DELETE FROM {self.table} WHERE workspace_id=?", (workspace,))
            conn.commit()
            pending = self.idle if self.active_workspace == workspace else None
        try:
            if pending and not pending.wait(40):
                raise HTTPException(409, "正在停止音频导出，请稍后重试清理工作区")
            yield
        finally:
            with self.lock:
                self.removing.discard(workspace)

    def _update(self, task_id, **values):
        with self.lock:
            values["updated_at"] = time.time()
            conn = self.connection()
            conn.execute(
                f"UPDATE {self.table} SET "
                + ",".join(f"{key}=?" for key in values)
                + " WHERE id=? AND state='running'",
                (*values.values(), task_id),
            )
            conn.commit()

    def _wake(self):
        if not self.stopping.is_set() and not (self.worker and self.worker.is_alive()):
            self.worker = threading.Thread(target=self._drain, daemon=True)
            self.worker.start()

    def _drain(self):
        while not self.stopping.is_set():
            with self.lock:
                conn = self.connection()
                row = conn.execute(
                    f"SELECT * FROM {self.table} WHERE state='queued' ORDER BY created_at,id LIMIT 1"
                ).fetchone()
                if not row:
                    self.worker = None
                    return
                conn.execute(
                    f"UPDATE {self.table} SET state='running',phase='preparing',updated_at=? WHERE id=?",
                    (time.time(), row[0]),
                )
                conn.commit()
                self.active_workspace, self.idle = row[1], threading.Event()
            try:
                self._execute(row)
            finally:
                with self.lock:
                    self.active_workspace = None
                    self.idle.set()

    def _execute(self, row):
        task_id, workspace = row[:2]

        def checkpoint():
            if self.stopping.is_set():
                raise ExportInterrupted("本地服务已停止，导出中断；可重新导出")
            try:
                state = self.get(workspace, task_id)["state"]
            except HTTPException as exc:
                if exc.status_code == 404:
                    raise ExportCancelled() from exc
                raise
            if state != "running":
                raise ExportCancelled()

        def committed(conn, artifact):
            checkpoint()
            conn.execute(
                f"UPDATE {self.table} SET state='completed',phase='completed',progress=100,artifact=?,updated_at=? WHERE id=?",
                (json.dumps(artifact, ensure_ascii=False), time.time(), task_id),
            )

        try:
            request = self.adapter.request.model_validate_json(row[12])
            expected = json.loads(row[13])
            checkpoint()
            self.adapter.validate(self.connection(), request, current_revision=False)
            if self.adapter.sources(request) != expected:
                raise HTTPException(409, "源素材已变化，请检查后重新导出")
            stage = self._stage(workspace, task_id)
            with self.lock:
                checkpoint()
                stage.mkdir(parents=True, exist_ok=False)
            if shutil.disk_usage(stage).free < self.adapter.disk_bytes(request):
                raise HTTPException(507, "预计导出空间不足，请释放磁盘空间")
            self._update(task_id, phase="rendering")
            output = self.adapter.render(
                request, stage, checkpoint, lambda value: self._update(task_id, progress=value)
            )
            checkpoint()
            if self.adapter.sources(request) != expected:
                raise HTTPException(409, "导出期间源素材已变化，结果未发布")
            with self.lock:
                checkpoint()
                self._update(task_id, phase="saving")
                self.adapter.publish(request, output, current_revision=False, committed=committed)
        except ExportCancelled:
            pass
        except Exception as exc:
            state = "interrupted" if isinstance(exc, ExportInterrupted) else "failed"
            message = (
                str(exc.detail)
                if isinstance(exc, HTTPException)
                else str(exc)
                if isinstance(exc, ExportInterrupted)
                else "音频导出失败，请检查素材和可用磁盘空间"
            )
            self._update(task_id, state=state, phase=state, error=message)
        finally:
            self._cleanup(workspace, task_id)
