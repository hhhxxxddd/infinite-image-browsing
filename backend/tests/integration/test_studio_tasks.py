import sqlite3
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi import HTTPException

from omnigallery.workspaces.tasks import StudioTasks, task_lock


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

    def test_output_keeps_submitted_production_origin_after_browser_switches(self):
        release = threading.Event()
        origin = {"document_id": "production-1", "document_revision": "a" * 64}
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
        release.set()
        self.wait_for(lambda: self.manager.list("workspace")[0]["state"] == "completed")
        result = self.saved.call_args.args[2]
        self.assertEqual(result["document_id"], "production-1")
        self.assertEqual(result["document_revision"], "a" * 64)
        self.assertEqual(result["source_image_base64"], "source-image")

    def test_restart_marks_uncertain_jobs_failed_without_replaying(self):
        conn = self.connection()
        conn.execute(
            "INSERT INTO studio_task VALUES (?,?,?,?,?,?,?,?)",
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
                "INSERT INTO studio_task VALUES (?,?,?,?,?,?,?,?)",
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
