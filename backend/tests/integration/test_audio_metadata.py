"""Audio cover and lyric access through the local, trusted API."""

import base64
import io
import os
import shutil
import subprocess
import tempfile
import unittest
import wave
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from mutagen.id3 import APIC, SYLT, TALB, TIT2, TPE1, TXXX, USLT
from mutagen.mp3 import MP3
from mutagen.wave import WAVE
from PIL import Image

from backend.tests.support.database import isolate_database
from omnigallery.infrastructure.video_streaming import (
    send_bytes_range_requests,
    video_file_handler,
)
from omnigallery.metadata.audio import (
    _embedded_lyrics,
    _first,
    _has_embedded_cover,
    mount_audio_routes,
)


class StrictCommentTags(dict):
    def get(self, key, default=None):
        if key in ("\xa9lyr", "covr"):
            raise ValueError("invalid Vorbis comment key")
        return super().get(key, default)


class AudioMetadataTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        isolate_database(self, self.root / "test.db")
        self.track = self.root / "song.v1.wav"
        with wave.open(str(self.track), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(8000)
            output.writeframes(b"\x00\x00" * 8000)

        def trusted(path):
            if not Path(path).is_relative_to(self.root):
                raise HTTPException(403, "untrusted")

        app = FastAPI()
        mount_audio_routes(app, "/api", lambda: None, trusted)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_same_name_lyrics_and_folder_cover(self):
        (self.root / "song.v1.lrc").write_text(
            "[00:01.50]第一句\n[00:02.25]第二句", encoding="utf-8"
        )
        Image.new("RGB", (640, 400), "#1468a0").save(self.root / "cover.png")
        response = self.client.get("/api/audio_metadata", params={"path": str(self.track)})
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data["title"], "song.v1")
        self.assertTrue(data["has_cover"])
        self.assertEqual(data["cover_source"], "directory")
        self.assertEqual(data["title_source"], "filename")
        self.assertTrue(data["lyrics"]["timed"])
        self.assertEqual(data["lyrics"]["lines"][0], {"time": 1.5, "text": "第一句"})
        self.assertEqual(data["duration"], 1.0)
        cover = self.client.get("/api/audio_cover", params={"path": str(self.track)})
        self.assertEqual(cover.status_code, 200, cover.text)
        self.assertEqual(cover.headers["content-type"], "image/webp")
        self.assertLess(len(cover.content), 100_000)

    def test_missing_art_and_plain_lyrics_fall_back_cleanly(self):
        (self.root / "song.v1.txt").write_text("台词一\n台词二", encoding="utf-8")
        data = self.client.get("/api/audio_metadata", params={"path": str(self.track)}).json()
        self.assertFalse(data["lyrics"]["timed"])
        self.assertFalse(data["has_cover"])
        self.assertEqual(data["lyrics"]["lines"][1]["text"], "台词二")
        self.assertEqual(
            self.client.get("/api/audio_cover", params={"path": str(self.track)}).status_code, 404
        )

    def test_rejects_non_audio(self):
        other = self.root / "note.txt"
        other.write_text("not audio", encoding="utf-8")
        self.assertEqual(
            self.client.get("/api/audio_metadata", params={"path": str(other)}).status_code, 404
        )

    def test_embedded_id3_artwork_and_timed_lyrics(self):
        artwork = io.BytesIO()
        Image.new("RGB", (30, 30), "#2065a9").save(artwork, format="PNG")
        audio = WAVE(str(self.track))
        audio.add_tags()
        audio.tags.add(TIT2(encoding=3, text="曲名"))
        audio.tags.add(TPE1(encoding=3, text="作者"))
        audio.tags.add(TALB(encoding=3, text="专辑"))
        audio.tags.add(APIC(encoding=3, mime="image/png", type=3, desc="", data=artwork.getvalue()))
        audio.tags.add(USLT(encoding=3, text="非同步歌词"))
        audio.tags.add(
            SYLT(encoding=3, format=2, type=1, text=[("第一句", 1000), ("第二句", 2200)])
        )
        audio.save()
        (self.root / "song.v1.lrc").write_text("", encoding="utf-8")

        data = self.client.get("/api/audio_metadata", params={"path": str(self.track)}).json()
        self.assertEqual(
            [data[key] for key in ("title", "artist", "album")], ["曲名", "作者", "专辑"]
        )
        self.assertEqual(
            data["lyrics"],
            {
                "source": "embedded",
                "timed": True,
                "lines": [{"time": 1.0, "text": "第一句"}, {"time": 2.2, "text": "第二句"}],
            },
        )
        self.assertTrue(data["has_cover"])
        self.assertEqual(data["cover_source"], "embedded")
        self.assertEqual(data["embedded_title"], "曲名")
        self.assertEqual(
            self.client.get("/api/audio_cover", params={"path": str(self.track)}).status_code, 200
        )

    def test_invalid_comment_keys_do_not_break_metadata(self):
        tags = StrictCommentTags({"LYRICS": ["测试歌词"]})
        audio = SimpleNamespace(tags=tags, pictures=[])
        self.assertEqual(_first(tags, "\xa9lyr"), "")
        self.assertEqual(_embedded_lyrics(audio), "测试歌词")
        self.assertFalse(_has_embedded_cover(audio))

    def make_mp3(self):
        path = self.root / "歌曲.mp3"
        subprocess.run(
            [
                shutil.which("ffmpeg"),
                "-v",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=1",
                str(path),
            ],
            check=True,
            capture_output=True,
        )
        audio = MP3(path)
        if audio.tags is None:
            audio.add_tags()
        audio.tags.add(TIT2(encoding=3, text="原歌曲名"))
        audio.tags.add(USLT(encoding=3, text="原歌词"))
        audio.tags.add(TXXX(encoding=3, desc="custom", text="保留自定义标签"))
        artwork = io.BytesIO()
        Image.new("RGB", (30, 30), "red").save(artwork, format="PNG")
        audio.tags.add(APIC(encoding=3, mime="image/png", type=3, desc="", data=artwork.getvalue()))
        audio.save()
        return path

    def audio_pcm(self, path):
        return subprocess.run(
            [
                shutil.which("ffmpeg"),
                "-v",
                "error",
                "-i",
                str(path),
                "-map",
                "0:a:0",
                "-f",
                "s16le",
                "pipe:1",
            ],
            check=True,
            capture_output=True,
        ).stdout

    def edit_request(self, path):
        metadata = self.client.get("/api/audio_metadata", params={"path": str(path)}).json()
        return {
            "path": str(path),
            "revision": metadata["revision"],
            "title": "新歌曲名",
            "artist": "新艺术家",
            "album": "新专辑",
        }

    @unittest.skipUnless(shutil.which("ffmpeg"), "FFmpeg required")
    def test_write_mp3_tags_and_replace_cover_preserves_sound_and_other_tags(self):
        path = self.make_mp3()
        before = self.audio_pcm(path)
        request = self.edit_request(path)
        old_cover = self.client.get("/api/audio_cover", params={"path": str(path)}).content
        artwork = io.BytesIO()
        Image.new("RGB", (64, 40), "blue").save(artwork, format="PNG")
        request["cover"] = "data:image/png;base64," + base64.b64encode(artwork.getvalue()).decode()
        response = self.client.post("/api/audio_metadata", json=request)
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(
            [data[key] for key in ("title", "artist", "album")], ["新歌曲名", "新艺术家", "新专辑"]
        )
        self.assertTrue(data["editable"])
        self.assertEqual(data["title_source"], "embedded")
        self.assertEqual(data["cover_source"], "embedded")
        self.assertNotEqual(data["revision"], request["revision"])
        self.assertEqual(MP3(path).tags.getall("USLT")[0].text, "原歌词")
        self.assertEqual(MP3(path).tags.getall("TXXX:custom")[0].text, ["保留自定义标签"])
        self.assertEqual(self.audio_pcm(path), before)
        new_cover = self.client.get("/api/audio_cover", params={"path": str(path)}).content
        self.assertNotEqual(new_cover, old_cover)
        unchanged = path.read_bytes()
        stale = self.client.post("/api/audio_metadata", json=request)
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(path.read_bytes(), unchanged)

    @unittest.skipUnless(shutil.which("ffmpeg"), "FFmpeg required")
    def test_clear_embedded_tags_and_cover_falls_back_to_directory_art(self):
        path = self.make_mp3()
        Image.new("RGB", (24, 24), "green").save(self.root / "cover.png")
        request = self.edit_request(path)
        request.update(title="", artist="", album="", remove_cover=True)
        response = self.client.post("/api/audio_metadata", json=request)
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data["title"], "歌曲")
        self.assertEqual(data["embedded_title"], "")
        self.assertEqual(data["title_source"], "filename")
        self.assertEqual(data["cover_source"], "directory")
        self.assertEqual(MP3(path).tags.getall("APIC"), [])
        self.assertEqual(MP3(path).tags.getall("USLT")[0].text, "原歌词")

    @unittest.skipUnless(shutil.which("ffmpeg"), "FFmpeg required")
    def test_tag_write_errors_and_permissions_preserve_source(self):
        path = self.make_mp3()
        original = path.read_bytes()
        request = self.edit_request(path)
        for cover in ("data:image/png;base64,invalid", "data:image/png;base64,dGV4dA=="):
            response = self.client.post("/api/audio_metadata", json={**request, "cover": cover})
            self.assertEqual(response.status_code, 422, response.text)
            self.assertEqual(path.read_bytes(), original)
        response = self.client.post(
            "/api/audio_metadata", json={**request, "cover": "x", "remove_cover": True}
        )
        self.assertEqual(response.status_code, 422)
        with patch("mutagen.mp3.MP3.save", side_effect=OSError("save failed")):
            response = self.client.post("/api/audio_metadata", json=request)
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual(list(self.root.glob(".omnigallery-audio-*")), [])
        with patch("omnigallery.infrastructure.auth.is_api_writeable", False):
            self.assertEqual(self.client.post("/api/audio_metadata", json=request).status_code, 403)
        self.assertEqual(path.read_bytes(), original)
        response = self.client.post(
            "/api/audio_metadata", json={**request, "path": str(self.root.parent / "outside.mp3")}
        )
        self.assertEqual(response.status_code, 403)
        response = self.client.post(
            "/api/audio_metadata", json={**request, "path": str(self.track)}
        )
        self.assertEqual(response.status_code, 422)

    @unittest.skipUnless(shutil.which("ffmpeg"), "FFmpeg required")
    def test_windows_player_release_retries_and_persistent_lock_preserves_source(self):
        path = self.make_mp3()
        request = self.edit_request(path)
        original_replace = os.replace
        busy = PermissionError("sharing violation")
        busy.winerror = 32
        attempts = 0

        def release_then_replace(source, destination):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                raise busy
            original_replace(source, destination)

        with (
            patch("omnigallery.metadata.audio.os.replace", side_effect=release_then_replace),
            patch("omnigallery.metadata.audio.time.sleep"),
        ):
            response = self.client.post("/api/audio_metadata", json=request)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(attempts, 2)
        request = self.edit_request(path)
        original = path.read_bytes()
        with (
            patch("omnigallery.metadata.audio.os.replace", side_effect=busy),
            patch("omnigallery.metadata.audio.time.sleep"),
        ):
            response = self.client.post("/api/audio_metadata", json=request)
        self.assertEqual(response.status_code, 422)
        self.assertIn("占用", response.json()["detail"])
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual(list(self.root.glob(".omnigallery-audio-*")), [])

    @unittest.skipUnless(shutil.which("ffmpeg"), "FFmpeg required")
    def test_tag_write_closes_active_preview_range_reader_before_replace(self):
        path = self.make_mp3()
        request = self.edit_request(path)
        reader = send_bytes_range_requests(str(path), 0, path.stat().st_size - 1, chunk_size=16)
        original_replace = os.replace
        try:
            self.assertEqual(len(next(reader)), 16)
            self.assertIn(str(path), video_file_handler)

            def replace_after_preview_release(source, destination):
                self.assertNotIn(str(path), video_file_handler)
                original_replace(source, destination)

            with patch(
                "omnigallery.metadata.audio.os.replace", side_effect=replace_after_preview_release
            ):
                response = self.client.post("/api/audio_metadata", json=request)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(list(reader), [])
            self.assertEqual(MP3(path).tags.getall("TIT2")[0].text, ["新歌曲名"])
        finally:
            reader.close()


if __name__ == "__main__":
    unittest.main()
