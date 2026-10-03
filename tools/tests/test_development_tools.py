"""Regression checks for packaging paths and the development-data deletion boundary."""

import json
import tempfile
import unittest
from pathlib import Path

from tools.maintenance.reset_development_data import MANAGED_DIRECTORIES, reset_targets
from tools.packaging.build_backend import ROOT, build_command


class DevelopmentDataTests(unittest.TestCase):
    def test_relocated_or_pending_storage_cannot_be_reset(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            data = root / ".local"
            data.mkdir()
            for state in (
                {"version": 1, "directory": str(root / "custom")},
                {"version": 1, "directory": str(data), "pending_directory": str(root / "custom")},
            ):
                (data / "storage.json").write_text(json.dumps(state), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "reset refused"):
                    reset_targets(root)

    def test_only_managed_subdirectories_are_selected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            for name in ("test_data", "models", ".git", ".local/build"):
                (root / name).mkdir(parents=True)
            targets = reset_targets(root)
            self.assertEqual([path.name for path in targets], list(MANAGED_DIRECTORIES))
            self.assertTrue(all(path.parent == root / ".local" for path in targets))
            self.assertNotIn(root / ".local/build", targets)

    def test_existing_file_is_not_treated_as_a_managed_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            (root / ".local").mkdir()
            (root / ".local/db").write_text("not a directory", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "not a directory"):
                reset_targets(root)

    def test_redirected_managed_directory_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            (root / ".local").mkdir()
            (root / "original-media").mkdir()
            try:
                (root / ".local/project-data").symlink_to(
                    root / "original-media", target_is_directory=True
                )
            except OSError as error:
                self.skipTest(f"Symlinks unavailable on this host: {error}")
            with self.assertRaisesRegex(ValueError, "redirected"):
                reset_targets(root)


class PackagingTests(unittest.TestCase):
    def test_both_packagers_embed_the_frontend_at_the_same_path(self):
        for packager in ("nuitka", "pyinstaller"):
            with self.subTest(packager=packager):
                command = build_command(packager, False, ROOT / ".local/build/test")
                self.assertTrue(any(str(ROOT / "frontend/dist") in item for item in command))
                self.assertTrue(any(item.endswith("frontend/dist") for item in command))
                self.assertEqual(command[-1], str(ROOT / "tools/packaging/backend_entry.py"))
                self.assertNotIn("--include-package=torch", command)
                self.assertFalse(any("imageio" in item for item in command))
                if packager == "pyinstaller":
                    self.assertEqual(command[command.index("torch") - 1], "--exclude-module")
                    self.assertEqual(command[command.index("hnswlib") - 1], "--exclude-module")
                else:
                    self.assertIn("--nofollow-import-to=hnswlib", command)

    def test_hnsw_acceleration_is_an_explicit_packaging_option(self):
        command = build_command("pyinstaller", False, ROOT / ".local/build/test", True)
        self.assertEqual(command[command.index("hnswlib") - 1], "--collect-all")
        command = build_command("nuitka", False, ROOT / ".local/build/test", True)
        self.assertIn("--include-module=hnswlib", command)
        self.assertNotIn("--nofollow-import-to=hnswlib", command)


if __name__ == "__main__":
    unittest.main()
