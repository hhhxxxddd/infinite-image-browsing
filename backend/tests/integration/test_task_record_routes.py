"""Deletion permissions for every persistent editor task source."""

import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.tests.support.database import isolate_database, isolate_project_storage
from omnigallery.ai.image_routes import mount_image_ai_routes
from omnigallery.image_editing.routes import mount_routes
from omnigallery.infrastructure.auth import verify_secret, write_permission_required
from omnigallery.infrastructure.route_context import RouteContext
from omnigallery.workspaces.audio_exports import mount_audio_export_routes
from omnigallery.workspaces.video_exports import mount_video_export_routes


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
