"""Task deletion permissions and availability of historical media results."""

import hashlib
import json
import sqlite3
import tempfile
import unittest
import uuid
from contextlib import closing
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.tests.support.database import isolate_database, isolate_project_storage
from omnigallery.ai.image_routes import mount_image_ai_routes
from omnigallery.image_editing.routes import mount_routes
from omnigallery.infrastructure.auth import verify_secret, write_permission_required
from omnigallery.infrastructure.database import Database
from omnigallery.infrastructure.route_context import RouteContext
from omnigallery.workspaces.artifacts import create_workspace_artifact_table
from omnigallery.workspaces.audio_exports import (
    AudioExports,
    AudioExportSubmission,
    mount_audio_export_routes,
)
from omnigallery.workspaces.task_records import with_task_artifact_availability
from omnigallery.workspaces.tasks import StudioTasks
from omnigallery.workspaces.video_exports import (
    VideoExports,
    VideoExportSubmission,
    mount_video_export_routes,
)
from omnigallery.workspaces.video_studio import VideoExport


class TaskRecordRouteTests(unittest.TestCase):
    def setUp(self):
        isolate_project_storage(self)
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        isolate_database(self, Path(temporary.name) / "tasks.db")
        self.workspace, self.task = str(uuid.uuid4()), str(uuid.uuid4())
        self.authorized, self.writable = True, True

        def verify():
            if not self.authorized:
                raise HTTPException(401, "未授权")

        def write():
            if not self.writable:
                raise HTTPException(403, "只读")

        app = FastAPI()
        self.manager = Mock()
        self.manager.delete.return_value = {"deleted": self.task}
        with patch("omnigallery.ai.image_routes.StudioTasks", return_value=self.manager):
            mount_image_ai_routes(app, "/api", verify, write, lambda _: True)
        mount_audio_export_routes(app, "/api", verify, write, lambda _: None)
        mount_video_export_routes(app, "/api", verify, write, lambda _: None)
        self.addCleanup(app.state.audio_exports.close)
        self.addCleanup(app.state.video_exports.close)
        app.state.audio_exports.delete = Mock(return_value={"deleted": self.task})
        app.state.video_exports.delete = Mock(return_value={"deleted": self.task})
        app.dependency_overrides[verify_secret] = verify
        app.dependency_overrides[write_permission_required] = write
        mount_routes(app, RouteContext())
        image_delete = patch(
            "omnigallery.image_editing.cutout.delete_job", return_value={"deleted": self.task}
        )
        self.addCleanup(image_delete.stop)
        self.image_delete = image_delete.start()
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_all_deletions_require_authentication_and_write_permission(self):
        for source in ("image-ai", "audio_studio", "video_studio", "image-ai-tools"):
            with self.subTest(source=source):
                query = (
                    {"document_key": "d" * 64}
                    if source == "image-ai-tools"
                    else {"workspace_id": self.workspace}
                )
                route = f"/api/{source}/tasks/{self.task}"
                self.authorized = False
                self.assertEqual(self.client.delete(route, params=query).status_code, 401)
                self.authorized, self.writable = True, False
                self.assertEqual(self.client.delete(route, params=query).status_code, 403)
                self.writable = True
                response = self.client.delete(route, params=query)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json(), {"deleted": self.task})
        self.manager.delete.assert_called_once_with(self.workspace, self.task)
        self.image_delete.assert_called_once_with("d" * 64, self.task)


class TaskArtifactAvailabilityTests(unittest.TestCase):
    def setUp(self):
        isolate_project_storage(self)
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        isolate_database(self, Path(temporary.name) / "tasks.db")
        self.conn = Database.get_connection()
        self.workspace = str(uuid.uuid4())
        create_workspace_artifact_table(self.conn)

    def artifact(self, kind):
        artifact = {
            "id": str(uuid.uuid4()),
            "workspace_id": self.workspace,
            "name": "result",
            "kind": kind,
            "source": "ai_image_edit" if kind == "image" else kind + "_studio",
            "format": {"image": "png", "audio": "wav", "video": "mp4"}[kind],
            "width": 320,
            "height": 240,
            "bytes": 1,
            "created_at": "2026-10-06T00:00:00Z",
        }
        self.conn.execute(
            "INSERT INTO workspace_artifact VALUES (?,?,?,?,?,?,?,?,?,?)", tuple(artifact.values())
        )
        self.conn.commit()
        return artifact

    def test_ai_partial_result_deletion_preserves_history_and_submission_receipt(self):
        manager = StudioTasks(Database.get_connection, Mock())
        first, second = self.artifact("image"), self.artifact("image")
        task_id = str(uuid.uuid4())
        results = [
            {"artifact_id": first["id"], "label": "first", "node_id": "node-1"},
            {"artifact_id": second["id"], "label": "second", "node_id": "node-2"},
        ]
        row = (
            task_id,
            self.workspace,
            "images",
            "completed",
            1,
            1,
            "",
            first["id"],
            json.dumps(results),
            "draft",
            "image_edit",
            json.dumps({"fingerprint": "input"}),
        )
        self.conn.execute("INSERT INTO studio_task VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", row)
        self.conn.commit()
        self.assertNotIn("deleted_artifact_ids", manager.get(self.workspace, task_id))
        self.conn.execute("DELETE FROM workspace_artifact WHERE id=?", (first["id"],))
        self.conn.commit()
        reopened = StudioTasks(Database.get_connection, Mock())
        for response in (
            manager.get(self.workspace, task_id),
            manager.list(self.workspace)[0],
            manager.existing(self.workspace, task_id, "input"),
            reopened.get(self.workspace, task_id),
        ):
            self.assertEqual(response["deleted_artifact_ids"], [first["id"]])
            self.assertEqual(response["artifact_id"], first["id"])
            self.assertEqual(response["results"], results)
            self.assertEqual(response["state"], "completed")
        self.assertEqual(
            self.conn.execute("SELECT * FROM studio_task WHERE id=?", (task_id,)).fetchone(), row
        )

    def test_audio_video_result_deletion_preserves_retry_and_survives_manager_restart(self):
        for kind, factory in (("audio", AudioExports), ("video", VideoExports)):
            with self.subTest(kind=kind):
                manager = factory(Database.get_connection, lambda _: None)
                self.addCleanup(manager.close)
                with patch.object(manager, "_wake"):
                    manager.start()
                common = {
                    "task_id": uuid.uuid4(),
                    "workspace_id": self.workspace,
                    "document_id": "draft",
                    "document_revision": "d" * 64,
                    "name": "result",
                }
                if kind == "audio":
                    submission = AudioExportSubmission(
                        **common, document={"tracks": []}, duration=1
                    )
                    request = manager.adapter.request.model_validate(
                        submission.model_dump(exclude={"task_id"}, exclude_unset=True)
                    )
                    payload = request.model_dump_json(exclude_unset=True)
                else:
                    submission = VideoExportSubmission(
                        **common,
                        document={
                            "version": 1,
                            "width": 320,
                            "height": 240,
                            "fps": 30,
                            "visuals": [],
                            "sounds": [],
                            "captions": [],
                            "markers": [],
                        },
                    )
                    payload = VideoExport.model_validate(
                        submission.model_dump(exclude={"task_id"})
                    ).model_dump_json()
                artifact = self.artifact(kind)
                task_id = str(submission.task_id)
                row = (
                    task_id,
                    self.workspace,
                    "draft",
                    "d" * 64,
                    "result",
                    "completed",
                    "completed",
                    100,
                    "",
                    1,
                    1,
                    json.dumps(artifact),
                    payload,
                    "{}",
                    hashlib.sha256(payload.encode()).hexdigest(),
                )
                table = kind + "_export_task"
                self.conn.execute(
                    f"INSERT INTO {table} VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", row
                )
                self.conn.commit()
                self.assertNotIn("deleted_artifact_ids", manager.get(self.workspace, task_id))
                self.conn.execute("DELETE FROM workspace_artifact WHERE id=?", (artifact["id"],))
                self.conn.commit()
                reopened = factory(Database.get_connection, lambda _: None)
                self.addCleanup(reopened.close)
                with patch.object(reopened, "_wake"):
                    reopened.start()
                for response in (
                    manager.get(self.workspace, task_id),
                    manager.list(self.workspace)[0],
                    manager.submit(submission),
                    reopened.get(self.workspace, task_id),
                ):
                    self.assertEqual(response["deleted_artifact_ids"], [artifact["id"]])
                    self.assertEqual(response["artifact"], artifact)
                    self.assertEqual(response["id"], task_id)
                    self.assertEqual(response["state"], "completed")
                self.assertEqual(
                    self.conn.execute(f"SELECT * FROM {table} WHERE id=?", (task_id,)).fetchone(),
                    row,
                )

    def test_task_only_database_keeps_unverifiable_result_unchanged(self):
        task = {"artifact_id": "historical-result", "results": []}
        with closing(sqlite3.connect(":memory:")) as conn:
            self.assertIs(with_task_artifact_availability(conn, task), task)
