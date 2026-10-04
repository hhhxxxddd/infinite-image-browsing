import base64
import io
import unittest
import uuid

from fastapi import HTTPException
from PIL import Image, ImageDraw

from backend.tests.integration import test_image_cutout as fixture
from omnigallery.ai import builtin_tools
from omnigallery.image_editing import assets, erase
from omnigallery.infrastructure.auth import verify_secret, write_permission_required


class ImageEraseTest(unittest.TestCase):
    patch = fixture.ImageCutoutTest.patch
    drain = fixture.ImageCutoutTest.drain

    def setUp(self):
        fixture.ImageCutoutTest.setUp(self)
        self.cutout_request = dict(self.request)
        for key in ("mode", "positive", "negative", "box", "refine_iterations"):
            self.request.pop(key)
        mask = Image.new("L", (32, 24))
        ImageDraw.Draw(mask).rectangle((10, 8, 14, 12), fill=255)
        stream = io.BytesIO()
        mask.save(stream, "PNG")
        self.request.update(
            mask_png_base64=base64.b64encode(stream.getvalue()).decode(),
            context_box=dict(x=0, y=0, width=32, height=24),
            processing_box=dict(x=0, y=-4, width=32, height=32),
            prompt="移除物体，补全背景",
            blend_pixels=16,
            output_width=512,
            output_height=512,
        )
        self.cloud.download_image.return_value = (fixture.png("RGB", (32, 24), "red"), "image/png")

    def submit(self, **changes):
        return self.client.post("/api/image-erase/tasks", json={**self.request, **changes})

    def jobs(self):
        return self.client.get(
            "/api/image-ai-tools/tasks", params={"document_key": "d" * 64}
        ).json()["items"]

    def action(self, action, job_id=None):
        return self.client.post(
            f"/api/image-ai-tools/tasks/{job_id or self.request['id']}/{action}",
            params={"document_key": "d" * 64},
        )

    def test_runs_supplied_graph_with_independent_inputs_and_preserves_source_alpha(self):
        response = self.submit()
        self.assertEqual(response.status_code, 202, response.text)
        self.assertNotIn("mask_png_base64", response.json())
        self.drain()
        job = self.jobs()[0]
        self.assertEqual(job["state"], "completed", job)
        self.assertEqual(job["tool_id"], builtin_tools.ERASE_ID)
        self.assertEqual(self.cloud.upload.call_count, 3)
        graph = self.cloud.submit.call_args.args[0]
        crop = graph["8"]["inputs"]
        self.assertEqual(crop["mask"], ["16", 0])
        self.assertEqual(crop["optional_context_mask"], ["17", 0])
        self.assertEqual(crop["mask_blend_pixels"], 16)
        self.assertFalse(crop["mask_fill_holes"])
        self.assertEqual(crop["mask_expand_pixels"], 0)
        self.assertEqual(crop["context_from_mask_extend_factor"], 1)
        self.assertEqual(graph["3"]["inputs"]["value"], self.request["prompt"])
        self.assertEqual(self.cloud.output.call_args.args[1], "2")
        pixels = Image.open(io.BytesIO(assets.read_png(job["result"]["path"].split(":")[1])))
        self.assertEqual(pixels.size, (32, 24))
        self.assertEqual(pixels.getpixel((0, 0)), (255, 0, 0, 128))
        self.assertEqual(
            {p.name for p in self.root.iterdir()}, {"image-editor-assets", "image-editor-tasks"}
        )

    def test_geometry_and_empty_mask_rejected_before_paid_submission(self):
        for changes in (
            {"mask_png_base64": base64.b64encode(fixture.png("L", (32, 24), 0)).decode()},
            {"mask_png_base64": base64.b64encode(fixture.png("L", (31, 24), 255)).decode()},
            {"mask_png_base64": base64.b64encode(fixture.png("RGB", (32, 24), "red")).decode()},
            {"mask_png_base64": base64.b64encode(fixture.png("LA", (32, 24), (255, 128))).decode()},
            {"context_box": dict(x=0, y=0, width=33, height=24)},
            {"processing_box": dict(x=0, y=0, width=32, height=24)},
        ):
            with self.subTest(changes=list(changes)):
                self.assertEqual(self.submit(**changes).status_code, 400)
        self.cloud.submit.assert_not_called()
        self.assertFalse(self.work)

    def test_strict_parameters_and_editable_blend(self):
        for changes in (
            {"blend_pixels": True},
            {"blend_pixels": -1},
            {"blend_pixels": 257},
            {"blend_pixels": 1.5},
            {"output_width": 511},
            {"output_height": 8192},
            {"prompt": "  "},
            {"unknown": True},
        ):
            self.assertEqual(self.submit(**changes).status_code, 422, changes)
        for blend in (0, 16, 256):
            self.assertEqual(self.submit(id=str(uuid.uuid4()), blend_pixels=blend).status_code, 202)
            self.drain()
            self.assertEqual(
                self.cloud.submit.call_args.args[0]["8"]["inputs"]["mask_blend_pixels"], blend
            )
        self.assertEqual(len(self.jobs()), 1)

    def test_cancel_and_cross_tool_lock_are_idempotent(self):
        self.assertEqual(self.submit().status_code, 202)
        self.assertEqual(self.submit().status_code, 202)
        self.assertEqual(len(self.work), 1)
        self.assertEqual(self.submit(prompt="different").status_code, 409)
        self.assertEqual(
            self.client.post(
                "/api/image-cutout/tasks", json={**self.cutout_request, "id": str(uuid.uuid4())}
            ).status_code,
            409,
        )
        self.action("cancel")
        self.drain()
        self.cloud.submit.assert_not_called()

    def test_bad_retry_preserves_last_pair(self):
        self.submit()
        self.drain()
        self.action("handled")
        self.cloud.download_image.return_value = (fixture.png("RGB", (31, 24), "red"), "image/png")
        self.submit(id=str(uuid.uuid4()))
        self.drain()
        jobs = self.jobs()
        self.assertEqual([job["state"] for job in jobs], ["failed", "completed"])
        self.assertTrue(jobs[1]["result"])

    def test_permissions(self):
        def deny():
            raise HTTPException(403, "denied")

        self.app.dependency_overrides[write_permission_required] = deny
        self.assertEqual(self.submit().status_code, 403)
        self.app.dependency_overrides[verify_secret] = deny
        self.assertEqual(self.client.get("/api/image-erase/config").status_code, 403)

    def test_crop_geometry_edges_and_padding(self):
        cases = [
            (
                (100, 100, 150, 140),
                dict(x=90, y=90, width=80, height=70),
                (400, 300),
                16,
                (512, 512),
                (89, 84, 81, 81),
            ),
            (
                (0, 0, 20, 20),
                dict(x=0, y=0, width=20, height=20),
                (100, 100),
                0,
                (1024, 512),
                (0, 0, 40, 20),
            ),
            (
                (0, 0, 400, 200),
                dict(x=0, y=0, width=400, height=200),
                (400, 200),
                0,
                (512, 512),
                (0, -100, 400, 400),
            ),
        ]
        for bounds, context, size, blend, target, expected in cases:
            with self.subTest(expected=expected):
                box = erase.processing_box(bounds, erase.PixelBox(**context), size, blend, target)
                self.assertEqual((box.x, box.y, box.width, box.height), expected)
