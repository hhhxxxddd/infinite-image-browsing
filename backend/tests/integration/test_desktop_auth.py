"""Untrusted browser origins and missing desktop tokens cannot access local media."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import Depends, Request
from fastapi.testclient import TestClient
from PIL import Image

from backend.tests.support.database import isolate_database, isolate_project_storage
from omnigallery.app import create_app
from omnigallery.infrastructure import auth
from omnigallery.infrastructure.video_streaming import close_video_file_reader


class DesktopAuthTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        isolate_database(self, self.root / "test.db")
        isolate_project_storage(self)
        token_patch = patch.object(auth, "desktop_token", "private-desktop-session")
        token_patch.start()
        self.addCleanup(token_patch.stop)
        self.app = create_app(allow_cors=True)

        @self.app.get("/api/auth_probe", dependencies=[Depends(auth.verify_secret)])
        def probe(request: Request):
            return {"query": request.scope["query_string"].decode("ascii")}

        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)

    def test_unknown_origin_is_rejected_before_deleting_any_files(self):
        source = self.root / "original.png"
        source.write_bytes(b"original")
        preflight = self.client.options(
            "/api/delete_files",
            headers={
                "Origin": "https://attacker.example",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        self.assertEqual(preflight.status_code, 400)
        self.assertNotIn("access-control-allow-origin", preflight.headers)
        response = self.client.post(
            "/api/delete_files",
            headers={
                "Origin": "https://attacker.example",
                "X-OmniGallery-Desktop-Token": "private-desktop-session",
            },
            json={"file_paths": [str(source)]},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(source.read_bytes(), b"original")

    def test_trusted_origin_requires_the_session_token(self):
        for origin in (
            "http://tauri.localhost",
            "https://tauri.localhost",
            "tauri://localhost",
            "http://localhost:3002",
        ):
            with self.subTest(origin=origin):
                denied = self.client.get("/api/auth_probe", headers={"Origin": origin})
                self.assertEqual(denied.status_code, 401)
                accepted = self.client.get(
                    "/api/auth_probe",
                    headers={
                        "Origin": origin,
                        "X-OmniGallery-Desktop-Token": "private-desktop-session",
                    },
                )
                self.assertEqual(accepted.status_code, 200)
                self.assertEqual(accepted.headers["access-control-allow-origin"], origin)
        self.assertEqual(self.client.get("/api/auth_probe").status_code, 401)

    def test_media_query_token_is_verified_and_removed_before_access_logging(self):
        response = self.client.get(
            "/api/auth_probe",
            params={
                "path": "photo.png",
                "desktop_token": "private-desktop-session",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["query"], "path=photo.png")
        for invalid_token in ("another-session", "无效令牌"):
            with self.subTest(token=invalid_token):
                self.assertEqual(
                    self.client.get(
                        "/api/auth_probe", params={"desktop_token": invalid_token}
                    ).status_code,
                    401,
                )

    def test_server_cookie_auth_still_works_without_desktop_token(self):
        with (
            patch.object(auth, "desktop_token", None),
            patch.object(auth, "secret_key", "server-key"),
            patch.dict(auth.mem, {"secret_key_hash": None}),
        ):
            self.assertEqual(self.client.get("/api/auth_probe").status_code, 401)
            self.client.cookies.set(
                "OMNIGALLERY_SECRET", auth.hashlib.sha256(b"server-key_ciallo").hexdigest()
            )
            self.assertEqual(self.client.get("/api/auth_probe").status_code, 200)

    def test_native_media_query_tokens_allow_images_and_range_reads(self):
        source = self.root / "photo.png"
        Image.new("RGB", (8, 6), "red").save(source)
        self.app.state.context.mem["all_scanned_paths"] = [str(self.root)]
        self.addCleanup(close_video_file_reader, str(source))
        params = {
            "path": str(source),
            "t": "now",
            "desktop_token": "private-desktop-session",
        }
        for endpoint in ("/api/file", "/api/img/photo.png", "/api/image-thumbnail"):
            with self.subTest(endpoint=endpoint):
                response = self.client.get(endpoint, params=params)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.content, source.read_bytes())
        streamed = self.client.get(
            "/api/stream_video", params=params, headers={"Range": "bytes=0-7"}
        )
        self.assertEqual(streamed.status_code, 206)
        self.assertEqual(streamed.content, source.read_bytes()[:8])

    def test_cors_configuration_cannot_enable_wildcard_or_opaque_origins(self):
        for origin in ("*", "null"):
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                create_app(allow_cors=True, cors_origins=[origin])
