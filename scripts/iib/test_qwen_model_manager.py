"""Model selection and installation without downloading weights."""

import os
import sqlite3
import tempfile
import unittest
from functools import partial
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from scripts.iib import qwen_model_manager as manager
from scripts.iib.db.datamodel import DataBase, GlobalSetting
from scripts.iib.network_proxy import ProxySettingsRequest, save_proxy_settings


class QwenModelManagerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        # TestClient routes run on worker threads; share one test-only connection
        # so teardown can close it before Windows removes the temporary database.
        db_scope = patch.multiple(DataBase, path=str(Path(self.temp.name) / "test.db"), local=SimpleNamespace())
        db_scope.start()
        self.addCleanup(db_scope.stop)
        connect_scope = patch("scripts.iib.db.datamodel.connect", new=partial(sqlite3.connect, check_same_thread=False))
        connect_scope.start()
        self.addCleanup(connect_scope.stop)
        self.addCleanup(self.close_test_db)
        self.root = Path(self.temp.name) / "models"
        self.env = patch.dict(os.environ, {"IIB_MODEL_DIR": str(self.root)})
        self.env.start()
        self.addCleanup(self.env.stop)
        DataBase.get_conn()
        manager._job.update(running=False, kind="", size="", stage="", error="")
        app = FastAPI()
        manager.mount_qwen_model_manager_routes(app, "/db", lambda: None, lambda: None)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def close_test_db(self):
        if hasattr(DataBase.local, "conn"):
            DataBase.local.conn.close()
            del DataBase.local.conn

    def fake_model(self, kind, size):
        path = manager.managed_path(kind, size)
        path.mkdir(parents=True)
        required = manager.instruct.MODEL_FILES if kind == "instruct" else manager.search.MODEL_FILES[kind]
        for name in required:
            target = path / name
            target.parent.mkdir(exist_ok=True)
            target.touch()
        (path / "model.safetensors").touch()
        return path

    def test_select_installed_8b_and_missing_model(self):
        missing = self.client.post("/db/qwen-models/select", json={"kind": "embedding", "size": "8B"})
        self.assertEqual(missing.status_code, 404)
        path = self.fake_model("embedding", "8B")
        listing = self.client.get("/db/qwen-models")
        self.assertEqual(listing.status_code, 200, listing.text)
        self.assertTrue(listing.json()["models"]["embedding"][1]["installed"])
        selected = self.client.post("/db/qwen-models/select", json={"kind": "embedding", "size": "8B"})
        self.assertEqual(selected.status_code, 200, selected.text)
        self.assertTrue(selected.json()["models"]["embedding"][1]["active"])
        self.assertEqual(GlobalSetting.get_setting(DataBase.get_conn(), manager.search.SETTING_KEYS["embedding"]), str(path))

    def test_download_uses_persistent_directory_and_activates_only_when_complete(self):
        path = manager.managed_path("instruct", "2B")

        def download(**kwargs):
            self.assertEqual(kwargs["repo_id"], "Qwen/Qwen3-VL-2B-Instruct")
            self.assertEqual(kwargs["local_dir"], str(path))
            self.fake_model("instruct", "2B")

        with patch("huggingface_hub.snapshot_download", side_effect=download), \
             patch.object(manager, "is_exe_ver", True):
            manager._download("instruct", "2B", path)
        self.assertFalse(manager._job["running"])
        self.assertEqual(manager._job["stage"], "安装完成")
        self.assertEqual(GlobalSetting.get_setting(DataBase.get_conn(), manager.instruct.SETTING_KEY), str(path))
        self.assertTrue(path.is_relative_to(self.root))

    def test_download_uses_isolated_proxy_environment(self):
        save_proxy_settings(ProxySettingsRequest(enabled=True, url="http://127.0.0.1:7890"))
        path = manager.managed_path("instruct", "2B")

        def download(*args, **kwargs):
            self.assertEqual(args[0][1], str(Path(manager.__file__).with_name("qwen_download_worker.py")))
            self.assertEqual(kwargs["env"]["HTTPS_PROXY"], "http://127.0.0.1:7890")
            self.fake_model("instruct", "2B")
            return SimpleNamespace(returncode=0, stderr="")

        with patch.object(manager.subprocess, "run", side_effect=download):
            manager._download("instruct", "2B", path)
        self.assertEqual(manager._job["stage"], "安装完成")


if __name__ == "__main__":
    unittest.main()
