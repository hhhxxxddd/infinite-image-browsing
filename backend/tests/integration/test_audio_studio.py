import base64
import io
import json
import shutil
import sqlite3
import subprocess
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
from omnigallery.workspaces.audio_studio import HIDDEN, mount_audio_studio_routes
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

    def video(self, with_audio=True):
        path = self.root / ("interview.mkv" if with_audio else "silent.mkv")
        args = [
            shutil.which("ffmpeg"),
            "-nostdin",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=black:s=32x32:r=25:d=2",
        ]
        if with_audio:
            # The second audio stream is stereo: FFmpeg's automatic stream selection
            # would prefer it, so this catches mismatched probe, waveform and playback.
            args += [
                "-i",
                str(self.source),
                "-f",
                "lavfi",
                "-i",
                "aevalsrc=0.1|0.1:d=2",
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-map",
                "2:a:0",
                "-c:a",
                "pcm_s16le",
            ]
        args += ["-c:v", "ffv1", "-t", "2", str(path)]
        subprocess.run(args, check=True, capture_output=True, timeout=30, creationflags=HIDDEN)
        return path

    def test_video_first_audio_stream_supports_waveforms_editing_and_audio_only_export(self):
        video = self.video()
        original = video.read_bytes()
        probe = self.client.get(
            "/api/audio_studio/source",
            params={"workspace_id": self.workspace, "path": str(video), "peaks": True},
        )
        self.assertEqual(probe.status_code, 200, probe.text)
        self.assertEqual(probe.json()["channels"], 1)
        self.assertGreater(max(probe.json()["peaks"]), 0.2)
        expected = self.pcm(self.client.post("/api/audio_studio/preview", json=self.request()))
        request = self.request([self.clip(path=str(video), sourceKind="video")])
        actual = self.pcm(self.client.post("/api/audio_studio/preview", json=request))
        np.testing.assert_allclose(actual, expected, atol=3)
        request["document"]["tracks"][0]["clips"] = [
            self.clip(path=str(video), sourceKind="video", duration=0.75),
            self.clip(
                id="clip-2",
                path=str(video),
                sourceKind="video",
                start=1,
                sourceIn=0.75,
                duration=1.25,
                envelopeOffset=0.75,
            ),
        ]
        request.update(
            name="采访声音", format="wav", document_id="draft-1", document_revision="c" * 64
        )
        export = self.client.post("/api/audio_studio/export", json=request)
        self.assertEqual(export.status_code, 200, export.text)
        self.assertEqual(export.json()["kind"], "audio")
        output = self.client.get(f"/api/workspace_artifacts/{export.json()['id']}/file")
        np.testing.assert_allclose(self.pcm(output), expected, atol=3)
        self.assertEqual(video.read_bytes(), original)

    def test_video_without_audio_rejects_probe_preview_and_export(self):
        video = self.video(with_audio=False)
        probe = self.client.get(
            "/api/audio_studio/source",
            params={"workspace_id": self.workspace, "path": str(video)},
        )
        self.assertEqual(probe.status_code, 422)
        self.assertIn("没有可用音轨", probe.json()["detail"])
        request = self.request([self.clip(path=str(video), sourceKind="video")])
        self.assertEqual(
            self.client.post("/api/audio_studio/preview", json=request).status_code, 422
        )
        request.update(
            name="无声视频", format="wav", document_id="draft-1", document_revision="d" * 64
        )
        self.assertEqual(
            self.client.post("/api/audio_studio/export", json=request).status_code, 422
        )
        self.assertEqual(
            self.conn.execute("SELECT count(*) FROM workspace_artifact").fetchone()[0], 0
        )

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

    def test_text_tracks_never_change_mixed_samples_and_invalid_text_timing_is_rejected(self):
        expected = self.pcm(self.client.post("/api/audio_studio/preview", json=self.request()))
        request = self.request()
        request["document"]["textTracks"] = [
            {
                "id": "text-1",
                "name": "歌词",
                "visible": True,
                "locked": False,
                "cues": [{"id": "cue-1", "start": 0.5, "duration": 1.5, "text": "Hello\n歌词"}],
            }
        ]
        actual = self.pcm(self.client.post("/api/audio_studio/preview", json=request))
        np.testing.assert_array_equal(actual, expected)
        request["document"]["textTracks"][0]["cues"][0]["start"] = 86400
        self.assertEqual(
            self.client.post("/api/audio_studio/preview", json=request).status_code, 422
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
            self.assertLess(item["mix_peak_dbfs"], 0)
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

    def test_speed_duration_pitch_and_source_bounds_in_preview_and_export(self):
        original = self.source.read_bytes()
        for rate in (0.25, 0.8, 2, 4):
            duration = 2 / rate
            for keep in (True, False):
                clip = self.clip(
                    start=0,
                    rate=rate,
                    preservePitch=keep,
                    duration=duration,
                    envelopeDuration=duration,
                    gain=1,
                    fadeIn=0,
                    fadeOut=0,
                )
                request = self.request([clip], duration=duration)
                request["document"]["masterGain"] = 1
                request["document"]["tracks"][0]["gain"] = 1
                samples = self.pcm(self.client.post("/api/audio_studio/preview", json=request))
                self.assertEqual(len(samples), round(duration * 48000))
                center = samples[int(0.1 * 48000) : int(min(duration - 0.05, 1.5) * 48000), 0]
                frequencies = np.fft.rfftfreq(len(center), 1 / 48000)
                frequency = frequencies[np.argmax(np.abs(np.fft.rfft(center)))]
                self.assertAlmostEqual(frequency, 440 if keep else 440 * rate, delta=5)
                if rate == 2:
                    request.update(
                        name="变速", format="wav", document_id="draft-1", document_revision="e" * 64
                    )
                    result = self.client.post("/api/audio_studio/export", json=request)
                    self.assertEqual(result.status_code, 200, result.text)
                    exported = self.pcm(
                        self.client.get(f"/api/workspace_artifacts/{result.json()['id']}/file")
                    )
                    np.testing.assert_array_equal(samples, exported)
        invalid = self.request([self.clip(rate=2)])
        self.assertEqual(
            self.client.post("/api/audio_studio/preview", json=invalid).status_code, 422
        )
        self.assertEqual(self.source.read_bytes(), original)

    def test_mix_meter_detects_overload_before_encoding_and_export_reports_peak(self):
        request = self.request([self.clip(start=0, gain=4, fadeIn=0, fadeOut=0)])
        request["document"]["masterGain"] = 2
        request["document"]["tracks"][0]["gain"] = 4
        response = self.client.post("/api/audio_studio/preview", json=request)
        samples = self.pcm(response)
        peaks = np.frombuffer(
            base64.b64decode(response.headers["x-audio-level-peaks"]), dtype="<f4"
        ).reshape(-1, 2)
        self.assertEqual(len(peaks), 50)
        self.assertGreater(peaks.max(), 1)
        self.assertEqual(samples.max(), 32767)
        self.assertIn("X-Audio-Level-Peaks", response.headers["access-control-expose-headers"])
        request.update(
            name="过载验证", format="mp3", document_id="draft-1", document_revision="f" * 64
        )
        result = self.client.post("/api/audio_studio/export", json=request)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertAlmostEqual(
            result.json()["mix_peak_dbfs"], 20 * np.log10(peaks.max()), delta=0.01
        )
        request["document"]["masterGain"] = 0
        quiet = self.client.post("/api/audio_studio/preview", json=request)
        self.assertTrue(np.all(self.pcm(quiet) == 0))
        values = np.frombuffer(base64.b64decode(quiet.headers["x-audio-level-peaks"]), dtype="<f4")
        self.assertTrue(np.all(values == 0))
        result = self.client.post("/api/audio_studio/export", json=request)
        self.assertIsNone(result.json()["mix_peak_dbfs"])
