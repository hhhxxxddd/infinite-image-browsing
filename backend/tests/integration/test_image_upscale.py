import unittest
import uuid
from unittest.mock import patch

from fastapi import HTTPException

from backend.tests.integration import test_image_cutout as fixture
from omnigallery.ai import builtin_tools
from omnigallery.image_editing import assets, upscale
from omnigallery.infrastructure.auth import verify_secret, write_permission_required


class ImageUpscaleTest(unittest.TestCase):
    patch = fixture.ImageCutoutTest.patch
    drain = fixture.ImageCutoutTest.drain

    def setUp(self):
        fixture.ImageCutoutTest.setUp(self)
        self.cutout_request = dict(self.request)
        for key in ("mode", "positive", "negative", "box", "refine_iterations"):
            self.request.pop(key)
        self.request["multiplier"] = 1

    def submit(self, **changes):
        return self.client.post("/api/image-upscale/tasks", json={**self.request, **changes})

    def jobs(self):
        response = self.client.get("/api/image-ai-tools/tasks", params={"document_key": "d" * 64})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["items"]

    def action(self, action, job_id=None):
        return self.client.post(
            f"/api/image-ai-tools/tasks/{job_id or self.request['id']}/{action}",
            params={"document_key": "d" * 64},
        )

    def test_every_multiplier_runs_full_graph_and_keeps_returned_alpha_verbatim(self):
        for multiplier in (1, 2, 4):
            with self.subTest(multiplier=multiplier):
                returned = fixture.png(
                    "RGBA", (32 * multiplier, 24 * multiplier), (70, 90, 180, 77)
                )
                self.cloud.download_image.return_value = (returned, "image/png")
                response = self.submit(id=str(uuid.uuid4()), multiplier=multiplier)
                self.assertEqual(response.status_code, 202, response.text)
                self.drain()
                job = self.jobs()[0]
                self.assertEqual(job["state"], "completed", job)
                self.assertEqual(job["multiplier"], multiplier)
                self.assertNotIn("target_resolution", job)
                graph = self.cloud.submit.call_args.args[0]
                self.assertEqual(graph["4:12"]["inputs"]["resize_type.multiplier"], multiplier)
                expected = builtin_tools.upscale_workflow()
                expected["1"]["inputs"]["image"] = self.cloud.upload.return_value
                expected["4:12"]["inputs"].pop("resize_type.shorter_size")
                expected["4:12"]["inputs"]["resize_type"] = "scale by multiplier"
                expected["4:12"]["inputs"]["resize_type.multiplier"] = multiplier
                self.assertEqual(graph, expected)
                self.assertEqual(self.cloud.output.call_args.args[1], "2")
                self.assertEqual(assets.read_png(job["result"]["path"].split(":")[1]), returned)
                self.assertIsNone(job["result_bounds"])
                self.assertEqual(len(self.jobs()), 1)
        self.assertEqual(self.cloud.submit.call_count, 3)
        self.assertEqual(
            {p.name for p in self.root.iterdir()}, {"image-editor-assets", "image-editor-tasks"}
        )

    def test_short_edge_request_runs_and_preserves_transparency(self):
        self.request.pop("multiplier")
        returned = fixture.png("RGBA", (2730, 2048), (10, 20, 30, 72))
        self.cloud.download_image.return_value = (returned, "image/png")
        response = self.submit(target_resolution="2K")
        self.assertEqual(response.status_code, 202, response.text)
        self.drain()
        job = self.jobs()[0]
        self.assertEqual(job["state"], "completed", job)
        self.assertEqual(job["target_resolution"], "2K")
        self.assertNotIn("multiplier", job)
        resize = self.cloud.submit.call_args.args[0]["4:12"]["inputs"]
        self.assertEqual(resize["resize_type"], "scale shorter dimension")
        self.assertEqual(resize["resize_type.shorter_size"], 2048)
        self.assertNotIn("resize_type.multiplier", resize)
        self.assertEqual(assets.read_png(job["result"]["path"].split(":")[1]), returned)

    def test_resolution_plans_limits_and_original_still_runs_sampler(self):
        from pydantic import ValidationError

        self.request.pop("multiplier")
        for resolution, short in (("2K", 2048), ("4K", 4096), ("8K", 8192)):
            request = upscale.UpscaleRequest(**self.request, target_resolution=resolution)
            self.assertEqual(
                upscale.requested_size({"width": 3000, "height": 4000}, resolution),
                (short, round(short * 4 / 3)),
            )
            resize = upscale.prepare_graph(builtin_tools.upscale_workflow(), request, "source.png")[
                "4:12"
            ]["inputs"]
            self.assertEqual(resize["resize_type.shorter_size"], short)
        request = upscale.UpscaleRequest(**self.request, target_resolution="original")
        graph = upscale.prepare_graph(builtin_tools.upscale_workflow(), request, "source.png")
        self.assertEqual(graph["4:12"]["inputs"]["resize_type.multiplier"], 1)
        self.assertEqual(graph["4:10"]["class_type"], "KSampler")
        with self.assertRaises(ValueError):
            upscale.validate_size({"width": 1920, "height": 1080}, "8K")
        for resolution in ("1K", "16K", 2048, None):
            with self.assertRaises(ValidationError):
                upscale.UpscaleRequest(**self.request, target_resolution=resolution)
        with self.assertRaises(ValidationError):
            upscale.UpscaleRequest(**self.request, target_resolution="2K", multiplier=2)

    def test_cancel_idempotency_and_cross_tool_exclusion(self):
        self.assertEqual(self.submit().status_code, 202)
        self.assertEqual(self.submit().status_code, 202)
        self.assertEqual(len(self.work), 1)
        self.assertEqual(self.submit(multiplier=2).status_code, 409)
        cutout = {**self.cutout_request, "id": str(uuid.uuid4())}
        self.assertEqual(self.client.post("/api/image-cutout/tasks", json=cutout).status_code, 409)
        self.assertEqual(self.action("cancel").status_code, 200)
        self.drain()
        self.cloud.submit.assert_not_called()
        self.assertEqual(self.jobs()[0]["state"], "canceled")

    def test_failed_retry_preserves_last_result_and_cutout_has_independent_buffer(self):
        self.cloud.download_image.return_value = (
            fixture.png("RGBA", (32, 24), (0, 50, 100, 72)),
            "image/png",
        )
        first = self.submit().json()
        self.drain()
        self.assertEqual(self.jobs()[0]["state"], "completed")
        self.action("handled")
        cutout = {**self.cutout_request, "id": str(uuid.uuid4())}
        self.cloud.download_image.return_value = (fixture.png("L", (32, 24), 128), "image/png")
        self.assertEqual(self.client.post("/api/image-cutout/tasks", json=cutout).status_code, 202)
        self.drain()
        self.cloud.download_image.return_value = (fixture.png("RGB", (33, 24), "red"), "image/png")
        self.assertEqual(self.submit(id=str(uuid.uuid4())).status_code, 202)
        self.drain()
        jobs = self.jobs()
        self.assertEqual(jobs[0]["state"], "failed")
        self.assertEqual(len(jobs), 3)
        self.assertTrue(any(job["id"] == first["id"] and job.get("result") for job in jobs))

    def test_result_validation_even_alignment_and_no_alpha_reprocessing(self):
        source = {"width": 33, "height": 25}
        output = fixture.png("RGBA", (32, 24), (10, 20, 30, 17))
        self.assertEqual(upscale.validate_result(source, output, 1), output)
        with self.assertRaises(ValueError):
            upscale.validate_result(source, output, 2)

    def test_limits_and_parameter_validation_happen_before_cloud_submission(self):
        for value in (0, 3, 8, True, "2", 1.5):
            self.assertEqual(self.submit(multiplier=value).status_code, 422)
        self.assertEqual(self.submit(refine_iterations=3).status_code, 422)
        with patch.object(
            assets,
            "save_png",
            return_value={"path": "editor-asset:" + "f" * 64, "width": 4097, "height": 3000},
        ):
            response = self.submit(multiplier=4)
        self.assertEqual(response.status_code, 400)
        self.assertFalse(self.work)
        self.cloud.submit.assert_not_called()
        for size in ({"width": 1, "height": 8}, {"width": 12000, "height": 12000}):
            with self.assertRaises(ValueError):
                upscale.validate_size(size, 1)

    def test_auth_and_readonly(self):
        def deny():
            raise HTTPException(403, "denied")

        self.app.dependency_overrides[write_permission_required] = deny
        self.assertEqual(self.submit().status_code, 403)
        self.app.dependency_overrides[verify_secret] = deny
        self.assertEqual(self.client.get("/api/image-upscale/config").status_code, 403)
        self.assertEqual(
            self.client.get(
                "/api/image-ai-tools/tasks", params={"document_key": "d" * 64}
            ).status_code,
            403,
        )
