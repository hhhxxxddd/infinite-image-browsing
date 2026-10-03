"""Migration preserves content and references across real restart boundaries."""

import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from omnigallery.storage import migration
from omnigallery.storage.layout import DIRECTORIES, ApplicationStorage, write_json


class ApplicationStorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.default = self.base / "original"
        self.target = self.base / "destination"

    def storage(self, **legacy):
        value = ApplicationStorage(self.default, legacy)
        self.addCleanup(value.close)
        return value

    def database(self, path=None):
        path = path or self.default / "db/omnigallery.db"
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(path)
        conn.execute("CREATE TABLE global_setting (name TEXT PRIMARY KEY, setting_json TEXT)")
        conn.execute("CREATE TABLE workspace_state (workspace_id TEXT, key TEXT, value TEXT)")
        conn.execute("CREATE TABLE media (id INTEGER PRIMARY KEY, path TEXT, description TEXT)")
        conn.commit()
        self.addCleanup(conn.close)
        return conn

    def test_all_children_move_and_database_references_follow_on_restart(self):
        store = self.storage()
        conn = self.database()
        model = self.default / "models/Qwen/model.gguf"
        original_media = self.base / "photos/original.jpg"
        with conn:
            conn.execute(
                "INSERT INTO global_setting VALUES (?, ?)",
                ("qwen3_vl_instruct_path", json.dumps(str(model))),
            )
            conn.execute(
                "INSERT INTO workspace_state VALUES ('w', 'draft', ?)",
                (
                    json.dumps(
                        {
                            "path": str(self.default / "project-data/a.png"),
                            "reference": str(original_media),
                        }
                    ),
                ),
            )
            conn.execute(
                "INSERT INTO media VALUES (1, ?, ?)",
                (str(self.default / "exports/a.png"), "retain my description"),
            )
        conn.close()
        for name in DIRECTORIES:
            path = self.default / name / "keep.bin"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes((name + " content").encode())
        record = self.default / "project-data/record.json"
        write_json(record, {"path": str(self.default / "project-data/a.png")})
        store.prepare()
        result = store.schedule(str(self.target))
        self.assertTrue(result["restart_required"])
        self.assertEqual(store.root, self.default)
        self.assertFalse((self.target / "models").exists())
        store.close()
        restarted = self.storage()
        restarted.prepare()
        self.assertEqual(restarted.root, self.target)
        self.assertFalse(restarted.settings()["restart_required"])
        for name in DIRECTORIES:
            self.assertEqual(
                (self.target / name / "keep.bin").read_bytes(),
                (self.default / name / "keep.bin").read_bytes(),
            )
        with closing(sqlite3.connect(self.target / "db/omnigallery.db")) as db:
            self.assertEqual(
                json.loads(db.execute("SELECT setting_json FROM global_setting").fetchone()[0]),
                str(self.target / "models/Qwen/model.gguf"),
            )
            doc = json.loads(db.execute("SELECT value FROM workspace_state").fetchone()[0])
            self.assertEqual(doc["path"], str(self.target / "project-data/a.png"))
            self.assertEqual(doc["reference"], str(original_media))
            self.assertEqual(
                db.execute("SELECT path, description FROM media").fetchone(),
                (str(self.target / "exports/a.png"), "retain my description"),
            )
        self.assertEqual(
            json.loads((self.target / "project-data/record.json").read_text())["path"],
            str(self.target / "project-data/a.png"),
        )

    def test_failure_keeps_original_active_and_allows_cancellation(self):
        store = self.storage()
        store.prepare()
        path = self.default / "models/model.bin"
        path.parent.mkdir()
        path.write_bytes(b"precious")
        store.schedule(str(self.target))
        store.close()
        restarted = self.storage()
        with patch.object(migration, "_copy", side_effect=OSError("disk full")):
            restarted.prepare()
        self.assertEqual(restarted.root, self.default)
        self.assertIn("disk full", restarted.settings()["error"])
        self.assertEqual(path.read_bytes(), b"precious")
        self.assertFalse((self.target / "models").exists())
        restarted.schedule(str(self.default))
        self.assertFalse(restarted.settings()["restart_required"])
        self.assertEqual(restarted.settings()["error"], "")

    def test_interrupted_publication_is_retried_using_its_owned_marker(self):
        store = self.storage()
        store.prepare()
        path = self.default / "templates/template.json"
        path.parent.mkdir()
        path.write_text('{"name":"saved"}')
        store.schedule(str(self.target))
        write_json(
            self.target / ".storage-migration.json",
            {"source": str(self.default), "id": store.state["pending_id"]},
        )
        (self.target / ".storage-migration").mkdir()
        (self.target / "templates").mkdir()
        (self.target / "templates/template.json").write_text("partial copy")
        store.close()
        restarted = self.storage()
        restarted.prepare()
        self.assertEqual(restarted.root, self.target)
        self.assertEqual((self.target / "templates/template.json").read_text(), '{"name":"saved"}')

    def test_target_changed_after_scheduling_is_not_overwritten(self):
        store = self.storage()
        store.prepare()
        store.schedule(str(self.target))
        (self.target / "user.txt").write_text("mine")
        store.close()
        restarted = self.storage()
        restarted.prepare()
        self.assertEqual(restarted.root, self.default)
        self.assertEqual((self.target / "user.txt").read_text(), "mine")
        self.assertTrue(restarted.settings()["error"])

    def test_legacy_locations_are_imported_once_and_model_choices_remap(self):
        old_db = self.base / "old-db/library.db"
        projects = self.base / "old-projects"
        exports = self.base / "old-exports"
        models = self.base / "old-models"
        conn = self.database(old_db)
        with conn:
            for key, value in (
                ("project_storage", {"directory": str(projects)}),
                ("archive", {"directory": str(exports)}),
                ("qwen3_vl_instruct_path", str(models / "qwen")),
            ):
                conn.execute("INSERT INTO global_setting VALUES (?, ?)", (key, json.dumps(value)))
        conn.close()
        for path in (
            projects / "omnigallery-workspace-artifacts/a.png",
            exports / "omnigallery_archive_a.zip",
            models / "qwen/model.gguf",
        ):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"keep")
        (exports / "unrelated.txt").write_text("personal file")
        store = self.storage(db=str(old_db), models=str(models))
        store.prepare()
        self.assertEqual(
            (self.default / "project-data/omnigallery-workspace-artifacts/a.png").read_bytes(),
            b"keep",
        )
        self.assertTrue((self.default / "exports/omnigallery_archive_a.zip").is_file())
        self.assertFalse((self.default / "exports/unrelated.txt").exists())
        self.assertTrue((models / "qwen/model.gguf").is_file())
        with closing(sqlite3.connect(self.default / "db/omnigallery.db")) as db:
            self.assertEqual(
                db.execute("SELECT name, setting_json FROM global_setting").fetchall(),
                [("qwen3_vl_instruct_path", json.dumps(str(self.default / "models/qwen")))],
            )
        store.close()
        self.storage(db=str(old_db), models=str(models)).prepare()

    def test_paths_reject_relative_nested_occupied_and_redirected_targets(self):
        store = self.storage()
        store.prepare()
        for target in ("relative", str(self.default / "child"), str(self.base), "/invalid\0path"):
            with self.subTest(target=target), self.assertRaises(ValueError):
                store.schedule(target)
        self.target.mkdir()
        (self.target / "owned.txt").touch()
        with self.assertRaises(ValueError):
            store.schedule(str(self.target))

    def test_legacy_upgrade_recovers_after_locator_publication_failure(self):
        old_db = self.base / "legacy/library.db"
        projects = self.base / "legacy/projects"
        projects.mkdir(parents=True)
        write_json(projects / "record.json", {"path": str(projects / "a.png")})
        conn = self.database(old_db)
        with conn:
            conn.execute(
                "INSERT INTO global_setting VALUES ('project_storage', ?)",
                (json.dumps({"directory": str(projects)}),),
            )
        conn.close()
        store = self.storage(db=str(old_db))
        with patch.object(store, "_save", side_effect=OSError("cannot publish locator")):
            with self.assertRaises(OSError):
                store.prepare()
        store.close()
        recovered = self.storage(db=str(old_db))
        recovered.prepare()
        self.assertEqual(
            json.loads((self.default / "project-data/record.json").read_text())["path"],
            str(self.default / "project-data/a.png"),
        )
        self.assertIn(str(old_db), recovered.settings()["backups"])
        self.assertFalse((self.default / ".storage-upgrade.json").exists())
        self.assertTrue(old_db.is_file())

    def test_legacy_upgrade_recovers_after_document_rewrite_failure(self):
        projects = self.base / "legacy/projects"
        projects.mkdir(parents=True)
        write_json(projects / "record.json", {"path": str(projects / "a.png")})
        conn = self.database()
        with conn:
            conn.execute(
                "INSERT INTO global_setting VALUES ('project_storage', ?)",
                (json.dumps({"directory": str(projects)}),),
            )
        conn.close()
        store = self.storage()
        rewrite = migration._remap_documents

        def interrupt(*args):
            rewrite(*args)
            raise OSError("interrupted after rewriting")

        with patch.object(migration, "_remap_documents", side_effect=interrupt):
            with self.assertRaises(OSError):
                store.prepare()
        store.close()
        recovered = self.storage()
        recovered.prepare()
        self.assertTrue((self.default / "db/backups/before-unification.db").is_file())
        self.assertEqual(
            json.loads((self.default / "project-data/record.json").read_text())["path"],
            str(self.default / "project-data/a.png"),
        )

    def test_locator_failure_rolls_back_published_children_and_can_retry(self):
        store = self.storage()
        store.prepare()
        (self.default / "models").mkdir()
        (self.default / "models/model.bin").write_bytes(b"retained")
        store.schedule(str(self.target))
        store.close()
        restarted = self.storage()
        save = restarted._save

        def fail_switch(state):
            if state["directory"] == str(self.target):
                raise OSError("locator unavailable")
            save(state)

        with patch.object(restarted, "_save", side_effect=fail_switch):
            restarted.prepare()
        self.assertEqual(restarted.root, self.default)
        self.assertFalse((self.target / "models").exists())
        restarted.close()
        recovered = self.storage()
        recovered.prepare()
        self.assertEqual(recovered.root, self.target)
        self.assertEqual((self.target / "models/model.bin").read_bytes(), b"retained")

    def test_installed_runtime_pointers_resolve_from_new_root(self):
        from omnigallery.ai.models import desktop_runtime, gguf_runtime
        from omnigallery.infrastructure import media_runtime

        store = self.storage()
        store.prepare()
        version = "a" * 32
        for name, binary in (
            ("ai-runtime", "python.exe"),
            ("gguf-runtime", "bin/llama-server.exe"),
            ("media-runtime", "bin/ffmpeg.exe"),
        ):
            folder = self.default / name
            write_json(folder / "active.json", {"directory": version})
            executable = folder / version / binary
            executable.parent.mkdir(parents=True, exist_ok=True)
            executable.write_bytes(b"test binary")
        store.schedule(str(self.target))
        store.close()
        restarted = self.storage()
        restarted.prepare()
        for module, name in (
            (desktop_runtime, "ai-runtime"),
            (gguf_runtime, "gguf-runtime"),
            (media_runtime, "media-runtime"),
        ):
            with patch.object(module, "RUNTIME_ROOT", self.target / name):
                self.assertEqual(module.active_runtime(), self.target / name / version)

    def test_cleanup_failure_after_commit_does_not_report_a_rollback(self):
        store = self.storage()
        store.prepare()
        store.schedule(str(self.target))
        store.close()
        restarted = self.storage()
        with patch.object(migration, "_remove_owned", side_effect=OSError("cleanup unavailable")):
            restarted.prepare()
        self.assertEqual(restarted.root, self.target)
        self.assertFalse(restarted.settings()["restart_required"])
        self.assertFalse(restarted.settings()["error"])
        self.assertEqual(json.loads(store.locator.read_text())["directory"], str(self.target))

    def test_duplicate_process_cannot_migrate_an_active_root(self):
        store = self.storage()
        store.prepare()
        another = self.storage()
        with self.assertRaises(OSError):
            another.prepare()

    def test_invalid_locator_never_falls_back_to_an_unrelated_directory(self):
        for path in ("", "relative", None, []):
            write_json(self.default / "storage.json", {"version": 1, "directory": path})
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.storage()

    def test_failed_verification_does_not_switch_locator(self):
        store = self.storage()
        store.prepare()
        path = self.default / "templates/a.bin"
        path.parent.mkdir()
        path.write_bytes(b"intact")
        store.schedule(str(self.target))
        store.close()
        restarted = self.storage()
        with patch.object(migration, "digest", side_effect=[b"original", b"different"]):
            restarted.prepare()
        self.assertEqual(restarted.root, self.default)
        self.assertEqual(json.loads(store.locator.read_text())["directory"], str(self.default))

    def test_bootstrap_runs_before_config_database_and_runtime_imports(self):
        store = self.storage()
        store.prepare()
        store.schedule(str(self.target))
        store.close()
        environment = os.environ.copy()
        environment["OMNIGALLERY_DATA_DIR"] = str(self.default)
        for key in (
            "OMNIGALLERY_DB_PATH",
            "OMNIGALLERY_CACHE_DIR",
            "OMNIGALLERY_PROJECT_DATA_DIR",
            "OMNIGALLERY_MODEL_DIR",
        ):
            environment[key] = ""
        code = """
from pathlib import Path
from contextlib import closing
from omnigallery.server import create_app
app = create_app()
from omnigallery.config import DATA_ROOT, DATABASE_PATH, CACHE_ROOT, PROJECT_DATA_ROOT, get_model_root
from omnigallery.infrastructure.database import Database
from omnigallery.ai.models import desktop_runtime, gguf_runtime
from omnigallery.infrastructure import media_runtime
import sys
root = Path(sys.argv[1])
assert DATA_ROOT == root
assert Path(Database.path) == root / 'db/omnigallery.db'
for path in (DATABASE_PATH, CACHE_ROOT, PROJECT_DATA_ROOT, get_model_root(), desktop_runtime.RUNTIME_ROOT, gguf_runtime.RUNTIME_ROOT, media_runtime.RUNTIME_ROOT):
    assert root in path.parents, path
"""
        result = subprocess.run(
            [sys.executable, "-X", "utf8", "-c", code, str(self.target)],
            env=environment,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=45,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
