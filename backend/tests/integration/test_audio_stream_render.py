import shutil
import subprocess
import threading
import unittest

import numpy as np
from fastapi import HTTPException
from pydantic import ValidationError

from backend.tests.integration.test_audio_mix_render import AudioMixRenderTests
from omnigallery.workspaces.audio_mix_render import render_full_mix, sound_revision_payload
from omnigallery.workspaces.audio_studio import (
    AudioDocument,
    AudioRender,
    probe_source,
    render_audio,
    waveform,
)
from omnigallery.workspaces.video_audio import render_video_audio, source_metadata
from omnigallery.workspaces.video_studio import VideoExport, render_video


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg required")
class AudioStreamRenderTests(unittest.TestCase):
    setUp = AudioMixRenderTests.setUp
    audio = AudioMixRenderTests.audio
    video = AudioMixRenderTests.video
    pcm = staticmethod(AudioMixRenderTests.pcm)

    def multistream(self):
        path = self.root / "two.mkv"
        subprocess.run(
            [
                shutil.which("ffmpeg"),
                "-nostdin",
                "-v",
                "error",
                "-y",
                "-i",
                str(self.source),
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=660:sample_rate=48000:duration=6",
                "-filter_complex",
                "[1:a]volume=3,asetpts=PTS+2/TB[late]",
                "-map",
                "0:a",
                "-map",
                "[late]",
                "-metadata:s:a:0",
                "title=Original",
                "-metadata:s:a:1",
                "title=Delayed",
                "-c:a",
                "pcm_s16le",
                str(path),
            ],
            check=True,
            capture_output=True,
        )
        return path

    def test_selected_stream_metadata_waveform_and_complete_mix_preserve_container_time(self):
        path = self.multistream()
        for kind in ("audio", "video"):
            doc = self.audio() if kind == "audio" else self.video()
            clip = doc.tracks[0].clips[0] if kind == "audio" else doc.sounds[0]
            clip.path = str(path)
            clip.audioStream = 1
            metadata = probe_source(path, 1)
            self.assertEqual(metadata["ordinal"], 1)
            self.assertAlmostEqual(metadata["start_time"], 2, places=2)
            self.assertEqual(len(metadata["audio_streams"]), 2)
            complete = self.root / (kind + ".wav")
            stage = self.root / (kind + "stage")
            stage.mkdir()
            render_full_mix(kind, doc, [path], complete, stage)
            samples = self.pcm(complete)
            self.assertEqual(samples.shape, (8 * 48000, 2))
            self.assertLess(np.max(np.abs(samples[: round(1.99 * 48000)])), 0.0001)
            self.assertGreater(np.max(np.abs(samples[round(2.05 * 48000) : round(3 * 48000)])), 0.2)
            old = sound_revision_payload(kind, doc)
            clip.audioStream = 0
            self.assertNotEqual(old, sound_revision_payload(kind, doc))
        peaks = waveform(path, 0, 3, 300, 1)
        self.assertLess(max(peaks["peaks"][:195]), 0.0001)
        self.assertGreater(max(peaks["peaks"][210:]), 0.2)
        peaks0 = waveform(path, 0, 3, 300, 0)
        self.assertGreater(max(peaks0["peaks"][:195]), 0.09)
        for start, duration in [(0, 1), (1, 0.5), (0, 2)]:
            with unittest.mock.patch(
                "omnigallery.workspaces.audio_studio.subprocess.Popen",
                side_effect=AssertionError("silent window must not decode"),
            ):
                silent = waveform(path, start, duration, 100, 1)
            self.assertEqual(silent["peaks"], [0] * 100)

    def test_quick_preview_reverse_speed_and_export_use_requested_stream(self):
        path = self.multistream()
        doc = self.video()
        clip = doc.sounds[0]
        clip.path = str(path)
        clip.audioStream = 1
        info = source_metadata(path, self.root, threading.Event(), 1)
        target = self.root / "quick.wav"
        stage = self.root / "quick"
        stage.mkdir()
        render_video_audio(doc, [path], target, stage, 0, 4, source_info=[info], preview=True)
        samples = self.pcm(target)
        self.assertLess(np.max(np.abs(samples[: round(1.99 * 48000)])), 0.0001)
        self.assertGreater(np.max(np.abs(samples[3 * 48000 :])), 0.2)
        clip.reverse = True
        clip.rate = 2
        clip.duration = 4
        clip.envelopeDuration = 4
        reverse = self.root / "reverse.wav"
        revstage = self.root / "revstage"
        revstage.mkdir()
        render_video_audio(doc, [path], reverse, revstage, 0, 4, source_info=[info])
        values = self.pcm(reverse)
        self.assertGreater(np.max(np.abs(values[: 2 * 48000])), 0.2)
        self.assertLess(np.max(np.abs(values[round(3.1 * 48000) :])), 0.0001)
        audio = self.audio()
        audio.tracks[0].clips[0].path = str(path)
        audio.tracks[0].clips[0].audioStream = 1
        exported = self.root / "export.wav"
        render_audio(
            AudioRender(workspace_id="scope", document=audio, start=0, duration=4),
            exported,
            lambda _: None,
        )
        np.testing.assert_allclose(self.pcm(exported), samples, atol=1 / 32768)
        doc.sounds[0].reverse = False
        doc.sounds[0].kind = "video"
        doc.sounds[0].rate = 1
        doc.sounds[0].duration = doc.sounds[0].envelopeDuration = 8
        movie = self.root / "selected-stream.mp4"
        movie_stage = self.root / "movie-stage"
        movie_stage.mkdir()
        render_video(
            VideoExport(
                workspace_id="scope",
                document_id="draft",
                document_revision="a" * 64,
                document=doc,
                name="selected",
                range={"start": 0, "end": 4},
            ),
            movie,
            movie_stage,
            lambda _: None,
        )
        encoded = self.pcm(movie)[: 4 * 48000]
        self.assertLess(np.max(np.abs(encoded[: round(1.9 * 48000)])), 0.0001)
        self.assertGreater(np.max(np.abs(encoded[3 * 48000 :])), 0.2)
        self.assertLess(np.sqrt(np.mean((encoded - samples) ** 2)), 0.01)

    def test_missing_or_invalid_stream_never_falls_back(self):
        path = self.multistream()
        with self.assertRaises(HTTPException):
            probe_source(path, 2)
        with self.assertRaises(HTTPException):
            source_metadata(path, self.root, threading.Event(), 2)
        with self.assertRaises(HTTPException):
            waveform(path, 0, 1, 100, 2)
        doc = self.audio()
        doc.tracks[0].clips[0].path = str(path)
        doc.tracks[0].clips[0].audioStream = 2
        with self.assertRaises(HTTPException):
            render_full_mix("audio", doc, [path], self.root / "invalid.wav", self.root / "invalid")
        for value in (-1, 256, True, 1.5):
            raw = doc.model_dump()
            raw["tracks"][0]["clips"][0]["audioStream"] = value
            with self.assertRaises(ValidationError):
                AudioDocument.model_validate(raw)
