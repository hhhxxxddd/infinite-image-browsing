import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from omnigallery.infrastructure.database import Database
from omnigallery.workspaces.state import (
    create_workspace_state_tables,
    mount_workspace_state_routes,
    remap_workspace_state,
    update_artifact_references,
)


class WorkspaceStateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "drafts.db"
        self.conn = sqlite3.connect(self.path, check_same_thread=False)
        self.addCleanup(self.conn.close)
        create_workspace_state_tables(self.conn)
        self.conn.commit()
        self.connection = patch.object(Database, "get_connection", return_value=self.conn)
        self.connection.start()
        self.addCleanup(self.connection.stop)
        self.readonly = False

        def write():
            if self.readonly:
                raise HTTPException(403, "readonly")

        app = FastAPI()
        mount_workspace_state_routes(app, "/api", lambda: None, write)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.base = "/api/workspace_state/workspace"
        self.work = "omnigallery:workspace-works-v2:workspace"
        self.doc = "omnigallery:workbench-image-document-v2:workspace:draft"
        self.ai = "omnigallery:ai-image-edit-v1:workspace:work:ai-draft:image.png"

    def test_import_once_and_restore_from_another_database_connection(self):
        entries = {
            self.work: '{"version":2,"works":[]}',
            self.doc: '{"layers":[{"kind":"text","text":"正文"}]}',
            self.ai: '{"layers":[]}',
        }
        saved = self.client.post(self.base + "/import", json={"entries": entries})
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()["entries"], entries)
        self.assertTrue(saved.json()["imported"])
        other_browser = self.client.post(
            self.base + "/import", json={"entries": {self.work: "stale"}}
        )
        self.assertEqual(other_browser.json()["entries"], entries)
        with closing(sqlite3.connect(self.path)) as independent:
            self.assertEqual(
                dict(independent.execute("SELECT key,value FROM workspace_state")), entries
            )

    def test_atomic_revision_conflict_never_splits_index_document_and_associations(self):
        revision = self.client.post(
            self.base + "/import", json={"entries": {self.work: "old"}}
        ).json()["revision"]
        changes = {self.work: "new", self.doc: "canvas", self.ai: "ai"}
        saved = self.client.patch(self.base, json={"revision": revision, "changes": changes})
        self.assertEqual(saved.status_code, 200, saved.text)
        stale = self.client.patch(
            self.base, json={"revision": revision, "changes": {self.work: "stale", self.doc: None}}
        )
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(self.client.get(self.base).json()["entries"], changes)

        # Force a failure after the work update; SQLite must roll the entire request back.
        self.conn.execute(
            f"CREATE TRIGGER fail_doc BEFORE UPDATE ON workspace_state WHEN NEW.key='{self.doc}' BEGIN SELECT RAISE(ABORT,'disk error'); END"
        )
        self.conn.commit()
        with self.assertRaises(sqlite3.IntegrityError):
            self.client.patch(
                self.base,
                json={
                    "revision": saved.json()["revision"],
                    "changes": {self.work: "partial", self.doc: "broken"},
                },
            )
        self.assertEqual(self.client.get(self.base).json()["entries"], changes)

    def test_empty_browser_does_not_prevent_later_legacy_migration(self):
        empty = self.client.post(self.base + "/import", json={"entries": {}})
        self.assertEqual(empty.status_code, 200)
        self.assertFalse(empty.json()["imported"])
        entries = {self.work: "legacy work", self.doc: "legacy canvas"}
        migrated = self.client.post(self.base + "/import", json={"entries": entries})
        self.assertEqual(migrated.status_code, 200)
        self.assertTrue(migrated.json()["imported"])
        self.assertEqual(migrated.json()["entries"], entries)

    def test_readonly_and_workspace_boundaries(self):
        self.readonly = True
        self.assertEqual(self.client.get(self.base).status_code, 200)
        self.assertEqual(
            self.client.post(self.base + "/import", json={"entries": {}}).status_code, 403
        )
        self.assertEqual(
            self.client.patch(self.base, json={"revision": 0, "changes": {}}).status_code, 403
        )
        self.assertEqual(self.client.delete(self.base).status_code, 403)
        self.readonly = False
        invalid = self.client.post(
            self.base + "/import", json={"entries": {self.work + "-other": "unrelated"}}
        )
        self.assertEqual(invalid.status_code, 422)
        self.assertFalse(self.client.get(self.base).json()["imported"])

    def test_delete_blocks_old_editor_and_browser_backup_resurrection(self):
        self.client.post(self.base + "/import", json={"entries": {self.work: "work"}})
        self.assertEqual(self.client.delete(self.base).status_code, 200)
        self.assertEqual(self.client.get(self.base).status_code, 404)
        self.assertEqual(
            self.client.post(
                self.base + "/import", json={"entries": {self.work: "backup"}}
            ).status_code,
            404,
        )
        self.assertEqual(
            self.client.patch(
                self.base, json={"revision": 1, "changes": {self.doc: "late autosave"}}
            ).status_code,
            404,
        )
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM workspace_state").fetchone()[0], 0)

    def test_renaming_media_updates_saved_layers_and_ai_path_keys_only(self):
        old, new = "old.png", "new.png"
        doc = {"layers": [{"path": old, "name": old}, {"kind": "text", "text": old}]}
        ai_key = "omnigallery:ai-image-edit-v1:workspace:work:draft:old.png"
        prompt_key = "omnigallery:ai-production-prompt-v1:workspace:work:draft:document"
        imported = self.client.post(
            self.base + "/import",
            json={"entries": {self.doc: json.dumps(doc), ai_key: json.dumps(doc), prompt_key: old}},
        ).json()
        with self.conn:
            remap_workspace_state(self.conn, old, new)
        saved = self.client.get(self.base).json()
        self.assertGreater(saved["revision"], imported["revision"])
        self.assertNotIn(ai_key, saved["entries"])
        self.assertIn(ai_key.replace("old.png", "new.png"), saved["entries"])
        self.assertEqual(saved["entries"][prompt_key], old)
        self.assertEqual(
            json.loads(saved["entries"][self.doc])["layers"],
            [{"path": new, "name": new}, {"kind": "text", "text": old}],
        )

    def test_deleted_product_cleans_ai_inputs_and_outcomes_without_removing_compositions(self):
        path = "workspace-artifact:product"
        encoded = "workspace-artifact%3Aproduct"
        scope = "workspace:work:ai"
        main = f"omnigallery:ai-image-edit-v1:{scope}:{encoded}"
        refs = f"omnigallery:ai-image-refs-v1:{scope}:other.png"
        ref_doc = f"omnigallery:ai-image-ref-v1:{scope}:other.png:{encoded}"
        last = f"omnigallery:ai-image-edit-asset-v1:{scope}"
        prompt = f"omnigallery:ai-production-prompt-v1:{scope}:document"
        entries = {
            self.work: json.dumps(
                {"version": 2, "works": [{"outputs": [{"path": path}, {"path": "other"}]}]}
            ),
            self.doc: json.dumps({"layers": [{"path": path}]}),
            main: "{}",
            refs: json.dumps([path, "other.png"]),
            ref_doc: "{}",
            last: path,
            prompt: path,
        }
        imported = self.client.post(self.base + "/import", json={"entries": entries}).json()
        with self.conn:
            update_artifact_references(self.conn, "workspace", "product")
        saved = self.client.get(self.base).json()
        self.assertGreater(saved["revision"], imported["revision"])
        for key in (main, ref_doc, last):
            self.assertNotIn(key, saved["entries"])
        self.assertEqual(json.loads(saved["entries"][refs]), ["other.png"])
        self.assertEqual(
            json.loads(saved["entries"][self.work])["works"][0]["outputs"], [{"path": "other"}]
        )
        self.assertEqual(saved["entries"][self.doc], entries[self.doc])
        self.assertEqual(saved["entries"][prompt], path)
