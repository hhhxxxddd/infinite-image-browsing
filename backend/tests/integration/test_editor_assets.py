import base64
import io
import unittest
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from PIL import Image

from backend.tests.support.database import isolate_project_storage
from omnigallery.image_editing import assets, history
from omnigallery.image_editing.routes import mount_routes
from omnigallery.infrastructure.auth import verify_secret, write_permission_required
from omnigallery.infrastructure.route_context import RouteContext


class EditorAssetsTest(unittest.TestCase):
    def setUp(self):
        self.root = isolate_project_storage(self)
        self.app = FastAPI()
        self.app.dependency_overrides[verify_secret] = lambda: None
        self.app.dependency_overrides[write_permission_required] = lambda: None
        mount_routes(self.app, RouteContext())
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)

    def png(self, color):
        stream = io.BytesIO()
        Image.new("RGBA", (32, 24), color).save(stream, format="PNG")
        return stream.getvalue()

    def save(self, raw):
        return self.client.post(
            "/api/image-editor-assets", json={"png_base64": base64.b64encode(raw).decode()}
        )

    def test_transparent_and_white_assets_persist_deduplicate_and_migrate(self):
        for color in [(0, 0, 0, 0), (255, 255, 255, 255)]:
            raw = self.png(color)
            result = self.save(raw)
            self.assertEqual(result.status_code, 200, result.text)
            record = result.json()
            asset_id = record["path"].split(":")[1]
            self.assertEqual(self.save(raw).json(), record)
            fetched = self.client.get("/api/image-editor-assets/" + asset_id)
            self.assertEqual(fetched.content, raw)
            self.assertEqual(Image.open(io.BytesIO(fetched.content)).getpixel((0, 0)), color)
        self.assertEqual(len(list((self.root / "image-editor-assets").glob("*.png"))), 2)
        moved = self.root / "moved"
        moved.mkdir()
        (self.root / "image-editor-assets").rename(moved / "image-editor-assets")
        with patch("omnigallery.storage.project_files.PROJECT_DATA_ROOT", moved):
            self.assertEqual(self.client.get("/api/image-editor-assets/" + asset_id).content, raw)

    def test_invalid_input_and_missing_assets_fail_without_publication(self):
        for raw in [b"bad", self.png("red")[:-20]]:
            self.assertEqual(self.save(raw).status_code, 400)
        self.assertEqual(
            self.client.post("/api/image-editor-assets", json={"png_base64": "!bad!"}).status_code,
            400,
        )
        self.assertFalse((self.root / "image-editor-assets").exists())
        for asset_id in ["invalid", "a" * 64]:
            self.assertEqual(
                self.client.get("/api/image-editor-assets/" + asset_id).status_code, 404
            )
        with self.assertRaises(ValueError):
            assets.asset_path("../escape")

    def test_read_auth_and_write_permission(self):
        def deny():
            raise HTTPException(403, "denied")

        self.app.dependency_overrides[write_permission_required] = deny
        self.assertEqual(self.save(self.png("white")).status_code, 403)
        self.app.dependency_overrides[verify_secret] = deny
        self.assertEqual(self.client.get("/api/image-editor-assets/" + "a" * 64).status_code, 403)

    def test_media_save_snapshots_managed_composite_without_external_path_trust(self):
        raw = self.png("white")
        record = self.save(raw).json()
        source = self.root / "source.png"
        source.write_bytes(raw)
        document = {
            "version": 2,
            "width": 32,
            "height": 24,
            "layers": [{"id": "merged", "kind": "image", "name": "merged", "path": record["path"]}],
        }
        prepared = history.prepare(str(source), document, "canvas", lambda path: self.fail(path))
        asset_id = record["path"].split(":")[1]
        self.assertEqual(prepared["document"]["layers"][0]["path"], "snapshot:" + asset_id)
        destination = history.save_edit(
            str(source),
            document,
            "canvas",
            lambda path: self.fail(path),
            crop={"x": 0, "y": 0, "width": 1, "height": 1},
            target_width=32,
            target_height=24,
            overwrite=False,
            rendered_base64=base64.b64encode(raw).decode(),
            copy_name="composite.png",
        )
        assets.asset_path(asset_id).unlink()
        self.assertEqual(history.snapshot_path(prepared, asset_id).read_bytes(), raw)
        reopened = history.latest(destination)
        self.assertEqual(reopened["document"]["layers"][0]["path"], "snapshot:" + asset_id)
        self.assertEqual(history.snapshot_path(reopened, asset_id).read_bytes(), raw)
        self.assertEqual(Image.open(destination).getpixel((0, 0)), (255, 255, 255, 255))
