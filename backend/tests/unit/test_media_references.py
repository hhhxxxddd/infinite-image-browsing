import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from omnigallery.library.media_references import (
    media_image_task_identity,
    rename_media_file,
    resolve_media_paths,
)


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
        identity = media_image_task_identity(self.conn, self.source)
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
        self.assertEqual(media_image_task_identity(self.conn, self.target), identity)
        again = rename_media_file(self.conn, self.target, "again.png")
        self.assertEqual(media_image_task_identity(self.conn, again), identity)

    def test_directory_only_image_keeps_task_identity_when_later_indexed(self):
        self.conn.execute("DELETE FROM media")
        self.conn.commit()
        identity = media_image_task_identity(self.conn, self.source)
        rename_media_file(self.conn, self.source, "new.png")
        Path(self.source).write_bytes(b"different image")
        replacement = media_image_task_identity(self.conn, self.source)
        self.assertNotEqual(replacement["document_key"], identity["document_key"])
        self.conn.execute("INSERT INTO media VALUES (28, ?)", (self.source,))
        self.conn.execute("INSERT INTO media VALUES (27, ?)", (self.target,))
        self.conn.commit()
        self.assertEqual(media_image_task_identity(self.conn, self.source), replacement)
        self.assertEqual(media_image_task_identity(self.conn, self.target), identity)
        again = rename_media_file(self.conn, self.target, "again.png")
        self.assertEqual(media_image_task_identity(self.conn, again), identity)
        path_values = self.conn.execute(
            "SELECT setting_json FROM global_setting WHERE name LIKE 'image_editor_identity:path:%'"
        ).fetchall()
        self.assertEqual([json.loads(row[0]) for row in path_values], [replacement])

    def test_reused_indexed_path_and_corrupt_metadata_do_not_inherit_moved_tasks(self):
        identity = media_image_task_identity(self.conn, self.source)
        rename_media_file(self.conn, self.source, "new.png")
        Path(self.source).write_bytes(b"different image")
        self.conn.execute("INSERT INTO media VALUES (14, ?)", (self.source,))
        self.conn.commit()
        replacement = media_image_task_identity(self.conn, self.source)
        self.assertNotEqual(replacement["document_key"], identity["document_key"])
        another = rename_media_file(self.conn, self.source, "replacement.png")
        self.assertEqual(media_image_task_identity(self.conn, another), replacement)
        self.assertEqual(media_image_task_identity(self.conn, self.target), identity)
        for malformed in ("invalid json", "null", '{"source_path":42}'):
            self.conn.execute(
                "UPDATE global_setting SET setting_json = ? WHERE name = 'image_editor_identity:media:14'",
                (malformed,),
            )
            self.assertEqual(media_image_task_identity(self.conn, another)["source_path"], another)
        final = rename_media_file(self.conn, another, "final.avif")
        self.assertEqual(media_image_task_identity(self.conn, final)["source_path"], another)
        last = rename_media_file(self.conn, final, "last.png")
        self.assertEqual(media_image_task_identity(self.conn, last)["source_path"], another)

    def assert_unchanged(self):
        self.assertTrue(os.path.isfile(self.source))
        self.assertFalse(os.path.exists(self.target))
        self.assertEqual(self.conn.execute("SELECT path FROM media").fetchone()[0], self.source)
        self.assertEqual(
            json.loads(self.conn.execute("SELECT setting_json FROM global_setting").fetchone()[0]),
            self.projects,
        )
        self.assertEqual(
            self.conn.execute(
                "SELECT COUNT(*) FROM global_setting WHERE name LIKE 'image_editor_identity:%'"
            ).fetchone()[0],
            0,
        )

    def test_filesystem_failure_leaves_index_unchanged(self):
        with (
            patch(
                "omnigallery.library.media_references.move_file_exclusive",
                side_effect=PermissionError,
            ),
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

    def test_rename_moves_sidecar_and_retains_it_on_extension_only_change(self):
        source_text = Path(self.source).with_suffix(".txt")
        source_text.write_text("generation metadata", encoding="utf-8")
        rename_media_file(self.conn, self.source, "new.png")
        target_text = Path(self.target).with_suffix(".txt")
        self.assertFalse(source_text.exists())
        self.assertEqual(target_text.read_text("utf-8"), "generation metadata")
        rename_media_file(self.conn, self.target, "new.jpg")
        self.assertEqual(target_text.read_text("utf-8"), "generation metadata")

    def test_sidecar_collision_preserves_both_files(self):
        source_text = Path(self.source).with_suffix(".txt")
        target_text = Path(self.target).with_suffix(".txt")
        source_text.write_text("source", encoding="utf-8")
        target_text.write_text("existing", encoding="utf-8")
        with self.assertRaises(FileExistsError):
            rename_media_file(self.conn, self.source, "new.png")
        self.assert_unchanged()
        self.assertEqual(source_text.read_text("utf-8"), "source")
        self.assertEqual(target_text.read_text("utf-8"), "existing")

    def test_database_failure_restores_media_and_sidecar(self):
        source_text = Path(self.source).with_suffix(".txt")
        source_text.write_text("source", encoding="utf-8")
        self.conn.execute(
            "CREATE TRIGGER reject_update BEFORE UPDATE ON global_setting "
            "BEGIN SELECT RAISE(ABORT, 'blocked'); END"
        )
        with self.assertRaises(sqlite3.IntegrityError):
            rename_media_file(self.conn, self.source, "new.png")
        self.assert_unchanged()
        self.assertEqual(source_text.read_text("utf-8"), "source")
        self.assertFalse(Path(self.target).with_suffix(".txt").exists())
