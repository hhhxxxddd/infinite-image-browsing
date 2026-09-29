import base64
import json
import time
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException

from backend.tests.integration import test_image_ai as fixtures
from omnigallery.ai import (
    image_configuration,
    image_defaults,
    image_providers,
    image_routes,
    image_schemas,
    image_workflows,
)
from omnigallery.ai.providers import comfy_cloud as comfy_cloud_v2
from omnigallery.infrastructure.database import Database
from omnigallery.storage.settings_repository import SettingsRepository
from omnigallery.workspaces import artifacts as workspace_artifacts


class MultiImageResultsTests(unittest.TestCase):
    setUp = fixtures.ImageAITests.setUp

    def test_workflow_tasks_save_every_image_and_comparison_for_each_edit_result(self):
        workspace_id = "22222222-2222-4222-8222-222222222222"
        SettingsRepository.save_setting(
            Database.get_connection(),
            "workbench_projects",
            json.dumps({"items": [{"id": workspace_id}]}),
        )
        media = base64.b64encode(self.path.read_bytes()).decode()
        for purpose in ("image_generation", "image_edit"):
            graph = {
                "p": {"class_type": "Prompt", "inputs": {"text": "old"}},
                "a": {"class_type": "SaveImage", "inputs": {}},
                "b": {"class_type": "SaveImage", "inputs": {}},
            }
            if purpose == "image_edit":
                graph["input"] = {"class_type": "LoadImage", "inputs": {"image": "old.png"}}
            preset = self.client.post(
                "/api/image-ai/studio/workflows",
                json={
                    "name": purpose,
                    "purpose": purpose,
                    "workflow": graph,
                    "prompt_node_id": "p",
                    "prompt_input": "text",
                    "image_node_id": "input" if purpose == "image_edit" else "",
                    "image_input": "image" if purpose == "image_edit" else "",
                    "output_mappings": [
                        {"node_id": "a", "label": "正面"},
                        {"node_id": "b", "label": "背面"},
                    ],
                },
            ).json()
            images = [
                {
                    "image_base64": media,
                    "media_type": "image/png",
                    "output_label": label,
                    "output_node_id": node_id,
                }
                for label, node_id in [("正面", "a"), ("正面", "a"), ("背面", "b")]
            ]
            provider_name = (
                "_comfy_cloud_studio_generate"
                if purpose == "image_generation"
                else "_comfy_cloud_studio_edit"
            )
            with (
                patch.object(image_configuration, "comfy_cloud_key", return_value=("test", "")),
                patch.object(image_routes, "production_context", return_value=("三视图", {})),
                patch.object(
                    image_providers, provider_name, return_value={"images": images, "job_id": "job"}
                ),
            ):
                submitted = self.client.post(
                    "/api/image-ai/tasks",
                    json={
                        "workspace_id": workspace_id,
                        "name": "三视图",
                        "mode": "workflow",
                        "purpose": purpose,
                        "document_id": purpose,
                        "document_revision": "a" * 64,
                        "request": {
                            "workflow_id": preset["id"],
                            "prompt": "three views",
                            **({"image_base64": media} if purpose == "image_edit" else {}),
                        },
                    },
                )
                self.assertEqual(submitted.status_code, 202, submitted.text)
                deadline = time.monotonic() + 3
                while time.monotonic() < deadline:
                    task = next(
                        item
                        for item in self.client.get(
                            "/api/image-ai/tasks", params={"workspace_id": workspace_id}
                        ).json()
                        if item["id"] == submitted.json()["id"]
                    )
                    if task["state"] in ("completed", "failed"):
                        break
                    time.sleep(0.01)
                self.assertEqual(task["state"], "completed", task)
            self.assertEqual(len(task["results"]), 3)
            self.assertEqual(task["purpose"], purpose)
            for result in task["results"]:
                artifact = workspace_artifacts._row(
                    Database.get_connection(), result["artifact_id"]
                )
                self.assertEqual(artifact["source"], purpose.replace("image_", "ai_image_"))
                self.assertTrue(workspace_artifacts._file(artifact).exists())
                metadata = workspace_artifacts._artifact_metadata(
                    Database.get_connection(), artifact
                )
                self.assertEqual(metadata["source_image_available"], purpose == "image_edit")
                self.assertIn("three views", metadata["generation_info"])
                self.assertIn(result["label"], metadata["generation_info"])

    def test_multiple_mapping_order_and_batches_for_generation_and_edit(self):
        for generation in (True, False):
            with self.subTest(generation=generation):
                graph = {
                    "prompt": {"class_type": "Prompt", "inputs": {"text": "old"}},
                    "front": {"class_type": "SaveImage", "inputs": {}},
                    "back": {"class_type": "SaveImage", "inputs": {}},
                }
                if not generation:
                    graph["input"] = {"class_type": "LoadImage", "inputs": {"image": "old.png"}}
                req = image_schemas.StudioEditRequest(
                    workflow=graph,
                    image_base64=base64.b64encode(self.path.read_bytes()).decode(),
                    image_node_id="" if generation else "input",
                    image_input="" if generation else "image",
                    prompt_node_id="prompt",
                    prompt_input="text",
                    prompt="三视图",
                    output_mappings=[
                        {"node_id": "front", "label": "正面"},
                        {"node_id": "back", "label": "背面"},
                    ],
                )
                job = fixtures.cloud_job(
                    "succeeded",
                    [
                        {"id": "back", "node_id": "back", "type": "image"},
                        {"id": "front-1", "node_id": "front", "type": "image"},
                        {"id": "text", "node_id": "front", "type": "text"},
                        {"id": "front-2", "node_id": "front", "type": "image"},
                    ],
                )
                with patch.object(image_providers, "ComfyCloudV2") as cloud_type:
                    cloud = cloud_type.return_value
                    cloud.submit.return_value = {"id": fixtures.CLOUD_JOB_ID}
                    cloud.wait.return_value = job
                    cloud.outputs.side_effect = comfy_cloud_v2.ComfyCloudV2.outputs
                    cloud.download_image.return_value = (self.path.read_bytes(), "image/png")
                    result = image_providers._comfy_cloud_studio_run(
                        req, "test", generation=generation
                    )
                self.assertEqual(
                    [call.args[0]["id"] for call in cloud.download_image.call_args_list],
                    ["front-1", "front-2", "back"],
                )
                self.assertEqual(
                    [item["output_label"] for item in result["images"]], ["正面", "正面", "背面"]
                )
                self.assertEqual(result["image_base64"], result["images"][0]["image_base64"])
                self.assertEqual(cloud.upload.call_count, 0 if generation else 1)

    def test_mapping_roundtrip_legacy_fallback_duplicates_and_missing_nodes(self):
        payload = {
            "name": "三视图",
            "purpose": "image_generation",
            "workflow": {
                "p": {"class_type": "Prompt", "inputs": {"text": "old"}},
                "a": {"class_type": "SaveImage", "inputs": {}},
                "b": {"class_type": "SaveImage", "inputs": {}},
            },
            "prompt_node_id": "p",
            "prompt_input": "text",
            "output_mappings": [
                {"node_id": "b", "label": "背面"},
                {"node_id": "a", "label": "正面"},
            ],
        }
        saved = self.client.post("/api/image-ai/studio/workflows", json=payload)
        self.assertEqual(saved.status_code, 200, saved.text)
        item = saved.json()
        summary = self.client.get("/api/image-ai/studio/workflows").json()[0]
        self.assertEqual(summary["output_mappings"], payload["output_mappings"])
        mapped, _ = image_workflows.prepare_generation_workflow(
            image_schemas.StudioPresetGenerationRequest(workflow_id=item["id"], prompt="views")
        )
        self.assertEqual([slot.node_id for slot in mapped.output_mappings], ["b", "a"])
        for outputs in ([{"node_id": "a"}, {"node_id": "a"}], [{"node_id": "missing"}]):
            invalid = self.client.put(
                "/api/image-ai/studio/workflows/" + item["id"],
                json={**payload, "output_mappings": outputs},
            )
            self.assertEqual(invalid.status_code, 400, invalid.text)
        self.assertEqual(
            image_workflows.output_mappings({"output_node_id": "a"}),
            [{"node_id": "a", "label": ""}],
        )
        self.assertEqual(
            image_workflows.output_mappings({"output_node_id": "a", "output_mappings": []}), []
        )

    def test_missing_one_mapped_result_fails_instead_of_silently_dropping_it(self):
        req = image_schemas.StudioEditRequest(
            image_base64="",
            image_node_id="",
            image_input="",
            workflow={
                "p": {"class_type": "Prompt", "inputs": {"text": "old"}},
                "a": {"class_type": "SaveImage", "inputs": {}},
                "b": {"class_type": "SaveImage", "inputs": {}},
            },
            prompt_node_id="p",
            prompt_input="text",
            output_mappings=[{"node_id": "a", "label": "正面"}, {"node_id": "b", "label": "背面"}],
        )
        with patch.object(image_providers, "ComfyCloudV2") as cloud_type:
            cloud = cloud_type.return_value
            cloud.submit.return_value = {"id": fixtures.CLOUD_JOB_ID}
            cloud.wait.return_value = fixtures.cloud_job(
                "succeeded", [{"node_id": "a", "type": "image"}]
            )
            cloud.outputs.side_effect = comfy_cloud_v2.ComfyCloudV2.outputs
            cloud.download_image.return_value = (self.path.read_bytes(), "image/png")
            with self.assertRaises(HTTPException) as caught:
                image_providers._comfy_cloud_studio_generate(req, "test")
        self.assertIn("背面", caught.exception.detail)

    def test_router_keeps_all_image_parts_and_candidates_for_both_purposes(self):
        inline = {
            "inlineData": {
                "mimeType": "image/png",
                "data": base64.b64encode(self.path.read_bytes()).decode(),
            }
        }
        response = Mock(status_code=200, headers={})
        response.json.return_value = {
            "candidates": [
                {"content": {"parts": [{"text": "views"}, inline, inline]}},
                {"content": {"parts": [inline]}},
            ]
        }
        for schema in (
            image_schemas.StudioRouterGenerationRequest,
            image_schemas.StudioRouterEditRequest,
        ):
            req = schema(
                prompt="three views",
                model=image_defaults.DEFAULT_CREATION_MODEL,
                **(
                    {"image_base64": inline["inlineData"]["data"]}
                    if schema is image_schemas.StudioRouterEditRequest
                    else {}
                ),
            )
            with patch.object(image_providers.requests, "post", return_value=response):
                result = image_providers._comfy_router_studio_edit(req, req.model, "test")
            self.assertEqual(len(result["images"]), 3)
