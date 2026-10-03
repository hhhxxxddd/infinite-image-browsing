"""Slow file operations must leave the HTTP event loop available."""

import asyncio
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi import FastAPI

from backend.tests.support.database import isolate_database, isolate_project_storage
from omnigallery.infrastructure.route_context import RouteContext
from omnigallery.library import file_routes


class FileRouteConcurrencyTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        isolate_database(self, Path(self.temp.name) / "test.db")
        isolate_project_storage(self)

    async def test_copy_can_wait_while_another_request_completes(self):
        app = FastAPI()
        context = RouteContext()
        context.check_path_trust = lambda path: None
        file_routes.mount_routes(app, context)

        @app.get("/probe")
        async def probe():
            return {"ok": True}

        started = threading.Event()
        release = threading.Event()

        def slow_copy(*args):
            started.set()
            release.wait(5)

        with (
            patch.object(file_routes, "get_img_geninfo_txt_path", return_value=None),
            patch.object(file_routes, "copy_media_exclusive", side_effect=slow_copy),
            patch.object(file_routes.os.path, "isdir", return_value=True),
        ):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://test"
            ) as client:
                copy = asyncio.create_task(
                    client.post("/api/copy_files", json={"file_paths": ["fake"], "dest": "fake"})
                )
                try:
                    self.assertTrue(await asyncio.to_thread(started.wait, 2))
                    self.assertFalse(copy.done())
                    response = await asyncio.wait_for(client.get("/probe"), 1)
                    self.assertEqual(response.json(), {"ok": True})
                    self.assertFalse(copy.done())
                finally:
                    release.set()
                    response = await copy
                self.assertEqual(response.status_code, 200, response.text)
