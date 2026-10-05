import json
import shutil
import sqlite3
import tempfile
import unittest
import uuid
import wave
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from omnigallery.infrastructure.database import Database
from omnigallery.workspaces import source_relink, video_media
from omnigallery.workspaces.artifacts import create_workspace_artifact_table
from omnigallery.workspaces.state import create_workspace_state_tables, delete_workspace_state


class SourceRelinkTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.media = self.root / "media"
        self.media.mkdir()
        self.conn = sqlite3.connect(self.root / "state.db", check_same_thread=False)
        self.addCleanup(self.conn.close)
        create_workspace_artifact_table(self.conn)
        create_workspace_state_tables(self.conn)
        self.workspace = str(uuid.uuid4())
        self.draft = str(uuid.uuid4())
        self.context = {"workspace_id": self.workspace, "document_id": self.draft, "kind": "audio"}
        self.conn.execute(
            "INSERT INTO workspace_state VALUES (?, ?, ?)",
            (
                self.workspace,
                f"omnigallery:workspace-works-v2:{self.workspace}",
                json.dumps(
                    {"version": 2, "works": [{"drafts": [{"id": self.draft, "kind": "audio"}]}]}
                ),
            ),
        )
        self.conn.commit()
        connection = patch.object(Database, "get_connection", return_value=self.conn)
        connection.start()
        self.addCleanup(connection.stop)

        def trust(path):
            if not Path(path).resolve().is_relative_to(self.media):
                raise HTTPException(403, "不允许访问")

        self.trust = trust
        app = FastAPI()
        self.authorized = True

        def secret():
            if not self.authorized:
                raise HTTPException(401, "认证失败")

        source_relink.mount_source_relink_routes(app, "/api", secret, trust)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def inspect(self, paths):
        return self.client.post(
            "/api/source_relink/inspect",
            json={
                **self.context,
                "sources": [{"path": str(path), "kind": "audio"} for path in paths],
            },
        )

    def find(self, **extra):
        return self.client.post(
            "/api/source_relink/candidates",
            json={**self.context, "directory": str(self.media), "names": ["voice.wav"], **extra},
        )

    def audio(self, path):
        with wave.open(str(path), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(8000)
            output.writeframes(b"\0\0" * 8000)

    @unittest.skipUnless(shutil.which("ffprobe"), "ffprobe required")
    def test_real_metadata_and_missing_or_forbidden_are_distinct_without_full_file_read(self):
        path = self.media / "voice.wav"
        self.audio(path)
        with patch.object(Path, "read_bytes", side_effect=AssertionError("full source read")):
            response = self.inspect([path, self.media / "missing.wav", self.root / "denied.wav"])
        self.assertEqual(response.status_code, 200, response.text)
        rows = response.json()["sources"]
        self.assertEqual([row["state"] for row in rows], ["available", "missing", "unavailable"])
        self.assertTrue(rows[0]["metadata"]["has_audio"])
        self.assertEqual(rows[0]["metadata"]["duration"], 1)

    def test_scan_lists_all_conflicts_without_probing_or_mutating_any_source(self):
        for name in ("one", "two"):
            child = self.media / name
            child.mkdir()
            (child / "voice.wav").write_bytes(b"a")
        (self.media / "unrelated.wav").write_bytes(b"a")
        before = list(self.media.rglob("*"))
        with patch.object(
            source_relink, "probe_media", side_effect=AssertionError("scan must not decode")
        ):
            response = self.find()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()["candidates"]), 2)
        self.assertTrue(response.json()["complete"])
        self.assertEqual(list(self.media.rglob("*")), before)
        self.assertEqual(self.find(recursive=False).json()["candidates"], [])

    def test_limits_mark_scan_incomplete_instead_of_claiming_a_unique_match(self):
        (self.media / "voice.wav").write_bytes(b"a")
        with patch.object(source_relink, "MAX_SCAN_ENTRIES", 0):
            result = self.find().json()
        self.assertFalse(result["complete"])
        self.assertEqual(result["candidates"], [])

    def test_directory_trust_and_filename_inputs_cannot_escape_selected_scope(self):
        self.assertEqual(self.find(directory=str(self.root)).status_code, 403)
        self.assertEqual(self.find(names=["../voice.wav"]).status_code, 422)
        self.assertEqual(self.find(directory=str(self.media / "missing")).status_code, 404)
        self.assertEqual(self.find(names=[]).status_code, 422)

    def test_deleted_missing_wrong_kind_and_cross_workspace_drafts_are_rejected(self):
        original = self.context.copy()
        for change in (
            {"document_id": str(uuid.uuid4())},
            {"workspace_id": str(uuid.uuid4())},
            {"kind": "video"},
        ):
            self.context = {**original, **change}
            self.assertEqual(self.find().status_code, 409)
        self.context = original
        delete_workspace_state(self.conn, self.workspace)
        self.assertEqual(self.find().status_code, 404)
        self.assertEqual(self.inspect([]).status_code, 404)

    def test_deletion_during_probe_does_not_return_a_stale_available_source(self):
        path = self.media / "voice.wav"
        path.write_bytes(b"a")

        def probe(*_):
            delete_workspace_state(self.conn, self.workspace)
            return {"duration": 1, "has_audio": True}

        with patch.object(source_relink, "probe_media", side_effect=probe):
            self.assertEqual(self.inspect([path]).status_code, 404)

    def test_authenticated_reads_need_no_write_permission_and_still_require_authentication(self):
        self.assertEqual(self.find().status_code, 200)
        self.authorized = False
        self.assertEqual(self.find().status_code, 401)
        self.assertEqual(self.inspect([]).status_code, 401)

    def test_probe_errors_are_per_source_and_unknown_failures_do_not_become_missing(self):
        first = self.media / "one.wav"
        first.write_bytes(b"a")
        second = self.media / "two.wav"
        second.write_bytes(b"a")
        with patch.object(
            source_relink,
            "probe_media",
            side_effect=[HTTPException(503, "FFprobe unavailable"), {"duration": 1}],
        ):
            response = self.inspect([first, second])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [row["state"] for row in response.json()["sources"]], ["error", "available"]
        )

    def test_foreign_workspace_artifact_is_never_probed(self):
        with (
            patch.object(
                video_media,
                "_row",
                return_value={"workspace_id": str(uuid.uuid4()), "kind": "audio"},
            ),
            patch.object(source_relink, "probe_media", side_effect=AssertionError("foreign media")),
        ):
            response = self.inspect(["workspace-artifact:" + str(uuid.uuid4())])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["sources"][0]["state"], "unavailable")

    def test_inaccessible_subtree_marks_candidate_list_incomplete(self):
        private = self.media / "private"
        private.mkdir()
        (self.media / "voice.wav").write_bytes(b"a")
        (private / "voice.wav").write_bytes(b"a")

        def trust(path):
            self.trust(path)
            if Path(path).resolve().is_relative_to(private):
                raise HTTPException(403, "private")

        request = source_relink.FindSources(
            **self.context, directory=str(self.media), names=["voice.wav"]
        )
        result = source_relink.find_sources(request, trust)
        self.assertFalse(result["complete"])
        self.assertEqual(len(result["candidates"]), 1)


if __name__ == "__main__":
    unittest.main()
