"""Storage API authorization and real filesystem effects, isolated from user data."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from omnigallery.infrastructure import auth
from omnigallery.infrastructure.route_context import RouteContext
from omnigallery.storage import routes
from omnigallery.storage.layout import ApplicationStorage


class ApplicationStorageApiTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name).resolve()
        self.storage = ApplicationStorage(self.base / "data")
        self.storage.prepare()
        self.addCleanup(self.storage.close)
        for mock in (
            patch.object(routes, "storage", self.storage),
            patch.multiple(auth, secret_key=None, desktop_token=None, is_api_writeable=True),
        ):
            mock.start()
            self.addCleanup(mock.stop)
        app = FastAPI()
        routes.mount_routes(app, RouteContext())
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_schedule_validate_and_cancel_without_moving_live_files(self):
        root = str(self.storage.root)
        self.assertEqual(self.client.get("/api/application_storage").json()["directory"], root)
        self.assertEqual(
            self.client.put("/api/application_storage", json={"directory": "relative"}).status_code,
            400,
        )
        pending = str(self.base / "next")
        result = self.client.put("/api/application_storage", json={"directory": pending})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["directory"], root)
        self.assertEqual(result.json()["pending_directory"], pending)
        self.assertFalse(
            self.client.put("/api/application_storage", json={"directory": root}).json()[
                "restart_required"
            ]
        )

    def test_cleanup_reports_exact_bytes_and_protects_persistent_files(self):
        for relative in (
            "cache/thumbnails/one.webp",
            "models/model.gguf",
            "project-data/media-covers/custom.webp",
            "templates/title.json",
        ):
            path = self.storage.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"123456")
        usage = self.client.get("/api/application_storage/usage").json()
        self.assertEqual(usage["reclaimable_bytes"], 6)
        self.assertEqual(usage["total_bytes"], 24)
        result = self.client.post("/api/application_storage/clear-cache").json()
        self.assertEqual(result, {"released_bytes": 6, "removed_files": 1, "skipped": 0})
        self.assertTrue((self.storage.root / "project-data/media-covers/custom.webp").is_file())
        self.assertEqual(
            self.client.get("/api/application_storage/usage").json()["total_bytes"], 18
        )

    def test_authentication_and_read_only_enforced(self):
        with patch.object(auth, "is_api_writeable", False):
            self.assertEqual(self.client.get("/api/application_storage/usage").status_code, 200)
            self.assertEqual(
                self.client.put(
                    "/api/application_storage", json={"directory": str(self.base / "next")}
                ).status_code,
                403,
            )
            self.assertEqual(
                self.client.post("/api/application_storage/clear-cache").status_code, 403
            )
        with patch.object(auth, "desktop_token", "private-test-token"):
            for path in ("/api/application_storage", "/api/application_storage/usage"):
                self.assertEqual(self.client.get(path).status_code, 401)
            self.assertEqual(
                self.client.post("/api/application_storage/clear-cache").status_code, 401
            )


if __name__ == "__main__":
    unittest.main()
