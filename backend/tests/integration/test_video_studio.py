import hashlib
import io
import json
import shutil
import sqlite3
import subprocess
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from PIL import Image

from backend.tests.support.database import isolate_project_storage
from omnigallery.infrastructure.database import Database
from omnigallery.workspaces.artifacts import (
    artifact_root,
    create_workspace_artifact_table,
    mount_workspace_artifact_routes,
)
from omnigallery.workspaces.audio_studio import HIDDEN
from omnigallery.workspaces.state import create_workspace_state_tables
from omnigallery.workspaces.video_studio import mount_video_studio_routes


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg required")
class VideoStudioTests(unittest.TestCase):
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
        self.draft_id = "video-draft"
        self.image = self.root / "still.png"
        Image.new("RGB", (320, 240), (230, 28, 24)).save(self.image)
        self.video = self.root / "blue.mp4"
        subprocess.run(
            [
                shutil.which("ffmpeg"),
                "-nostdin",
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=blue:s=320x240:r=12:d=2",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=48000:duration=2",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
                str(self.video),
            ],
            check=True,
            capture_output=True,
            timeout=30,
            creationflags=HIDDEN,
        )
        self.conn.execute(
            "INSERT INTO workspace_state VALUES (?, ?, ?)",
            (
                self.workspace,
                f"omnigallery:workspace-works-v2:{self.workspace}",
                json.dumps({"works": [{"drafts": [{"id": self.draft_id, "kind": "video"}]}]}),
            ),
        )
        self.conn.commit()

        app = FastAPI()

        def trusted(path):
            if not Path(path).resolve().is_relative_to(self.root):
                raise HTTPException(403, "不允许读取此文件")

        mount_video_studio_routes(app, "/api", lambda: None, lambda: None, trusted)
        mount_workspace_artifact_routes(app, "/api", lambda: None, lambda: None)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def clip(self, path, kind, **fields):
        return {
            "id": str(uuid.uuid4()),
            "path": str(path),
            "name": path.name,
            "kind": kind,
            "start": 0,
            "sourceIn": 0,
            "duration": 1,
            "sourceDuration": 2,
            "rate": 1,
            "gain": 0.8,
            **fields,
        }

    def document(self):
        return {
            "version": 1,
            "width": 320,
            "height": 240,
            "fps": 12,
            "visuals": [
                self.clip(self.image, "image", duration=1),
                self.clip(self.video, "video", start=1, duration=1),
            ],
            "sounds": [self.clip(self.video, "video", start=1, duration=1, rate=2)],
            "captions": [{"id": "caption-1", "text": "HELLO", "start": 0.25, "duration": 0.5}],
            "markers": [{"id": "mark-1", "name": "later", "time": 10}],
        }

    def save_document(self, document):
        raw = json.dumps(document, separators=(",", ":"), ensure_ascii=False)
        self.conn.execute(
            "INSERT OR REPLACE INTO workspace_state VALUES (?, ?, ?)",
            (
                self.workspace,
                f"omnigallery:video-timeline-v1:{self.workspace}:{self.draft_id}",
                raw,
            ),
        )
        self.conn.commit()
        return hashlib.sha256(raw.encode()).hexdigest()

    def export(self, document=None, **changes):
        document = document or self.document()
        revision = self.save_document(document)
        request = {
            "workspace_id": self.workspace,
            "document_id": self.draft_id,
            "document_revision": revision,
            "name": "剪辑测试.mp4",
            "document": document,
            **changes,
        }
        return self.client.post("/api/video_studio/export", json=request)

    def test_export_renders_visuals_audio_captions_and_registers_mp4(self):
        before = (self.image.read_bytes(), self.video.read_bytes())
        response = self.export()
        self.assertEqual(response.status_code, 200, response.text[:600])
        artifact = response.json()
        self.assertEqual(
            (artifact["kind"], artifact["source"], artifact["format"]),
            ("video", "video_studio", "mp4"),
        )
        self.assertEqual((artifact["width"], artifact["height"]), (320, 240))
        self.assertEqual(artifact["document_id"], self.draft_id)
        file = self.client.get(f"/api/workspace_artifacts/{artifact['id']}/file")
        self.assertEqual(file.status_code, 200, file.text[:300] if file.status_code != 200 else "")
        self.assertGreater(len(file.content), 3000)
        exported = self.root / "exported.mp4"
        exported.write_bytes(file.content)
        probe = subprocess.run(
            [
                shutil.which("ffprobe"),
                "-v",
                "error",
                "-show_entries",
                "format=duration:stream=codec_type,width,height",
                "-of",
                "json",
                str(exported),
            ],
            check=True,
            capture_output=True,
            timeout=30,
            creationflags=HIDDEN,
        )
        info = json.loads(probe.stdout)
        self.assertAlmostEqual(float(info["format"]["duration"]), 2, delta=0.25)
        self.assertEqual({item["codec_type"] for item in info["streams"]}, {"video", "audio"})
        self.assertEqual((info["streams"][0]["width"], info["streams"][0]["height"]), (320, 240))
        audio = subprocess.run(
            [
                shutil.which("ffmpeg"),
                "-nostdin",
                "-v",
                "error",
                "-ss",
                "1.25",
                "-t",
                "0.25",
                "-i",
                str(exported),
                "-map",
                "0:a:0",
                "-f",
                "s16le",
                "-ac",
                "1",
                "-ar",
                "16000",
                "pipe:1",
            ],
            check=True,
            capture_output=True,
            timeout=30,
            creationflags=HIDDEN,
        )
        self.assertGreater(np.max(np.abs(np.frombuffer(audio.stdout, dtype="<i2"))), 100)
        before_sound = subprocess.run(
            [
                shutil.which("ffmpeg"),
                "-nostdin",
                "-v",
                "error",
                "-ss",
                "0.25",
                "-t",
                "0.2",
                "-i",
                str(exported),
                "-map",
                "0:a:0",
                "-f",
                "s16le",
                "-ac",
                "1",
                "-ar",
                "16000",
                "pipe:1",
            ],
            check=True,
            capture_output=True,
            timeout=30,
            creationflags=HIDDEN,
        )
        self.assertEqual(np.max(np.abs(np.frombuffer(before_sound.stdout, dtype="<i2"))), 0)
        self.assertEqual(self.frame(exported, 0.08).getpixel((160, 90))[0] > 150, True)
        self.assertEqual(self.frame(exported, 1.5).getpixel((160, 90))[2] > 90, True)
        # Subtitle burn changes pixels near the bottom while the still remains red.
        plain = self.frame(exported, 0.08)
        subtitled = self.frame(exported, 0.5)
        self.assertNotEqual(
            plain.crop((50, 170, 270, 235)).tobytes(), subtitled.crop((50, 170, 270, 235)).tobytes()
        )
        thumb = self.client.get(f"/api/workspace_artifacts/{artifact['id']}/thumbnail?size=160")
        self.assertEqual(
            thumb.status_code, 200, thumb.text[:200] if thumb.status_code != 200 else ""
        )
        with Image.open(io.BytesIO(thumb.content)) as image:
            self.assertLessEqual(max(image.size), 160)
        metadata = self.client.get(f"/api/workspace_artifacts/{artifact['id']}/metadata")
        self.assertEqual(metadata.status_code, 200, metadata.text[:500])
        self.assertEqual(metadata.json()["exif"]["像素尺寸"], "320 × 240")
        self.assertEqual(metadata.json()["exif"]["格式"], "MP4")
        self.assertEqual(metadata.json()["exif"]["帧率"], "12 fps")
        self.assertAlmostEqual(
            float(metadata.json()["exif"]["时长"].removesuffix(" 秒")), 2, delta=0.25
        )
        self.assertFalse(metadata.json()["source_image_available"])
        update = self.client.put(
            f"/api/workspace_artifacts/{artifact['id']}/metadata",
            json={"description": "视频产物描述"},
        )
        self.assertEqual(update.status_code, 200, update.text[:500])
        self.assertEqual(update.json()["description"], "视频产物描述")
        self.assertEqual((self.image.read_bytes(), self.video.read_bytes()), before)

    def frame(self, path, time):
        result = subprocess.run(
            [
                shutil.which("ffmpeg"),
                "-nostdin",
                "-v",
                "error",
                "-ss",
                str(time),
                "-i",
                str(path),
                "-frames:v",
                "1",
                "-f",
                "image2pipe",
                "-vcodec",
                "png",
                "pipe:1",
            ],
            check=True,
            capture_output=True,
            timeout=30,
            creationflags=HIDDEN,
        )
        return Image.open(io.BytesIO(result.stdout)).convert("RGB")

    def test_rejects_untrusted_source_before_ffmpeg_reads_it(self):
        outside = Path(self.temp.name).parent / "not-trusted.mp4"
        document = self.document()
        document["visuals"][0]["path"] = str(outside)
        document["visuals"][0]["kind"] = "video"
        response = self.export(document)
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(list((artifact_root() / self.workspace).glob(".video-render-*")), [])
        self.assertEqual(
            self.conn.execute("SELECT COUNT(*) FROM workspace_artifact").fetchone()[0], 0
        )

    def test_multiple_sound_clips_keep_their_timeline_offsets(self):
        document = self.document()
        document["sounds"].append(self.clip(self.video, "video", start=0, duration=1))
        document["captions"] = []
        response = self.export(document)
        self.assertEqual(response.status_code, 200, response.text[:600])
        artifact = response.json()
        target = self.root / "mixed.mp4"
        target.write_bytes(
            self.client.get(f"/api/workspace_artifacts/{artifact['id']}/file").content
        )
        for position in (0.4, 1.4):
            sample = subprocess.run(
                [
                    shutil.which("ffmpeg"),
                    "-nostdin",
                    "-v",
                    "error",
                    "-ss",
                    str(position),
                    "-t",
                    "0.2",
                    "-i",
                    str(target),
                    "-map",
                    "0:a:0",
                    "-f",
                    "s16le",
                    "-ac",
                    "1",
                    "-ar",
                    "16000",
                    "pipe:1",
                ],
                check=True,
                capture_output=True,
                timeout=30,
                creationflags=HIDDEN,
            )
            self.assertGreater(np.max(np.abs(np.frombuffer(sample.stdout, dtype="<i2"))), 100)

    def test_later_visual_covers_earlier_then_reveals_it_and_silence_is_valid(self):
        document = self.document()
        document["visuals"][0]["duration"] = 2
        document["visuals"][1]["start"] = 0.5
        document["visuals"][1]["rate"] = 2
        document["sounds"] = []
        document["captions"] = []
        response = self.export(document)
        self.assertEqual(response.status_code, 200, response.text[:600])
        artifact = response.json()
        video = self.root / "overlap.mp4"
        video.write_bytes(
            self.client.get(f"/api/workspace_artifacts/{artifact['id']}/file").content
        )
        first = self.frame(video, 0.2).getpixel((160, 90))
        middle = self.frame(video, 0.9).getpixel((160, 90))
        last = self.frame(video, 1.8).getpixel((160, 90))
        self.assertGreater(first[0], 150)
        self.assertGreater(middle[2], 90)
        self.assertGreater(last[0], 150)

    def test_video_source_in_uses_requested_part_of_source(self):
        two_colors = self.root / "two-colors.mp4"
        subprocess.run(
            [
                shutil.which("ffmpeg"),
                "-nostdin",
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=red:s=320x240:r=12:d=1",
                "-f",
                "lavfi",
                "-i",
                "color=c=green:s=320x240:r=12:d=1",
                "-filter_complex",
                "[0:v][1:v]concat=n=2:v=1:a=0[v]",
                "-map",
                "[v]",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                str(two_colors),
            ],
            check=True,
            capture_output=True,
            timeout=30,
            creationflags=HIDDEN,
        )
        document = self.document()
        document["visuals"] = [
            self.clip(two_colors, "video", sourceIn=1, duration=0.8, sourceDuration=2)
        ]
        document["sounds"] = []
        document["captions"] = []
        response = self.export(document)
        self.assertEqual(response.status_code, 200, response.text[:600])
        artifact = response.json()
        target = self.root / "trimmed.mp4"
        target.write_bytes(
            self.client.get(f"/api/workspace_artifacts/{artifact['id']}/file").content
        )
        green = self.frame(target, 0.4).getpixel((160, 90))
        self.assertGreater(green[1], green[0])

    def test_rejects_stale_saved_revision_and_out_of_range_source(self):
        document = self.document()
        response = self.export(document, document_revision="a" * 64)
        self.assertEqual(response.status_code, 409, response.text)
        document["visuals"][1]["sourceIn"] = 1.5
        response = self.export(document)
        self.assertEqual(response.status_code, 422, response.text)

    def test_rejects_artifact_from_another_workspace(self):
        foreign_id = str(uuid.uuid4())
        self.conn.execute(
            "INSERT INTO workspace_artifact VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                foreign_id,
                str(uuid.uuid4()),
                "foreign.mp4",
                "video",
                "video_studio",
                "mp4",
                320,
                240,
                100,
                "2026-09-30T00:00:00+00:00",
            ),
        )
        self.conn.commit()
        document = self.document()
        document["visuals"][1]["path"] = f"workspace-artifact:{foreign_id}"
        response = self.export(document)
        self.assertEqual(response.status_code, 403, response.text)


if __name__ == "__main__":
    unittest.main()
