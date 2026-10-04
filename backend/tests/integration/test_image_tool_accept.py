import base64
import io
import unittest
import uuid

from fastapi import HTTPException
from PIL import Image

from backend.tests.integration import test_image_cutout as fixture
from omnigallery.image_editing import assets, erase
from omnigallery.infrastructure.auth import verify_secret, write_permission_required


class ImageToolAcceptTest(unittest.TestCase):
    patch = fixture.ImageCutoutTest.patch
    drain = fixture.ImageCutoutTest.drain

    def setUp(self):
        fixture.ImageCutoutTest.setUp(self)

    def request_for(self, tool, pixels, layer="image"):
        with Image.open(io.BytesIO(pixels)) as image:
            width, height = image.size
        request = {
            key: value
            for key, value in self.request.items()
            if key in {"document_key", "source_revision"}
        }
        request.update(
            id=str(uuid.uuid4()), layer_id=layer, png_base64=base64.b64encode(pixels).decode()
        )
        if tool == "cutout":
            request.update(mode="points", positive=[dict(x=0.5, y=0.5)])
        elif tool == "upscale":
            request.update(multiplier=2)
        else:
            context = erase.PixelBox(x=0, y=0, width=width, height=height)
            request.update(
                mask_png_base64=base64.b64encode(fixture.png("L", (width, height), 255)).decode(),
                context_box=context.model_dump(),
                processing_box=erase.processing_box(
                    (0, 0, width, height), context, (width, height), 16, (512, 512)
                ).model_dump(),
            )
        return request

    def complete(self, tool, request):
        with Image.open(io.BytesIO(base64.b64decode(request["png_base64"]))) as image:
            width, height = image.size
        output = (
            fixture.png("L", (width, height), 128)
            if tool == "cutout"
            else fixture.png("RGB", (width * 2, height * 2), "blue")
            if tool == "upscale"
            else fixture.png("RGB", (width, height), "red")
        )
        self.cloud.download_image.return_value = (output, "image/png")
        response = self.client.post(f"/api/image-{tool}/tasks", json=request)
        self.assertEqual(response.status_code, 202, response.text)
        self.drain()
        return next(job for job in self.jobs() if job["id"] == request["id"])

    def jobs(self):
        return self.client.get(
            "/api/image-ai-tools/tasks", params={"document_key": "d" * 64}
        ).json()["items"]

    def action(self, job_id, action="accept"):
        return self.client.post(
            f"/api/image-ai-tools/tasks/{job_id}/{action}", params={"document_key": "d" * 64}
        )

    def test_each_tool_can_adopt_and_process_its_new_pixels_again(self):
        for tool in ("cutout", "upscale", "erase"):
            with self.subTest(tool=tool):
                pixels = fixture.png("RGBA", (32, 24), (40, 60, 80, 200))
                first_request = self.request_for(tool, pixels, tool)
                first = self.complete(tool, first_request)
                self.assertEqual(first["state"], "completed")
                result = assets.read_png(first["result"]["path"].split(":")[1])
                response = self.action(first["id"])
                self.assertEqual(response.status_code, 200, response.text)
                accepted_at = response.json()["accepted_at"]
                self.assertTrue(response.json()["handled"])
                self.assertGreater(accepted_at, first["created_at"])
                self.assertEqual(self.action(first["id"]).json()["accepted_at"], accepted_at)
                persisted = next(job for job in self.jobs() if job["id"] == first["id"])
                self.assertEqual(persisted["accepted_at"], accepted_at)
                self.assertEqual(assets.read_png(first["source"]["path"].split(":")[1]), pixels)
                second = self.complete(tool, self.request_for(tool, result, tool))
                self.assertEqual(second["state"], "completed")
                self.assertNotIn("accepted_at", second)
                self.assertEqual(second["source"]["path"], first["result"]["path"])
                # Adopting an old result again cannot accidentally adopt a later round.
                self.assertEqual(self.action(first["id"]).json()["accepted_at"], accepted_at)
                self.assertNotIn(
                    "accepted_at", next(j for j in self.jobs() if j["id"] == second["id"])
                )

    def test_adoption_closes_all_previous_tool_buffers_only_on_this_layer(self):
        pixels = fixture.png("RGB", (32, 24), "white")
        other = self.complete("cutout", self.request_for("cutout", pixels, "other"))
        for tool in ("cutout", "upscale", "erase"):
            job = self.complete(tool, self.request_for(tool, pixels))
            self.action(job["id"], "handled")
        self.assertEqual(self.action(job["id"]).status_code, 200)
        for current in self.jobs():
            if current["id"] == other["id"]:
                self.assertNotIn("accepted_at", current)
            else:
                self.assertTrue(current["accepted_at"])
                self.assertTrue(current["handled"])
                self.assertTrue(assets.read_png(current["result"]["path"].split(":")[1]))

    def test_pending_or_unapplied_tasks_block_adoption(self):
        pixels = fixture.png("RGB", (32, 24), "white")
        first = self.complete("cutout", self.request_for("cutout", pixels))
        self.action(first["id"], "handled")
        request = self.request_for("upscale", pixels)
        self.cloud.download_image.return_value = (fixture.png("RGB", (64, 48), "blue"), "image/png")
        self.client.post("/api/image-upscale/tasks", json=request)
        self.assertEqual(self.action(request["id"]).status_code, 409)
        self.assertEqual(self.action(first["id"]).status_code, 409)
        self.drain()
        self.assertEqual(self.action(first["id"]).status_code, 409)
        self.action(request["id"], "handled")
        self.assertEqual(self.action(first["id"]).status_code, 200)

    def test_canceled_failed_superseded_and_readonly_cannot_be_adopted(self):
        pixels = fixture.png("RGB", (32, 24), "white")
        request = self.request_for("cutout", pixels)
        self.client.post("/api/image-cutout/tasks", json=request)
        self.action(request["id"], "cancel")
        self.drain()
        self.assertEqual(self.action(request["id"]).status_code, 409)
        first = self.complete("cutout", self.request_for("cutout", pixels))
        second = self.complete("cutout", self.request_for("cutout", pixels))
        self.assertEqual(self.action(first["id"]).status_code, 409)
        self.cloud.submit.side_effect = RuntimeError("test failure")
        failed = self.complete("cutout", self.request_for("cutout", pixels))
        self.assertEqual(failed["state"], "failed")
        self.assertEqual(self.action(failed["id"]).status_code, 409)

        def deny():
            raise HTTPException(403, "denied")

        for dependency in (write_permission_required, verify_secret):
            self.app.dependency_overrides[dependency] = deny
            self.assertEqual(self.action(second["id"]).status_code, 403)
