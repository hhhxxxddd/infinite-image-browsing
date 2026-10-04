import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.tests.support.database import isolate_database, isolate_project_storage
from omnigallery.ai import builtin_tools, image_routes, image_schemas, image_workflows
from omnigallery.image_editing import cutout


class BuiltinToolsTest(unittest.TestCase):
    def setUp(self):
        isolate_project_storage(self)
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        isolate_database(self, Path(directory.name) / "test.db")
        self.app = FastAPI()
        self.write = lambda: None
        self.auth = lambda: None
        image_routes.mount_image_ai_routes(self.app, "/api", self.auth, self.write, lambda _: True)
        self.client = TestClient(self.app)
        self.addCleanup(self.client.close)
        self.path = "/api/ai-tools/builtin/" + builtin_tools.CUTOUT_ID

    def test_defaults_persist_independently_and_reject_graph_or_purpose_edits(self):
        response = self.client.get("/api/ai-tools/builtin")
        self.assertEqual(response.status_code, 200)
        items = response.json()
        self.assertEqual(items[0]["defaults"], {"refine_iterations": 3, "trim_transparent": False})
        self.assertNotIn("purpose", items[0])
        self.assertEqual([i["status"] for i in items], ["available", "available", "available"])
        for value in (0, 5, 3):
            saved = self.client.put(self.path + "/defaults", json={"refine_iterations": value})
            self.assertEqual(saved.status_code, 200, saved.text)
            self.assertEqual(builtin_tools.cutout_defaults()["refine_iterations"], value)
            self.assertEqual(cutout.workflow()[0]["118:115"]["inputs"]["refine_iterations"], 3)
        saved = self.client.put(
            self.path + "/defaults", json={"refine_iterations": 3, "trim_transparent": True}
        )
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertTrue(builtin_tools.cutout_defaults()["trim_transparent"])
        for invalid in (
            {"refine_iterations": 6},
            {"refine_iterations": 2.5},
            {"refine_iterations": True},
            {"trim_transparent": "false"},
            {"purpose": "image_edit"},
            {"workflow": {}},
        ):
            self.assertEqual(
                self.client.put(self.path + "/defaults", json=invalid).status_code, 422
            )
        self.assertEqual(self.client.delete(self.path).status_code, 404)
        self.assertEqual(self.client.put(self.path + "/workflow", json={}).status_code, 405)
        self.assertEqual(
            self.client.get("/api/ai-tools/builtin/image-erase/workflow").status_code, 200
        )

    def test_copy_is_independent_custom_preset_and_mask_is_excluded_from_general_editor(self):
        preset = self.client.get(self.path + "/workflow").json()
        response = self.client.post("/api/image-ai/studio/workflows", json=preset)
        self.assertEqual(response.status_code, 200, response.text)
        workflow_id = response.json()["id"]
        rows = self.client.get("/api/image-ai/studio/workflows").json()
        self.assertEqual(len(rows), 1)
        self.assertTrue(rows[0]["unavailable_reason"])
        with self.assertRaises(HTTPException) as failure:
            image_workflows.prepare_studio_workflow(
                image_schemas.StudioPresetEditRequest(
                    workflow_id=workflow_id, image_base64="", prompt=""
                )
            )
        self.assertEqual(failure.exception.status_code, 400)
        preset["workflow"]["118:116"]["inputs"]["ckpt_name"] = "custom-model"
        self.assertEqual(
            self.client.put(
                f"/api/image-ai/studio/workflows/{workflow_id}", json=preset
            ).status_code,
            200,
        )
        self.assertEqual(
            cutout.workflow()[0]["118:116"]["inputs"]["ckpt_name"],
            "sam3.1_multiplex_fp16.safetensors",
        )
        self.assertEqual(
            self.client.delete(f"/api/image-ai/studio/workflows/{workflow_id}").status_code, 200
        )
        self.assertEqual(len(cutout.workflow()[0]), 5)
        self.assertFalse(
            builtin_tools.studio_unavailable_reason(
                {
                    "workflow": {
                        "save": {"class_type": "SaveImage", "inputs": {"images": ["image", 0]}}
                    },
                    "output_node_id": "save",
                }
            )
        )

    def test_readonly_and_auth_enforced_and_no_secret_exposed(self):
        with patch.object(builtin_tools, "comfy_cloud_key", return_value=("private-key", "saved")):
            response = self.client.get("/api/ai-tools/builtin")
        self.assertTrue(response.json()[0]["connection_configured"])
        self.assertNotIn("private-key", response.text)

        def deny():
            raise HTTPException(403, "denied")

        self.app.dependency_overrides[self.write] = deny
        self.assertEqual(
            self.client.put(self.path + "/defaults", json={"refine_iterations": 2}).status_code, 403
        )
        self.assertEqual(self.client.get(self.path + "/workflow").status_code, 200)
        self.app.dependency_overrides[self.auth] = deny
        self.assertEqual(self.client.get("/api/ai-tools/builtin").status_code, 403)
        self.assertEqual(self.client.get(self.path + "/workflow").status_code, 403)

    def test_upscale_defaults_are_strict_and_do_not_modify_built_in_graph(self):
        path = "/api/ai-tools/builtin/image-upscale"
        self.assertEqual(
            self.client.get("/api/ai-tools/builtin").json()[2]["defaults"],
            {"target_resolution": "4K"},
        )
        for resolution in ("original", "2K", "4K", "8K"):
            response = self.client.put(path + "/defaults", json={"target_resolution": resolution})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(builtin_tools.upscale_defaults(), {"target_resolution": resolution})
            self.assertEqual(
                builtin_tools.upscale_workflow()["4:12"]["inputs"]["resize_type.shorter_size"], 4096
            )
        for payload in (
            {"target_resolution": "16K"},
            {"target_resolution": 2048},
            {"multiplier": True},
            {"multiplier": 3},
            {"multiplier": 2.5},
            {"multiplier": "2"},
            {"refine_iterations": 3},
        ):
            self.assertEqual(self.client.put(path + "/defaults", json=payload).status_code, 422)
        self.assertEqual(
            self.client.put(self.path + "/defaults", json={"multiplier": 2}).status_code, 422
        )
        preset = self.client.get(path + "/workflow").json()
        self.assertEqual(preset["image_node_id"], "1")
        self.assertEqual(preset["output_node_id"], "2")
        self.assertFalse(builtin_tools.studio_unavailable_reason(preset))
        saved = self.client.post("/api/image-ai/studio/workflows", json=preset)
        self.assertEqual(saved.status_code, 200, saved.text)
        preset["workflow"]["4:12"]["inputs"]["resize_type.shorter_size"] = 2048
        self.assertEqual(
            builtin_tools.upscale_workflow()["4:12"]["inputs"]["resize_type.shorter_size"], 4096
        )

    def test_legacy_upscale_defaults_migrate_without_mutating_other_tools(self):
        for old, expected in ((1, "original"), (2, "4K"), (4, "4K")):
            with patch.object(
                builtin_tools.SettingsRepository, "get_setting", return_value={"multiplier": old}
            ):
                self.assertEqual(builtin_tools.upscale_defaults(), {"target_resolution": expected})

    def test_erase_defaults_and_custom_copy(self):
        path = "/api/ai-tools/builtin/image-erase"
        self.assertEqual(
            self.client.get("/api/ai-tools/builtin").json()[1]["defaults"]["blend_pixels"], 16
        )
        response = self.client.put(
            path + "/defaults", json={"blend_pixels": 40, "prompt": "补全背景"}
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(builtin_tools.erase_defaults()["blend_pixels"], 40)
        self.assertEqual(builtin_tools.erase_workflow()["8"]["inputs"]["mask_blend_pixels"], 16)
        preset = self.client.get(path + "/workflow").json()
        saved = self.client.post("/api/image-ai/studio/workflows", json=preset)
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertNotIn("17", preset["workflow"])
        self.assertEqual(preset["mask_node_id"], "16")
        self.assertEqual(preset["prompt_node_id"], "3")
