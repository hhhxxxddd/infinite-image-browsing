import base64
import io
import json
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException
from PIL import Image

from omnigallery.ai import image_defaults as defaults
from omnigallery.ai import image_providers as providers
from omnigallery.ai import image_schemas as schemas
from omnigallery.ai import image_workflows, router_images


class RouterImagesTest(unittest.TestCase):
    def setUp(self):
        stream = io.BytesIO()
        Image.new("RGBA", (512, 256), (12, 30, 42, 80)).save(stream, "PNG")
        self.png = stream.getvalue()
        self.encoded = base64.b64encode(self.png).decode()

    def test_supported_models_generate_and_edit_with_native_fields(self):
        self.assertEqual(len(defaults.CREATION_MODELS), 9)
        self.assertEqual(
            {m for m in defaults.CREATION_MODELS if m.startswith("bfl/")}, {"bfl/flux-3-image"}
        )
        for model in defaults.CREATION_MODELS:
            for edit in (False, True):
                with self.subTest(model=model, edit=edit):
                    data = dict(
                        model=model,
                        prompt="Change background",
                        aspect_ratio="3:2",
                        image_size=defaults.router_image_options(model)["image_sizes"][0],
                    )
                    req = (
                        schemas.StudioRouterEditRequest(
                            **data,
                            image_base64=self.encoded,
                            reference_images_base64=[self.encoded],
                        )
                        if edit
                        else schemas.StudioRouterGenerationRequest(**data)
                    )
                    image_workflows.validate_router_edit(req)
                    payload = providers.router_studio_payload(req)
                    if model.startswith("vertexai/"):
                        parts = payload["contents"][0]["parts"]
                        self.assertEqual(sum("inlineData" in p for p in parts), 2 if edit else 0)
                    elif model.startswith("bfl/"):
                        self.assertEqual(payload["resolution"], "1k")
                        self.assertEqual(
                            payload.get("images", []), [self.encoded] * (2 if edit else 0)
                        )
                        self.assertNotIn("width", payload)
                    else:
                        self.assertEqual(len(payload.get("image", [])), 2 if edit else 0)
                        if edit:
                            self.assertTrue(
                                payload["image"][0].startswith("data:image/png;base64,")
                            )
                        if model.startswith("openai/"):
                            self.assertEqual(payload["size"], "1536x1024")
                        else:
                            self.assertEqual(payload["response_format"], "b64_json")

    def test_seedream_every_exposed_size_and_ratio_meets_native_pixel_limits(self):
        for model in (m for m in defaults.CREATION_MODELS if m.startswith("byteplus/")):
            low, high = (
                (3686400, 9437184)
                if model.endswith("260128")
                else (921600, 4624220)
                if "flash" in model
                else (1048576, 4194304)
            )
            options = defaults.router_image_options(model)
            for size in options["image_sizes"]:
                for ratio in options["aspect_ratios"]:
                    req = schemas.StudioRouterGenerationRequest(
                        model=model, prompt="image", image_size=size, aspect_ratio=ratio
                    )
                    w, h = map(int, providers.router_studio_payload(req)["size"].split("x"))
                    self.assertLessEqual(low, w * h, (model, size, ratio, w, h))
                    self.assertLessEqual(w * h, high)
                    self.assertLess(
                        abs(w / h - int(ratio.split(":")[0]) / int(ratio.split(":")[1])), 0.01
                    )

    def test_rejects_retired_models_invalid_options_and_too_many_references(self):
        for model in ("bfl/flux-2-pro", "bfl/flux-2-max", "vertexai/gemini-2.5-flash-image"):
            with self.assertRaises(HTTPException):
                image_workflows.validate_router_edit(
                    schemas.StudioRouterGenerationRequest(model=model, prompt="image")
                )
        for changes in (
            {"image_size": "8K"},
            {"aspect_ratio": "1:8"},
            {"reference_images_base64": [self.encoded] * 10},
        ):
            with self.assertRaises(HTTPException):
                image_workflows.validate_router_edit(
                    schemas.StudioRouterEditRequest(
                        model="bfl/flux-3-image",
                        prompt="image",
                        image_base64=self.encoded,
                        **changes,
                    )
                )

    def test_base64_and_url_outputs_preserve_alpha_and_job_identity(self):
        bodies = [
            {"candidates": [{"content": {"parts": [{"inlineData": {"data": self.encoded}}]}}]},
            {"data": [{"b64_json": self.encoded}]},
            {"data": [{"url": "https://cdn.example.com/result.png"}]},
            {"status": "Ready", "result": {"sample": "https://cdn.example.com/result.png"}},
        ]
        with patch.object(router_images, "download_result", return_value=self.png):
            for body in bodies:
                result = providers.parse_router_studio_result(body, "job")
                self.assertEqual(result["image_base64"], self.encoded)
                self.assertEqual(result["media_type"], "image/png")
                self.assertEqual(result["job_id"], "job")
        for body in (
            {"data": [None]},
            {"result": []},
            {"error": "failed"},
            {"data": [{"b64_json": "bad"}]},
            {"status": "Pending", "result": {"sample": "https://cdn.example.com/result.png"}},
        ):
            with self.assertRaises(HTTPException):
                providers.parse_router_studio_result(body)

    def test_output_download_rejects_local_urls_and_does_not_forward_credentials(self):
        for url in (
            "http://example.com/image.png",
            "https://127.0.0.1/image.png",
            "https://localhost/image.png",
        ):
            with self.assertRaises(ValueError):
                router_images.download_result(url)
        response = Mock(status_code=200, headers={})
        response.iter_content.return_value = [self.png]
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        with (
            patch.object(router_images, "_public_url"),
            patch.object(router_images.requests, "get", return_value=response) as get,
        ):
            self.assertEqual(
                router_images.download_result("https://cdn.example.com/result.png"), self.png
            )
            self.assertNotIn("headers", get.call_args.kwargs)
            self.assertFalse(get.call_args.kwargs["allow_redirects"])

    def test_gpt_understanding_uses_responses_and_ignores_reasoning(self):
        self.assertFalse(any("claude" in model for model in defaults.COMFY_MODELS))
        response = Mock(status_code=200)
        response.json.return_value = {
            "status": "completed",
            "output": [
                {"type": "reasoning", "summary": "private"},
                {"type": "message", "content": [{"type": "output_text", "text": "A blue sky"}]},
            ],
        }
        with (
            patch.object(providers.image_images, "_image_jpeg_base64", return_value="jpeg"),
            patch.object(providers, "_comfy_post", return_value=response) as post,
        ):
            for model in (m for m in defaults.COMFY_MODELS if m.startswith("openai/")):
                self.assertEqual(
                    providers._comfy_cloud_generate("image", "Describe", model, "key", 100),
                    "A blue sky",
                )
                payload = post.call_args.kwargs["json"]
                self.assertEqual(payload["instructions"], "Describe")
                self.assertFalse(payload["store"])
                self.assertIn("input_image", json.dumps(payload))
                self.assertNotIn("generationConfig", payload)
            response.json.return_value = {"status": "incomplete", "output": []}
            with self.assertRaises(HTTPException):
                providers._comfy_cloud_generate("image", "Describe", "openai/gpt-6-sol", "key", 100)
