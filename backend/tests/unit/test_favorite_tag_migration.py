import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.tests.support.database import isolate_database
from omnigallery.infrastructure.auth import verify_secret, write_permission_required
from omnigallery.infrastructure.database import Database
from omnigallery.library.tag_repository import MediaTag, Tag
from omnigallery.library.tag_routes import mount_routes
from omnigallery.storage.settings_repository import SettingsRepository


class FavoriteTagMigrationTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.addCleanup(self.conn.close)
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.execute("CREATE TABLE media (id INTEGER PRIMARY KEY)")
        self.conn.executemany("INSERT INTO media VALUES (?)", [(1,), (2,)])
        Tag.create_table(self.conn)
        MediaTag.create_table(self.conn)
        SettingsRepository.create_table(self.conn)
        self.conn.execute(
            "CREATE TABLE workspace_artifact_tag (artifact_id TEXT, tag_id INTEGER, "
            "PRIMARY KEY (artifact_id, tag_id))"
        )
        self.favorite_id = self.conn.execute("SELECT id FROM tag WHERE name = '喜欢'").fetchone()[0]
        self.conn.execute(
            "UPDATE tag SET name = 'like', color = '#356cb6', group_name = '收藏' WHERE id = ?",
            (self.favorite_id,),
        )
        self.conn.execute("INSERT INTO media_tag VALUES (1, ?, '2026-01-01')", (self.favorite_id,))
        self.conn.execute(
            "INSERT INTO workspace_artifact_tag VALUES ('one', ?)", (self.favorite_id,)
        )
        SettingsRepository.save_setting(
            self.conn,
            "auto_tag_rules",
            json.dumps([{"tag": "like", "filters": [{"value": "like", "field": "pos_prompt"}]}]),
        )
        self.conn.commit()

    def test_rename_preserves_id_color_group_links_and_rule_conditions(self):
        Tag.create_table(self.conn)
        Tag.create_table(self.conn)
        favorite = Tag.get(self.conn, self.favorite_id)
        self.assertEqual(
            (favorite.name, favorite.color, favorite.group_name), ("喜欢", "#356cb6", "收藏")
        )
        self.assertIsNone(favorite.display_name)
        self.assertEqual(
            self.conn.execute("SELECT tag_id FROM media_tag").fetchall(), [(self.favorite_id,)]
        )
        self.assertEqual(
            self.conn.execute("SELECT tag_id FROM workspace_artifact_tag").fetchall(),
            [(self.favorite_id,)],
        )
        self.assertEqual(
            SettingsRepository.get_setting(self.conn, "auto_tag_rules"),
            [{"tag": "喜欢", "filters": [{"value": "like", "field": "pos_prompt"}]}],
        )
        self.assertEqual(Tag.get_or_create(self.conn, "like", "custom").id, self.favorite_id)
        self.assertEqual(
            self.conn.execute("SELECT count(*) FROM tag WHERE type = 'custom'").fetchone()[0], 1
        )

    def add_duplicate(self):
        self.conn.execute("INSERT INTO tag (name, type) VALUES ('喜欢', 'custom')")
        duplicate = self.conn.execute("SELECT id FROM tag WHERE name = '喜欢'").fetchone()[0]
        self.conn.executemany(
            "INSERT INTO media_tag VALUES (?, ?, '2026-02-01')", [(1, duplicate), (2, duplicate)]
        )
        self.conn.executemany(
            "INSERT INTO workspace_artifact_tag VALUES (?, ?)",
            [("one", duplicate), ("two", duplicate)],
        )
        self.conn.commit()
        return duplicate

    def test_existing_chinese_tag_merges_media_and_workspace_links_without_replacing_builtin_id(
        self,
    ):
        duplicate = self.add_duplicate()
        self.conn.execute("INSERT INTO tag (name, type) VALUES ('like', 'pos')")
        Tag.create_table(self.conn)
        self.assertIsNone(Tag.get(self.conn, duplicate))
        self.assertEqual(
            self.conn.execute(
                "SELECT media_id, tag_id, created_at FROM media_tag ORDER BY media_id"
            ).fetchall(),
            [(1, self.favorite_id, "2026-01-01"), (2, self.favorite_id, "2026-02-01")],
        )
        self.assertEqual(
            self.conn.execute(
                "SELECT * FROM workspace_artifact_tag ORDER BY artifact_id"
            ).fetchall(),
            [("one", self.favorite_id), ("two", self.favorite_id)],
        )
        self.assertEqual(Tag.get(self.conn, self.favorite_id).count, 2)
        self.assertEqual(
            self.conn.execute("SELECT name FROM tag WHERE type = 'pos'").fetchone()[0], "like"
        )

    def test_failed_migration_rolls_back_merge_and_keeps_callers_pending_transaction(self):
        duplicate = self.add_duplicate()
        self.conn.execute(
            "CREATE TRIGGER reject_favorite BEFORE UPDATE OF name ON tag "
            "BEGIN SELECT RAISE(ABORT, 'rename failed'); END"
        )
        self.conn.execute("UPDATE tag SET color = '#28795c' WHERE id = ?", (self.favorite_id,))
        with self.assertRaisesRegex(sqlite3.IntegrityError, "rename failed"):
            Tag.migrate_favorite_tag(self.conn)
        self.assertTrue(self.conn.in_transaction)
        self.assertEqual(
            self.conn.execute(
                "SELECT name, color FROM tag WHERE id = ?", (self.favorite_id,)
            ).fetchone(),
            ("like", "#28795c"),
        )
        self.assertIsNotNone(Tag.get(self.conn, duplicate))
        self.assertEqual(self.conn.execute("SELECT count(*) FROM media_tag").fetchone()[0], 3)
        self.assertEqual(
            self.conn.execute("SELECT count(*) FROM workspace_artifact_tag").fetchone()[0], 3
        )
        self.assertEqual(
            SettingsRepository.get_setting(self.conn, "auto_tag_rules")[0]["tag"], "like"
        )

    def test_database_initialization_persists_migration_and_new_databases_use_chinese_name(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "library.db"
            with patch.object(Database, "path", str(path)):
                with closing(Database.initialize()) as conn:
                    favorite = Tag.get_or_create(conn, "喜欢", "custom")
                    self.assertEqual(conn.execute("SELECT name FROM tag").fetchall(), [("喜欢",)])
                    conn.execute("UPDATE tag SET name = 'like' WHERE id = ?", (favorite.id,))
                    conn.commit()
                with closing(Database.initialize()) as conn:
                    self.assertEqual(Tag.get(conn, favorite.id).name, "喜欢")
                with closing(sqlite3.connect(path)) as conn:
                    self.assertEqual(
                        conn.execute("SELECT id, name FROM tag").fetchall(), [(favorite.id, "喜欢")]
                    )


class FavoriteTagApiTests(unittest.TestCase):
    def test_builtin_delete_is_rejected_without_removing_media_links(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        isolate_database(self, Path(directory.name) / "library.db")
        conn = Database.get_connection()
        favorite = Tag.get_or_create(conn, "喜欢", "custom")
        MediaTag(1, favorite.id).save(conn)
        conn.commit()
        app = FastAPI()
        app.dependency_overrides[verify_secret] = lambda: None
        app.dependency_overrides[write_permission_required] = lambda: None
        mount_routes(
            app,
            SimpleNamespace(
                api_base="/api",
                update_extra_paths=lambda conn: None,
                is_path_under_parents=lambda path: True,
            ),
        )
        client = TestClient(app)
        self.addCleanup(client.close)
        response = client.post("/api/remove_custom_tag", json={"tag_id": favorite.id})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Tag.get(conn, favorite.id).name, "喜欢")
        self.assertEqual([tag.id for tag in MediaTag.get_tags_for_image(conn, 1)], [favorite.id])
