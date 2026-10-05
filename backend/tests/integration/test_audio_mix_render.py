import copy
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
import uuid
import wave
from pathlib import Path
from unittest.mock import patch

import numpy as np
from fastapi import HTTPException
from pydantic import ValidationError

from omnigallery.workspaces.audio_mix_cache import AudioMixCacheManager
from omnigallery.workspaces.audio_mix_render import (
    export_mix_slice,
    needs_full_mix,
    render_full_mix,
    sound_document,
    sound_duration,
    sound_revision_payload,
)
from omnigallery.workspaces.audio_studio import AudioDocument, AudioRender, render_audio
from omnigallery.workspaces.video_audio import PreviewCancelled, render_video_audio
from omnigallery.workspaces.video_studio import VideoDocument


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg required")
class AudioMixRenderTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "source.wav"
        clock = np.arange(8 * 48000) / 48000
        level = np.where(clock < 3, 0.1, 0.65)
        signal = np.column_stack(
            (level * np.sin(2 * np.pi * 440 * clock), level / 3 * np.sin(2 * np.pi * 880 * clock))
        )
        with wave.open(str(self.source), "wb") as output:
            output.setnchannels(2)
            output.setsampwidth(2)
            output.setframerate(48000)
            output.writeframes((signal * 32767).astype("<i2").tobytes())

    def audio(self):
        return AudioDocument.model_validate(
            {
                "version": 1,
                "tracks": [
                    {
                        "id": "track",
                        "clips": [
                            {
                                "id": "clip",
                                "path": str(self.source),
                                "name": "source",
                                "start": 0,
                                "sourceIn": 0,
                                "duration": 8,
                                "gain": 1,
                                "fadeIn": 0,
                                "fadeOut": 0,
                                "envelopeOffset": 0,
                                "envelopeDuration": 8,
                            }
                        ],
                    }
                ],
                "masterGain": 1,
            }
        )

    def video(self):
        clip = self.audio().tracks[0].clips[0].model_dump()
        clip.pop("sourceKind", None)
        clip.update(kind="audio", sourceDuration=8)
        return VideoDocument.model_validate(
            {
                "version": 1,
                "width": 320,
                "height": 240,
                "fps": 12,
                "sounds": [clip],
                "visuals": [],
                "captions": [],
                "markers": [],
            }
        )

    @staticmethod
    def pcm(path):
        result = subprocess.run(
            [
                shutil.which("ffmpeg"),
                "-nostdin",
                "-v",
                "error",
                "-i",
                str(path),
                "-ar",
                "48000",
                "-ac",
                "2",
                "-f",
                "f32le",
                "pipe:1",
            ],
            capture_output=True,
            check=True,
        )
        return np.frombuffer(result.stdout, "<f4").reshape(-1, 2)

    def mix(self, kind, document, target="complete.wav", **kwargs):
        stage = self.root / (target + "-stage")
        stage.mkdir()
        path = self.root / target
        sources = [self.source for _ in sound_document(kind, document).sounds]
        render_full_mix(kind, document, sources, path, stage, **kwargs)
        return path

    def test_normalized_complete_audio_and_video_chunks_match_final_float_samples(self):
        for kind, document in (("audio", self.audio()), ("video", self.video())):
            with self.subTest(kind=kind):
                document.processing.normalize = "voice"
                if kind == "audio":
                    document.tracks[0].processing.normalize = "music"
                else:
                    document.sounds[0].channels = "swap"
                path = self.mix(kind, document, kind + ".wav")
                full = self.pcm(path)
                self.assertEqual(len(full), 8 * 48000)
                chunk = self.root / (kind + "-chunk.wav")
                export_mix_slice(path, chunk, self.root, 2.375, 4.125, float_output=True)
                np.testing.assert_array_equal(self.pcm(chunk), full[114000:312000])
                output = self.root / (kind + "-export.wav")
                export_mix_slice(path, output, self.root, 2.375, 4.125)
                np.testing.assert_allclose(self.pcm(output), full[114000:312000], atol=1 / 32768)

    def test_only_audible_pitch_preserving_speed_changes_require_complete_mix(self):
        for kind, document in (("audio", self.audio()), ("video", self.video())):
            clip = document.tracks[0].clips[0] if kind == "audio" else document.sounds[0]
            with self.subTest(kind=kind):
                self.assertFalse(needs_full_mix(kind, document))
                for rate in (0.5, 2):
                    clip.rate = rate
                    self.assertTrue(needs_full_mix(kind, document))
                clip.preservePitch = False
                self.assertFalse(needs_full_mix(kind, document))
                clip.preservePitch = True
                if kind == "audio":
                    document.tracks[0].muted = True
                else:
                    from omnigallery.workspaces.video_studio import Track

                    document.tracks = [Track(id="audio-1", kind="audio", muted=True)]
                self.assertFalse(needs_full_mix(kind, document))
                document.tracks[0].muted = False
                document.tracks[0].solo = True
                self.assertTrue(needs_full_mix(kind, document))
                if kind == "video":
                    clip.freeze = True
                    self.assertFalse(needs_full_mix(kind, document))

    def test_atempo_cached_seek_chunks_match_complete_export_across_internal_boundary(self):
        manager = AudioMixCacheManager(
            root=self.root / "atempo-cache",
            validate_workspace=lambda _: None,
            normalizer=lambda kind, document: document,
            source_resolver=lambda kind, document, workspace, trust: [self.source],
            revision_payload=sound_revision_payload,
            duration_fn=sound_duration,
            free_reserve=0,
        )
        self.addCleanup(manager.close)
        workspace = str(uuid.uuid4())
        for kind, document in (("audio", self.audio()), ("video", self.video())):
            with self.subTest(kind=kind):
                clip = document.tracks[0].clips[0] if kind == "audio" else document.sounds[0]
                clip.rate, clip.duration, clip.envelopeDuration = 0.5, 16, 16
                # No other processing requests a full cache: atempo alone must opt in.
                self.assertTrue(needs_full_mix(kind, document))
                with patch(
                    "omnigallery.workspaces.audio_mix_cache.get_audio_mix_cache_manager",
                    return_value=manager,
                ):
                    if kind == "audio":
                        request = AudioRender(
                            workspace_id=workspace, document=document, start=8, duration=4
                        )
                        with self.assertRaises(HTTPException) as missing:
                            render_audio(
                                request,
                                self.root / "not-ready.wav",
                                lambda _: None,
                                preview_context=True,
                            )
                        self.assertEqual(missing.exception.status_code, 409)
                    job = manager.start(workspace, kind, document)
                    deadline = time.monotonic() + 20
                    while time.monotonic() < deadline:
                        status = manager.get(job["id"], workspace)
                        if status["state"] not in ("queued", "running"):
                            break
                        time.sleep(0.01)
                    self.assertEqual(status["state"], "ready", status)
                    with manager.lease_ready(workspace, kind, document) as path:
                        self.assertIsNotNone(path)
                        full = self.pcm(path)
                        self.assertEqual(full.shape, (16 * 48000, 2))
                        # Crosses the 10-second bounded decoder boundary, and seeks at
                        # non-round times before/after it. All reads use finalized PCM.
                        for index, (start, duration) in enumerate(
                            ((8, 4), (9.73125, 2.125), (12.375, 2.125))
                        ):
                            body, _ = manager.chunk(job["id"], workspace, start, duration)
                            chunk = self.root / f"{kind}-tempo-chunk-{index}.wav"
                            chunk.write_bytes(body)
                            expected = full[
                                round(start * 48000) : round((start + duration) * 48000)
                            ]
                            np.testing.assert_array_equal(self.pcm(chunk), expected)
                            exported = self.root / f"{kind}-tempo-export-{index}.wav"
                            if kind == "audio":
                                request = AudioRender(
                                    workspace_id=workspace,
                                    document=document,
                                    start=start,
                                    duration=duration,
                                )
                                preview = self.root / f"audio-tempo-preview-{index}.wav"
                                render_audio(request, preview, lambda _: None, preview_context=True)
                                np.testing.assert_array_equal(self.pcm(preview), expected)
                                render_audio(request, exported, lambda _: None)
                            else:
                                export_mix_slice(path, exported, self.root, start, duration)
                            np.testing.assert_allclose(self.pcm(exported), expected, atol=1 / 32768)

    def test_empty_mix_and_tail_beyond_sound_duration_produce_exact_silence_samples(self):
        doc = self.audio()
        path = self.mix("audio", doc)
        tail = self.root / "tail.wav"
        export_mix_slice(path, tail, self.root, 9, 1.125, float_output=True)
        self.assertEqual(self.pcm(tail).shape, (54000, 2))
        self.assertEqual(np.max(np.abs(self.pcm(tail))), 0)
        doc.tracks.clear()
        doc.processing.normalize = "voice"
        self.assertEqual(sound_duration("audio", doc), 1 / 48000)
        path = self.mix("audio", doc, "empty.wav")
        self.assertEqual(self.pcm(path).shape, (1, 2))

    def test_duck_uses_same_processed_dialogue_and_bounded_inputs_as_full_graph(self):
        doc = self.audio()
        music = doc.tracks[0]
        music.role, music.duck, music.pan = "music", True, 1
        voice = music.model_copy(deep=True)
        voice.id, voice.role, voice.duck, voice.pan = "voice", "dialogue", False, -1
        voice.clips[0].id = "voice-clip"
        voice.gain = 0.6
        voice.processing.equalizer = "voice"
        doc.tracks.append(voice)
        commands = []

        def runner(args, directory, span):
            commands.append(args)
            return subprocess.run(args, cwd=directory, capture_output=True, check=True)

        path = self.mix("audio", doc, runner=runner)
        expected = self.root / "legacy.wav"
        # Independent single-process oracle: processed dialogue drives the sidechain,
        # and both buses remain audible in the result.
        graph = (
            "[0:a]pan=stereo|c0=0*c0|c1=c1,aresample=48000:osf=fltp,asetnsamples=n=1024:p=1[music];"
            "[1:a]volume=.6,pan=stereo|c0=c0|c1=0*c1,highpass=f=80,"
            "equalizer=f=2500:t=q:w=0.8:g=2,aresample=48000:osf=fltp,asetnsamples=n=1024:p=1,asplit=2[voice][side];"
            "[music][side]sidechaincompress=threshold=.025:ratio=8:attack=20:release=400[duck];"
            "[voice][duck]amix=inputs=2:normalize=0:dropout_transition=0,atrim=end=8[out]"
        )
        subprocess.run(
            [
                shutil.which("ffmpeg"),
                "-nostdin",
                "-v",
                "error",
                "-y",
                "-i",
                str(self.source),
                "-i",
                str(self.source),
                "-filter_complex",
                graph,
                "-map",
                "[out]",
                "-t",
                "8",
                "-c:a",
                "pcm_f32le",
                str(expected),
            ],
            capture_output=True,
            check=True,
        )
        np.testing.assert_allclose(self.pcm(path), self.pcm(expected), atol=0.0001)
        self.assertTrue(all(args.count("-i") <= 2 for args in commands))

    def test_more_than_256_overlapping_clips_are_bounded_to_two_decoder_inputs(self):
        doc = self.audio()
        clip = doc.tracks[0].clips[0]
        clip.duration = clip.envelopeDuration = 0.1
        doc.tracks[0].clips = [clip.model_copy(update={"id": str(i)}) for i in range(256)]
        extra = doc.tracks[0].model_copy(deep=True)
        extra.id, extra.clips = "second", [clip.model_copy(update={"id": "257"})]
        doc.tracks.append(extra)
        commands = []

        def runner(args, directory, span):
            commands.append(args)
            Path(args[-1]).write_bytes(b"bounded stub output")
            return subprocess.CompletedProcess(args, 0, stderr=b"")

        with patch(
            "omnigallery.workspaces.audio_mix_render.source_metadata",
            return_value={"duration": 8, "audio": True},
        ):
            self.mix("audio", doc, runner=runner)
        self.assertGreaterEqual(len(commands), 260)
        self.assertTrue(all(args.count("-i") <= 2 for args in commands))

    def test_sound_revision_ignores_editor_metadata_and_changes_for_actual_processing(self):
        from omnigallery.workspaces.audio_studio import AudioExport
        from omnigallery.workspaces.video_studio import VideoExport

        for kind, doc in (("audio", self.audio()), ("video", self.video())):
            raw = doc.model_dump()
            marker = {"id": "marker", "name": "检查点", "time": 1}
            raw["markers"] = [marker]
            doc = type(doc).model_validate(raw)
            payload = sound_revision_payload(kind, doc)
            note = "备注\n" + "字" * 1997
            raw["markers"][0]["note"] = note
            changed = type(doc).model_validate(raw)
            restored = type(doc).model_validate_json(changed.model_dump_json())
            self.assertEqual(restored.markers[0].note, note)
            request = {
                "workspace_id": "workspace",
                "document_id": "draft",
                "document_revision": "a" * 64,
                "document": restored.model_dump(),
                "name": "export",
            }
            if kind == "audio":
                request["duration"] = 1
                exported = AudioExport.model_validate(request)
                preview = AudioRender.model_validate(request)
                self.assertEqual(preview.document.markers[0].note, note)
            else:
                exported = VideoExport.model_validate(request)
            self.assertEqual(exported.document.markers[0].note, note)
            for invalid in (None, False, 7, [], {}, "字" * 2001):
                with self.subTest(kind=kind, invalid_type=type(invalid).__name__):
                    raw["markers"][0]["note"] = invalid
                    with self.assertRaises(ValidationError):
                        type(doc).model_validate(raw)
            if kind == "audio":
                changed.tracks[0].id = "renamed-track-id"
                changed.tracks[0].name = "renamed"
                changed.tracks[0].locked = True
                changed.tracks[0].clips[0].id = "renamed-clip-id"
                changed.tracks[0].clips[0].name = "renamed-clip"
            else:
                changed.width = 640
                changed.sounds[0].id, changed.sounds[0].name = "renamed", "new name"
            self.assertEqual(payload, sound_revision_payload(kind, changed))
            changed.masterGain = 0.5
            self.assertNotEqual(payload, sound_revision_payload(kind, changed))

    def test_invalid_source_duration_cannot_publish_a_complete_mix(self):
        for duration in (float("nan"), float("inf"), 0):
            with self.subTest(duration=duration):
                with patch(
                    "omnigallery.workspaces.audio_mix_render.source_metadata",
                    return_value={"duration": duration, "audio": True},
                ):
                    with self.assertRaises(HTTPException):
                        self.mix("audio", self.audio(), "invalid-" + str(duration) + ".wav")

    def test_cancel_prevents_processing_and_long_anchored_fades_survive_slow_playback(self):
        event = threading.Event()
        event.set()
        with self.assertRaises(PreviewCancelled):
            self.mix("audio", self.audio(), cancelled=event)
        doc = self.video()
        doc.sounds[0].duration, doc.sounds[0].rate = 1, 0.25
        doc.sounds[0].envelopeOffset, doc.sounds[0].envelopeDuration = 240, 480
        doc.sounds[0].fadeIn, doc.sounds[0].fadeOut = 480, 0
        checked = VideoDocument.model_validate(doc.model_dump())
        stage = self.root / "fade-stage"
        stage.mkdir()
        target = self.root / "fade.wav"
        render_video_audio(checked, [self.source], target, stage, 0, 1)
        # Compare to the identical time/pitch conversion without the anchored envelope.
        plain = checked.model_copy(deep=True)
        plain.sounds[0].fadeIn = 0
        plain_stage = self.root / "plain-stage"
        plain_stage.mkdir()
        plain_target = self.root / "plain.wav"
        render_video_audio(plain, [self.source], plain_target, plain_stage, 0, 1)
        full, original = self.pcm(target), self.pcm(plain_target)
        progress = (240 + np.arange(48000) / 48000) / 480
        np.testing.assert_allclose(full, original * progress[:, None], atol=0.0001)
        invalid = copy.deepcopy(checked.model_dump())
        invalid["sounds"][0]["envelopeDuration"] = None
        with self.assertRaises(ValidationError):
            VideoDocument.model_validate(invalid)


if __name__ == "__main__":
    unittest.main()
