"""Desktop runtime installation is transactional and never invokes the frozen EXE as pip."""

import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from omnigallery.ai.models import desktop_runtime as runtime
from omnigallery.ai.models.runtime_client import client as worker
from omnigallery.search import qwen


class DesktopRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        root = patch.object(runtime, "RUNTIME_ROOT", self.root)
        root.start()
        self.addCleanup(root.stop)
        runtime._job.update(running=False, stage="", progress=0, error="")
        runtime._checked.clear()
        self.addCleanup(runtime._checked.clear)
        self.addCleanup(runtime._job.update, running=False, stage="", progress=0, error="")

    def existing(self):
        path = self.root / ("a" * 32)
        path.mkdir()
        (path / "python.exe").touch()
        (self.root / "active.json").write_text(json.dumps({"directory": path.name}))
        return path

    def test_pointer_cannot_escape_owned_root(self):
        (self.root / "active.json").write_text('{"directory":"../outside"}')
        self.assertIsNone(runtime.active_runtime())

    def test_repair_failure_keeps_previous_environment(self):
        old = self.existing()
        with patch.object(runtime, "prepare_runtime", side_effect=RuntimeError("download failed")):
            runtime.install("cpu")
        self.assertEqual(runtime.active_runtime(), old)
        self.assertIn("download failed", runtime._job["error"])
        self.assertFalse(runtime._job["running"])
        self.assertEqual([p for p in self.root.iterdir() if p.is_dir()], [old])

    def test_new_environment_only_activated_after_validation(self):
        old = self.existing()

        def prepare(path, variant):
            self.assertEqual(runtime.active_runtime(), old)
            self.assertEqual(variant, "cpu")
            (path / "python.exe").touch()
            return {"device": "CPU", "cuda": False, "versions": {"torch": "2.11.0+cpu"}}

        with patch.object(runtime, "prepare_runtime", side_effect=prepare):
            runtime.install("cpu")
        self.assertNotEqual(runtime.active_runtime(), old)
        self.assertTrue(old.exists())
        self.assertTrue(runtime._checked["ready"])
        self.assertEqual(runtime._job["progress"], 100)

    def test_broken_import_is_not_reported_ready(self):
        self.existing()
        with patch.object(runtime, "probe", side_effect=RuntimeError("DLL load failed")):
            runtime.check()
        state, detail = runtime.readiness()
        self.assertEqual(state, "missing_dependency")
        self.assertIn("DLL load failed", detail)

    def test_archive_traversal_rejected_before_extraction(self):
        archive = self.root / "bad.zip"
        with zipfile.ZipFile(archive, "w") as output:
            output.writestr("../outside.txt", "bad")
        with self.assertRaises(ValueError):
            runtime.unpack(archive, self.root / "stage")
        self.assertFalse((self.root / "outside.txt").exists())

    def test_routes_reject_unsupported_platform_and_concurrent_jobs(self):
        app = FastAPI()
        runtime.mount_runtime_routes(app, "/api", lambda: None, lambda: None)
        with TestClient(app) as client:
            with patch.object(runtime, "supported", return_value=False):
                self.assertEqual(
                    client.post("/api/ai-runtime/install", json={"variant": "cpu"}).status_code, 400
                )
            with patch.object(runtime, "supported", return_value=True):
                runtime._job["running"] = True
                self.assertEqual(client.post("/api/ai-runtime/check").status_code, 409)
                self.assertEqual(
                    client.post(
                        "/api/ai-runtime/install", json={"variant": "arbitrary"}
                    ).status_code,
                    422,
                )

    def test_source_build_can_install_and_dispatch_to_managed_environment(self):
        app = FastAPI()
        runtime.mount_runtime_routes(app, "/api", lambda: None, lambda: None)
        with (
            patch.object(runtime, "is_exe_ver", False),
            patch.object(runtime, "supported", return_value=True),
            patch.object(runtime.threading, "Thread") as thread,
            TestClient(app) as client,
        ):
            self.assertFalse(runtime.uses_managed_runtime())
            self.assertEqual(runtime.status()["source"], "python")
            response = client.post("/api/ai-runtime/install", json={"variant": "cpu"})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(thread.call_args.kwargs["args"], (runtime.install, "cpu"))
            thread.return_value.start.assert_called_once()
            self.existing()
            runtime._checked.update(ready=True)
            self.assertTrue(runtime.uses_managed_runtime())
            self.assertEqual(runtime.status()["source"], "managed")
            with (
                patch.dict(sys.modules, {"torch": None}),
                patch.object(qwen, "model_path", return_value=self.root),
                patch.object(worker, "request", return_value=[3.0, 4.0]) as request,
                patch.object(qwen, "_release_gguf"),
            ):
                vector = qwen._Runtime("embedding").vector("query", False)
            self.assertAlmostEqual(float(vector[0]), 0.6)
            self.assertEqual(request.call_args.kwargs["kind"], "embedding")

    def test_source_models_released_before_runtime_activation(self):
        from omnigallery.ai.models import qwen_instruct

        def prepare(path, variant):
            (path / "python.exe").touch()
            return {"device": "CPU", "cuda": False, "versions": {}}

        def release():
            self.assertIsNone(runtime.active_runtime())

        with (
            patch.object(runtime, "prepare_runtime", side_effect=prepare),
            patch.object(qwen, "release_search_models", side_effect=release) as search_release,
            patch.object(
                qwen_instruct, "release_loaded_model", side_effect=release
            ) as generation_release,
        ):
            runtime.install("cpu")
        search_release.assert_called_once()
        generation_release.assert_called_once()
        self.assertIsNotNone(runtime.active_runtime())

    def test_readonly_cannot_install(self):
        def readonly():
            raise HTTPException(403, "read only")

        app = FastAPI()
        runtime.mount_runtime_routes(app, "/api", lambda: None, readonly)
        with TestClient(app) as client:
            self.assertEqual(
                client.post("/api/ai-runtime/install", json={"variant": "cpu"}).status_code, 403
            )

    def test_pip_uses_managed_python_and_hidden_window(self):
        with (
            patch.object(runtime.subprocess, "Popen") as popen,
            patch.object(runtime, "process_options", return_value={}),
        ):
            popen.return_value.returncode = 0
            runtime.run_pip(self.root, ["check"])
            self.assertEqual(
                popen.call_args.args[0], [str(self.root / "python.exe"), "-I", "-m", "pip", "check"]
            )


if __name__ == "__main__":
    unittest.main()
