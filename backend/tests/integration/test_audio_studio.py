import io
import json
import shutil
import sqlite3
import tempfile
import unittest
import uuid
import wave
from pathlib import Path
from unittest.mock import patch

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.tests.support.database import isolate_project_storage
from omnigallery.infrastructure.database import Database
from omnigallery.workspaces.artifacts import (
    create_workspace_artifact_table,
    mount_workspace_artifact_routes,
)
from omnigallery.workspaces.audio_studio import mount_audio_studio_routes
from omnigallery.workspaces.state import create_workspace_state_tables


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg required")
class AudioStudioTests(unittest.TestCase):
    def setUp(self):
        isolate_project_storage(self)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.conn = sqlite3.connect(self.root / "test.db", check_same_thread=False)
        self.addCleanup(self.conn.close)
        create_workspace_state_tables(self.conn)
        create_workspace_artifact_table(self.conn)
        self.conn.execute("CREATE TABLE tag (id INTEGER PRIMARY KEY, type TEXT)")
        self.conn.commit()
        connection = patch.object(Database, "get_connection", return_value=self.conn)
        connection.start()
        self.addCleanup(connection.stop)
        self.workspace = str(uuid.uuid4())
        self.source = self.root / "tone.wav"
        self.samples = (np.sin(np.arange(96000) * 2 * np.pi * 440 / 48000) * 12000).astype("<i2")
        with wave.open(str(self.source), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(48000)
            output.writeframes(self.samples.tobytes())
        self.conn.execute(
            "INSERT INTO workspace_state VALUES (?, ?, ?)",
            (
                self.workspace,
                f"omnigallery:workspace-works-v2:{self.workspace}",
                json.dumps({"works": [{"drafts": [{"id": "draft-1", "kind": "audio"}]}]}),
            ),
        )
        self.conn.commit()
        app = FastAPI()

        def trusted(path):
            if not Path(path).resolve().is_relative_to(self.root):
                raise HTTPException(403, "不允许读取此文件")

        mount_audio_studio_routes(app, "/api", lambda: None, lambda: None, trusted)
        mount_workspace_artifact_routes(app, "/api", lambda: None, lambda: None)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def clip(self, **fields):
        return {
            "id": "clip-1",
            "path": str(self.source),
            "name": "Tone",
            "start": 0.25,
            "sourceIn": 0,
            "duration": 2,
            "gain": 0.6,
            "fadeIn": 0.5,
            "fadeOut": 0.5,
            "envelopeOffset": 0,
            "envelopeDuration": 2,
            **fields,
        }

    def request(self, clips=None, **fields):
        return {
            "workspace_id": self.workspace,
            "start": 0,
            "duration": 2.5,
            "document": {
                "version": 1,
                "masterGain": 0.8,
                "tracks": [{"id": "track-1", "gain": 0.7, "clips": clips or [self.clip()]}],
            },
            **fields,
        }

    def pcm(self, result):
        self.assertEqual(result.status_code, 200, result.text[:300])
        with wave.open(io.BytesIO(result.content)) as audio:
            self.assertEqual(audio.getframerate(), 48000)
            self.assertEqual(audio.getnchannels(), 2)
            return np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2").reshape(-1, 2)

    def test_probe_peaks_and_path_permissions(self):
        response = self.client.get(
            "/api/audio_studio/source",
            params={"workspace_id": self.workspace, "path": str(self.source), "peaks": True},
        )
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result["duration"], 2)
        self.assertEqual(len(result["peaks"]), 4096)
        self.assertGreater(max(result["peaks"]), 0.2)
        self.assertEqual(
            self.client.get(
                "/api/audio_studio/source",
                params={"workspace_id": self.workspace, "path": "C:/not-allowed.wav"},
            ).status_code,
            403,
        )

    def test_preview_windows_and_split_preserve_envelopes(self):
        full = self.pcm(self.client.post("/api/audio_studio/preview", json=self.request()))
        window = self.pcm(
            self.client.post(
                "/api/audio_studio/preview", json=self.request(start=0.7, duration=1.3)
            )
        )
        np.testing.assert_allclose(window, full[33600:96000], atol=3)
        clips = [
            self.clip(duration=0.3),
            self.clip(id="clip-2", start=0.55, sourceIn=0.3, duration=1.7, envelopeOffset=0.3),
        ]
        split = self.pcm(self.client.post("/api/audio_studio/preview", json=self.request(clips)))
        np.testing.assert_allclose(split, full, atol=3)
        self.assertEqual(len(full), 120000)
        self.assertTrue(np.all(full[:12000] == 0))

    def test_mute_solo_and_missing_source(self):
        request = self.request()
        request["document"]["tracks"][0]["muted"] = True
        silence = self.pcm(self.client.post("/api/audio_studio/preview", json=request))
        self.assertTrue(np.all(silence == 0))
        request["document"]["tracks"][0]["muted"] = False
        request["document"]["tracks"].append({"id": "solo", "solo": True, "clips": []})
        self.assertTrue(
            np.all(self.pcm(self.client.post("/api/audio_studio/preview", json=request)) == 0)
        )
        self.source.unlink()
        self.assertEqual(
            self.client.post("/api/audio_studio/preview", json=self.request()).status_code, 404
        )
        self.assertEqual(
            self.client.post(
                "/api/audio_studio/preview", json=self.request(duration=15)
            ).status_code,
            422,
        )

    def test_exports_are_workspace_audio_artifacts_and_support_reuse(self):
        for audio_format in ("wav", "mp3"):
            result = self.client.post(
                "/api/audio_studio/export",
                json=self.request(
                    name="声音",
                    format=audio_format,
                    document_id="draft-1",
                    document_revision="a" * 64,
                ),
            )
            self.assertEqual(result.status_code, 200, result.text)
            item = result.json()
            self.assertEqual(item["source"], "audio_studio")
            self.assertEqual(item["kind"], "audio")
            self.assertTrue(item["name"].endswith("." + audio_format))
            response = self.client.get(f"/api/workspace_artifacts/{item['id']}/file")
            self.assertEqual(response.status_code, 200)
            metadata = self.client.get(f"/api/workspace_artifacts/{item['id']}/metadata")
            self.assertEqual(metadata.status_code, 200, metadata.text)
            self.assertIn("时长", metadata.json()["exif"])
            probe = self.client.get(
                "/api/audio_studio/source",
                params={"workspace_id": self.workspace, "path": f"workspace-artifact:{item['id']}"},
            )
            self.assertEqual(probe.status_code, 200, probe.text)
            self.assertAlmostEqual(probe.json()["duration"], 2.5, delta=0.05)
            wrong = self.client.get(
                "/api/audio_studio/source",
                params={
                    "workspace_id": str(uuid.uuid4()),
                    "path": f"workspace-artifact:{item['id']}",
                },
            )
            self.assertEqual(wrong.status_code, 403)
            rename = self.client.put(
                f"/api/workspace_artifacts/{item['id']}", json={"name": "新名字.png"}
            )
            self.assertEqual(rename.json()["name"], "新名字." + audio_format)
        self.conn.execute("DELETE FROM workspace_state")
        self.conn.commit()
        self.assertEqual(
            self.client.post(
                "/api/audio_studio/export",
                json=self.request(
                    name="声音", format="wav", document_id="draft-1", document_revision="b" * 64
                ),
            ).status_code,
            409,
        )
