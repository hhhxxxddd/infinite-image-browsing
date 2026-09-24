"""Audio cover and lyric access through the local, trusted API."""

import tempfile
import unittest
import wave
import io
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from PIL import Image
from mutagen.id3 import APIC, TALB, TIT2, TPE1, SYLT, USLT
from mutagen.wave import WAVE

from scripts.iib.audio_metadata import mount_audio_routes


class AudioMetadataTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
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
        (self.root / "song.v1.lrc").write_text("[00:01.50]第一句\n[00:02.25]第二句", encoding="utf-8")
        Image.new("RGB", (640, 400), "#1468a0").save(self.root / "cover.png")
        response = self.client.get("/api/audio_metadata", params={"path": str(self.track)})
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(data["title"], "song.v1")
        self.assertTrue(data["has_cover"])
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
        self.assertEqual(self.client.get("/api/audio_cover", params={"path": str(self.track)}).status_code, 404)

    def test_rejects_non_audio(self):
        other = self.root / "note.txt"
        other.write_text("not audio", encoding="utf-8")
        self.assertEqual(self.client.get("/api/audio_metadata", params={"path": str(other)}).status_code, 404)

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
        audio.tags.add(SYLT(encoding=3, format=2, type=1, text=[("第一句", 1000), ("第二句", 2200)]))
        audio.save()
        (self.root / "song.v1.lrc").write_text("", encoding="utf-8")

        data = self.client.get("/api/audio_metadata", params={"path": str(self.track)}).json()
        self.assertEqual([data[key] for key in ("title", "artist", "album")], ["曲名", "作者", "专辑"])
        self.assertEqual(data["lyrics"], {"source": "embedded", "timed": True, "lines": [
            {"time": 1.0, "text": "第一句"}, {"time": 2.2, "text": "第二句"}]})
        self.assertTrue(data["has_cover"])
        self.assertEqual(self.client.get("/api/audio_cover", params={"path": str(self.track)}).status_code, 200)


if __name__ == "__main__":
    unittest.main()
