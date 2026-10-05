import json
import sqlite3
import tempfile
import threading
import time
import unittest
import uuid
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi import HTTPException

from omnigallery.workspaces.tasks import (
    StudioTasks,
    TaskContext,
    TaskInterrupted,
    ai_output_stem,
    task_lock,
)


class StudioTasksTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db = str(Path(self.temp.name) / "tasks.db")
        self.local = threading.local()
        self.connections = []
        self.addCleanup(lambda: [conn.close() for conn in self.connections])
        self.threads = []
        original_thread = threading.Thread

        def tracked_thread(*args, **kwargs):
            thread = original_thread(*args, **kwargs)
            self.threads.append(thread)
            return thread

        thread_patch = patch(
            "omnigallery.workspaces.tasks.threading.Thread", side_effect=tracked_thread
        )
        thread_patch.start()
        self.addCleanup(thread_patch.stop)
        self.addCleanup(lambda: [thread.join(3) for thread in self.threads])

        def connection():
            if not hasattr(self.local, "conn"):
                self.local.conn = sqlite3.connect(self.db, check_same_thread=False)
                self.connections.append(self.local.conn)
            return self.local.conn

        self.connection = connection
        self.saved = Mock(return_value={"id": "result-id"})
        self.manager = StudioTasks(connection, self.saved)

    def wait_for(self, predicate):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if predicate():
                return
            time.sleep(0.01)
        self.fail("background task did not reach expected state")

    def durable_manager(self, runner):
        return StudioTasks(
            self.connection, self.saved, runner=runner, payload_root=lambda: Path(self.temp.name)
        )

    def durable_submit(self, manager, **kwargs):
        return manager.submit(
            "workspace",
            "Test",
            None,
            {"prompt": "forest"},
            origin={"purpose": "image_edit", "lineage": {"source": "original"}},
            payload={"mode": "router", "generation": False, "request": {"image_base64": "source"}},
            **kwargs,
        )

    def test_delete_hides_terminal_record_and_preserves_idempotent_results(self):
        runner = Mock(return_value={"image_base64": "result"})
        manager = self.durable_manager(runner)
        task = self.durable_submit(manager, task_id=str(uuid.uuid4()), fingerprint="input")
        self.wait_for(lambda: manager.get("workspace", task["id"])["state"] == "completed")
        results = manager.get("workspace", task["id"])["results"]
        self.assertEqual(manager.delete("workspace", task["id"]), {"deleted": task["id"]})
        self.assertEqual(manager.delete("workspace", task["id"]), {"deleted": task["id"]})
        self.assertEqual(manager.list("workspace"), [])
        retried = self.durable_submit(manager, task_id=task["id"], fingerprint="input")
        self.assertTrue(retried["deleted"])
        self.assertEqual(retried["results"], results)
        runner.assert_called_once()
        self.saved.assert_called_once()
        self.assertEqual(self.durable_manager(runner).list("workspace"), [])
        with self.assertRaises(HTTPException) as wrong_scope:
            manager.delete("other-workspace", task["id"])
        self.assertEqual(wrong_scope.exception.status_code, 404)

    def test_delete_rejects_active_interrupted_and_unconfirmed_remote_failure(self):
        manager = self.durable_manager(Mock())
        with patch.object(manager, "_start_remote"):
            task = self.durable_submit(manager)
        for state in ("queued", "running", "interrupted", "failed"):
            with self.subTest(state=state):
                TaskContext(manager, task["id"]).update(submitted_at=10, remote_id="remote")
                self.connection().execute(
                    "UPDATE studio_task SET state=? WHERE id=?", (state, task["id"])
                )
                self.connection().commit()
                with self.assertRaises(HTTPException) as active:
                    manager.delete("workspace", task["id"])
                self.assertEqual(active.exception.status_code, 409)
                self.assertTrue(manager._payload_path("workspace", task["id"]).exists())
        TaskContext(manager, task["id"]).update(remote_done=True)
        self.assertEqual(manager.delete("workspace", task["id"]), {"deleted": task["id"]})

    def test_restart_recovers_durable_snapshot_and_handle_without_page(self):
        runner = Mock(return_value={"image_base64": "result"})
        manager = self.durable_manager(runner)
        with patch.object(manager, "_start_remote"):
            task = self.durable_submit(manager)
        TaskContext(manager, task["id"]).update(remote_id="remote-job", submitted_at=10)
        self.connection().execute(
            "UPDATE studio_task SET state='running' WHERE id=?", (task["id"],)
        )
        self.connection().commit()
        resumed = self.durable_manager(runner)
        self.wait_for(lambda: resumed.get("workspace", task["id"])["state"] == "completed")
        runner.assert_called_once()
        payload, context = runner.call_args.args
        self.assertEqual(context.read()["remote_id"], "remote-job")
        self.assertEqual(payload["request"]["image_base64"], "source")
        self.assertEqual(self.saved.call_args.args[2]["lineage"], {"source": "original"})
        self.assertEqual(self.saved.call_args.args[2]["source_image_base64"], "source")
        self.wait_for(lambda: not manager._payload_path("workspace", task["id"]).exists())

    def test_duplicate_client_submission_returns_original_and_rejects_changed_input(self):
        runner = Mock(return_value={"image_base64": "result"})
        manager = self.durable_manager(runner)
        submission_id = "22222222-2222-4222-8222-222222222222"
        first = self.durable_submit(manager, task_id=submission_id, fingerprint="input")
        second = self.durable_submit(manager, task_id=submission_id, fingerprint="input")
        self.assertEqual(first["id"], second["id"])
        with self.assertRaises(HTTPException) as raised:
            self.durable_submit(manager, task_id=submission_id, fingerprint="changed")
        self.assertEqual(raised.exception.status_code, 409)
        self.wait_for(lambda: manager.get("workspace", submission_id)["state"] == "completed")
        runner.assert_called_once()
        self.assertNotIn("execution", manager.get("workspace", submission_id))
        self.assertNotIn("fingerprint", json.dumps(manager.get("workspace", submission_id)))

    def test_local_queued_cancel_removes_snapshot_and_never_calls_provider(self):
        runner = Mock()
        manager = self.durable_manager(runner)
        with patch.object(manager, "_start_remote"):
            task = self.durable_submit(manager)
        result = manager.cancel("workspace", task["id"])
        self.assertEqual(result["state"], "cancelled")
        self.assertFalse(manager._payload_path("workspace", task["id"]).exists())
        runner.assert_not_called()
        with self.assertRaises(HTTPException):
            manager.cancel("another-workspace", task["id"])

    def test_partial_save_resumes_without_duplicate_artifacts(self):
        def run(payload, context):
            context.update(phase="saving", remote_id="remote-job")
            return {"images": [{"image_base64": "a"}, {"image_base64": "b"}]}

        runner = Mock(side_effect=run)
        manager = self.durable_manager(runner)
        self.saved.side_effect = [{"id": "first"}, OSError("disk full"), {"id": "second"}]
        with self.assertLogs("omnigallery.workspaces.tasks", level="ERROR"):
            task = self.durable_submit(manager)
            self.wait_for(lambda: manager.get("workspace", task["id"])["state"] == "interrupted")
        interrupted = manager.get("workspace", task["id"])
        self.assertTrue(interrupted["resumable"])
        self.assertEqual(len(interrupted["results"]), 1)
        manager.resume("workspace", task["id"])
        self.wait_for(lambda: manager.get("workspace", task["id"])["state"] == "completed")
        self.assertEqual(self.saved.call_count, 3)
        runner.assert_called_once()  # Already downloaded outputs survive offline/local-save retries.
        self.assertEqual(
            self.saved.call_args_list[1].args[2]["artifact_id"],
            self.saved.call_args_list[2].args[2]["artifact_id"],
        )
        self.assertEqual(
            [r["artifact_id"] for r in manager.get("workspace", task["id"])["results"]],
            ["first", "second"],
        )

    def test_interrupted_handle_can_resume_but_uncertain_admission_cannot(self):
        runner = Mock(side_effect=TaskInterrupted("offline"))
        manager = self.durable_manager(runner)
        task = self.durable_submit(manager)
        self.wait_for(lambda: manager.get("workspace", task["id"])["state"] == "interrupted")
        TaskContext(manager, task["id"]).update(unrecoverable=True)
        with self.assertRaises(HTTPException):
            manager.resume("workspace", task["id"])
        self.assertTrue(manager._payload_path("workspace", task["id"]).exists())

    def test_returns_while_processing_and_saves_without_browser(self):
        release = threading.Event()
        run = Mock(
            side_effect=lambda: (release.wait(2), {"job_id": "cloud-id", "image_base64": "image"})[
                1
            ]
        )
        task = self.manager.submit("workspace", "Test", run, {"prompt": "edit", "model": "test"})
        self.assertEqual(task["state"], "queued")
        self.wait_for(lambda: self.manager.list("workspace")[0]["state"] == "running")
        self.saved.assert_not_called()
        release.set()
        self.wait_for(lambda: self.manager.list("workspace")[0]["state"] == "completed")
        self.assertEqual(self.manager.list("workspace")[0]["artifact_id"], "result-id")
        self.assertIn("cloud-id", self.saved.call_args.args[3])
        self.assertIn("edit", self.saved.call_args.args[3])
        run.assert_called_once()

    def test_provider_failure_is_persisted_without_resubmitting(self):
        run = Mock(side_effect=HTTPException(502, "云端额度不足"))
        with self.assertLogs("omnigallery.workspaces.tasks", level="ERROR"):
            self.manager.submit("workspace", "Test", run, {})
            self.wait_for(lambda: self.manager.list("workspace")[0]["state"] == "failed")
        self.assertEqual(self.manager.list("workspace")[0]["error"], "云端额度不足")
        self.saved.assert_not_called()
        run.assert_called_once()
        restarted = StudioTasks(self.connection, self.saved)
        self.assertEqual(restarted.list("workspace")[0]["state"], "failed")

    def test_multiple_results_keep_order_labels_origin_and_survive_restart(self):
        self.saved.side_effect = [{"id": "front"}, {"id": "side"}, {"id": "back"}]
        images = [
            {"image_base64": label, "output_node_id": str(index), "output_label": label}
            for index, label in enumerate(("正面", "侧面", "背面"))
        ]
        self.manager.submit(
            "workspace",
            "三视图",
            lambda: {"images": images, "job_id": "job-1"},
            {"prompt": "三视图"},
            "original",
            {"document_id": "production-1", "document_revision": "a" * 64},
        )
        self.wait_for(lambda: self.manager.list("workspace")[0]["state"] == "completed")
        task = StudioTasks(self.connection, self.saved).list("workspace")[0]
        self.assertEqual(task["artifact_id"], "front")
        self.assertEqual(task["document_id"], "production-1")
        self.assertEqual(
            [item["artifact_id"] for item in task["results"]], ["front", "side", "back"]
        )
        for index, call in enumerate(self.saved.call_args_list):
            self.assertEqual(
                call.args[1], f"三视图-AI-001-{index + 1:02d}-{images[index]['output_label']}"
            )
            self.assertEqual(call.args[2]["source_image_base64"], "original")
            self.assertEqual(call.args[2]["document_id"], "production-1")
            self.assertIn(f'"output_index": {index + 1}', call.args[3])
            self.assertIn('"output_count": 3', call.args[3])

    def test_later_save_failure_keeps_visible_partial_results(self):
        self.saved.side_effect = [{"id": "saved"}, HTTPException(507, "磁盘空间不足")]
        with self.assertLogs("omnigallery.workspaces.tasks", level="ERROR"):
            self.manager.submit("workspace", "三视图", lambda: {"images": [{}, {}, {}]}, {})
            self.wait_for(lambda: self.manager.list("workspace")[0]["state"] == "failed")
        task = self.manager.list("workspace")[0]
        self.assertEqual(task["results"][0]["artifact_id"], "saved")
        self.assertIn("已保存 1 / 3", task["error"])
        self.assertEqual(self.saved.call_count, 2)

    def test_long_result_labels_fit_artifact_name_and_keep_batch_number(self):
        self.manager.submit(
            "workspace",
            "名称" * 60,
            lambda: {"images": [{"output_label": "正面" * 40}, {"output_label": "背面" * 40}]},
            {},
            origin={"document_id": "p"},
        )
        self.wait_for(lambda: self.manager.list("workspace")[0]["state"] == "completed")
        for call in self.saved.call_args_list:
            self.assertLessEqual(len(call.args[1]), 120)
            self.assertIn("-AI-001-", call.args[1])

    def test_old_task_table_migrates_and_keeps_legacy_single_result(self):
        conn = self.connection()
        conn.execute("DROP TABLE studio_task")
        conn.execute("""CREATE TABLE studio_task (id TEXT PRIMARY KEY, workspace_id TEXT, name TEXT,
                     state TEXT, created_at REAL, updated_at REAL, error TEXT, artifact_id TEXT)""")
        conn.execute(
            "INSERT INTO studio_task VALUES ('old','workspace','old','completed',1,1,'','result')"
        )
        conn.execute("CREATE TABLE workspace_artifact (id TEXT, source TEXT)")
        conn.execute("INSERT INTO workspace_artifact VALUES ('result','ai_image_generation')")
        conn.execute("CREATE TABLE workspace_artifact_origin (artifact_id TEXT, document_id TEXT)")
        conn.execute("INSERT INTO workspace_artifact_origin VALUES ('result','legacy-production')")
        conn.commit()
        restarted = StudioTasks(self.connection, self.saved)
        self.assertEqual(restarted.list("workspace")[0]["document_id"], "legacy-production")
        self.assertEqual(restarted.list("workspace")[0]["purpose"], "image_generation")
        self.assertEqual(
            restarted.list("workspace")[0]["results"],
            [{"artifact_id": "result", "label": "", "node_id": ""}],
        )

    def test_output_keeps_submitted_production_origin_after_browser_switches(self):
        release = threading.Event()
        origin = {
            "document_id": "production-1",
            "document_revision": "a" * 64,
            "lineage": {"documentId": "image-1", "layerIds": ["layer-1"]},
        }
        self.manager.submit(
            "workspace",
            "AI result",
            lambda: (release.wait(2), {"image_base64": "image", "document_id": "provider-id"})[1],
            {},
            "source-image",
            origin=origin,
        )
        self.wait_for(lambda: self.manager.list("workspace")[0]["state"] == "running")
        origin["document_id"] = "production-2"
        origin["lineage"]["layerIds"].append("layer-2")
        release.set()
        self.wait_for(lambda: self.manager.list("workspace")[0]["state"] == "completed")
        result = self.saved.call_args.args[2]
        self.assertEqual(result["document_id"], "production-1")
        self.assertEqual(result["document_revision"], "a" * 64)
        self.assertEqual(result["source_image_base64"], "source-image")
        self.assertEqual(result["lineage"]["layerIds"], ["layer-1"])

    def test_names_are_numbered_per_production_and_survive_history_deletion(self):
        origin = {"document_id": "ai-1", "document_revision": "a" * 64}
        first = self.manager.submit("workspace", "风景.jpg-AI结果.png", dict, {}, origin=origin)
        second = self.manager.submit("workspace", "风景.jpg-AI结果", dict, {}, origin=origin)
        self.assertEqual(first["name"], "风景-AI-001")
        self.assertEqual(second["name"], "风景-AI-002")
        self.wait_for(
            lambda: all(task["state"] == "completed" for task in self.manager.list("workspace"))
        )
        with task_lock:
            self.connection().execute("DELETE FROM studio_task")
            self.connection().commit()
        restarted = StudioTasks(self.connection, self.saved)
        third = restarted.submit("workspace", "重命名", dict, {}, origin=origin)
        other = restarted.submit(
            "workspace", "另一个分支", dict, {}, origin={**origin, "document_id": "ai-2"}
        )
        self.assertEqual(third["name"], "重命名-AI-003")
        self.assertEqual(other["name"], "另一个分支-AI-001")
        self.assertEqual(ai_output_stem("风景.png"), "风景")

    def test_restart_marks_uncertain_jobs_failed_without_replaying(self):
        conn = self.connection()
        conn.execute(
            "INSERT INTO studio_task (id,workspace_id,name,state,created_at,updated_at,error,artifact_id) VALUES (?,?,?,?,?,?,?,?)",
            ("task", "workspace", "Test", "running", 1, 1, "", ""),
        )
        conn.commit()
        restarted = StudioTasks(self.connection, self.saved)
        self.assertEqual(restarted.list("workspace")[0]["state"], "failed")
        self.assertIn("重启", restarted.list("workspace")[0]["error"])
        self.saved.assert_not_called()

    def test_deleting_workspace_during_processing_does_not_recreate_outputs(self):
        release, finished = threading.Event(), threading.Event()

        def run():
            release.wait(2)
            finished.set()
            return {"image_base64": "image"}

        task = self.manager.submit("workspace", "Test", run, {})
        self.wait_for(lambda: self.manager.list("workspace")[0]["state"] == "running")
        with task_lock:
            self.connection().execute("DELETE FROM studio_task WHERE id=?", (task["id"],))
            self.connection().commit()
        release.set()
        self.assertTrue(finished.wait(2))
        for thread in self.threads:
            thread.join(3)
            self.assertFalse(thread.is_alive())
        self.assertEqual(self.manager.list("workspace"), [])
        self.saved.assert_not_called()

    def test_queue_is_bounded(self):
        conn = self.connection()
        for index in range(4):
            conn.execute(
                "INSERT INTO studio_task (id,workspace_id,name,state,created_at,updated_at,error,artifact_id) VALUES (?,?,?,?,?,?,?,?)",
                (str(index), "workspace", "Test", "queued", 1, 1, "", ""),
            )
        conn.commit()
        with self.assertRaises(HTTPException) as caught:
            self.manager.submit("workspace", "Extra", dict, {})
        self.assertEqual(caught.exception.status_code, 429)
        self.assertEqual(len(self.manager.list("workspace")), 4)

    def test_concurrency_changes_wake_queue_without_interrupting_running_jobs(self):
        self.manager.set_concurrency(1)
        releases = [threading.Event() for _ in range(4)]
        started = [threading.Event() for _ in range(4)]

        def run(index):
            started[index].set()
            releases[index].wait(3)
            return {"image_base64": "image"}

        try:
            self.manager.submit("workspace", "0", lambda: run(0), {})
            self.assertTrue(started[0].wait(1))
            self.manager.submit("workspace", "1", lambda: run(1), {})
            self.assertFalse(started[1].wait(0.1))
            self.manager.set_concurrency(2)
            self.assertTrue(started[1].wait(1))
            self.manager.set_concurrency(1)
            self.manager.submit("workspace", "2", lambda: run(2), {})
            self.manager.submit("workspace", "3", lambda: run(3), {})
            releases[0].set()
            self.wait_for(
                lambda: any(
                    task["name"] == "0" and task["state"] == "completed"
                    for task in self.manager.list("workspace")
                )
            )
            self.assertFalse(started[2].wait(0.1))
            self.assertFalse(started[3].is_set())
            releases[1].set()
            self.wait_for(lambda: started[2].is_set() or started[3].is_set())
            self.assertNotEqual(started[2].is_set(), started[3].is_set())
        finally:
            for release in releases:
                release.set()
        self.wait_for(
            lambda: all(task["state"] == "completed" for task in self.manager.list("workspace"))
        )

    def test_only_two_jobs_run_while_others_queue(self):
        release = threading.Event()
        run = Mock(side_effect=lambda: (release.wait(2), {"image_base64": "image"})[1])
        for index in range(4):
            self.manager.submit("workspace", str(index), run, {})
        self.wait_for(
            lambda: sum(task["state"] == "running" for task in self.manager.list("workspace")) == 2
        )
        self.assertEqual(
            sum(task["state"] == "queued" for task in self.manager.list("workspace")), 2
        )
        self.assertEqual(run.call_count, 2)
        release.set()
        self.wait_for(
            lambda: all(task["state"] == "completed" for task in self.manager.list("workspace"))
        )
        self.assertEqual(self.saved.call_count, 4)
