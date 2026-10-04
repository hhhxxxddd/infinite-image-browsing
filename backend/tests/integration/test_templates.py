import base64
import copy
import io
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from backend.tests.support.database import isolate_project_storage
from omnigallery.image_editing import history
from omnigallery.infrastructure.auth import verify_secret, write_permission_required
from omnigallery.infrastructure.route_context import RouteContext
from omnigallery.templates import store
from omnigallery.templates.defaults import starter_templates
from omnigallery.templates.routes import mount_routes


class TemplatesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = isolate_project_storage(self)
        patched = patch.object(store, "storage", SimpleNamespace(root=self.root))
        patched.start()
        self.addCleanup(patched.stop)
        app = FastAPI()
        app.dependency_overrides[verify_secret] = lambda: None
        app.dependency_overrides[write_permission_required] = lambda: None
        self.app = app
        mount_routes(app, RouteContext())
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.document = copy.deepcopy(next(starter_templates())[1])

    def mixed(self):
        output = io.BytesIO()
        Image.new("RGB", (32, 24), "red").save(output, format="PNG")
        raw = output.getvalue()
        doc = copy.deepcopy(self.document)
        doc["layers"].insert(
            0,
            dict(
                id="picture",
                groupId=doc["groups"][0]["id"],
                kind="image",
                name="photo",
                path="external.png",
                x=0,
                y=0,
                width=32,
                height=24,
                rotation=0,
                opacity=1,
                visible=True,
                locked=False,
            ),
        )
        return doc, raw

    def test_seed_once_search_rename_delete_and_paging(self):
        self.assertEqual(self.client.get("/api/templates").json()["total"], 10)
        for template_id, _ in starter_templates():
            record = self.client.get("/api/templates/" + template_id).json()
            store.validate_document(record["document"])
        self.assertEqual(len(self.client.get("/api/templates?limit=2&offset=2").json()["items"]), 2)
        self.assertEqual(self.client.get("/api/templates?q=电影").json()["total"], 1)
        self.assertEqual(self.client.get("/api/templates?q=%25").json()["total"], 0)
        saved = self.client.post(
            "/api/templates", json=dict(name="自定义", document=self.document)
        ).json()
        self.assertFalse(saved["builtin"])
        endpoint = "/api/templates/" + saved["id"]
        self.assertEqual(self.client.patch(endpoint, json={"name": "已重命名"}).status_code, 200)
        self.assertEqual(self.client.get("/api/templates?q=已重命名").json()["total"], 1)
        self.assertEqual(self.client.delete(endpoint).status_code, 204)
        self.assertEqual(self.client.get(endpoint).status_code, 404)
        self.client.delete("/api/templates/builtin-caption")
        store.ensure_defaults()
        self.assertEqual(store.list_templates()["total"], 9)
        # A canceled index rebuild cannot leave an apparently valid but empty catalog.
        store.root().joinpath("catalog.sqlite").unlink()
        sqlite3.connect(store.root() / "catalog.sqlite").close()
        self.assertEqual(store.list_templates()["total"], 9)

    def test_mixed_template_and_inserted_material_survive_source_and_template_deletion(self):
        doc, raw = self.mixed()
        source = self.root / "source.png"
        source.write_bytes(raw)
        req = dict(
            name="配图组合", document=doc, assets={"external.png": base64.b64encode(raw).decode()}
        )
        response = self.client.post("/api/templates", json=req)
        self.assertEqual(response.status_code, 200, response.text)
        template_id = response.json()["id"]
        source.unlink()
        preview = self.client.get(f"/api/templates/{template_id}").json()["document"]
        path = preview["layers"][0]["path"]
        self.assertTrue(path.startswith("template-library:"))
        digest = path.split(":")[-1]
        self.assertEqual(
            self.client.get(f"/api/templates/{template_id}/assets/{digest}").content, raw
        )
        applied = self.client.post(f"/api/templates/{template_id}/instantiate").json()["document"]
        self.assertEqual(applied["layers"][0]["path"], "template-asset:" + digest)
        self.client.delete(f"/api/templates/{template_id}")
        self.assertEqual(self.client.get(f"/api/template-assets/{digest}").content, raw)
        # Media-library save snapshots inserted images without trusting filesystem input.
        source.write_bytes(raw)
        prepared = history.prepare(str(source), applied, "canvas", lambda path: self.fail(path))
        self.assertEqual(history.snapshot_path(prepared, digest).read_bytes(), raw)
        self.assertEqual(prepared["document"]["layers"][0]["path"], "snapshot:" + digest)
        # Also survives app data relocation: references carry no old absolute root.
        moved = self.project / "moved"
        moved.mkdir()
        (self.project / "template-assets").rename(moved / "template-assets")
        with patch("omnigallery.storage.project_files.PROJECT_DATA_ROOT", moved):
            self.assertEqual(self.client.get(f"/api/template-assets/{digest}").content, raw)

    def test_rejects_invalid_documents_assets_and_arbitrary_paths_without_partial_publication(self):
        before = store.list_templates()["total"]
        doc, raw = self.mixed()
        for document, assets in [
            ({**doc, "layers": [doc["layers"][0]]}, {}),
            (doc, {}),
            (doc, {"external.png": base64.b64encode(b"not an image").decode()}),
            ({**doc, "width": 90000}, {}),
            ({**doc, "layers": doc["layers"] * 300}, {}),
        ]:
            result = self.client.post(
                "/api/templates", json=dict(name="无效", document=document, assets=assets)
            )
            self.assertEqual(result.status_code, 400, result.text)
        self.assertEqual(store.list_templates()["total"], before)
        self.assertEqual(
            self.client.post(
                "/api/templates", json=dict(name=" ", document=self.document)
            ).status_code,
            422,
        )
        self.assertEqual(self.client.get("/api/template-assets/not-a-hash").status_code, 400)
        self.assertEqual(
            self.client.get("/api/templates/builtin-caption/assets/" + "a" * 64).status_code, 400
        )
        with self.assertRaises(ValueError):
            store.package("../escape")
        with self.assertRaises(ValueError):
            store.material_path("../escape")

    def test_write_permission_applies_to_all_mutations(self):
        from fastapi import HTTPException

        def readonly():
            raise HTTPException(403, "readonly")

        self.app.dependency_overrides[write_permission_required] = readonly
        self.assertEqual(self.client.get("/api/templates").status_code, 200)
        for method, path, body in [
            ("POST", "/api/templates", dict(name="模板", document=self.document)),
            ("POST", "/api/templates/builtin-caption/instantiate", None),
            ("PATCH", "/api/templates/builtin-caption", {"name": "名称"}),
            ("DELETE", "/api/templates/builtin-caption", None),
        ]:
            self.assertEqual(self.client.request(method, path, json=body).status_code, 403)

    def test_preview_is_bounded_and_deleted_with_its_manifest(self):
        _, raw = self.mixed()
        request = dict(
            name="带预览", document=self.document, preview=base64.b64encode(raw).decode()
        )
        response = self.client.post("/api/templates", json=request)
        self.assertEqual(response.status_code, 200, response.text)
        record = response.json()
        self.assertTrue(record["has_preview"])
        url = f"/api/templates/{record['id']}/preview"
        self.assertEqual(self.client.get(url).content, raw)
        self.assertEqual(self.client.get(url).headers["content-type"], "image/png")
        self.client.delete(f"/api/templates/{record['id']}")
        self.assertEqual(self.client.get(url).status_code, 404)
        request["preview"] = base64.b64encode(b"invalid").decode()
        self.assertEqual(self.client.post("/api/templates", json=request).status_code, 400)

    def test_layout_and_page_lifecycle_and_validation(self):
        from omnigallery.templates.comic_defaults import comic_templates

        defaults = list(comic_templates())
        for kind, _template_id, document in defaults:
            store.validate_document(document, kind)
        self.assertEqual(self.client.get("/api/templates?type=image").json()["total"], 2)
        page = copy.deepcopy(defaults[-1][2])
        layout = copy.deepcopy(page)
        layout["layers"] = [layer for layer in layout["layers"] if layer["kind"] == "frame"]
        layout["groups"] = []
        for kind, doc in (("layout", layout), ("image", page)):
            response = self.client.post(
                "/api/templates", json=dict(type=kind, name="漫画预设", document=doc)
            )
            self.assertEqual(response.status_code, 200, response.text)
            record = response.json()
            self.assertEqual(record["type"], kind)
            instantiated = self.client.post(
                "/api/templates/" + record["id"] + "/instantiate"
            ).json()
            self.assertEqual(instantiated["document"]["layers"], doc["layers"])
            self.assertEqual(
                self.client.get("/api/templates?type=" + kind + "&q=漫画预设").json()["total"], 1
            )
            self.client.delete("/api/templates/" + record["id"])
        self.assertEqual(
            self.client.post(
                "/api/templates", json=dict(type="layout", name="bad", document=page)
            ).status_code,
            400,
        )
        page["layers"][0]["frameId"] = page["layers"][1]["id"]
        self.assertEqual(
            self.client.post(
                "/api/templates", json=dict(type="image", name="bad", document=page)
            ).status_code,
            400,
        )
        bubble = copy.deepcopy(defaults[0][2])
        bubble["layers"][0]["points"][0]["x"] = -2
        self.assertEqual(
            self.client.post("/api/templates", json=dict(name="bad", document=bubble)).status_code,
            400,
        )
