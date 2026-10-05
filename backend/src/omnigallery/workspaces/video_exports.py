"""Durable, bounded local video exports. The database stores instructions, never media bytes."""

import hashlib
import json
import math
import shutil
import subprocess
import threading
import time
from collections import deque
from contextlib import contextmanager
from uuid import UUID

from fastapi import Depends, HTTPException

from omnigallery.infrastructure.database import Database
from omnigallery.storage.project_files import storage_lock
from omnigallery.workspaces.artifacts import _uuid, artifact_root
from omnigallery.workspaces.audio_studio import HIDDEN
from omnigallery.workspaces.task_records import (
    create_task_record_table,
    delete_task_record,
    with_task_record_deletion,
)
from omnigallery.workspaces.video_studio import (
    VideoExport,
    _commit_video,
    _resolve_source,
    _saved_document,
    export_bounds,
    render_video,
)

RESERVE_BYTES = 256 * 1024**2
MAX_RENDER_SECONDS = 24 * 3600
STALL_SECONDS = 10 * 60
MAX_PENDING = 4
FIELDS = (
    "id",
    "workspace_id",
    "document_id",
    "document_revision",
    "name",
    "state",
    "phase",
    "progress",
    "error",
    "created_at",
    "updated_at",
    "artifact",
    "request",
    "sources",
    "fingerprint",
)


class VideoExportSubmission(VideoExport):
    task_id: UUID


class ExportCancelled(Exception):
    pass


class ExportInterrupted(Exception):
    pass


def create_video_export_table(conn):
    create_task_record_table(conn)
    conn.execute("""CREATE TABLE IF NOT EXISTS video_export_task (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, document_id TEXT NOT NULL,
        document_revision TEXT NOT NULL, name TEXT NOT NULL, state TEXT NOT NULL,
        phase TEXT NOT NULL, progress REAL NOT NULL, error TEXT NOT NULL,
        created_at REAL NOT NULL, updated_at REAL NOT NULL, artifact TEXT NOT NULL,
        request TEXT NOT NULL, sources TEXT NOT NULL, fingerprint TEXT NOT NULL
    )""")
    conn.commit()


def public_task(row):
    value = dict(zip(FIELDS, row, strict=True))
    for key in ("request", "sources", "fingerprint"):
        value.pop(key)
    value["artifact"] = json.loads(value["artifact"]) if value["artifact"] else None
    return value


def source_fingerprints(request, check_path_trust):
    result = {}
    for clip in request.document.visuals + request.document.sounds:
        if clip.path in result:
            continue
        path = _resolve_source(clip, request.workspace_id, check_path_trust)
        stat = path.stat()
        result[clip.path] = [str(path.resolve()), stat.st_size, stat.st_mtime_ns]
    return result


def required_disk_bytes(request):
    # A conservative working estimate, not an output-size promise for CRF encoding.
    pixels = request.document.width * request.document.height
    bitrate = max(8_000_000, 12_000_000 * pixels / (1920 * 1080) * request.document.fps / 30)
    start, end = export_bounds(request)
    # Completed segments coexist with final output; two bounded 10-second working layers.
    from omnigallery.workspaces.audio_mix_render import needs_full_mix, sound_duration

    sound_length = (
        sound_duration("video", request.document)
        if needs_full_mix("video", request.document)
        else end - start
    )
    pcm_cache = sound_length * 48000 * 8 * 4
    return math.ceil((end - start) * bitrate / 8 * 2.4 + pcm_cache) + 256 * 1024**2 + RESERVE_BYTES


def run_ffmpeg(args, directory, duration, checkpoint, progress):
    """Drain both pipes continuously with bounded memory; cancellation never waits on readline."""
    checkpoint()
    state = {"seconds": 0.0, "activity": time.monotonic()}
    errors = deque(maxlen=32)

    def consume_progress(stream):
        try:
            while line := stream.readline(4096):
                key, _, value = line.strip().partition(b"=")
                if key in (b"out_time_us", b"out_time_ms"):
                    try:
                        seconds = float(value) / 1_000_000
                        if math.isfinite(seconds) and seconds > state["seconds"]:
                            state.update(seconds=seconds, activity=time.monotonic())
                    except ValueError:
                        pass
        finally:
            stream.close()

    def consume_errors(stream):
        try:
            while line := stream.readline(4096):
                errors.append(line)
        finally:
            stream.close()

    try:
        process = subprocess.Popen(
            [*args[:-1], "-nostats", "-progress", "pipe:1", args[-1]],
            cwd=directory,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=HIDDEN,
        )
    except OSError as exc:
        raise HTTPException(503, "无法启动 FFmpeg，请检查运行环境") from exc
    readers = [
        threading.Thread(target=consume_progress, args=(process.stdout,), daemon=True),
        threading.Thread(target=consume_errors, args=(process.stderr,), daemon=True),
    ]
    for reader in readers:
        reader.start()
    started = time.monotonic()
    last_report = 0.0
    try:
        while process.poll() is None:
            checkpoint()
            now = time.monotonic()
            if now - started > MAX_RENDER_SECONDS or now - state["activity"] > STALL_SECONDS:
                raise ExportInterrupted(
                    "视频导出长时间无进展或超过 24 小时，请检查原片和磁盘后重新导出"
                )
            if now - last_report >= 0.5:
                if shutil.disk_usage(directory).free < RESERVE_BYTES:
                    raise HTTPException(507, "可用磁盘空间不足，视频导出已停止")
                progress(min(99.0, max(0.0, state["seconds"] / duration * 100)))
                last_report = now
            time.sleep(0.1)
        checkpoint()
        if process.returncode != 0:
            diagnostic = b"".join(errors)
            detail = "视频渲染失败，请检查素材编码、字幕滤镜和可用磁盘空间"
            if b"No such filter: 'subtitles'" in diagnostic:
                detail = "当前 FFmpeg 缺少字幕滤镜，无法导出含字幕的视频"
            raise HTTPException(422, detail)
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        for reader in readers:
            reader.join(timeout=3)


class VideoExports:
    def __init__(
        self, connection, check_path_trust, *, renderer=render_video, publisher=_commit_video
    ):
        self.connection = connection
        self.check_path_trust = check_path_trust
        self.renderer, self.publisher = renderer, publisher
        self.lock = threading.RLock()
        self.stopping = threading.Event()
        self.worker = None
        self.started = False
        self.removing = set()
        self.active_workspace = None
        self.idle = threading.Event()
        self.idle.set()

    def start(self):
        with self.lock:
            if self.started:
                return
            conn = self.connection()
            create_video_export_table(conn)
            conn.execute(
                "UPDATE video_export_task SET state='interrupted', phase='interrupted', "
                "error=?, updated_at=? WHERE state='running'",
                ("本地服务已重启，导出中断；可重新导出", time.time()),
            )
            conn.commit()
            # The path consists exclusively of validated UUIDs, never user filenames.
            for workspace, task_id in conn.execute(
                "SELECT workspace_id,id FROM video_export_task WHERE state NOT IN ('queued','running')"
            ).fetchall():
                self._cleanup(workspace, task_id)
            self.started = True
            self._wake()

    def _stage(self, workspace_id, task_id):
        return artifact_root() / _uuid(workspace_id) / (".video-export-" + str(UUID(task_id)))

    def _cleanup(self, workspace_id, task_id):
        stage = self._stage(workspace_id, task_id)
        if stage.exists() and not stage.is_symlink():
            shutil.rmtree(stage, ignore_errors=True)

    def _wake(self):
        if self.stopping.is_set() or (self.worker and self.worker.is_alive()):
            return
        self.worker = threading.Thread(target=self._drain, daemon=True)
        self.worker.start()

    def get(self, workspace_id, task_id):
        self.start()
        with self.lock:
            row = (
                self.connection()
                .execute(
                    "SELECT * FROM video_export_task WHERE workspace_id=? AND id=?",
                    (_uuid(workspace_id), str(UUID(task_id))),
                )
                .fetchone()
            )
            if not row:
                raise HTTPException(404, "视频导出任务不存在")
            return with_task_record_deletion(self.connection(), "video-export", public_task(row))

    def delete(self, workspace_id, task_id):
        with self.lock:
            return delete_task_record(
                self.connection(), "video-export", self.get(workspace_id, task_id)
            )

    def list(self, workspace_id, document_id=""):
        self.start()
        with self.lock:
            rows = (
                self.connection()
                .execute(
                    "SELECT * FROM video_export_task WHERE workspace_id=? AND (?='' OR document_id=?) "
                    "AND NOT EXISTS (SELECT 1 FROM task_record_deletion "
                    "WHERE source='video-export' AND task_id=video_export_task.id) "
                    "ORDER BY created_at DESC LIMIT 100",
                    (_uuid(workspace_id), document_id, document_id),
                )
                .fetchall()
            )
            return [public_task(row) for row in rows]

    def submit(self, submission):
        self.start()
        request = VideoExport.model_validate(submission.model_dump(exclude={"task_id"}))
        request.workspace_id = _uuid(request.workspace_id)
        task_id = str(submission.task_id)
        serialized = request.model_dump_json()
        fingerprint = hashlib.sha256(serialized.encode()).hexdigest()
        with self.lock, storage_lock:
            conn = self.connection()
            existing = conn.execute(
                "SELECT * FROM video_export_task WHERE id=?", (task_id,)
            ).fetchone()
            if existing:
                same_request = existing[-1] == fingerprint
                if not same_request:
                    # Optional v1 additions must not invalidate an accepted pre-upgrade retry.
                    try:
                        same_request = (
                            VideoExport.model_validate_json(existing[12]).model_dump_json()
                            == serialized
                        )
                    except ValueError:
                        pass
                if existing[1] != request.workspace_id or not same_request:
                    raise HTTPException(409, "该提交编号已用于其他视频导出")
                return with_task_record_deletion(conn, "video-export", public_task(existing))
            # Only this region can prove that no task with this id was created.
            # Authentication, validation and failures after COMMIT cannot make that promise.
            try:
                if self.stopping.is_set():
                    raise HTTPException(503, "视频导出服务正在关闭")
                if request.workspace_id in self.removing:
                    raise HTTPException(409, "工作区正在清理，请稍后再试")
                if (
                    conn.execute(
                        "SELECT count(*) FROM video_export_task WHERE state IN ('queued','running')"
                    ).fetchone()[0]
                    >= MAX_PENDING
                ):
                    raise HTTPException(429, "后台已有 4 个视频导出任务，请等待完成")
                _saved_document(conn, request)
                export_bounds(request)
                sources = source_fingerprints(request, self.check_path_trust)
                directory = artifact_root() / request.workspace_id
                directory.mkdir(parents=True, exist_ok=True)
                if shutil.disk_usage(directory).free < required_disk_bytes(request):
                    raise HTTPException(507, "预计导出空间不足，请释放磁盘空间或缩短范围")
            except HTTPException as exc:
                raise HTTPException(
                    exc.status_code,
                    {"type": "video_export_not_created", "message": str(exc.detail)},
                    headers=exc.headers,
                ) from exc
            stamp = time.time()
            row = (
                task_id,
                request.workspace_id,
                request.document_id,
                request.document_revision,
                request.name,
                "queued",
                "queued",
                0.0,
                "",
                stamp,
                stamp,
                "",
                serialized,
                json.dumps(sources),
                fingerprint,
            )
            conn.execute(
                "INSERT INTO video_export_task VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", row
            )
            conn.commit()
            self._wake()
            return public_task(row)

    def cancel(self, workspace_id, task_id):
        with self.lock:
            item = self.get(workspace_id, task_id)
            if item["state"] in ("queued", "running"):
                conn = self.connection()
                conn.execute(
                    "UPDATE video_export_task SET state='cancelled',phase='cancelled',updated_at=? WHERE id=?",
                    (time.time(), item["id"]),
                )
                conn.commit()
            return self.get(workspace_id, task_id)

    def close(self):
        self.stopping.set()
        if self.worker and self.worker is not threading.current_thread():
            self.worker.join(timeout=10)

    @contextmanager
    def removing_workspace(self, workspace_id):
        """Stop writers before Windows deletes their open output files."""
        self.start()
        workspace_id = _uuid(workspace_id)
        with self.lock:
            self.removing.add(workspace_id)
            conn = self.connection()
            conn.execute("DELETE FROM video_export_task WHERE workspace_id=?", (workspace_id,))
            conn.commit()
            pending = self.idle if self.active_workspace == workspace_id else None
        try:
            if pending and not pending.wait(40):
                raise HTTPException(409, "正在停止视频导出，请稍后重试清理工作区")
            yield
        finally:
            with self.lock:
                self.removing.discard(workspace_id)

    def _update(self, task_id, **values):
        with self.lock:
            conn = self.connection()
            values["updated_at"] = time.time()
            conn.execute(
                "UPDATE video_export_task SET "
                + ",".join(f"{key}=?" for key in values)
                + " WHERE id=? AND state='running'",
                (*values.values(), task_id),
            )
            conn.commit()

    def _drain(self):
        while not self.stopping.is_set():
            with self.lock:
                conn = self.connection()
                row = conn.execute(
                    "SELECT * FROM video_export_task WHERE state='queued' ORDER BY created_at,id LIMIT 1"
                ).fetchone()
                if not row:
                    self.worker = None
                    return
                conn.execute(
                    "UPDATE video_export_task SET state='running',phase='preparing',updated_at=? WHERE id=?",
                    (time.time(), row[0]),
                )
                conn.commit()
                self.active_workspace = row[1]
                # A cleanup waiter must not accidentally wait for the next workspace's job.
                self.idle = threading.Event()
            try:
                self._execute(row)
            finally:
                with self.lock:
                    self.active_workspace = None
                    self.idle.set()

    def _execute(self, row):
        task_id, workspace_id = row[:2]
        started = time.monotonic()

        def checkpoint():
            if time.monotonic() - started > MAX_RENDER_SECONDS:
                raise ExportInterrupted("视频导出超过 24 小时，请降低时间线复杂度后重试")
            if self.stopping.is_set():
                raise ExportInterrupted("本地服务已停止，导出中断；可重新导出")
            try:
                state = self.get(workspace_id, task_id)["state"]
            except HTTPException as exc:
                if exc.status_code == 404:
                    raise ExportCancelled() from exc
                raise
            if state != "running":
                raise ExportCancelled()

        def committed(conn, artifact):
            checkpoint()
            conn.execute(
                "UPDATE video_export_task SET state='completed',phase='completed',progress=100,"
                "artifact=?,updated_at=? WHERE id=?",
                (json.dumps(artifact, ensure_ascii=False), time.time(), task_id),
            )

        try:
            request = VideoExport.model_validate_json(row[12])
            expected = json.loads(row[13])
            checkpoint()
            _saved_document(self.connection(), request, current_revision=False)
            if source_fingerprints(request, self.check_path_trust) != expected:
                raise HTTPException(409, "源素材已变化，请检查后重新导出")
            stage = self._stage(workspace_id, task_id)
            with self.lock:
                checkpoint()
                stage.mkdir(parents=True, exist_ok=False)
            if shutil.disk_usage(stage).free < required_disk_bytes(request):
                raise HTTPException(507, "预计导出空间不足，请释放磁盘空间")

            def run(args, directory, duration, *, progress_start=0, progress_end=99):
                self._update(task_id, phase="rendering")
                run_ffmpeg(
                    args,
                    directory,
                    duration,
                    checkpoint,
                    lambda value: self._update(
                        task_id,
                        progress=progress_start + value / 100 * (progress_end - progress_start),
                    ),
                )

            output = stage / "render.mp4"
            self.renderer(
                request,
                output,
                stage,
                self.check_path_trust,
                run_process=run,
                check_cancel=checkpoint,
            )
            checkpoint()
            if source_fingerprints(request, self.check_path_trust) != expected:
                raise HTTPException(409, "导出期间源素材已变化，结果未发布")
            with self.lock:
                checkpoint()
                self._update(task_id, phase="saving")
                self.publisher(request, output, current_revision=False, committed=committed)
        except ExportCancelled:
            pass
        except ExportInterrupted as exc:
            self._update(task_id, state="interrupted", phase="interrupted", error=str(exc))
        except Exception as exc:
            message = (
                str(exc.detail)
                if isinstance(exc, HTTPException)
                else "视频导出失败，请检查素材和可用磁盘空间"
            )
            self._update(task_id, state="failed", phase="failed", error=message)
        finally:
            self._cleanup(workspace_id, task_id)


def mount_video_export_routes(
    app, base, verify_secret, write_permission_required, check_path_trust
):
    manager = VideoExports(Database.get_connection, check_path_trust)
    app.state.video_exports = manager
    route = base + "/video_studio/tasks"

    @app.get(route, dependencies=[Depends(verify_secret)])
    def list_tasks(workspace_id: str, document_id: str = ""):
        return manager.list(workspace_id, document_id)

    @app.delete(
        route + "/{task_id}",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def delete(task_id: UUID, workspace_id: str):
        return manager.delete(workspace_id, str(task_id))

    @app.post(
        route,
        status_code=202,
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def submit(request: VideoExportSubmission):
        return manager.submit(request)

    @app.post(
        route + "/{task_id}/cancel",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def cancel(task_id: UUID, workspace_id: str):
        return manager.cancel(workspace_id, str(task_id))
