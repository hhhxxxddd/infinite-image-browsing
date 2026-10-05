"""Queue lifecycle tests plus real short FFmpeg rendering; not a 10 GB/4K benchmark."""

import array
import hashlib
import json
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from PIL import Image

from backend.tests.support.database import isolate_database, isolate_project_storage
from omnigallery.infrastructure.database import Database
from omnigallery.workspaces.artifacts import artifact_root, mount_workspace_artifact_routes
from omnigallery.workspaces.state import delete_workspace_state
from omnigallery.workspaces.video_exports import (
    ExportCancelled,
    VideoExports,
    VideoExportSubmission,
    mount_video_export_routes,
    required_disk_bytes,
    run_ffmpeg,
)
from omnigallery.workspaces.video_studio import MAX_SECONDS, VideoDocument, render_duration


class VideoExportQueueTests(unittest.TestCase):
    def setUp(self):
        isolate_project_storage(self)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        isolate_database(self, self.root / "test.db")
        self.conn = Database.get_connection()
        self.workspace = str(uuid.uuid4())
        self.draft = "video-draft"
        self.source = self.root / "original.png"
        Image.new("RGB", (320, 240), "red").save(self.source)
        self.conn.execute(
            "INSERT INTO workspace_state VALUES (?,?,?)",
            (
                self.workspace,
                f"omnigallery:workspace-works-v2:{self.workspace}",
                json.dumps({"works": [{"drafts": [{"id": self.draft, "kind": "video"}]}]}),
            ),
        )
        self.conn.commit()

    def document(self, duration=1):
        return {
            "version": 1,
            "width": 320,
            "height": 240,
            "fps": 12,
            "visuals": [
                {
                    "id": "clip",
                    "path": str(self.source),
                    "name": self.source.name,
                    "kind": "image",
                    "start": 0,
                    "sourceIn": 0,
                    "duration": duration,
                    "sourceDuration": duration,
                    "rate": 1,
                    "gain": 1,
                }
            ],
            "sounds": [],
            "captions": [],
            "markers": [],
        }

    def submission(self, *, document=None, task_id=None):
        document = document or self.document()
        raw = json.dumps(document)
        self.conn.execute(
            "INSERT OR REPLACE INTO workspace_state VALUES (?,?,?)",
            (self.workspace, f"omnigallery:video-timeline-v1:{self.workspace}:{self.draft}", raw),
        )
        self.conn.commit()
        return VideoExportSubmission(
            task_id=task_id or uuid.uuid4(),
            workspace_id=self.workspace,
            document_id=self.draft,
            document_revision=hashlib.sha256(raw.encode()).hexdigest(),
            name="视频.mp4",
            document=document,
        )

    def manager(self, **kwargs):
        def trusted(path):
            if not Path(path).resolve().is_relative_to(self.root.resolve()):
                raise HTTPException(403, "不允许读取此素材")

        manager = VideoExports(Database.get_connection, trusted, **kwargs)
        self.addCleanup(manager.close)
        return manager

    def wait(self, manager, task_id, state, timeout=10):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            item = manager.get(self.workspace, task_id)
            if item["state"] == state:
                return item
            if item["state"] in {"failed", "completed", "interrupted"}:
                self.fail(f"Expected {state}, got {item}")
            time.sleep(0.02)
        self.fail(f"Timed out: {manager.get(self.workspace, task_id)}")

    @staticmethod
    def fake_renderer(request, target, directory, check_path_trust, **kwargs):
        target.write_bytes(b"synthetic artifact; lifecycle test only")

    def test_submission_is_idempotent_and_conflicting_reuse_is_rejected(self):
        manager = self.manager(renderer=self.fake_renderer)
        request = self.submission()
        with patch.object(manager, "_wake"):
            first = manager.submit(request)
            second = manager.submit(request)
            self.assertEqual(first, second)
            changed = request.model_copy(update={"name": "other.mp4"})
            with self.assertRaises(HTTPException) as caught:
                manager.submit(changed)
            self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(len(manager.list(self.workspace)), 1)

    def test_pre_extension_v1_task_retry_keeps_accepted_identity(self):
        manager = self.manager(renderer=self.fake_renderer)
        request = self.submission()
        legacy = {
            "workspace_id": request.workspace_id,
            "document_id": request.document_id,
            "document_revision": request.document_revision,
            "document": self.document(),
            "name": request.name,
        }
        raw = json.dumps(legacy)
        with patch.object(manager, "_wake"):
            job = manager.submit(request)
            self.conn.execute(
                "UPDATE video_export_task SET request=?, fingerprint=? WHERE id=?",
                (raw, hashlib.sha256(raw.encode()).hexdigest(), job["id"]),
            )
            self.conn.commit()
            self.assertEqual(manager.submit(request)["id"], job["id"])
            self.assertEqual(len(manager.list(self.workspace)), 1)

    def test_api_returns_public_tasks_and_enforces_workspace_and_write_boundaries(self):
        app = FastAPI()
        writable = True

        def write():
            if not writable:
                raise HTTPException(403, "只读")

        mount_video_export_routes(app, "/api", lambda: None, write, lambda path: None)
        manager = app.state.video_exports
        self.addCleanup(manager.close)
        request = self.submission().model_dump(mode="json")
        with TestClient(app) as client, patch.object(manager, "_wake"):
            response = client.post("/api/video_studio/tasks", json=request)
            self.assertEqual(response.status_code, 202, response.text)
            job = response.json()
            self.assertEqual(job["state"], "queued")
            self.assertEqual(job["progress"], 0)
            self.assertIsNone(job["artifact"])
            self.assertNotIn("request", job)
            self.assertNotIn("sources", job)
            listed = client.get(
                "/api/video_studio/tasks",
                params={
                    "workspace_id": self.workspace,
                    "document_id": self.draft,
                },
            )
            self.assertEqual(listed.json(), [job])
            wrong_workspace = client.post(
                f"/api/video_studio/tasks/{job['id']}/cancel",
                params={
                    "workspace_id": str(uuid.uuid4()),
                },
            )
            self.assertEqual(wrong_workspace.status_code, 404)
            writable = False
            denied = client.post(
                f"/api/video_studio/tasks/{job['id']}/cancel",
                params={
                    "workspace_id": self.workspace,
                },
            )
            self.assertEqual(denied.status_code, 403)
            writable = True
            cancelled = client.post(
                f"/api/video_studio/tasks/{job['id']}/cancel",
                params={
                    "workspace_id": self.workspace,
                },
            )
            self.assertEqual(cancelled.json()["state"], "cancelled")

    def test_api_marks_only_preflight_rejections_as_definitely_not_created(self):
        app = FastAPI()
        mount_video_export_routes(app, "/api", lambda: None, lambda: None, lambda path: None)
        manager = app.state.video_exports
        self.addCleanup(manager.close)
        with TestClient(app) as client, patch.object(manager, "_wake"):
            request = self.submission().model_dump(mode="json")
            with patch("omnigallery.workspaces.video_exports.shutil.disk_usage") as disk:
                disk.return_value.free = 1
                response = client.post("/api/video_studio/tasks", json=request)
            self.assertEqual(response.status_code, 507, response.text)
            self.assertEqual(response.json()["detail"]["type"], "video_export_not_created")
            self.assertIn("空间", response.json()["detail"]["message"])
            self.assertEqual(manager.list(self.workspace), [])

            self.submission(document=self.document(2))
            response = client.post("/api/video_studio/tasks", json=request)
            self.assertEqual(response.status_code, 409, response.text)
            self.assertEqual(response.json()["detail"]["type"], "video_export_not_created")
            self.assertEqual(manager.list(self.workspace), [])

            for _ in range(4):
                accepted = client.post(
                    "/api/video_studio/tasks", json=self.submission().model_dump(mode="json")
                )
                self.assertEqual(accepted.status_code, 202, accepted.text)
            response = client.post(
                "/api/video_studio/tasks", json=self.submission().model_dump(mode="json")
            )
            self.assertEqual(response.status_code, 429, response.text)
            self.assertEqual(response.json()["detail"]["type"], "video_export_not_created")
            self.assertEqual(len(manager.list(self.workspace)), 4)

    def test_api_uncertain_commit_retries_keep_identity_through_auth_validation_and_full_queue(
        self,
    ):
        app = FastAPI()
        authenticated, writable = True, True

        def verify():
            if not authenticated:
                raise HTTPException(401, "登录已失效")

        def write():
            if not writable:
                raise HTTPException(403, "只读")

        mount_video_export_routes(app, "/api", verify, write, lambda path: None)
        manager = app.state.video_exports
        self.addCleanup(manager.close)
        request = self.submission().model_dump(mode="json")
        with TestClient(app) as client, patch.object(manager, "_wake") as wake:
            manager.start()
            # The row is committed before waking the worker; losing this response is ambiguous.
            wake.side_effect = HTTPException(503, "模拟提交后的响应失败")
            response = client.post("/api/video_studio/tasks", json=request)
            self.assertEqual(response.status_code, 503, response.text)
            self.assertIsInstance(response.json()["detail"], str)
            self.assertEqual(manager.list(self.workspace)[0]["id"], request["task_id"])
            wake.side_effect = None

            authenticated = False
            response = client.post("/api/video_studio/tasks", json=request)
            self.assertEqual(response.status_code, 401, response.text)
            self.assertIsInstance(response.json()["detail"], str)
            authenticated, writable = True, False
            response = client.post("/api/video_studio/tasks", json=request)
            self.assertEqual(response.status_code, 403, response.text)
            self.assertIsInstance(response.json()["detail"], str)
            writable = True
            response = client.post(
                "/api/video_studio/tasks", json={**request, "task_id": "invalid"}
            )
            self.assertEqual(response.status_code, 422, response.text)
            self.assertIsInstance(response.json()["detail"], list)
            response = client.post("/api/video_studio/tasks", json={**request, "name": "other.mp4"})
            self.assertEqual(response.status_code, 409, response.text)
            self.assertIsInstance(response.json()["detail"], str)

            for duration in (2, 3, 4):
                accepted = client.post(
                    "/api/video_studio/tasks",
                    json=self.submission(document=self.document(duration)).model_dump(mode="json"),
                )
                self.assertEqual(accepted.status_code, 202, accepted.text)
            # Saved revision has changed and all slots are occupied, but this is an existing task.
            retry = client.post("/api/video_studio/tasks", json=request)
            self.assertEqual(retry.status_code, 202, retry.text)
            self.assertEqual(retry.json()["id"], request["task_id"])
            self.assertEqual(retry.json()["document_revision"], request["document_revision"])
            self.assertEqual(len(manager.list(self.workspace)), 4)

    def test_full_queue_still_accepts_idempotent_retry(self):
        manager = self.manager(renderer=self.fake_renderer)
        request = self.submission()
        with patch.object(manager, "_wake"):
            job = manager.submit(request)
            for _ in range(3):
                manager.submit(self.submission())
            self.assertEqual(manager.submit(request)["id"], job["id"])
            with self.assertRaises(HTTPException) as caught:
                manager.submit(self.submission())
            self.assertEqual(caught.exception.status_code, 429)

    def test_deleting_workspace_state_removes_only_its_export_rows(self):
        manager = self.manager(renderer=self.fake_renderer)
        with patch.object(manager, "_wake"):
            job = manager.submit(self.submission())
        foreign_workspace = str(uuid.uuid4())
        foreign_id = str(uuid.uuid4())
        row = list(self.conn.execute("SELECT * FROM video_export_task").fetchone())
        row[:2] = [foreign_id, foreign_workspace]
        self.conn.execute(
            "INSERT INTO video_export_task VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", row
        )
        self.conn.commit()
        delete_workspace_state(self.conn, self.workspace)
        self.assertEqual(manager.list(self.workspace), [])
        self.assertEqual(manager.list(foreign_workspace)[0]["id"], foreign_id)
        self.assertFalse(manager._stage(self.workspace, job["id"]).exists())

    @unittest.skipUnless(shutil.which("ffmpeg"), "FFmpeg required")
    def test_deleting_workspace_artifacts_stops_real_running_process_before_removing_directory(
        self,
    ):
        entered = threading.Event()

        def realtime(request, target, directory, trust, *, run_process, **kwargs):
            entered.set()
            run_process(
                [
                    shutil.which("ffmpeg"),
                    "-nostdin",
                    "-v",
                    "error",
                    "-y",
                    "-re",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=blue:s=320x240:r=12:d=60",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "ultrafast",
                    str(target),
                ],
                directory,
                60,
            )

        manager = self.manager(renderer=realtime)
        job = manager.submit(self.submission())
        self.assertTrue(entered.wait(5))
        app = FastAPI()
        app.state.video_exports = manager
        mount_workspace_artifact_routes(app, "/api", lambda: None, lambda: None)
        with TestClient(app) as client:
            response = client.delete(
                "/api/workspace_artifacts", params={"workspace_id": self.workspace}
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(manager.list(self.workspace), [])
        self.assertFalse((artifact_root() / self.workspace).exists())
        self.assertFalse(manager._stage(self.workspace, job["id"]).exists())
        self.assertEqual(
            self.conn.execute("SELECT count(*) FROM workspace_artifact").fetchone()[0], 0
        )

    def test_queue_runs_one_export_at_a_time_and_snapshot_survives_continued_editing(self):
        entered, release = threading.Event(), threading.Event()
        active = 0
        maximum = 0

        def render(*args, **kwargs):
            nonlocal active, maximum
            active += 1
            maximum = max(maximum, active)
            entered.set()
            self.assertTrue(release.wait(5))
            self.fake_renderer(*args, **kwargs)
            active -= 1

        manager = self.manager(renderer=render)
        self.addCleanup(release.set)
        first = manager.submit(self.submission())
        self.assertTrue(entered.wait(5))
        second = manager.submit(self.submission(document=self.document(2)))
        # A subsequent edit is allowed while the first immutable snapshot is rendering.
        self.submission(document=self.document(3))
        release.set()
        result1 = self.wait(manager, first["id"], "completed")
        result2 = self.wait(manager, second["id"], "completed")
        self.assertEqual(maximum, 1)
        self.assertEqual(result1["artifact"]["document_revision"], first["document_revision"])
        self.assertEqual(result2["artifact"]["document_revision"], second["document_revision"])
        self.assertEqual(
            self.conn.execute("SELECT count(*) FROM workspace_artifact").fetchone()[0], 2
        )

    def test_repeated_start_does_not_interrupt_an_active_export(self):
        entered, release = threading.Event(), threading.Event()

        def renderer(*args, **kwargs):
            entered.set()
            self.assertTrue(release.wait(5))
            self.fake_renderer(*args, **kwargs)

        manager = self.manager(renderer=renderer)
        self.addCleanup(release.set)
        job = manager.submit(self.submission())
        self.assertTrue(entered.wait(5))
        original_worker = manager.worker
        manager.start()
        manager.start()
        self.assertIs(manager.worker, original_worker)
        self.assertEqual(manager.get(self.workspace, job["id"])["state"], "running")
        release.set()
        self.wait(manager, job["id"], "completed")

    def test_cancel_arriving_during_atomic_publish_returns_completed_result(self):
        from omnigallery.workspaces.video_studio import _commit_video

        publishing, release = threading.Event(), threading.Event()
        responses = []

        def publisher(*args, **kwargs):
            publishing.set()
            self.assertTrue(release.wait(5))
            return _commit_video(*args, **kwargs)

        manager = self.manager(renderer=self.fake_renderer, publisher=publisher)
        self.addCleanup(release.set)
        job = manager.submit(self.submission())
        self.assertTrue(publishing.wait(5))
        cancelling = threading.Thread(
            target=lambda: responses.append(manager.cancel(self.workspace, job["id"]))
        )
        cancelling.start()
        release.set()
        cancelling.join(5)
        self.assertFalse(cancelling.is_alive())
        self.assertEqual(responses[0]["state"], "completed")
        self.assertIsNotNone(responses[0]["artifact"])
        self.assertEqual(
            self.conn.execute("SELECT count(*) FROM workspace_artifact").fetchone()[0], 1
        )

    def test_source_changed_during_render_cannot_publish_partial_version(self):
        def renderer(*args, **kwargs):
            self.fake_renderer(*args, **kwargs)
            self.source.write_bytes(b"different source after rendering")

        manager = self.manager(renderer=renderer)
        job = manager.submit(self.submission())
        result = self.wait(manager, job["id"], "failed")
        self.assertIn("导出期间", result["error"])
        self.assertEqual(
            self.conn.execute("SELECT count(*) FROM workspace_artifact").fetchone()[0], 0
        )

    def test_cancelled_queue_never_renders_or_publishes(self):
        manager = self.manager(renderer=self.fake_renderer)
        with patch.object(manager, "_wake"):
            job = manager.submit(self.submission())
            cancelled = manager.cancel(self.workspace, job["id"])
        self.assertEqual(cancelled["state"], "cancelled")
        manager._wake()
        manager.close()
        self.assertEqual(
            self.conn.execute("SELECT count(*) FROM workspace_artifact").fetchone()[0], 0
        )

    def test_running_cancellation_cleans_partial_output_without_publishing(self):
        entered, release = threading.Event(), threading.Event()

        def render(*args, **kwargs):
            self.fake_renderer(*args, **kwargs)
            entered.set()
            self.assertTrue(release.wait(5))

        manager = self.manager(renderer=render)
        self.addCleanup(release.set)
        job = manager.submit(self.submission())
        self.assertTrue(entered.wait(5))
        manager.cancel(self.workspace, job["id"])
        release.set()
        manager.close()
        self.assertEqual(manager.get(self.workspace, job["id"])["state"], "cancelled")
        self.assertFalse(manager._stage(self.workspace, job["id"]).exists())
        self.assertEqual(
            self.conn.execute("SELECT count(*) FROM workspace_artifact").fetchone()[0], 0
        )

    def test_restart_marks_running_interrupted_and_preserves_queued_snapshots(self):
        manager = self.manager(renderer=self.fake_renderer)
        with patch.object(manager, "_wake"):
            first = manager.submit(self.submission())
            second = manager.submit(self.submission())
        stage = manager._stage(self.workspace, first["id"])
        stage.mkdir()
        (stage / "render.mp4").write_bytes(b"incomplete")
        self.conn.execute("UPDATE video_export_task SET state='running' WHERE id=?", (first["id"],))
        self.conn.commit()
        manager.close()
        restarted = self.manager(renderer=self.fake_renderer)
        restarted.start()
        self.assertEqual(restarted.get(self.workspace, first["id"])["state"], "interrupted")
        self.assertFalse(stage.exists())
        self.wait(restarted, second["id"], "completed")

    def test_source_change_and_deleted_draft_reject_publish(self):
        for modification in ("source", "draft"):
            with self.subTest(modification=modification):
                manager = self.manager(renderer=self.fake_renderer)
                with patch.object(manager, "_wake"):
                    job = manager.submit(self.submission())
                if modification == "source":
                    self.source.write_bytes(b"changed original")
                else:
                    self.conn.execute(
                        "UPDATE workspace_state SET value=? WHERE key=? AND workspace_id=?",
                        (
                            '{"works":[]}',
                            f"omnigallery:workspace-works-v2:{self.workspace}",
                            self.workspace,
                        ),
                    )
                    self.conn.commit()
                manager._wake()
                result = self.wait(manager, job["id"], "failed")
                self.assertIn("变化" if modification == "source" else "删除", result["error"])
                manager.close()
        self.assertEqual(
            self.conn.execute("SELECT count(*) FROM workspace_artifact").fetchone()[0], 0
        )

    def test_publisher_failure_rolls_back_artifact_and_cleans_files(self):
        from omnigallery.workspaces.video_studio import _commit_video

        def publisher(request, target, **kwargs):
            def fail_commit(conn, artifact):
                raise OSError("failed task completion")

            return _commit_video(request, target, current_revision=False, committed=fail_commit)

        manager = self.manager(renderer=self.fake_renderer, publisher=publisher)
        job = manager.submit(self.submission())
        self.wait(manager, job["id"], "failed")
        manager.close()
        self.assertEqual(
            self.conn.execute("SELECT count(*) FROM workspace_artifact").fetchone()[0], 0
        )
        self.assertEqual(list((artifact_root() / self.workspace).glob("*.mp4")), [])
        self.assertFalse(manager._stage(self.workspace, job["id"]).exists())

    def test_length_budget_and_disk_preflight_are_explicit(self):
        request = self.submission(document=self.document(MAX_SECONDS))
        self.assertEqual(render_duration(request.document), 6 * 3600)
        self.assertGreater(required_disk_bytes(request), 20 * 1024**3)
        with self.assertRaises(HTTPException):
            render_duration(VideoDocument.model_validate(self.document(MAX_SECONDS + 1)))
        manager = self.manager(renderer=self.fake_renderer)
        with patch("omnigallery.workspaces.video_exports.shutil.disk_usage") as disk:
            disk.return_value.free = 1
            with self.assertRaises(HTTPException) as caught:
                manager.submit(request)
            self.assertEqual(caught.exception.status_code, 507)

    def test_proxy_cache_path_cannot_be_submitted_as_original(self):
        proxy = self.root / "cache" / "video-proxies" / "low-res.mp4"
        proxy.parent.mkdir(parents=True)
        proxy.write_bytes(b"proxy")
        document = self.document()
        document["visuals"][0].update(path=str(proxy), name=proxy.name, kind="video")
        manager = self.manager(renderer=self.fake_renderer)
        with patch(
            "omnigallery.workspaces.video_studio.get_cache_dir",
            return_value=str(self.root / "cache"),
        ):
            with self.assertRaises(HTTPException) as caught:
                manager.submit(self.submission(document=document))
        self.assertEqual(caught.exception.status_code, 422)
        self.assertEqual(caught.exception.detail["type"], "video_export_not_created")
        self.assertIn("原始素材", caught.exception.detail["message"])

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg required")
    def test_real_short_ffmpeg_export_uses_original_path_and_publishes_atomic_result(self):
        manager = self.manager()
        request = self.submission()
        with patch.object(Path, "read_bytes", side_effect=AssertionError("No full source reads")):
            job = manager.submit(request)
            result = self.wait(manager, job["id"], "completed", timeout=30)
        artifact = result["artifact"]
        target = artifact_root() / self.workspace / (artifact["id"] + ".mp4")
        self.assertGreater(target.stat().st_size, 500)
        metadata = json.loads(
            subprocess.check_output(
                [
                    shutil.which("ffprobe"),
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration:stream=width,height",
                    "-of",
                    "json",
                    str(target),
                ]
            )
        )
        self.assertAlmostEqual(float(metadata["format"]["duration"]), 1, delta=0.2)
        self.assertEqual(metadata["streams"][0]["width"], 320)
        self.assertEqual(result["progress"], 100)
        manager.close()
        self.assertFalse(manager._stage(self.workspace, job["id"]).exists())

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg required")
    def test_real_uhd_original_with_audio_is_trimmed_reversed_sped_up_and_exported_at_4k(self):
        # Real UHD decoding/encoding, deliberately short; this is not a large-file speed benchmark.
        source = self.root / "original-uhd.mp4"
        subprocess.run(
            [
                shutil.which("ffmpeg"),
                "-nostdin",
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=blue:s=3840x2160:r=12:d=3",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=48000:duration=3",
                "-c:v",
                "libx264",
                "-threads",
                "2",
                "-preset",
                "ultrafast",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
                str(source),
            ],
            check=True,
            capture_output=True,
            timeout=60,
        )
        before = (source.stat().st_size, source.stat().st_mtime_ns)
        document = self.document()
        document.update(width=3840, height=2160)
        clip = document["visuals"][0]
        clip.update(
            path=str(source),
            name=source.name,
            kind="video",
            sourceIn=1,
            sourceDuration=3,
            duration=1,
            rate=2,
            reverse=True,
        )
        document["sounds"] = [{**clip, "id": "sound"}]
        manager = self.manager()
        updates = []
        update = manager._update

        def record(task_id, **values):
            updates.append(values)
            return update(task_id, **values)

        with patch.object(manager, "_update", side_effect=record):
            job = manager.submit(self.submission(document=document))
            result = self.wait(manager, job["id"], "completed", timeout=60)
        artifact = result["artifact"]
        target = artifact_root() / self.workspace / (artifact["id"] + ".mp4")
        metadata = json.loads(
            subprocess.check_output(
                [
                    shutil.which("ffprobe"),
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration:stream=codec_type,width,height",
                    "-of",
                    "json",
                    str(target),
                ]
            )
        )
        self.assertEqual((artifact["width"], artifact["height"]), (3840, 2160))
        video = next(stream for stream in metadata["streams"] if stream["codec_type"] == "video")
        self.assertEqual((video["width"], video["height"]), (3840, 2160))
        self.assertTrue(any(stream["codec_type"] == "audio" for stream in metadata["streams"]))
        self.assertAlmostEqual(float(metadata["format"]["duration"]), 1, delta=0.2)
        self.assertIn({"phase": "rendering"}, updates)
        samples = array.array(
            "h",
            subprocess.check_output(
                [
                    shutil.which("ffmpeg"),
                    "-nostdin",
                    "-v",
                    "error",
                    "-i",
                    str(target),
                    "-map",
                    "0:a:0",
                    "-t",
                    "0.2",
                    "-f",
                    "s16le",
                    "-ac",
                    "1",
                    "-ar",
                    "8000",
                    "pipe:1",
                ]
            ),
        )
        self.assertGreater(max(abs(value) for value in samples), 100)
        self.assertTrue(any(0 <= item.get("progress", -1) <= 99 for item in updates))
        self.assertEqual(result["progress"], 100)
        self.assertEqual((source.stat().st_size, source.stat().st_mtime_ns), before)

    @unittest.skipUnless(shutil.which("ffmpeg"), "FFmpeg required")
    def test_real_ffmpeg_cancel_terminates_process_promptly(self):
        started = time.monotonic()
        reports = []
        processes = []
        real_popen = subprocess.Popen

        def spawned(*args, **kwargs):
            process = real_popen(*args, **kwargs)
            processes.append(process)
            return process

        def checkpoint():
            if time.monotonic() - started > 1:
                raise ExportCancelled()

        args = [
            shutil.which("ffmpeg"),
            "-nostdin",
            "-v",
            "error",
            "-y",
            "-re",
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:s=320x240:r=12:d=60",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            str(self.root / "cancel.mp4"),
        ]
        with patch("omnigallery.workspaces.video_exports.subprocess.Popen", side_effect=spawned):
            with self.assertRaises(ExportCancelled):
                run_ffmpeg(args, self.root, 60, checkpoint, reports.append)
        self.assertTrue(reports)
        self.assertLess(time.monotonic() - started, 5)
        self.assertIsNotNone(processes[0].poll())


if __name__ == "__main__":
    unittest.main()
