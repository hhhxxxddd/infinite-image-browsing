"""Metadata reads and custom tag writes used by the React preview."""

import asyncio
import json
import os
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import httpx
import piexif
import piexif.helper
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from PIL import Image
from PIL.PngImagePlugin import PngInfo

from backend.tests.support.database import isolate_database
from omnigallery.infrastructure.auth import verify_secret, write_permission_required
from omnigallery.infrastructure.database import Database
from omnigallery.library import tag_routes
from omnigallery.library.media_repository import Media
from omnigallery.library.tag_repository import MediaTag, Tag
from omnigallery.metadata import routes


class MediaMetadataRouteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        isolate_database(self, self.root / "test.db")
        self.path = str(self.root / "photo.png")
        Image.new("RGB", (32, 24)).save(self.path)
        self.conn = Database.get_connection()
        self.media = Media(self.path, exif="cached prompt")
        self.media.save(self.conn)
        self.conn.commit()

        def trusted(path):
            if not Path(path).resolve().is_relative_to(self.root):
                raise HTTPException(403, "untrusted")

        self.app = FastAPI()
        context = SimpleNamespace(
            api_base="/api",
            check_path_trust=trusted,
            update_extra_paths=lambda _conn: None,
            is_path_under_parents=lambda path: Path(path).is_relative_to(self.root),
        )
        routes.mount_routes(self.app, context)
        tag_routes.mount_routes(self.app, context)
        self.app.dependency_overrides[verify_secret] = lambda: None
        self.app.dependency_overrides[write_permission_required] = lambda: None
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)

    def test_metadata_validates_paths_before_reading_or_writing(self):
        outside = str(self.root.parent / "outside.png")
        with patch("omnigallery.library.indexing.get_exif_data") as read:
            for route in ["image_geninfo", "image_exif"]:
                result = self.client.get(f"/api/{route}", params={"path": outside})
                self.assertEqual(result.status_code, 403, result.text)
            batch = self.client.post(
                "/api/image_geninfo_batch", json={"paths": [self.path, outside]}
            )
            self.assertEqual(batch.status_code, 403, batch.text)
            read.assert_not_called()
        result = self.client.post("/api/update_exif", json={"path": outside, "exif": "new"})
        self.assertEqual(result.status_code, 403, result.text)
        self.assertIsNone(Media.get(self.conn, outside))

    def test_workflow_metadata_survives_png_and_encoded_exif_comments(self):
        workflow = {"nodes": [{"id": 1, "type": "KSampler", "title": "测试节点"}], "links": []}
        prompt = {"1": {"class_type": "KSampler", "inputs": {"seed": 42}}}
        png_info = PngInfo()
        png_info.add_text("workflow", json.dumps(workflow))
        png_info.add_text("prompt", json.dumps(prompt))
        Image.new("RGB", (8, 8)).save(self.path, pnginfo=png_info)
        png = self.client.get("/api/image_exif", params={"path": self.path}).json()
        self.assertEqual(json.loads(png["workflow"]), workflow)
        self.assertEqual(json.loads(png["prompt"]), prompt)

        exif = piexif.dump(
            {
                "0th": {piexif.ImageIFD.Make: ("prompt:" + json.dumps(prompt)).encode()},
                "Exif": {
                    piexif.ExifIFD.UserComment: piexif.helper.UserComment.dump(
                        "workflow:" + json.dumps(workflow, ensure_ascii=False), encoding="unicode"
                    )
                },
            }
        )
        for extension in ("jpg", "webp"):
            path = str(self.root / f"workflow.{extension}")
            Image.new("RGB", (8, 8)).save(path, exif=exif)
            metadata = self.client.get("/api/image_exif", params={"path": path}).json()
            self.assertEqual(
                json.loads(metadata["UserComment"].removeprefix("workflow:")), workflow
            )
            self.assertEqual(json.loads(metadata["Make"].removeprefix("prompt:")), prompt)

    def test_batch_metadata_uses_one_query_and_preserves_request_keys(self):
        paths = [str(self.root / f"image-{index}.png") for index in range(100)]
        for path in paths:
            Media(path, exif=path).save(self.conn)
        self.conn.commit()
        statements = []
        self.conn.set_trace_callback(statements.append)
        self.addCleanup(self.conn.set_trace_callback, None)
        with patch.object(Database, "get_connection", return_value=self.conn):
            result = self.client.post("/api/image_geninfo_batch", json={"paths": paths})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json(), dict(zip(paths, paths, strict=True)))
        selects = [query for query in statements if query.startswith("SELECT")]
        self.assertEqual(len(selects), 1, selects)
        alias = os.path.join(str(self.root), "nested", "..", "photo.png")
        result = self.client.post("/api/image_geninfo_batch", json={"paths": [alias]})
        self.assertEqual(result.json(), {alias: "cached prompt"})

    def test_file_metadata_is_loaded_only_for_uncached_paths(self):
        unindexed = str(self.root / "unindexed.png")
        with patch(
            "omnigallery.library.indexing.get_exif_data",
            return_value=SimpleNamespace(raw_info="from file"),
        ) as read:
            result = self.client.post(
                "/api/image_geninfo_batch", json={"paths": [self.path, unindexed]}
            )
        self.assertEqual(result.json(), {self.path: "cached prompt", unindexed: "from file"})
        read.assert_called_once_with(unindexed)
        exif = self.client.get("/api/image_exif", params={"path": self.path})
        self.assertEqual(exif.json()["像素尺寸"], "32 × 24")

    def test_custom_tags_are_idempotent_and_preserve_generated_tags(self):
        custom = Tag.get_or_create(self.conn, "风景", "custom")
        generated = Tag.get_or_create(self.conn, "model", "Model")
        MediaTag(self.media.id, generated.id).save(self.conn)
        self.conn.commit()
        body = {"img_path": self.path, "tag_ids": [custom.id, custom.id]}
        for _ in range(2):
            result = self.client.put("/api/media_custom_tags", json=body)
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual([tag["id"] for tag in result.json()], [custom.id])
        invalid = self.client.put(
            "/api/media_custom_tags", json={**body, "tag_ids": [generated.id]}
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(
            {tag.id for tag in MediaTag.get_tags_for_image(self.conn, self.media.id)},
            {custom.id, generated.id},
        )
        cleared = self.client.put("/api/media_custom_tags", json={**body, "tag_ids": []})
        self.assertEqual(cleared.json(), [])
        self.assertEqual(
            [tag.id for tag in MediaTag.get_tags_for_image(self.conn, self.media.id)],
            [generated.id],
        )

    def test_failed_bulk_tag_write_rolls_back_the_whole_batch(self):
        second_path = str(self.root / "second.png")
        Image.new("RGB", (8, 8)).save(second_path)
        second = Media(second_path)
        second.save(self.conn)
        custom = Tag.get_or_create(self.conn, "batch", "custom")
        self.conn.execute(
            "CREATE TRIGGER reject_second_tag BEFORE INSERT ON media_tag "
            f"WHEN NEW.media_id = {second.id} BEGIN SELECT RAISE(ABORT, 'write failed'); END"
        )
        self.conn.commit()
        body = {"img_paths": [self.path, second_path], "action": "add", "tag_id": custom.id}
        invalid = self.client.post(
            "/api/batch_update_image_tag", json={**body, "action": "invalid"}
        )
        self.assertEqual(invalid.status_code, 422)
        with self.assertRaises(sqlite3.IntegrityError):
            self.client.post("/api/batch_update_image_tag", json=body)
        self.assertEqual(MediaTag.get_tags_for_image(self.conn, self.media.id), [])

    def test_slow_metadata_reader_does_not_block_other_requests(self):
        started = threading.Event()
        released = threading.Event()
        finished = threading.Event()

        def slow_read(_path):
            started.set()
            released.wait(3)
            finished.set()
            return SimpleNamespace(raw_info="read")

        @self.app.get("/ping")
        async def ping():
            return {"ok": True}

        async def run():
            transport = httpx.ASGITransport(app=self.app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                request = asyncio.create_task(
                    client.get("/api/image_geninfo", params={"path": str(self.root / "slow.png")})
                )
                try:
                    self.assertTrue(await asyncio.to_thread(started.wait, 2))
                    response = await asyncio.wait_for(client.get("/ping"), timeout=1)
                    self.assertEqual(response.json(), {"ok": True})
                    self.assertFalse(finished.is_set(), "file read blocked the event loop")
                finally:
                    released.set()
                    await request

        with patch("omnigallery.library.indexing.get_exif_data", side_effect=slow_read):
            asyncio.run(run())
