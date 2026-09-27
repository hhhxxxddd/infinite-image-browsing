"""Protocol and credential-boundary checks for the Comfy Cloud v2 client."""

import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException

from omnigallery.ai.providers import comfy_cloud as comfy_cloud_v2

JOB_ID = "550e8400-e29b-41d4-a716-446655440000"
ASSET_ID = "11111111-1111-4111-8111-111111111111"


def response(status: int, payload: dict, headers: dict | None = None) -> Mock:
    result = Mock(status_code=status, headers=headers or {})
    result.json.return_value = payload
    return result


def job(status: str) -> dict:
    return {
        "id": JOB_ID,
        "status": status,
        "outputs": [],
        "urls": {"self": f"/api/v2/jobs/{JOB_ID}"},
    }


class ComfyCloudV2Tests(unittest.TestCase):
    def test_poll_retries_rate_limit_without_resubmitting(self):
        limited = response(
            429, {"error": {"code": "rate_limited", "message": "slow down"}}, {"Retry-After": "4"}
        )
        done = response(200, job("succeeded"))
        with (
            patch.object(comfy_cloud_v2.requests, "get", side_effect=[limited, done]) as get,
            patch.object(comfy_cloud_v2.time, "sleep") as sleep,
        ):
            result = comfy_cloud_v2.ComfyCloudV2("private-key").wait(job("queued"))
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(get.call_count, 2)
        self.assertEqual(
            get.call_args_list[0].kwargs["headers"], {"Authorization": "Bearer private-key"}
        )
        self.assertEqual(sleep.call_args_list[1].args[0], 4)

    def test_error_code_is_used_without_echoing_upstream_message(self):
        denied = response(422, {"error": {"code": "missing_asset", "message": "private-key"}})
        with self.assertRaises(HTTPException) as raised:
            comfy_cloud_v2._json_response(denied, "工作流提交", (201,))
        self.assertIn("工作流引用的素材不存在", raised.exception.detail)
        self.assertNotIn("private-key", raised.exception.detail)

    def test_follow_up_url_must_remain_on_cloud_v2(self):
        unsafe = {**job("queued"), "urls": {"self": "https://example.com/api/v2/jobs/" + JOB_ID}}
        with patch.object(comfy_cloud_v2.requests, "get") as get, self.assertRaises(HTTPException):
            comfy_cloud_v2.ComfyCloudV2("private-key").wait(unsafe)
        get.assert_not_called()

    def test_download_rejects_private_redirect(self):
        redirect = response(302, {}, {"Location": "https://127.0.0.1/private"})
        with (
            patch.object(comfy_cloud_v2.requests, "get", return_value=redirect) as get,
            self.assertRaises(HTTPException),
        ):
            comfy_cloud_v2.ComfyCloudV2("private-key").download({"id": ASSET_ID}, 1024)
        get.assert_called_once()

    def test_download_rejects_malformed_redirect(self):
        redirect = response(302, {}, {"Location": "https://[broken"})
        with (
            patch.object(comfy_cloud_v2.requests, "get", return_value=redirect) as get,
            self.assertRaises(HTTPException),
        ):
            comfy_cloud_v2.ComfyCloudV2("private-key").download({"id": ASSET_ID}, 1024)
        get.assert_called_once()

    def test_output_uses_selected_node_and_type(self):
        outputs = [
            {"node_id": "1", "id": ASSET_ID, "type": "image", "content_type": "image/png"},
            {"node_id": "2", "id": ASSET_ID, "type": "text", "content_type": "text/plain"},
        ]
        self.assertEqual(
            comfy_cloud_v2.ComfyCloudV2.output({"outputs": outputs}, "2", "text"), outputs[1]
        )
        with self.assertRaises(HTTPException):
            comfy_cloud_v2.ComfyCloudV2.output({"outputs": outputs}, "1", "text")

    def test_connection_check_uses_v2_job_lookup(self):
        for code in ("not_found", "job_not_found"):
            with self.subTest(code=code):
                missing = response(404, {"error": {"code": code, "message": "unknown job"}})
                with patch.object(comfy_cloud_v2.requests, "get", return_value=missing) as get:
                    ready, _ = comfy_cloud_v2.check_connection("private-key")
                self.assertTrue(ready)
                self.assertIn("/api/v2/jobs/", get.call_args.args[0])
                self.assertEqual(
                    get.call_args.kwargs["headers"], {"Authorization": "Bearer private-key"}
                )

        denied = response(401, {"error": {"code": "unauthorized", "message": "denied"}})
        with patch.object(comfy_cloud_v2.requests, "get", return_value=denied):
            ready, detail = comfy_cloud_v2.check_connection("private-key")
        self.assertFalse(ready)
        self.assertNotIn("private-key", detail)

    def test_connection_check_rejects_generic_404(self):
        for payload in ({"detail": "Not Found"}, {"error": {"code": "route_not_found"}}):
            with self.subTest(payload=payload):
                with patch.object(
                    comfy_cloud_v2.requests, "get", return_value=response(404, payload)
                ):
                    ready, detail = comfy_cloud_v2.check_connection("private-key")
                self.assertFalse(ready)
                self.assertIn("HTTP 404", detail)


if __name__ == "__main__":
    unittest.main()
