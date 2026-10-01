"""Native retrieval never silently falls back to text-only inference."""

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from PIL import Image

from omnigallery.ai.models import gguf_client as native
from omnigallery.ai.models import gguf_models
from omnigallery.ai.models import gguf_runtime as runtime
from omnigallery.search import qwen


class GGUFRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        scope = patch.object(runtime, "RUNTIME_ROOT", self.root / "runtime")
        scope.start()
        self.addCleanup(scope.stop)
        runtime._job.update(running=False, stage="", progress=0, error="")
        self.addCleanup(runtime._job.update, running=False, stage="", progress=0, error="")

    def bundle(self, kind="embedding"):
        path = self.root / kind
        path.mkdir(exist_ok=True)
        for name in ("model.gguf", "mmproj.gguf"):
            (path / name).write_bytes(b"GGUFtest")
        (path / "gguf-model.json").write_text(
            json.dumps(
                {
                    "kind": kind,
                    "model_file": "model.gguf",
                    "projector_file": "mmproj.gguf",
                }
            )
        )
        return runtime.bundle(path, kind)

    def test_projector_required_and_role_checked(self):
        bundle = self.bundle()
        with self.assertRaises(ValueError):
            runtime.bundle(bundle.model.parent, "reranker")
        bundle.projector.unlink()
        state, detail = runtime.readiness(bundle.model.parent, "embedding")
        self.assertEqual(state, "missing_model")
        self.assertIn("mmproj", detail)

    def test_projector_revision_invalidates_embedding_key(self):
        bundle = self.bundle()
        key = bundle.key()
        bundle.projector.write_bytes(b"GGUFreplacement")
        self.assertNotEqual(key, bundle.key())

    def test_manifest_cannot_escape_model_directory(self):
        bundle = self.bundle()
        (bundle.model.parent / "gguf-model.json").write_text(
            json.dumps(
                {
                    "kind": "embedding",
                    "model_file": "../outside.gguf",
                    "projector_file": "mmproj.gguf",
                }
            )
        )
        with self.assertRaises(ValueError):
            runtime.bundle(bundle.model.parent, "embedding")

    def test_ambiguous_import_is_not_silently_selected(self):
        bundle = self.bundle()
        (bundle.model.parent / "gguf-model.json").unlink()
        (bundle.model.parent / "another.gguf").write_bytes(b"GGUFtest")
        with self.assertRaises(ValueError):
            runtime.bundle(bundle.model.parent, "embedding")
        self.assertEqual(runtime.bundle(bundle.model, "embedding"), bundle)

    def existing(self):
        path = runtime.RUNTIME_ROOT / ("a" * 32)
        (path / "bin").mkdir(parents=True)
        (path / "bin/llama-server.exe").touch()
        (runtime.RUNTIME_ROOT / "active.json").write_text(json.dumps({"directory": path.name}))
        return path

    def test_pointer_escape_and_transactional_repair(self):
        old = self.existing()
        with patch.object(runtime, "prepare_runtime", side_effect=RuntimeError("checksum failed")):
            runtime.install("cpu")
        self.assertEqual(runtime.active_runtime(), old)
        self.assertIn("checksum failed", runtime._job["error"])
        self.assertEqual([p for p in runtime.RUNTIME_ROOT.iterdir() if p.is_dir()], [old])
        (runtime.RUNTIME_ROOT / "active.json").write_text('{"directory":"../outside"}')
        self.assertIsNone(runtime.active_runtime())

    def test_gguf_does_not_require_python_ai_dependencies(self):
        bundle = self.bundle()
        with (
            patch.object(qwen, "model_path", return_value=bundle.model.parent),
            patch.object(runtime, "binary", return_value="llama-server"),
            patch.object(
                qwen.importlib.util,
                "find_spec",
                side_effect=AssertionError("PyTorch dependency check"),
            ),
        ):
            self.assertEqual(qwen.readiness("embedding")[0], "ready")
            self.assertIn(runtime.PROTOCOL, qwen.model_key("embedding"))

    def test_routes_enforce_write_permissions_and_single_install(self):
        app = FastAPI()
        runtime.mount_gguf_runtime_routes(app, "/api", lambda: None, lambda: None)
        with TestClient(app) as client, patch.object(runtime, "supported", return_value=True):
            runtime._job["running"] = True
            self.assertEqual(
                client.post("/api/gguf-runtime/install", json={"variant": "cuda"}).status_code, 409
            )
            self.assertEqual(
                client.post("/api/gguf-runtime/install", json={"variant": "arbitrary"}).status_code,
                422,
            )

        def readonly():
            raise HTTPException(403, "read only")

        app = FastAPI()
        runtime.mount_gguf_runtime_routes(app, "/api", lambda: None, readonly)
        with TestClient(app) as client:
            self.assertEqual(client.post("/api/gguf-runtime/install", json={}).status_code, 403)


class GGUFInferenceTests(GGUFRuntimeTests):
    def make_client(self, bundle):
        client = native.GGUFClient()
        client.process = MagicMock()
        client.process.poll.return_value = None
        client.session = MagicMock()
        client.kind, client.key = bundle.kind, bundle.key()
        client.marker = "<__media_dynamic__>"
        self.addCleanup(client.close)
        return client

    def test_actual_image_bytes_and_official_last_token_prompt(self):
        bundle = self.bundle()
        client = self.make_client(bundle)
        with patch.object(
            client, "_request", return_value=[{"embedding": [[1.0] * 4096]}]
        ) as request:
            client.vector(bundle, Image.new("RGB", (8, 8), "red"), True, qwen.INSTRUCTION)
            content = request.call_args.args[1]["content"]
            self.assertIn("Represent the user's input.", content["prompt_string"])
            self.assertTrue(content["prompt_string"].endswith("<|im_start|>assistant\n"))
            self.assertEqual(content["prompt_string"].count(client.marker), 1)
            self.assertNotIn("<|vision_start|>", content["prompt_string"])
            self.assertTrue(content["multimodal_data"][0].startswith("iVBOR"))
            client.vector(bundle, "男人", False, qwen.INSTRUCTION)
            self.assertNotIn("multimodal_data", request.call_args.args[1]["content"])
            self.assertIn(qwen.INSTRUCTION, request.call_args.args[1]["content"]["prompt_string"])

    def test_reranking_uses_images_and_conditional_probability(self):
        bundle = self.bundle("reranker")
        client = self.make_client(bundle)
        image = self.root / "photo.png"
        Image.new("RGB", (8, 8), "blue").save(image)
        reply = {
            "probs": [
                {
                    "top_probs": [
                        {"token": "y", "prob": 0.2},
                        {"token": "yes", "prob": 0.6},
                        {"token": "no", "prob": 0.2},
                    ]
                }
            ]
        }
        with patch.object(client, "_request", return_value=reply) as request:
            self.assertAlmostEqual(
                client.rerank(bundle, "男人", [str(image)], qwen.INSTRUCTION)[0], 0.75
            )
            endpoint, payload = request.call_args.args
            self.assertEqual(endpoint, "/completion")
            self.assertIn("<Query>:男人\n<Document>:", payload["prompt"]["prompt_string"])
            self.assertNotIn("<think>", payload["prompt"]["prompt_string"])
            self.assertTrue(payload["prompt"]["multimodal_data"])
            self.assertEqual(payload["temperature"], 1)

    def test_bad_scores_and_wrong_embedding_fail_and_stop_process(self):
        for reply in (
            {"probs": []},
            {"probs": [{"top_probs": [{"token": "yes", "prob": 1}]}]},
            {
                "probs": [
                    {
                        "top_probs": [
                            {"token": "yes", "prob": float("nan")},
                            {"token": "no", "prob": 0.5},
                        ]
                    }
                ]
            },
        ):
            with self.assertRaises(ValueError):
                native.yes_probability(reply)
        bundle = self.bundle()
        client = self.make_client(bundle)
        process = client.process
        with patch.object(client, "_request", return_value=[{"embedding": [[1.0, 2.0]]}]):
            with self.assertRaises(ValueError):
                client.vector(bundle, "test", False, qwen.INSTRUCTION)
        process.terminate.assert_called_once()
        self.assertIsNone(client.process)

    def test_instruct_generation_sends_image_and_preserves_prompt_roles(self):
        bundle = self.bundle("instruct")
        client = self.make_client(bundle)
        image = self.root / "photo.png"
        Image.new("RGB", (8, 8), "red").save(image)
        reply = {"choices": [{"message": {"content": "  A red square.  "}}]}
        with patch.object(client, "_request", return_value=reply) as request:
            self.assertEqual(client.generate(bundle, str(image), "Describe", 80), "A red square.")
            endpoint, payload = request.call_args.args
            self.assertEqual(endpoint, "/v1/chat/completions")
            content = payload["messages"][0]["content"]
            self.assertTrue(
                content[0]["image_url"]["url"].startswith("data:image/png;base64,iVBOR")
            )
            self.assertEqual(content[1]["text"], "Describe")
            self.assertEqual(payload["max_tokens"], 80)
            self.assertEqual(payload["temperature"], 0)
            client.generate(bundle, str(image), "Use allowed tags", 256, system=True)
            messages = request.call_args.args[1]["messages"]
            self.assertEqual(messages[0], {"role": "system", "content": "Use allowed tags"})
            self.assertEqual(messages[1]["role"], "user")

    def test_instruct_dispatch_uses_native_engine_and_reuses_loaded_process(self):
        from omnigallery.ai.models import qwen_instruct as instruct
        from omnigallery.ai.models.runtime_client import client as worker

        bundle = self.bundle("instruct")
        with (
            patch.object(instruct, "model_path", return_value=bundle.model.parent),
            patch.object(runtime, "binary", return_value="llama-server"),
            patch.object(
                instruct.importlib.util, "find_spec", side_effect=AssertionError("PyTorch")
            ),
            patch.object(native.client, "generate", return_value="description") as generate,
            patch.object(native.client, "release") as release,
            patch.object(worker, "release"),
            patch.object(worker, "close"),
        ):
            self.assertEqual(instruct.readiness()[0], "ready")
            self.assertEqual(instruct.model_id(), "Qwen/Qwen3-VL-8B-Instruct")
            engine = instruct._Runtime()
            engine.generate("photo.png", "Describe", 80)
            engine.generate("photo.png", "Describe again", 80)
            self.assertEqual(generate.call_count, 2)
            self.assertNotIn(unittest.mock.call("instruct"), release.call_args_list)
            engine.clear()
            release.assert_called_with("instruct")

    def test_invalid_instruct_reply_releases_native_process(self):
        for reply in ({"choices": []}, {"choices": [{"message": {"content": " "}}]}):
            bundle = self.bundle("instruct")
            client = self.make_client(bundle)
            process = client.process
            with patch.object(client, "_request", return_value=reply):
                with self.assertRaises(ValueError):
                    client.generate(bundle, Image.new("RGB", (2, 2)), "Describe", 80)
            process.terminate.assert_called_once()
            self.assertIsNone(client.process)

    def test_launch_is_hidden_loopback_and_timeout_cleans_up(self):
        bundle = self.bundle()
        client = native.GGUFClient()
        process = MagicMock()
        process.poll.return_value = None
        with (
            patch.object(runtime, "binary", return_value="llama-server.exe"),
            patch.object(native.subprocess, "Popen", return_value=process) as spawn,
            patch.object(native, "_windows_job", return_value=None),
            patch.object(native, "START_TIMEOUT", 0),
        ):
            with self.assertRaisesRegex(RuntimeError, "超时"):
                client._start(bundle)
        args = spawn.call_args.args[0]
        self.assertEqual(args[args.index("--host") + 1], "127.0.0.1")
        self.assertIn("last", args)
        self.assertIn("--mmproj", args)
        if os.name == "nt":
            self.assertEqual(
                spawn.call_args.kwargs["creationflags"], native.subprocess.CREATE_NO_WINDOW
            )
        process.terminate.assert_called_once()
        self.assertIsNone(client.process)

    def test_release_only_owned_role_and_restart_after_failure(self):
        bundle = self.bundle()
        client = self.make_client(bundle)
        process = client.process
        client.release("reranker")
        self.assertIs(client.process, process)
        client.release("embedding")
        self.assertIsNone(client.process)
        with patch.object(client, "_start") as start:
            client._ensure(bundle)
            start.assert_called_once_with(bundle)

    def test_pinned_download_catalog_has_both_matching_projectors(self):
        for spec in gguf_models.CATALOG.values():
            self.assertEqual(len(spec["files"]), 2)
            main, projector = spec["files"]
            self.assertIn("Q6_K", main)
            self.assertIn("mmproj", projector)
            self.assertEqual(len(spec["revision"]), 40)
            self.assertTrue(all(len(digest) == 64 for digest in spec["files"].values()))
