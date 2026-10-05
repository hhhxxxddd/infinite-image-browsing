import base64
import copy
import io
import json
import unittest
import uuid
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from PIL import Image

from backend.tests.support.database import isolate_project_storage
from omnigallery.image_editing import assets, cutout
from omnigallery.image_editing.routes import mount_routes
from omnigallery.infrastructure.auth import verify_secret, write_permission_required
from omnigallery.infrastructure.route_context import RouteContext


def png(mode, size, color):
    output = io.BytesIO()
    Image.new(mode, size, color).save(output, "PNG")
    return output.getvalue()


class ImageCutoutTest(unittest.TestCase):
    def setUp(self):
        self.root = isolate_project_storage(self)
        self.patch("comfy_cloud_key", return_value=("test-key", "saved"))
        self.work = []
        self.patch("executor").submit.side_effect = lambda fn, *args: self.work.append((fn, args))
        self.cloud = self.patch("ComfyCloudV2").return_value
        self.cloud.upload.return_value = {"__type": "core/ASSET", "info": {"id": "uploaded"}}
        self.cloud.submit.return_value = {"id": "cloud-job"}
        self.cloud.wait.return_value = {"status": "succeeded"}
        self.cloud.output.return_value = {"id": "mask"}
        self.cloud.download_image.return_value = (png("L", (32, 24), 128), "image/png")
        app = FastAPI()
        app.dependency_overrides[verify_secret] = lambda: None
        app.dependency_overrides[write_permission_required] = lambda: None
        mount_routes(app, RouteContext())
        self.app = app
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.addCleanup(self.drain)
        self.request = dict(
            id=str(uuid.uuid4()),
            document_key="d" * 64,
            layer_id="image",
            source_revision="a" * 64,
            png_base64=base64.b64encode(png("RGBA", (32, 24), (50, 100, 150, 128))).decode(),
            mode="points",
            positive=[{"x": 0.5, "y": 0.25}],
            negative=[{"x": 1, "y": 1}],
            box=None,
            refine_iterations=3,
        )

    def patch(self, name, **kwargs):
        p = patch("omnigallery.image_editing.cutout." + name, **kwargs)
        self.addCleanup(p.stop)
        return p.start()

    def drain(self):
        while self.work:
            fn, args = self.work.pop(0)
            fn(*args)

    def submit(self, **changes):
        return self.client.post("/api/image-cutout/tasks", json={**self.request, **changes})

    def jobs(self):
        response = self.client.get("/api/image-cutout/tasks", params={"document_key": "d" * 64})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["items"]

    def action(self, action):
        return self.client.post(
            f"/api/image-cutout/tasks/{self.request['id']}/{action}",
            params={"document_key": "d" * 64},
        )

    def test_points_complete_preserve_alpha_and_never_publish_artifact(self):
        result = self.submit()
        self.assertEqual(result.status_code, 202, result.text)
        self.assertEqual(result.json()["state"], "queued")
        self.assertEqual(self.submit().json()["id"], result.json()["id"])
        self.assertEqual(len(self.work), 1)
        self.assertEqual(self.submit(id=str(uuid.uuid4())).status_code, 409)
        self.drain()
        job = self.jobs()[0]
        self.assertEqual(job["state"], "completed", job)
        graph = self.cloud.submit.call_args.args[0]
        inputs = graph["118:115"]["inputs"]
        self.assertEqual(json.loads(inputs["positive_coords"]), [{"x": 16, "y": 6}])
        self.assertEqual(json.loads(inputs["negative_coords"]), [{"x": 31, "y": 23}])
        self.assertEqual(inputs["refine_iterations"], 3)
        self.assertNotIn("conditioning", inputs)
        self.assertNotIn("bboxes", inputs)
        raw = assets.read_png(job["result"]["path"].split(":")[1])
        image = Image.open(io.BytesIO(raw))
        self.assertEqual(image.size, (32, 24))
        self.assertEqual(image.getpixel((0, 0)), (50, 100, 150, 64))
        self.assertEqual(
            {p.name for p in self.root.iterdir()}, {"image-editor-assets", "image-editor-tasks"}
        )
        self.assertNotIn("test-key", json.dumps(self.jobs()))
        self.assertTrue(self.action("handled").json()["handled"])

    def test_delete_hides_record_preserves_pixels_and_does_not_replay_cloud_request(self):
        self.submit()
        route = f"/api/image-ai-tools/tasks/{self.request['id']}"
        query = {"document_key": "d" * 64}
        self.assertEqual(self.client.delete(route, params=query).status_code, 409)
        self.assertEqual(
            self.client.delete(route, params={"document_key": "a" * 64}).status_code, 404
        )
        self.drain()
        job = self.jobs()[0]
        original = assets.read_png(job["source"]["path"].split(":")[1])
        result = assets.read_png(job["result"]["path"].split(":")[1])
        self.assertTrue(job["deletable"])
        response = self.client.delete(route, params=query)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.client.delete(route, params=query).status_code, 200)
        self.assertEqual(self.jobs(), [])
        self.assertEqual(assets.read_png(job["source"]["path"].split(":")[1]), original)
        self.assertEqual(assets.read_png(job["result"]["path"].split(":")[1]), result)
        self.assertTrue(self.submit().json()["deleted"])
        self.assertFalse(self.work)
        self.cloud.submit.assert_called_once()

    def test_delete_rejects_uncertain_cloud_tracking_and_requires_write_permission(self):
        self.submit()
        route = f"/api/image-ai-tools/tasks/{self.request['id']}"
        query = {"document_key": "d" * 64}
        self.cloud.wait.side_effect = HTTPException(504, "任务可能仍在云端运行")
        self.drain()
        job = self.jobs()[0]
        self.assertEqual(job["state"], "failed")
        self.assertFalse(job["deletable"])
        self.assertEqual(self.client.delete(route, params=query).status_code, 409)

        def forbidden():
            raise HTTPException(403, "不可写")

        self.app.dependency_overrides[write_permission_required] = forbidden
        self.assertEqual(self.client.delete(route, params=query).status_code, 403)

    def test_box_ignores_imported_workflow_and_passes_refinement(self):
        graph, _, _ = cutout.workflow()
        graph["118:117"] = {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": "", "clip": ["118:116", 1]},
        }
        graph["118:115"]["inputs"].update(
            conditioning=["118:117", 0], positive_coords="[]", negative_coords="[]"
        )
        original = copy.deepcopy(graph)
        with patch(
            "omnigallery.ai.image_workflows._studio_workflows",
            return_value=[{"name": "imported", "workflow": graph, "output_node_id": "20"}],
        ):
            result = self.submit(
                mode="box",
                positive=[],
                negative=[],
                box=dict(x=0.25, y=0.5, width=0.5, height=0.5),
                refine_iterations=5,
            )
        self.assertEqual(result.status_code, 202, result.text)
        self.drain()
        submitted = self.cloud.submit.call_args.args[0]
        self.assertNotIn("118:117", submitted)
        inputs = submitted["118:115"]["inputs"]
        self.assertEqual(inputs["bboxes"], dict(x=8, y=12, width=16, height=12))
        self.assertEqual(inputs["refine_iterations"], 5)
        self.assertFalse(inputs["individual_masks"])
        for key in ["positive_coords", "negative_coords", "conditioning"]:
            self.assertNotIn(key, inputs)
        self.assertEqual(graph, original)

    def test_cancel_queued_and_running_never_exposes_result(self):
        self.submit()
        self.assertEqual(self.action("cancel").json()["state"], "canceled")
        self.drain()
        self.cloud.submit.assert_not_called()
        self.request["id"] = str(uuid.uuid4())
        self.submit()
        self.cloud.wait.side_effect = lambda *args, **kw: (
            self.action("cancel"),
            {"status": "succeeded"},
        )[1]
        self.drain()
        job = self.jobs()[0]
        self.assertEqual(job["state"], "canceled")
        self.assertNotIn("result", job)
        self.cloud.download_image.assert_not_called()
        self.request["id"] = str(uuid.uuid4())
        self.cloud.submit.side_effect = lambda *args: (
            self.action("cancel"),
            {"id": "late-cloud-job"},
        )[1]
        self.submit()
        self.drain()
        self.assertEqual(self.jobs()[0]["state"], "canceled")
        self.assertEqual(self.jobs()[0]["cloud_job_id"], "late-cloud-job")

    def test_zero_refinement_uses_fixed_builtin(self):
        broken = {"sam": {"class_type": "SAM3_Detect", "inputs": {"image": 42, "model": None}}}
        with patch(
            "omnigallery.ai.image_workflows._studio_workflows", return_value=[{"workflow": broken}]
        ):
            response = self.submit(refine_iterations=0)
        self.assertEqual(response.status_code, 202, response.text)
        self.drain()
        self.assertEqual(
            self.cloud.submit.call_args.args[0]["118:115"]["inputs"]["refine_iterations"], 0
        )

    def test_empty_mismatched_or_colored_mask_fails_without_result(self):
        for mask in [png("L", (32, 24), 0), png("L", (16, 12), 255), png("RGB", (32, 24), "red")]:
            self.request["id"] = str(uuid.uuid4())
            self.cloud.download_image.return_value = (mask, "image/png")
            self.submit()
            self.drain()
            self.assertEqual(self.jobs()[0]["state"], "failed")
            self.assertNotIn("result", self.jobs()[0])

    def test_trim_uses_composed_alpha_bounds_and_preserves_irregular_transparency(self):
        source = Image.new("RGBA", (32, 24), (50, 100, 150, 0))
        source.putpixel((4, 6), (50, 100, 150, 255))
        source.putpixel((12, 10), (50, 100, 150, 128))
        stream = io.BytesIO()
        source.save(stream, "PNG")
        for trim in (True, False):
            with self.subTest(trim=trim):
                self.request["id"] = str(uuid.uuid4())
                response = self.submit(
                    trim_transparent=trim, png_base64=base64.b64encode(stream.getvalue()).decode()
                )
                self.assertEqual(response.status_code, 202, response.text)
                self.drain()
                job = self.jobs()[0]
                self.assertEqual(job["state"], "completed", job)
                self.assertEqual(job["trim_transparent"], trim)
                raw = assets.read_png(job["result"]["path"].split(":")[1])
                image = Image.open(io.BytesIO(raw))
                if trim:
                    self.assertEqual(image.size, (9, 5))
                    self.assertEqual(
                        job["result_bounds"], dict(x=4 / 32, y=6 / 24, width=9 / 32, height=5 / 24)
                    )
                    self.assertEqual(image.getpixel((0, 0))[3], 128)
                    self.assertEqual(image.getpixel((8, 4))[3], 64)
                    self.assertEqual(image.getpixel((4, 2))[3], 0)
                else:
                    self.assertEqual(image.size, (32, 24))
                    self.assertEqual(job["result_bounds"], dict(x=0, y=0, width=1, height=1))

    def test_trim_mask_bounds_keep_faint_edges_and_reject_fully_transparent_source(self):
        mask = Image.new("L", (32, 24), 0)
        mask.putpixel((7, 8), 1)
        mask.putpixel((7, 14), 255)
        stream = io.BytesIO()
        mask.save(stream, "PNG")
        self.cloud.download_image.return_value = (stream.getvalue(), "image/png")
        self.submit(
            trim_transparent=True,
            png_base64=base64.b64encode(png("RGBA", (32, 24), "red")).decode(),
        )
        self.drain()
        job = self.jobs()[0]
        self.assertEqual((job["result"]["width"], job["result"]["height"]), (1, 7))
        self.assertEqual(
            job["result_bounds"], dict(x=7 / 32, y=8 / 24, width=1 / 32, height=7 / 24)
        )
        self.request["id"] = str(uuid.uuid4())
        self.submit(
            trim_transparent=True,
            png_base64=base64.b64encode(png("RGBA", (32, 24), (0, 0, 0, 0))).decode(),
        )
        self.drain()
        self.assertEqual(self.jobs()[0]["state"], "failed")
        self.assertNotIn("result", self.jobs()[0])

    def test_restart_is_durable_but_never_resubmits_paid_job(self):
        self.submit()
        cutout._change("d" * 64, self.request["id"], cloud_job_id="cloud-job")
        with patch.object(cutout, "PROCESS_ID", "other-process"):
            job = self.jobs()[0]
            self.assertEqual(job["state"], "failed")
            self.assertEqual(job["cloud_job_id"], "cloud-job")
        # Simulate a terminated worker, releasing its reserved local slot.
        self.work.clear()
        cutout.slots.release()
        self.assertEqual(self.submit().json()["state"], "failed")
        self.assertFalse(self.work)
        self.cloud.submit.assert_not_called()

    def test_single_result_slot_retains_success_on_retry_and_isolates_layers(self):
        first_request = dict(self.request)
        self.submit()
        self.drain()
        first = self.jobs()[0]
        first_pixels = assets.read_png(first["result"]["path"].split(":")[1])
        self.action("handled")
        self.request["id"] = str(uuid.uuid4())
        self.submit()
        self.assertEqual(len(self.jobs()), 2)  # Running task plus the one comparison pair.
        self.action("cancel")
        self.drain()
        self.assertEqual(sum(job["state"] == "completed" for job in self.jobs()), 1)
        self.request["id"] = str(uuid.uuid4())
        self.submit()
        self.drain()
        self.assertEqual(len(self.jobs()), 1)
        self.assertEqual(self.jobs()[0]["id"], self.request["id"])
        retired = cutout._read("d" * 64, first["id"])
        self.assertTrue(retired["superseded"])
        self.assertNotIn("result", retired)
        self.assertNotIn("source", retired)
        self.assertEqual(assets.read_png(first["result"]["path"].split(":")[1]), first_pixels)
        receipt = self.client.post("/api/image-cutout/tasks", json=first_request)
        self.assertEqual(receipt.status_code, 202)
        self.assertTrue(receipt.json()["handled"])
        self.assertFalse(self.work)  # Reposting a retired task must not incur a new cloud charge.
        self.request.update(id=str(uuid.uuid4()), layer_id="duplicate-image")
        self.submit()
        self.drain()
        self.assertEqual(len(self.jobs()), 2)
        self.assertEqual({job["layer_id"] for job in self.jobs()}, {"image", "duplicate-image"})

    def test_legacy_history_returns_only_latest_status_and_success_per_layer(self):
        self.submit()
        self.drain()
        first = cutout._read("d" * 64, self.request["id"])
        for age in (1, 2):
            cutout._save(
                {**first, "id": str(uuid.uuid4()), "created_at": first["created_at"] - age}
            )
        self.assertEqual(len(self.jobs()), 1)
        self.assertEqual(self.jobs()[0]["id"], first["id"])
        self.request["id"] = str(uuid.uuid4())
        self.cloud.submit.side_effect = HTTPException(502, "任务失败")
        self.submit()
        self.drain()
        self.assertEqual([job["state"] for job in self.jobs()], ["failed", "completed"])

    def test_retired_results_keep_compact_recovery_chain_for_unsaved_retries(self):
        for revision in ("a", "b", "c"):
            self.request.update(id=str(uuid.uuid4()), source_revision=revision * 64)
            self.assertEqual(self.submit().status_code, 202)
            self.drain()
        jobs = self.jobs()
        self.assertEqual(len(jobs), 1)
        latest = jobs[0]
        self.assertEqual(latest["source_revision"], "c" * 64)
        self.assertEqual(
            {step["source_revision"] for step in latest["recovery_steps"]},
            {"a" * 64, "b" * 64},
        )
        for step in latest["recovery_steps"]:
            self.assertEqual(
                set(step), {"source_revision", "source_bounds", "result_bounds", "result"}
            )
            self.assertTrue(assets.read_png(step["result"]["path"].split(":")[1]))
        # Recovery metadata is durable and needs no extra cloud job after reopening.
        with patch.object(cutout, "PROCESS_ID", "after-restart"):
            self.assertEqual(self.jobs()[0]["recovery_steps"], latest["recovery_steps"])
        self.assertEqual(self.cloud.submit.call_count, 3)

    def test_crash_after_publishing_completion_cannot_hide_the_recovery_chain(self):
        self.submit()
        self.drain()
        first = self.jobs()[0]
        self.request.update(id=str(uuid.uuid4()), source_revision="b" * 64)
        self.assertEqual(self.submit().status_code, 202)
        # The replacement worker below represents a process terminated after its first write.
        self.work.clear()
        cutout.slots.release()
        save = cutout._save

        class ProcessExit(BaseException):
            pass

        def save_then_exit(record):
            save(record)
            raise ProcessExit()

        with (
            patch.object(cutout, "_save", side_effect=save_then_exit),
            self.assertRaises(ProcessExit),
        ):
            cutout._change("d" * 64, self.request["id"], state="completed", result=first["result"])
        with patch.object(cutout, "PROCESS_ID", "after-crash"):
            latest = self.jobs()[0]
        self.assertEqual(latest["id"], self.request["id"])
        self.assertEqual(latest["state"], "completed")
        self.assertEqual(latest["recovery_steps"][0]["source_revision"], first["source_revision"])
        self.assertEqual(latest["recovery_steps"][0]["result"], first["result"])
        self.assertFalse(cutout._read("d" * 64, first["id"]).get("superseded", False))

    def test_validation_idempotency_auth_and_cloud_errors(self):
        for changes in [
            dict(refine_iterations=-1),
            dict(refine_iterations=6),
            dict(refine_iterations=2.5),
            dict(trim_transparent="true"),
            dict(source_bounds=dict(x=0.9, y=0, width=0.5, height=1)),
            dict(positive=[]),
            dict(positive=[{"x": 2, "y": 0}]),
            dict(box=dict(x=0, y=0, width=1, height=1)),
            dict(mode="box", positive=[], negative=[], box=dict(x=0.8, y=0, width=0.5, height=1)),
            dict(document_key="../escape"),
        ]:
            self.assertEqual(self.submit(**changes).status_code, 422, changes)
        self.submit()
        self.assertEqual(self.submit(refine_iterations=0).status_code, 409)
        self.cloud.submit.side_effect = HTTPException(502, "云端拒绝任务")
        self.drain()
        self.assertEqual(self.jobs()[0]["error"], "云端拒绝任务")

        def deny():
            raise HTTPException(403, "denied")

        self.app.dependency_overrides[write_permission_required] = deny
        self.assertEqual(self.submit().status_code, 403)
        self.assertEqual(self.action("cancel").status_code, 403)
        self.app.dependency_overrides[verify_secret] = deny
        self.assertEqual(self.client.get("/api/image-cutout/config").status_code, 403)
