import asyncio
import base64
import copy
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

import numpy as np

from backend.tests.integration import test_video_studio as fixtures
from omnigallery.workspaces import video_audio
from omnigallery.workspaces.video_audio import (
    PreviewCancelled,
    cancellable_process,
    render_video_audio,
    wait_preview,
)
from omnigallery.workspaces.video_studio import VideoDocument


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg required")
class VideoAudioTests(unittest.TestCase):
    def setUp(self):
        from omnigallery.workspaces.audio_mix_cache import AudioMixCacheManager

        fixtures.VideoStudioTests.setUp(self)
        self.mix_manager = AudioMixCacheManager(
            root=self.root / "mix-cache",
            check_path_trust=lambda _: None,
            validate_workspace=lambda _: None,
            free_reserve=0,
        )
        self.addCleanup(self.mix_manager.close)
        self.mix_patch = patch(
            "omnigallery.workspaces.audio_mix_cache.get_audio_mix_cache_manager",
            return_value=self.mix_manager,
        )
        self.mix_patch.start()
        self.addCleanup(self.mix_patch.stop)

    clip = fixtures.VideoStudioTests.clip
    save_document = fixtures.VideoStudioTests.save_document
    export = fixtures.VideoStudioTests.export
    frame = fixtures.VideoStudioTests.frame

    def source(self, duration=24):
        path = self.root / "stereo.wav"
        clock = np.arange(round(duration * 48000)) / 48000
        level = np.where(clock < 12, 0.6, 0.9)
        samples = np.column_stack(
            (level * np.sin(clock * 2 * np.pi * 440), level / 4 * np.sin(clock * 2 * np.pi * 880))
        )
        with wave.open(str(path), "wb") as out:
            out.setnchannels(2)
            out.setsampwidth(2)
            out.setframerate(48000)
            out.writeframes((samples * 32767).astype("<i2").tobytes())
        return path

    def document(self, path=None, duration=24, **fields):
        path = path or self.source(duration)
        return {
            "version": 1,
            "width": 320,
            "height": 240,
            "fps": 12,
            "visuals": [],
            "sounds": [
                self.clip(
                    path, "audio", duration=duration, sourceDuration=duration, gain=1, **fields
                )
            ],
            "captions": [],
            "markers": [],
        }

    @staticmethod
    def pcm(value):
        is_bytes = isinstance(value, bytes)
        result = subprocess.run(
            [
                shutil.which("ffmpeg"),
                "-nostdin",
                "-v",
                "error",
                "-i",
                "pipe:0" if is_bytes else str(value),
                "-map",
                "0:a:0",
                "-ac",
                "2",
                "-ar",
                "48000",
                "-f",
                "f32le",
                "pipe:1",
            ],
            input=value if is_bytes else None,
            capture_output=True,
            check=True,
        )
        return np.frombuffer(result.stdout, dtype="<f4").reshape(-1, 2)

    def preview(self, document, start=0, duration=1):
        from pydantic import ValidationError

        from omnigallery.workspaces.audio_mix_render import needs_full_mix

        try:
            model = VideoDocument.model_validate(document)
        except ValidationError:
            model = None
        if model is not None and needs_full_mix("video", model):
            job = self.mix_manager.start(self.workspace, "video", model)
            until = time.monotonic() + 15
            while job["state"] in {"queued", "running"} and time.monotonic() < until:
                time.sleep(0.02)
                job = self.mix_manager.get(job["id"], self.workspace)
            self.assertEqual(job["state"], "ready", job)
        return self.client.post(
            "/api/video_studio/preview-mix",
            json={
                "workspace_id": self.workspace,
                "document": document,
                "start": start,
                "duration": duration,
            },
        )

    def render(self, document, start=0, duration=None, **kwargs):
        model = VideoDocument.model_validate(document)
        target = self.root / "mix.wav"
        with tempfile.TemporaryDirectory(dir=self.root) as stage:
            render_video_audio(
                model,
                [Path(c.path) for c in model.sounds],
                target,
                Path(stage),
                start,
                duration or max(c.start + c.duration for c in model.sounds),
                **kwargs,
            )
        return self.pcm(target)

    def test_preview_and_export_helper_share_curves_points_channels_and_sample_clock(self):
        document = self.document(
            duration=6,
            channels="swap",
            invertPhase=True,
            fadeIn=2,
            fadeOut=1,
            fadeCurve="equalPower",
            pan=-0.2,
            gainPoints=[
                {"time": 0, "gain": 0.25},
                {"time": 3, "gain": 1.5},
                {"time": 6, "gain": 0.4},
            ],
        )
        full = self.render(document)
        preview = self.preview(document, 1.125, 3.75)
        self.assertEqual(
            preview.status_code, 200, preview.text[:100] if preview.status_code != 200 else ""
        )
        actual = self.pcm(preview.content)
        self.assertEqual(len(actual), 180000)
        self.assertLess(np.max(np.abs(actual - full[54000:234000])), 0.0001)
        levels = np.frombuffer(
            base64.b64decode(preview.headers["X-Audio-Level-Peaks"]), "<f4"
        ).reshape(-1, 2)
        self.assertEqual(len(levels), 75)
        self.assertGreater(levels[:, 1].max(), levels[:, 0].max() * 2)

    def test_stateful_dsp_does_not_reset_at_export_ten_second_or_preview_twelve_second_seams(self):
        document = self.document()
        document["tracks"] = [
            {
                "id": "audio-1",
                "kind": "audio",
                "gain": 1.3,
                "pan": 0.2,
                "processing": {
                    "equalizer": "custom",
                    "eq": {"low": 2, "mid": -3, "high": 1},
                    "compressor": "custom",
                    "compression": {"thresholdDb": -24, "ratio": 5, "release": 400},
                },
            }
        ]
        document["processing"] = {"compressor": "gentle", "limiter": True}
        document["masterGain"] = 0.75
        full = self.render(document)
        response = self.preview(document, 12, 12)
        self.assertEqual(response.status_code, 200)
        preview = self.pcm(response.content)
        self.assertEqual(len(preview), 576000)
        self.assertLess(np.sqrt(np.mean((preview - full[576000:]) ** 2)), 0.0005)
        # The raw window seams must not create silence or missing samples.
        self.assertGreater(np.max(np.abs(full[479900:480100])), 0.02)
        self.assertGreater(np.max(np.abs(full[959900:960100])), 0.02)

    def test_trimmed_and_extended_envelopes_keep_the_original_anchor(self):
        path = self.source(6)
        original = self.document(path, 6, fadeIn=2, fadeOut=2, fadeCurve="smooth")
        full = self.render(original)
        trimmed = copy.deepcopy(original)
        trimmed["sounds"][0].update(duration=3, sourceIn=1, envelopeOffset=1, envelopeDuration=6)
        actual = self.render(trimmed)
        self.assertLess(np.max(np.abs(actual - full[48000:192000])), 0.0001)
        extended = copy.deepcopy(original)
        extended["sounds"][0].update(duration=4, envelopeOffset=-1, envelopeDuration=3)
        actual = self.render(extended)
        self.assertLess(np.max(np.abs(actual[:48000])), 0.00001)
        self.assertGreater(np.max(np.abs(actual[72000:96000])), 0.05)

    def test_reverse_speed_pitch_policy_and_freeze_share_preview_and_render(self):
        path = self.source(8)
        document = self.document(path, 4, rate=2, reverse=True, preservePitch=False)
        document["sounds"][0]["sourceDuration"] = 8
        full = self.render(document)
        response = self.preview(document, 1, 2)
        self.assertEqual(response.status_code, 200)
        self.assertLess(np.max(np.abs(self.pcm(response.content) - full[48000:144000])), 0.0002)
        spectrum = np.fft.rfft(full[48000:96000, 0])
        self.assertAlmostEqual(np.argmax(np.abs(spectrum)), 880, delta=2)
        document["sounds"][0]["freeze"] = True
        frozen = self.preview(document, 0, 1)
        self.assertEqual(frozen.status_code, 200)
        self.assertEqual(np.max(np.abs(self.pcm(frozen.content))), 0)

    def test_track_solo_hidden_phase_and_bypass_are_preserved_in_actual_mp4(self):
        path = self.source(2)
        document = self.document(path, 2, channels="mono", invertPhase=True)
        document["tracks"] = [
            {
                "id": "audio-1",
                "kind": "audio",
                "solo": True,
                "gain": 1.2,
                "processing": {"compressor": "voice", "bypass": True},
            },
            {"id": "other", "kind": "audio", "gain": 4},
        ]
        other = copy.deepcopy(document["sounds"][0])
        other.update(id="other-clip", trackId="other", gain=4)
        document["sounds"].append(other)
        expected = self.render(document)
        response = self.export(document)
        self.assertEqual(response.status_code, 200, response.text[:400])
        output = self.root / "exported.mp4"
        file = self.client.get(f"/api/workspace_artifacts/{response.json()['id']}/file")
        self.assertEqual(file.status_code, 200)
        output.write_bytes(file.content)
        actual = self.pcm(output)
        self.assertLess(
            np.sqrt(np.mean((actual[: len(expected)] - expected[: len(actual)]) ** 2)), 0.01
        )
        self.assertLess(np.max(np.abs(expected[:, 0] - expected[:, 1])), 0.00001)
        document["tracks"][0]["hidden"] = True
        hidden = self.preview(document)
        self.assertEqual(hidden.status_code, 200)
        self.assertEqual(np.max(np.abs(self.pcm(hidden.content))), 0)

    def test_processed_selection_mp4_reuses_complete_mix_and_matches_cached_preview(self):
        for processing in (
            {"normalize": "voice"},
            {"compressor": "custom", "compression": {"thresholdDb": -24, "ratio": 6}},
        ):
            with self.subTest(processing=processing):
                document = self.document(duration=6)
                document["processing"] = processing
                raw = self.client.post(
                    "/api/video_studio/preview-mix",
                    json={
                        "workspace_id": self.workspace,
                        "document": document,
                        "start": 0.75,
                        "duration": 1.5,
                    },
                )
                self.assertEqual(raw.status_code, 409)
                expected = self.pcm(self.preview(document, 0.75, 1.5).content)
                with patch(
                    "omnigallery.workspaces.audio_mix_render.render_full_mix",
                    side_effect=AssertionError("cache must be reused"),
                ):
                    response = self.export(document, range={"start": 0.75, "end": 2.25})
                self.assertEqual(response.status_code, 200, response.text[:300])
                target = self.root / "processed-selection.mp4"
                target.write_bytes(
                    self.client.get(
                        f"/api/workspace_artifacts/{response.json()['id']}/file"
                    ).content
                )
                actual = self.pcm(target)
                count = min(len(expected), len(actual))
                self.assertGreaterEqual(count, 1.45 * 48000)
                self.assertLess(np.sqrt(np.mean((actual[:count] - expected[:count]) ** 2)), 0.01)

    def test_atempo_alone_prepares_cached_preview_and_mp4_export_from_identical_samples(self):
        document = self.document(duration=8, rate=0.5, preservePitch=True)
        document["sounds"][0].update(duration=16, envelopeDuration=16)
        request = {
            "workspace_id": self.workspace,
            "document": document,
            "start": 8,
            "duration": 4,
        }
        # Stateful atempo alone must reject the old independently decoded preview.
        self.assertEqual(
            self.client.post("/api/video_studio/preview-mix", json=request).status_code, 409
        )
        preview = self.preview(document, 8, 4)
        self.assertEqual(preview.status_code, 200)
        expected = self.pcm(preview.content)
        with self.mix_manager.lease_ready(
            self.workspace, "video", VideoDocument.model_validate(document)
        ) as cached:
            self.assertIsNotNone(cached)
            np.testing.assert_array_equal(expected, self.pcm(cached)[8 * 48000 : 12 * 48000])
        from omnigallery.workspaces.audio_mix_render import export_mix_slice

        export_inputs = []

        def checked_slice(*args, **kwargs):
            result = export_mix_slice(*args, **kwargs)
            export_inputs.append(self.pcm(args[1]))
            return result

        with (
            patch(
                "omnigallery.workspaces.audio_mix_render.render_full_mix",
                side_effect=AssertionError("the finalized atempo cache must be reused"),
            ),
            patch(
                "omnigallery.workspaces.audio_mix_render.export_mix_slice",
                side_effect=checked_slice,
            ),
        ):
            response = self.export(document, range={"start": 8, "end": 12})
        self.assertEqual(response.status_code, 200, response.text[:300])
        self.assertEqual(len(export_inputs), 1)
        np.testing.assert_array_equal(export_inputs[0], expected)
        target = self.root / "atempo-selection.mp4"
        target.write_bytes(
            self.client.get(f"/api/workspace_artifacts/{response.json()['id']}/file").content
        )
        actual = self.pcm(target)
        self.assertGreaterEqual(len(actual), 3.95 * 48000)
        # Compare AAC to an independently encoded identical PCM slice, rather than
        # treating lossy codec error as a timing or mixing error.
        oracle_source = self.root / "atempo-oracle.wav"
        oracle_source.write_bytes(preview.content)
        oracle = self.root / "atempo-oracle.m4a"
        subprocess.run(
            [
                shutil.which("ffmpeg"),
                "-nostdin",
                "-v",
                "error",
                "-y",
                "-i",
                str(oracle_source),
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-t",
                "4",
                str(oracle),
            ],
            capture_output=True,
            check=True,
        )
        np.testing.assert_array_equal(actual, self.pcm(oracle))

    def test_long_internal_visual_fade_retains_slow_motion_envelope_after_trim(self):
        document = self.document(duration=1)
        document["sounds"] = []
        document["visuals"] = [
            self.clip(
                self.image,
                "image",
                duration=1,
                fadeIn=480,
                envelopeOffset=240,
                envelopeDuration=480,
                fadeCurve="smooth",
            )
        ]
        response = self.export(document)
        self.assertEqual(response.status_code, 200, response.text[:300])
        target = self.root / "long-anchored-fade.mp4"
        target.write_bytes(
            self.client.get(f"/api/workspace_artifacts/{response.json()['id']}/file").content
        )
        self.assertAlmostEqual(
            self.frame(target, 0.25).getpixel((160, 120))[0], 230 * 0.50078125, delta=8
        )

    def test_preview_rejects_unbounded_invalid_fields_and_missing_audio(self):
        document = self.document(duration=2)
        self.assertEqual(self.preview(document, duration=12.01).status_code, 422)
        self.assertEqual(self.preview(document, start=21600, duration=1).status_code, 422)
        damaged = copy.deepcopy(document)
        damaged["sounds"][0]["gainPoints"] = [{"time": 1, "gain": 1}, {"time": 0, "gain": 1}]
        self.assertEqual(self.preview(damaged).status_code, 422)
        damaged["sounds"][0]["gainPoints"] = []
        damaged["sounds"][0]["pan"] = 1.01
        self.assertEqual(self.preview(damaged).status_code, 422)
        damaged["sounds"][0].update(path=str(self.image), kind="image")
        self.assertEqual(self.preview(damaged).status_code, 422)

    def test_visual_fade_uses_retained_anchor_and_the_same_curve_family(self):
        document = self.document(duration=1)
        document["sounds"] = []
        clip = self.clip(
            self.image, "image", duration=1, fadeIn=2, envelopeOffset=1, envelopeDuration=4
        )
        document["visuals"] = [clip]
        for curve, progress in (
            ("linear", 0.625),
            ("smooth", 0.68359375),
            ("equalPower", 0.8314696),
        ):
            with self.subTest(curve=curve):
                clip["fadeCurve"] = curve
                response = self.export(document)
                self.assertEqual(response.status_code, 200, response.text[:300])
                output = self.root / "fade.mp4"
                output.write_bytes(
                    self.client.get(
                        f"/api/workspace_artifacts/{response.json()['id']}/file"
                    ).content
                )
                pixel = self.frame(output, 0.25).getpixel((160, 120))
                self.assertAlmostEqual(pixel[0], 230 * progress, delta=8)
        clip["envelopeOffset"] = -0.5
        response = self.export(document)
        self.assertEqual(response.status_code, 200)
        output.write_bytes(
            self.client.get(f"/api/workspace_artifacts/{response.json()['id']}/file").content
        )
        self.assertLess(max(self.frame(output, 0.25).getpixel((160, 120))), 5)

    def test_sparse_clip_and_track_order_never_overwrites_the_accumulated_mix(self):
        path = self.source(24)
        document = self.document(path, 1)
        document["tracks"] = [
            {"id": "audio-1", "kind": "audio"},
            {"id": "empty", "kind": "audio"},
            {"id": "third", "kind": "audio"},
        ]
        document["sounds"] = [
            self.clip(path, "audio", sourceDuration=24, gain=0.1),
            self.clip(path, "audio", sourceDuration=24, start=20, gain=0.1),
            self.clip(path, "audio", sourceDuration=24, sourceIn=0, gain=0.2),
            self.clip(path, "audio", sourceDuration=24, trackId="third", gain=0.3),
        ]
        full = self.render(document, duration=21)
        self.assertGreater(np.max(np.abs(full[:48000])), 0.3)
        self.assertEqual(np.max(np.abs(full[48000 : 20 * 48000])), 0)
        preview = self.preview(document, 0, 1)
        self.assertEqual(preview.status_code, 200)
        self.assertLess(np.max(np.abs(self.pcm(preview.content) - full[:48000])), 0.00001)

    def test_consecutive_previews_cache_metadata_and_reprobe_changed_sources_without_reading_them(
        self,
    ):
        path = self.source(2)
        document = self.document(path, 2)
        original_read = Path.read_bytes
        original_process = video_audio.cancellable_process
        probes = []

        def checked_read(file):
            if file.resolve() == path.resolve():
                raise AssertionError("preview must not load the source file into memory")
            return original_read(file)

        def tracked(args, *rest, **kwargs):
            if Path(args[0]).stem == "ffprobe":
                probes.append(args)
            return original_process(args, *rest, **kwargs)

        with (
            patch.object(Path, "read_bytes", checked_read),
            patch.object(video_audio, "cancellable_process", tracked),
        ):
            self.assertEqual(self.preview(document, 0, 0.5).status_code, 200)
            self.assertEqual(self.preview(document, 0.5, 0.5).status_code, 200)
            self.assertEqual(len(probes), 1)
            self.source(3)
            self.assertEqual(self.preview(document, 1, 0.5).status_code, 200)
            self.assertEqual(len(probes), 2)

    def test_source_decoding_is_bounded_with_two_inputs_and_readonly_preview_has_no_write_guard(
        self,
    ):
        document = self.document(duration=24, reverse=True)
        commands = []

        def runner(args, stage, length):
            commands.append(args)
            return subprocess.run(args, cwd=stage, capture_output=True, check=True)

        self.render(document, start=10, duration=12, runner=runner)
        for args in commands:
            self.assertLessEqual(args.count("-i"), 2)
            if str(self.root / "stereo.wav") in args:
                self.assertLessEqual(float(args[args.index("-t") + 1]), 10.5)
        # The registered preview route requires the secret, but no production-write permission.
        route = next(
            r
            for r in self.client.app.routes
            if getattr(r, "path", "") == "/api/video_studio/preview-mix"
        )
        self.assertEqual(len(route.dependencies), 1)

    def test_cancel_terminates_the_real_process_and_disconnect_cancels_worker(self):
        cancelled, started, processes = threading.Event(), threading.Event(), []
        popen = subprocess.Popen

        def tracked(*args, **kwargs):
            process = popen(*args, **kwargs)
            processes.append(process)
            started.set()
            return process

        def run():
            return cancellable_process(
                [
                    shutil.which("ffmpeg"),
                    "-nostdin",
                    "-re",
                    "-f",
                    "lavfi",
                    "-i",
                    "sine=d=60",
                    "-f",
                    "null",
                    "-",
                ],
                self.root,
                60,
                cancelled,
            )

        def worker():
            try:
                run()
            except PreviewCancelled:
                return "cancelled"

        async def disconnected():
            return started.is_set()

        before = time.monotonic()
        with patch("omnigallery.workspaces.video_audio.subprocess.Popen", tracked):
            self.assertEqual(
                asyncio.run(wait_preview(worker, disconnected, cancelled)), "cancelled"
            )
        self.assertLess(time.monotonic() - before, 5)
        self.assertTrue(cancelled.is_set())
        self.assertTrue(all(p.poll() is not None for p in processes))
