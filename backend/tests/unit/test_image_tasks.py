"""No paid calls: exercise queue admission, recovery and cancellation contracts."""

import base64
import copy
import io
import time
import unittest
from unittest.mock import Mock, patch

import requests
from fastapi import HTTPException
from PIL import Image

from omnigallery.ai import image_tasks
from omnigallery.workspaces.tasks import TaskCancelled, TaskInterrupted

JOB = "550e8400-e29b-41d4-a716-446655440000"
TASK = "22222222-2222-4222-8222-222222222222"


def response(code, data, headers=None):
    return Mock(status_code=code, headers=headers or {}, json=Mock(return_value=data))


class Context:
    task_id = TASK

    def __init__(self, **data):
        self.data, self.sleeps = data, []

    def read(self):
        return copy.deepcopy(self.data)

    def update(self, **data):
        self.data.update(data)
        return self.read()

    def sleep(self, seconds):
        self.sleeps.append(seconds)


class ImageTaskProtocolTests(unittest.TestCase):
    def setUp(self):
        self.payload = {
            "mode": "router",
            "generation": True,
            "request": {"prompt": "forest", "model": "vertexai/gemini-3.1-flash-image-preview"},
        }
        stream = io.BytesIO()
        Image.new("RGB", (2, 2)).save(stream, "PNG")
        self.output = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {"inlineData": {"data": base64.b64encode(stream.getvalue()).decode()}}
                        ]
                    }
                }
            ]
        }
        self.key = patch.object(
            image_tasks.image_configuration, "comfy_cloud_key", return_value=("private-key", "")
        )
        self.key.start()
        self.addCleanup(self.key.stop)

    def status(self, status, **extra):
        return {"request_id": JOB, "status": status, **extra}

    def test_lost_router_admission_replays_same_key_then_collects_without_browser(self):
        pending = [
            requests.Timeout(),
            response(201, self.status("IN_QUEUE", queue_position=4), {"Retry-After": "7"}),
            response(200, self.status("IN_PROGRESS")),
            response(200, self.status("COMPLETED")),
            response(200, self.output),
        ]
        calls = []

        def call(method, url, **kwargs):
            calls.append((method, url, copy.deepcopy(kwargs)))
            result = pending.pop(0)
            if isinstance(result, Exception):
                raise result
            return result

        context = Context()
        with patch.object(image_tasks.requests, "request", side_effect=call):
            result = image_tasks.run_image_task(self.payload, context)
        self.assertEqual(result["job_id"], JOB)
        self.assertEqual([c[0] for c in calls], ["POST", "POST", "GET", "GET", "GET"])
        self.assertEqual(calls[0][2]["headers"]["Idempotency-Key"], TASK)
        self.assertEqual(calls[0][2]["json"], calls[1][2]["json"])
        self.assertEqual(calls[1][2]["headers"]["Idempotency-Key"], TASK)
        self.assertIn(7, context.sleeps)
        self.assertNotIn("private-key", str(context.data))

    def test_cancel_request_is_not_confirmation_and_completed_result_is_saved(self):
        context = Context(remote_id=JOB, submitted_at=time.time(), cancel_requested=True)
        with patch.object(
            image_tasks.requests,
            "request",
            side_effect=[
                response(200, self.status("IN_PROGRESS")),
                response(202, {"status": "CANCELLATION_REQUESTED"}),
                response(200, self.status("COMPLETED")),
                response(200, self.output),
            ],
        ) as call:
            result = image_tasks.run_image_task(self.payload, context)
        self.assertEqual(result["job_id"], JOB)
        self.assertEqual([c.args[0] for c in call.call_args_list], ["GET", "PUT", "GET", "GET"])
        self.assertTrue(context.data["cancel_sent"])

    def test_confirmed_cancellation_has_no_result_fetch(self):
        context = Context(remote_id=JOB, submitted_at=time.time())
        with (
            patch.object(
                image_tasks.requests,
                "request",
                return_value=response(200, self.status("COMPLETED", error_type="cancelled")),
            ) as call,
            self.assertRaises(TaskCancelled),
        ):
            image_tasks.run_image_task(self.payload, context)
        self.assertEqual(call.call_count, 1)

    def test_queue_unavailable_never_falls_back_to_synchronous_generation(self):
        with (
            patch.object(
                image_tasks.requests,
                "request",
                return_value=response(403, {}, {"X-Comfy-Error-Type": "not_enabled"}),
            ) as call,
            self.assertRaises(HTTPException),
        ):
            image_tasks.run_image_task(self.payload, Context())
        self.assertEqual(call.call_count, 1)
        self.assertTrue(call.call_args.args[1].endswith("/requests"))

    def test_expired_idempotency_window_never_resubmits(self):
        context = Context(submitted_at=time.time() - 24 * 3600)
        with (
            patch.object(image_tasks.requests, "request") as call,
            self.assertRaises(TaskInterrupted),
        ):
            image_tasks.run_image_task(self.payload, context)
        call.assert_not_called()
        self.assertTrue(context.data["unrecoverable"])

    def test_repeated_network_failure_retains_handle_for_manual_resume(self):
        context = Context(remote_id=JOB, submitted_at=time.time())
        with (
            patch.object(image_tasks.requests, "request", side_effect=requests.Timeout()) as call,
            self.assertRaises(TaskInterrupted),
        ):
            image_tasks.run_image_task(self.payload, context)
        self.assertEqual(call.call_count, 12)
        self.assertEqual(context.data["remote_id"], JOB)
        self.assertTrue(all(c.args[0] == "GET" for c in call.call_args_list))

    def test_router_output_download_failure_resumes_same_completed_job(self):
        context = Context(remote_id=JOB, submitted_at=time.time())
        output = {"data": [{"url": "https://example.com/result.png"}]}
        png = base64.b64decode(
            self.output["candidates"][0]["content"]["parts"][0]["inlineData"]["data"]
        )
        with (
            patch.object(
                image_tasks.requests,
                "request",
                side_effect=[
                    response(200, self.status("COMPLETED")),
                    response(200, output),
                    response(200, self.status("COMPLETED")),
                    response(200, output),
                ],
            ) as call,
            patch(
                "omnigallery.ai.router_images.download_result",
                side_effect=[requests.Timeout("expired connection"), png],
            ),
        ):
            with self.assertRaises(TaskInterrupted):
                image_tasks.run_image_task(self.payload, context)
            self.assertEqual(context.data["remote_id"], JOB)
            self.assertFalse(context.data.get("unrecoverable"))
            result = image_tasks.run_image_task(self.payload, context)
        self.assertEqual(result["job_id"], JOB)
        self.assertEqual(context.data["phase"], "saving")
        self.assertEqual([c.args[0] for c in call.call_args_list], ["GET"] * 4)

    def test_recovery_polls_cloud_handle_without_upload_or_submit(self):
        payload = {
            "mode": "workflow",
            "generation": True,
            "request": {"workflow": {}, "image_base64": "", "image_node_id": "", "image_input": ""},
        }
        context = Context(
            remote_id=JOB,
            submitted_at=time.time(),
            job={"id": JOB, "urls": {"self": f"/api/v2/jobs/{JOB}"}},
        )
        with (
            patch.object(image_tasks, "ComfyCloudV2") as factory,
            patch.object(
                image_tasks.image_providers,
                "collect_cloud_studio",
                return_value={"image_base64": "result"},
            ) as collect,
        ):
            cloud = factory.return_value
            cloud.read_response.return_value = response(200, {"id": JOB, "status": "succeeded"})
            result = image_tasks.run_image_task(payload, context)
        cloud.upload.assert_not_called()
        cloud.submit.assert_not_called()
        collect.assert_called_once()
        self.assertEqual(result["image_base64"], "result")

    def test_unknown_cloud_admission_cannot_replay(self):
        context = Context(submitted_at=time.time())
        with (
            patch.object(image_tasks, "ComfyCloudV2") as factory,
            self.assertRaises(TaskInterrupted),
        ):
            image_tasks._cloud(Mock(), False, context, "private-key")
        factory.return_value.submit.assert_not_called()
        self.assertTrue(context.data["unrecoverable"])

    def test_cloud_rejection_is_not_reported_as_unknown_execution(self):
        with (
            patch.object(image_tasks.image_providers, "prepare_cloud_studio", return_value={}),
            patch(
                "omnigallery.ai.providers.comfy_cloud.requests.post",
                return_value=response(402, {"error": {"code": "insufficient_credits"}}),
            ),
            self.assertRaises(HTTPException) as raised,
        ):
            image_tasks._cloud(Mock(), False, Context(), "private-key")
        self.assertIn("积分不足", raised.exception.detail)

    def test_cloud_lost_submit_response_stops_without_a_second_submission(self):
        context = Context()
        with (
            patch.object(image_tasks.image_providers, "prepare_cloud_studio", return_value={}),
            patch(
                "omnigallery.ai.providers.comfy_cloud.requests.post", side_effect=requests.Timeout()
            ) as post,
        ):
            for _ in range(2):
                with self.assertRaises(TaskInterrupted):
                    image_tasks._cloud(Mock(), False, context, "private-key")
        post.assert_called_once()
        self.assertTrue(context.data["unrecoverable"])

    def test_cloud_success_records_handle_before_poll_and_supports_cancel(self):
        context = Context()
        job = {
            "id": JOB,
            "status": "queued",
            "urls": {"self": f"/api/v2/jobs/{JOB}", "cancel": f"/api/v2/jobs/{JOB}/cancel"},
        }
        with (
            patch.object(image_tasks.image_providers, "prepare_cloud_studio", return_value={}),
            patch(
                "omnigallery.ai.providers.comfy_cloud.requests.post",
                return_value=response(201, job),
            ) as post,
        ):
            self.assertEqual(image_tasks._cloud(Mock(), False, context, "private-key")[0], None)
        self.assertEqual(post.call_args.kwargs["headers"]["Idempotency-Key"], TASK)
        self.assertEqual(context.data["remote_id"], JOB)
        context.update(cancel_requested=True)
        with (
            patch(
                "omnigallery.ai.providers.comfy_cloud.requests.get",
                side_effect=[
                    response(200, {**job, "status": "running"}),
                    response(200, {**job, "status": "canceled"}),
                ],
            ),
            patch(
                "omnigallery.ai.providers.comfy_cloud.requests.post",
                return_value=response(200, {**job, "status": "canceling"}),
            ) as cancel,
        ):
            image_tasks._cloud(Mock(), False, context, "private-key")
            self.assertTrue(context.data["cancel_sent"])
            with self.assertRaises(TaskCancelled):
                image_tasks._cloud(Mock(), False, context, "private-key")
        cancel.assert_called_once()
        self.assertTrue(cancel.call_args.args[0].endswith(f"/{JOB}/cancel"))

    def test_cloud_cancel_link_cannot_leak_credentials_to_another_host(self):
        from omnigallery.ai.providers.comfy_cloud import ComfyCloudV2

        with (
            patch("omnigallery.ai.providers.comfy_cloud.requests.post") as post,
            self.assertRaises(HTTPException),
        ):
            ComfyCloudV2("private-key").read_response(
                {"id": JOB, "urls": {"cancel": "https://example.com/api/v2/jobs/cancel"}},
                cancel=True,
            )
        post.assert_not_called()
