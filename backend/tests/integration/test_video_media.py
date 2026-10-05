import os
import shutil
import sqlite3
import subprocess
import tempfile
import time
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from omnigallery.infrastructure.database import Database
from omnigallery.workspaces import video_media
from omnigallery.workspaces.artifacts import create_workspace_artifact_table


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg required")
class VideoMediaTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.media_root = self.root / "media"
        self.media_root.mkdir()
        self.cache_root = self.root / "cache"
        self.cache_root.mkdir()
        self.workspace = str(uuid.uuid4())
        self.other_workspace = str(uuid.uuid4())
        cache = patch.object(video_media, "get_cache_dir", return_value=str(self.cache_root))
        cache.start()
        self.addCleanup(cache.stop)
        self.conn = sqlite3.connect(self.root / "test.db", check_same_thread=False)
        self.addCleanup(self.conn.close)
        create_workspace_artifact_table(self.conn)
        connection = patch.object(Database, "get_connection", return_value=self.conn)
        connection.start()
        self.addCleanup(connection.stop)
        self.allow_write = True

        def trusted(path):
            if not Path(path).resolve().is_relative_to(self.media_root):
                raise HTTPException(403, "不允许读取此文件")

        def write():
            if not self.allow_write:
                raise HTTPException(403, "只读")

        app = FastAPI()
        video_media.mount_video_media_routes(app, "/api", lambda: None, write, trusted)
        self.service = app.state.video_media
        self.addCleanup(self.service.close)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.video = self.media_root / "clip.mp4"
        self.make_video(self.video)

    def ffmpeg(self, *args):
        subprocess.run(
            [shutil.which("ffmpeg"), "-nostdin", "-v", "error", "-y", *args],
            check=True,
            capture_output=True,
            timeout=45,
            creationflags=video_media.HIDDEN,
        )

    def make_video(self, path, duration=1.2, audio=True, size="320x180"):
        args = ["-f", "lavfi", "-i", f"testsrc2=s={size}:r=12:d={duration}"]
        if audio:
            args += [
                "-f",
                "lavfi",
                "-i",
                f"sine=frequency=440:sample_rate=48000:duration={duration}",
            ]
        self.ffmpeg(
            *args,
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            *(["-c:a", "aac"] if audio else []),
            str(path),
        )

    def info(self, path=None, kind="video"):
        response = self.client.get(
            "/api/video_studio/media",
            params={"workspace_id": self.workspace, "path": str(path or self.video), "kind": kind},
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def submit(self, path=None):
        response = self.client.post(
            "/api/video_studio/proxies",
            json={"workspace_id": self.workspace, "path": str(path or self.video)},
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def wait(self, job):
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            job = self.service.get(self.workspace, job["id"])
            if job["state"] not in video_media.ACTIVE:
                return job
            time.sleep(0.02)
        self.fail("proxy did not finish")

    def test_metadata_is_cached_by_stat_without_reading_whole_media(self):
        with (
            patch.object(Path, "read_bytes", side_effect=AssertionError("whole file read")),
            patch.object(video_media.subprocess, "run", wraps=subprocess.run) as run,
        ):
            first, again = self.info(), self.info()
            self.assertEqual(run.call_count, 1)
            self.assertEqual(first, again)
            self.assertTrue(first["has_audio"])
            self.assertEqual(first["video_codec"], "h264")
            self.assertEqual((first["width"], first["height"]), (320, 180))
            original = self.video.stat()
            os.utime(self.video, ns=(original.st_atime_ns, original.st_mtime_ns + 1_000_000))
            changed = self.info()
            self.assertEqual(run.call_count, 2)
            self.assertNotEqual(first["fingerprint"], changed["fingerprint"])

    def test_multiple_audio_streams_report_languages_and_container_relative_endpoints(self):
        source = self.media_root / "languages.mkv"
        self.ffmpeg(
            "-f",
            "lavfi",
            "-i",
            "color=s=32x32:r=5:d=6",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000:duration=2",
            "-itsoffset",
            "3",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=880:sample_rate=44100:duration=1",
            "-map",
            "0:v",
            "-map",
            "1:a",
            "-map",
            "2:a",
            "-metadata:s:a:0",
            "language=eng",
            "-metadata:s:a:0",
            "title=English",
            "-metadata:s:a:1",
            "language=zho",
            "-metadata:s:a:1",
            "title=Chinese",
            "-disposition:a:0",
            "0",
            "-disposition:a:1",
            "default",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-c:a",
            "pcm_s16le",
            str(source),
        )
        with patch.object(Path, "read_bytes", side_effect=AssertionError("whole file read")):
            info = self.info(source)
        self.assertAlmostEqual(info["duration"], 6, delta=0.01)
        first, late = info["audio_streams"]
        self.assertEqual((first["ordinal"], first["index"], first["language"]), (0, 1, "eng"))
        self.assertEqual((late["ordinal"], late["index"], late["language"]), (1, 2, "zho"))
        self.assertEqual((first["title"], late["title"]), ("English", "Chinese"))
        self.assertFalse(first["default"])
        self.assertTrue(late["default"])
        self.assertEqual((first["sample_rate"], late["sample_rate"]), (48000, 44100))
        self.assertAlmostEqual(first["duration"], 2, delta=0.01)
        self.assertAlmostEqual(late["start_time"], 3, delta=0.01)
        self.assertAlmostEqual(late["duration"], 4, delta=0.01)
        self.assertAlmostEqual(late["real_duration"], 1, delta=0.01)

    def test_real_proxy_reuses_cache_serves_ranges_and_invalidates_changed_source(self):
        original = self.video.stat()
        with patch.object(Path, "read_bytes", side_effect=AssertionError("whole file read")):
            job = self.wait(self.submit())
        self.assertEqual(job["state"], "succeeded", job)
        self.assertEqual(self.video.stat().st_mtime_ns, original.st_mtime_ns)
        self.assertEqual(job["proxy_url"], self.info()["proxy_url"])
        response = self.client.get(job["proxy_url"], headers={"Range": "bytes=0-31"})
        self.assertEqual(response.status_code, 206, response.text)
        self.assertEqual(len(response.content), 32)
        with patch.object(
            video_media.subprocess, "Popen", side_effect=AssertionError("cache not reused")
        ):
            cached = self.submit()
            self.assertEqual(cached["state"], "succeeded")
        target = self.service.jobs[job["id"]]["_target"]
        proxy = video_media.probe_media(target)
        self.assertEqual(proxy["has_audio"], True)
        self.assertAlmostEqual(proxy["duration"], self.info()["duration"], delta=0.1)
        os.utime(self.video, ns=(original.st_atime_ns, original.st_mtime_ns + 1_000_000))
        self.assertIsNone(self.info()["proxy_url"])
        self.assertEqual(self.client.get(job["proxy_url"]).status_code, 404)
        cleared = self.client.delete(
            "/api/video_studio/proxy",
            params={"workspace_id": self.workspace, "path": str(self.video)},
        )
        self.assertEqual(cleared.status_code, 200)
        self.assertEqual(cleared.json()["deleted"], 1)
        self.assertFalse(target.exists())
        self.assertTrue(self.video.exists())

    def test_silent_rotation_and_original_dimensions_survive_proxy(self):
        silent = self.media_root / "silent.mp4"
        self.make_video(silent, audio=False, size="1920x1080")
        rotated = self.media_root / "portrait.mp4"
        self.ffmpeg("-display_rotation", "90", "-i", str(silent), "-c", "copy", str(rotated))
        source = self.info(rotated)
        self.assertFalse(source["has_audio"])
        self.assertEqual((source["width"], source["height"]), (1080, 1920))
        job = self.wait(self.submit(rotated))
        self.assertEqual(job["state"], "succeeded", job)
        target = self.service.jobs[job["id"]]["_target"]
        proxy = video_media.probe_media(target)
        self.assertFalse(proxy["has_audio"])
        self.assertEqual((proxy["width"], proxy["height"]), (720, 1280))
        self.assertEqual(proxy["rotation"], 0)
        self.assertEqual(self.info(rotated)["encoded_width"], 1920)

    def test_cancel_running_and_queued_jobs_removes_partial_output(self):
        # -re makes a tiny valid source take real time, so cancellation deterministically
        # targets the live FFmpeg process rather than racing a fast completed render.
        self.make_video(self.video, duration=4)
        popen = subprocess.Popen

        def slow(args, **kwargs):
            args = list(args)
            if Path(args[0]).stem == "ffmpeg":
                args.insert(args.index("-i"), "-re")
            return popen(args, **kwargs)

        with patch.object(video_media.subprocess, "Popen", side_effect=slow):
            job = self.submit()
            deadline = time.monotonic() + 5
            while not self.service.jobs[job["id"]]["_process"] and time.monotonic() < deadline:
                time.sleep(0.01)
            other = self.media_root / "other.mp4"
            shutil.copyfile(self.video, other)
            queued = self.submit(other)
            self.assertEqual(queued["state"], "queued")
            for item in (queued, job):
                response = self.client.post(
                    f"/api/video_studio/proxies/{item['id']}/cancel",
                    params={"workspace_id": self.workspace},
                )
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()["state"], "cancelled")
            self.service.close()
        self.assertFalse(list(self.cache_root.rglob("*.mp4")))
        self.assertTrue(self.video.exists())

    def test_permissions_workspace_boundaries_and_proxy_input_rejection(self):
        denied = self.client.get(
            "/api/video_studio/media",
            params={"workspace_id": self.workspace, "path": str(self.root / "outside.mp4")},
        )
        self.assertEqual(denied.status_code, 403)
        self.allow_write = False
        self.assertEqual(
            self.client.post(
                "/api/video_studio/proxies",
                json={"workspace_id": self.workspace, "path": str(self.video)},
            ).status_code,
            403,
        )
        self.allow_write = True
        job = self.wait(self.submit())
        denied = self.client.get(
            f"/api/video_studio/proxies/{job['id']}", params={"workspace_id": self.other_workspace}
        )
        self.assertEqual(denied.status_code, 404)
        self.assertEqual(self.service.list(self.other_workspace)["jobs"], [])
        target = self.service.jobs[job["id"]]["_target"]
        with self.assertRaises(HTTPException) as raised:
            video_media.resolve_media(str(target), self.workspace, "video", lambda path: None)
        self.assertEqual(raised.exception.status_code, 422)
        artifact_id = str(uuid.uuid4())
        self.conn.execute(
            "INSERT INTO workspace_artifact (id, workspace_id, kind, name, format, width, height, bytes, created_at, source) VALUES (?, ?, 'video', 'v', 'mp4', 320, 180, 1, '', '{}')",
            (artifact_id, self.other_workspace),
        )
        self.conn.commit()
        denied = self.client.get(
            "/api/video_studio/media",
            params={"workspace_id": self.workspace, "path": "workspace-artifact:" + artifact_id},
        )
        self.assertEqual(denied.status_code, 403, denied.text)

    def test_audio_metadata_does_not_require_browser_decoder(self):
        audio = self.media_root / "audio.flac"
        self.ffmpeg("-i", str(self.video), "-vn", "-c:a", "flac", str(audio))
        info = self.info(audio, "audio")
        self.assertTrue(info["has_audio"])
        self.assertEqual(info["audio_streams"][0]["codec"], "flac")
        self.assertGreater(info["duration"], 1)
        self.assertEqual(info["width"], 0)
        self.assertIsNone(info["proxy_url"])

    def test_large_stat_metadata_has_no_file_size_limit_or_whole_file_read(self):
        stat = self.video.stat()
        original_stat = Path.stat

        def large(path, *args, **kwargs):
            if path == self.video:
                return SimpleNamespace(
                    st_size=12 * 1024**3, st_mtime_ns=stat.st_mtime_ns, st_mode=stat.st_mode
                )
            return original_stat(path, *args, **kwargs)

        with (
            patch.object(Path, "stat", large),
            patch.object(Path, "read_bytes", side_effect=AssertionError("whole file read")),
        ):
            self.assertEqual(self.info()["size"], 12 * 1024**3)

    def test_multiple_audio_tracks_keep_their_time_offsets(self):
        target = self.media_root / "multitrack.mp4"
        self.ffmpeg(
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=320x180:r=12:d=2",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000:duration=2",
            "-itsoffset",
            "0.35",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=880:sample_rate=48000:duration=1",
            "-map",
            "0:v",
            "-map",
            "1:a",
            "-map",
            "2:a",
            "-c:v",
            "libx264",
            "-c:a",
            "aac",
            str(target),
        )
        original = self.info(target)
        job = self.wait(self.submit(target))
        self.assertEqual(job["state"], "succeeded", job)
        proxy = video_media.probe_media(self.service.jobs[job["id"]]["_target"])
        self.assertEqual(len(proxy["audio_streams"]), 2)
        self.assertAlmostEqual(proxy["duration"], original["duration"], delta=0.1)
        for actual, expected in zip(proxy["audio_streams"], original["audio_streams"], strict=True):
            self.assertAlmostEqual(actual["start_time"], expected["start_time"], delta=0.05)

    def test_cache_survives_service_restart_and_clear_removes_abandoned_partial(self):
        job = self.wait(self.submit())
        self.assertEqual(job["state"], "succeeded", job)
        target = self.service.jobs[job["id"]]["_target"]
        self.service.close()
        other = video_media.VideoMedia(self.service.check_path_trust)
        self.addCleanup(other.close)
        self.assertTrue(other.info(self.workspace, str(self.video), "video")["proxy_url"])
        with patch.object(
            video_media.subprocess, "Popen", side_effect=AssertionError("not reused")
        ):
            cached = other.submit(
                video_media.ProxyRequest(workspace_id=self.workspace, path=str(self.video))
            )
        self.assertEqual(cached["state"], "succeeded")
        abandoned = target.parent / ("." + str(uuid.uuid4()) + ".mp4")
        abandoned.write_bytes(b"partial")
        self.assertEqual(other.clear(self.workspace, str(self.video))["deleted"], 2)
        self.assertFalse(abandoned.exists())
