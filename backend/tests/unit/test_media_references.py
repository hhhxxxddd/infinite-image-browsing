import json
import os
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from omnigallery.library.media_references import rename_media_file, resolve_media_paths


class MediaReferencesTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.source = os.path.join(self.directory.name, "old.png")
        self.target = os.path.join(self.directory.name, "new.png")
        with open(self.source, "wb") as file:
            file.write(b"image")
        self.conn = sqlite3.connect(":memory:")
        self.addCleanup(self.conn.close)
        self.conn.executescript(
            "CREATE TABLE media (id INTEGER PRIMARY KEY, path TEXT); "
            "CREATE TABLE global_setting (name TEXT PRIMARY KEY, setting_json TEXT);"
        )
        self.conn.execute("INSERT INTO media VALUES (13, ?)", (self.source,))
        asset = {"id": 13, "path": self.source, "name": "old.png", "kind": "image"}
        self.projects = {
            "version": 2,
            "items": [{"id": "workspace", "assets": [asset], "outputs": [asset]}],
        }
        self.conn.execute(
            "INSERT INTO global_setting VALUES (?, ?)",
            ("workbench_projects", json.dumps(self.projects)),
        )
        self.conn.commit()

    def test_rename_preserves_id_and_updates_both_reference_roles(self):
        self.assertEqual(rename_media_file(self.conn, self.source, "new.png"), self.target)
        self.assertFalse(os.path.exists(self.source))
        self.assertTrue(os.path.isfile(self.target))
        self.assertEqual(
            self.conn.execute("SELECT id, path FROM media").fetchone(), (13, self.target)
        )
        saved = json.loads(
            self.conn.execute("SELECT setting_json FROM global_setting").fetchone()[0]
        )
        for role in ("assets", "outputs"):
            self.assertEqual(saved["items"][0][role][0]["path"], self.target)
            self.assertEqual(saved["items"][0][role][0]["name"], "new.png")

    def assert_unchanged(self):
        self.assertTrue(os.path.isfile(self.source))
        self.assertFalse(os.path.exists(self.target))
        self.assertEqual(self.conn.execute("SELECT path FROM media").fetchone()[0], self.source)
        self.assertEqual(
            json.loads(self.conn.execute("SELECT setting_json FROM global_setting").fetchone()[0]),
            self.projects,
        )

    def test_filesystem_failure_leaves_index_unchanged(self):
        with (
            patch("omnigallery.library.media_references.os.rename", side_effect=PermissionError),
            self.assertRaises(PermissionError),
        ):
            rename_media_file(self.conn, self.source, "new.png")
        self.assert_unchanged()

    def test_database_failure_rolls_back_file_and_index(self):
        self.conn.execute(
            "CREATE TRIGGER reject_update BEFORE UPDATE ON global_setting "
            "BEGIN SELECT RAISE(ABORT, 'blocked'); END"
        )
        with self.assertRaises(sqlite3.IntegrityError):
            rename_media_file(self.conn, self.source, "new.png")
        self.assert_unchanged()

    def test_rejects_directory_traversal(self):
        for name in ("../new.png", "..\\new.png", "C:new.png", "", ".."):
            with self.assertRaises(ValueError):
                rename_media_file(self.conn, self.source, name)
        self.assert_unchanged()

    def test_resolver_uses_id_and_filters_untrusted_paths(self):
        rename_media_file(self.conn, self.source, "new.png")
        self.assertEqual(
            resolve_media_paths(self.conn, [13, 999], lambda path: True),
            [{"id": 13, "path": self.target, "name": "new.png"}],
        )
        self.assertEqual(resolve_media_paths(self.conn, [13], lambda path: False), [])
        self.assertEqual(resolve_media_paths(self.conn, [], lambda path: True), [])

    def test_existing_destination_is_not_overwritten(self):
        with open(self.target, "wb") as file:
            file.write(b"keep")
        with self.assertRaises(FileExistsError):
            rename_media_file(self.conn, self.source, "new.png")
        with open(self.target, "rb") as file:
            self.assertEqual(file.read(), b"keep")
