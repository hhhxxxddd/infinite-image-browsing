import asyncio
import json
import shutil
import subprocess
import threading
import time
import unittest
import uuid
import wave
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from fastapi import HTTPException

from backend.tests.integration import test_audio_studio as fixtures
from omnigallery.workspaces.audio_exports import AudioExports, AudioExportSubmission
from omnigallery.workspaces.audio_studio import AudioRender, render_audio
from omnigallery.workspaces.state import delete_workspace_state, mount_workspace_state_routes


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg required")
class AudioProcessingTests(unittest.TestCase):
    def setUp(self):
        from unittest.mock import patch

        from omnigallery.workspaces.audio_mix_cache import AudioMixCacheManager

        fixtures.AudioStudioTests.setUp(self)
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

    def preview(self, request):
        from omnigallery.workspaces.audio_mix_render import needs_full_mix
        from omnigallery.workspaces.audio_studio import AudioDocument

        doc = AudioDocument.model_validate(request["document"])
        if needs_full_mix("audio", doc):
            job = self.mix_manager.start(self.workspace, "audio", doc)
            until = time.monotonic() + 15
            while job["state"] in {"queued", "running"} and time.monotonic() < until:
                time.sleep(0.02)
                job = self.mix_manager.get(job["id"], self.workspace)
            self.assertEqual(job["state"], "ready", job)
        return self.client.post("/api/audio_studio/preview", json=request)

    clip = fixtures.AudioStudioTests.clip
    request = fixtures.AudioStudioTests.request
    pcm = fixtures.AudioStudioTests.pcm
    save_export_request = fixtures.AudioStudioTests.save_export_request

    def test_window_waveform_keeps_source_duration_and_requested_resolution(self):
        response = self.client.get(
            "/api/audio_studio/source",
            params={
                "workspace_id": self.workspace,
                "path": str(self.source),
                "peaks": True,
                "start": 0.5,
                "duration": 0.25,
                "samples": 320,
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(
            (data["duration"], data["window_start"], data["window_duration"]), (2, 0.5, 0.25)
        )
        self.assertEqual(len(data["peaks"]), 320)
        self.assertGreater(max(data["peaks"]), 0.2)
        self.assertEqual(len(data["channel_peaks"]), 2)
        self.assertEqual(len(data["channel_peaks"][0]), 320)

    def test_stereo_waveform_channel_processing_and_phase_match_rendered_samples(self):
        samples = np.column_stack((self.samples, self.samples // 4)).astype("<i2")
        with wave.open(str(self.source), "wb") as output:
            output.setnchannels(2)
            output.setsampwidth(2)
            output.setframerate(48000)
            output.writeframes(samples.tobytes())
        query = {
            "workspace_id": self.workspace,
            "path": str(self.source),
            "peaks": True,
            "start": 0.5,
            "duration": 0.25,
            "samples": 320,
        }
        data = self.client.get("/api/audio_studio/source", params=query).json()
        self.assertGreater(max(data["channel_peaks"][0]), max(data["channel_peaks"][1]) * 3.9)
        request = self.request([self.clip(start=0, gain=1, fadeIn=0, fadeOut=0)], duration=2)
        original = self.pcm(self.preview(request))
        for mode in ("swap", "mono", "left", "right"):
            request["document"]["tracks"][0]["clips"][0]["channels"] = mode
            changed = self.pcm(self.preview(request))
            expected = (
                original[:, ::-1]
                if mode == "swap"
                else np.column_stack((original.mean(axis=1), original.mean(axis=1)))
                if mode == "mono"
                else np.repeat(original[:, 0 if mode == "left" else 1, None], 2, axis=1)
            )
            np.testing.assert_allclose(changed, expected, atol=0.01)
        request["document"]["tracks"][0]["clips"][0].update(channels="stereo", invertPhase=True)
        inverted = self.pcm(self.preview(request))
        np.testing.assert_allclose(inverted, -original, atol=0.01)

    def test_custom_processing_and_bypass_retain_original_settings(self):
        request = self.request([self.clip(start=0, fadeIn=0, fadeOut=0)])
        original = self.pcm(self.preview(request))
        request["document"]["processing"] = {
            "equalizer": "custom",
            "eq": {"low": -12, "mid": -6, "high": 0},
            "compressor": "custom",
            "compression": {
                "thresholdDb": -24,
                "ratio": 4,
                "attack": 5,
                "release": 100,
                "makeupDb": 0,
            },
        }
        altered = self.pcm(self.preview(request))
        self.assertLess(np.max(np.abs(altered)), np.max(np.abs(original)))
        request["document"]["processing"]["bypass"] = True
        bypass = self.pcm(self.preview(request))
        np.testing.assert_allclose(bypass, original, atol=0.01)

    def test_fade_curves_match_export_and_arbitrary_preview_windows(self):
        for curve in ("linear", "smooth", "equalPower"):
            request = self.request([self.clip(start=0, fadeCurve=curve)], duration=2)
            preview = self.pcm(self.preview(request))
            part = self.pcm(
                self.client.post(
                    "/api/audio_studio/preview", json={**request, "start": 0.173, "duration": 1.4}
                )
            )
            np.testing.assert_allclose(part, preview[8304:75504], atol=0.01)
            target = self.root / (curve + ".wav")
            render_audio(AudioRender(**request), target, lambda _: None)
            with wave.open(str(target)) as output:
                exported = np.frombuffer(
                    output.readframes(output.getnframes()), dtype="<i2"
                ).reshape(-1, 2)
            np.testing.assert_allclose(exported, preview, atol=1)

    def test_analysis_measures_exact_complete_unclipped_mix_and_scopes_jobs(self):
        request = self.request([self.clip(start=0, gain=4, fadeIn=0, fadeOut=0)], duration=2)
        request["document"]["tracks"][0]["gain"] = 4
        submitted = self.client.post("/api/audio_studio/analysis", json=request)
        self.assertEqual(submitted.status_code, 200, submitted.text)
        key = submitted.json()["id"]
        self.assertEqual(
            self.client.get(
                "/api/audio_studio/analysis/" + key, params={"workspace_id": str(uuid.uuid4())}
            ).status_code,
            404,
        )
        result = submitted.json()
        deadline = time.monotonic() + 10
        while result["state"] == "running" and time.monotonic() < deadline:
            time.sleep(0.02)
            result = self.client.get(
                "/api/audio_studio/analysis/" + key, params={"workspace_id": self.workspace}
            ).json()
        self.assertEqual(result["state"], "completed", result)
        self.assertGreater(result["result"]["integrated_lufs"], -10)
        self.assertGreater(result["result"]["true_peak_dbfs"], 0)
        self.assertGreater(result["result"]["overload_windows"], 0)
        self.assertGreater(len(result["result"]["overload_ranges"]), 0)

    def test_analysis_cancellation_terminates_the_media_process_and_releases_slot(self):
        from unittest.mock import patch

        from omnigallery.workspaces.audio_analysis import (
            AnalysisCancelled,
            AudioAnalyses,
            inspect_audio,
        )

        event = threading.Event()
        event.set()
        with self.assertRaises(AnalysisCancelled):
            inspect_audio(AudioRender(**self.request()), lambda _: None, event)
        began = threading.Event()
        finished = threading.Event()

        def wait_for_cancel(request, trust, cancel):
            began.set()
            cancel.wait(5)
            finished.set()
            raise AnalysisCancelled()

        analyses = AudioAnalyses()
        with patch(
            "omnigallery.workspaces.audio_analysis.inspect_audio", side_effect=wait_for_cancel
        ):
            job = analyses.submit(AudioRender(**self.request()), lambda _: None)
            self.assertTrue(began.wait(1))
            with self.assertRaises(HTTPException) as busy:
                analyses.submit(AudioRender(**self.request()), lambda _: None)
            self.assertEqual(busy.exception.status_code, 409)
            with self.assertRaises(HTTPException):
                analyses.cancel(job["id"], str(uuid.uuid4()))
            analyses.cancel(job["id"], self.workspace)
            self.assertTrue(finished.wait(1))
            deadline = time.monotonic() + 1
            while (
                analyses.get(job["id"], self.workspace)["state"] == "running"
                and time.monotonic() < deadline
            ):
                time.sleep(0.01)
            self.assertEqual(analyses.get(job["id"], self.workspace)["state"], "cancelled")

    def test_analysis_reuses_final_processed_pcm_and_rejects_changed_source_revision(self):
        from unittest.mock import patch

        from omnigallery.workspaces.audio_analysis import inspect_audio

        request = self.request([self.clip(start=0, gain=1, fadeIn=0, fadeOut=0)], duration=2)
        request["document"]["processing"] = {"normalize": "voice"}
        self.pcm(self.preview(request))
        model = AudioRender(**request)
        with patch(
            "omnigallery.workspaces.audio_mix_render.render_full_mix",
            side_effect=AssertionError("ready PCM must be reused"),
        ):
            report = inspect_audio(model, lambda _: None)
        self.assertEqual(
            report["sound_revision"],
            self.mix_manager.revision(self.workspace, "audio", model.document),
        )
        self.assertLess(abs(report["integrated_lufs"] + 16), 1)
        with patch.object(self.mix_manager, "revision", side_effect=["a" * 64, "b" * 64]):
            with self.assertRaises(HTTPException) as changed:
                inspect_audio(model, lambda _: None)
        self.assertEqual(changed.exception.status_code, 409)

    def test_audio_preview_disconnect_reaps_decoder_and_releases_capacity(self):
        from pathlib import Path
        from unittest.mock import patch

        from omnigallery.workspaces import video_audio

        started, processes = threading.Event(), []
        original, popen = video_audio.cancellable_process, subprocess.Popen

        def slow(args, directory, span, cancel, **options):
            if Path(args[0]).stem == "ffmpeg":
                args = [
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
                ]
            return original(args, directory, span, cancel, **options)

        def tracked(args, **options):
            process = popen(args, **options)
            processes.append(process)
            if Path(args[0]).stem == "ffmpeg":
                started.set()
            return process

        class Http:
            async def is_disconnected(self):
                return started.is_set()

        endpoint = next(
            route.endpoint
            for route in self.client.app.routes
            if getattr(route, "path", "") == "/api/audio_studio/preview"
        )
        before = time.monotonic()
        with (
            patch.object(video_audio, "cancellable_process", slow),
            patch.object(video_audio.subprocess, "Popen", tracked),
        ):
            with self.assertRaises(HTTPException) as cancelled:
                asyncio.run(endpoint(AudioRender(**self.request()), Http()))
        self.assertEqual(cancelled.exception.status_code, 499)
        self.assertLess(time.monotonic() - before, 5)
        self.assertTrue(all(process.poll() is not None for process in processes))
        self.assertEqual(
            self.client.post("/api/audio_studio/preview", json=self.request()).status_code, 200
        )

    def test_analysis_accepts_more_than_256_clips_and_silence_after_mix_end(self):
        from unittest.mock import patch

        from omnigallery.workspaces.audio_analysis import inspect_audio

        request = self.request(
            [self.clip(id=f"clip-{i}", start=0, gain=1, fadeIn=0, fadeOut=0) for i in range(257)],
            duration=2,
        )
        decoded = []
        track = request["document"]["tracks"][0]
        last = track["clips"].pop()
        request["document"]["tracks"].append({**track, "id": "extra-track", "clips": [last]})

        def complete(kind, document, sources, target, directory, **options):
            decoded.append(len(sources))
            shutil.copyfile(self.source, target)

        with patch("omnigallery.workspaces.audio_mix_render.render_full_mix", side_effect=complete):
            report = inspect_audio(AudioRender(**request), lambda _: None)
        self.assertEqual(decoded, [257])
        self.assertEqual(report["duration"], 2)
        request = self.request([self.clip(start=0, gain=1, fadeIn=0, fadeOut=0)], duration=1)
        request["start"] = 3
        report = inspect_audio(AudioRender(**request), lambda _: None)
        self.assertEqual(report["overload_windows"], 0)
        self.assertIsNone(report["sample_peak_dbfs"])
        request["start"] = 86400
        with self.assertRaises(HTTPException) as invalid:
            inspect_audio(AudioRender(**request), lambda _: None)
        self.assertEqual(invalid.exception.status_code, 422)

    def test_pan_and_gain_automation_are_applied_before_meter_and_encoding(self):
        clip = self.clip(pan=-1, gainPoints=[{"time": 0, "gain": 0.1}, {"time": 2, "gain": 1}])
        response = self.client.post("/api/audio_studio/preview", json=self.request([clip]))
        audio = self.pcm(response)
        self.assertTrue(np.all(audio[:, 1] == 0))
        self.assertGreater(
            np.max(np.abs(audio[50000:65000, 0])), np.max(np.abs(audio[20000:30000, 0]))
        )
        window = self.pcm(
            self.client.post(
                "/api/audio_studio/preview", json=self.request([clip], start=0.7, duration=1.3)
            )
        )
        np.testing.assert_allclose(window, audio[33600:96000], atol=3)

    def test_all_presets_render_and_limiter_preserves_peak_headroom(self):
        request = self.request([self.clip(gain=4, fadeIn=0, fadeOut=0)])
        request["document"]["processing"] = {
            "denoise": "light",
            "equalizer": "voice",
            "compressor": "voice",
            "deess": True,
            "normalize": "voice",
            "limiter": True,
        }
        self.assertEqual(
            self.client.post("/api/audio_studio/preview", json=request).status_code, 409
        )
        audio = self.pcm(self.preview(request))
        self.assertGreater(np.max(np.abs(audio)), 100)
        self.assertLess(np.max(np.abs(audio)), 30000)
        for equalizer in ("warm", "bright"):
            request["document"]["processing"] = {
                "equalizer": equalizer,
                "denoise": "strong",
                "compressor": "gentle",
            }
            self.pcm(self.preview(request))

    def test_float_preview_preserves_headroom_for_live_master_gain_without_changing_export(self):
        request = self.request([self.clip(start=0, gain=4, fadeIn=0, fadeOut=0)])
        request["document"]["tracks"][0]["gain"] = 4
        request["document"]["masterGain"] = 1
        preview = self.pcm(self.preview(request))
        self.assertGreater(np.max(np.abs(preview)), 32768)
        request["document"]["masterGain"] = 0.1
        reduced = self.pcm(self.preview(request))
        np.testing.assert_allclose(preview * 0.1, reduced, atol=0.01)
        target = self.root / "live-gain-export.wav"
        render_audio(AudioRender(**request), target, lambda _: None)
        with wave.open(str(target)) as output:
            self.assertEqual(output.getsampwidth(), 2)
            exported = np.frombuffer(output.readframes(output.getnframes()), dtype="<i2").reshape(
                -1, 2
            )
        np.testing.assert_allclose(exported, reduced, atol=1)

    def test_music_duck_uses_dialogue_sidechain(self):
        request = self.request([self.clip(start=0, fadeIn=0, fadeOut=0, pan=1)])
        music = request["document"]["tracks"][0]
        music.update(role="music", duck=True)
        request["document"]["tracks"].append(
            {
                "id": "voice",
                "role": "dialogue",
                "clips": [self.clip(id="voice", start=0, fadeIn=0, fadeOut=0, pan=-1)],
            }
        )
        ducked = self.pcm(self.preview(request))
        music["duck"] = False
        original = self.pcm(self.preview(request))
        self.assertLess(
            np.mean(np.abs(ducked[24000:72000, 1])), np.mean(np.abs(original[24000:72000, 1])) * 0.6
        )

    def test_processed_selection_export_reuses_complete_mix_instead_of_normalizing_the_selection(
        self,
    ):
        from unittest.mock import patch

        for processing in (
            {"normalize": "voice"},
            {"compressor": "custom", "compression": {"thresholdDb": -24, "ratio": 6}},
        ):
            with self.subTest(processing=processing):
                request = self.request([self.clip(start=0, fadeIn=0, fadeOut=0)])
                request["document"]["processing"] = processing
                full = self.pcm(self.preview(request))
                request.update(start=0.375, duration=1.125)
                request = self.save_export_request(request)
                # The editor has already prepared this sound revision. Exports must pin
                # and slice it, even though the saved editor document has new metadata.
                with patch(
                    "omnigallery.workspaces.audio_mix_render.render_full_mix",
                    side_effect=AssertionError("cache must be reused"),
                ):
                    response = self.client.post("/api/audio_studio/export", json=request)
                self.assertEqual(response.status_code, 200, response.text)
                output = self.client.get(f"/api/workspace_artifacts/{response.json()['id']}/file")
                actual = self.pcm(output)
                np.testing.assert_allclose(actual, full[18000:72000], atol=1)

    def test_stateful_preview_has_context_and_keeps_sample_clock_at_twelve_second_boundary(self):
        length = 26
        signal = (np.sin(np.arange(length * 48000) * 2 * np.pi * 440 / 48000) * 12000).astype("<i2")
        with wave.open(str(self.source), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(48000)
            output.writeframes(signal.tobytes())
        request = self.request(
            [self.clip(start=0, duration=length, envelopeDuration=length, fadeIn=0, fadeOut=0)],
            duration=length,
        )
        request["document"]["processing"] = {
            "equalizer": "voice",
            "compressor": "voice",
            "limiter": True,
        }
        target = self.root / "full.wav"
        render_audio(AudioRender(**request), target, lambda _: None)
        with wave.open(str(target)) as output:
            full = np.frombuffer(output.readframes(output.getnframes()), dtype="<i2").reshape(-1, 2)
        request.update(start=12, duration=12)
        chunk = self.pcm(self.preview(request))
        self.assertEqual(len(chunk), 12 * 48000)
        np.testing.assert_allclose(chunk, full[12 * 48000 : 24 * 48000], atol=4)

    def test_maximum_curve_points_render_without_expression_depth_failure(self):
        clip = self.clip(
            gainPoints=[
                {"time": 2 * index / 127, "gain": (index % 4 + 1) / 4} for index in range(128)
            ]
        )
        audio = self.pcm(self.client.post("/api/audio_studio/preview", json=self.request([clip])))
        self.assertGreater(np.max(np.abs(audio)), 1000)

    def task(self):
        request = self.save_export_request(self.request())
        return AudioExportSubmission(**request, task_id=uuid.uuid4())

    def wait(self, manager, task_id, terminal=True):
        until = time.monotonic() + 12
        while time.monotonic() < until:
            task = manager.get(self.workspace, str(task_id))
            if (
                (task["state"] not in ("queued", "running"))
                if terminal
                else task["state"] == "running"
            ):
                return task
            time.sleep(0.02)
        self.fail("audio task timed out")

    def test_background_export_is_idempotent_and_commits_original_snapshot(self):
        manager = AudioExports(lambda: self.conn, lambda _: None)
        self.addCleanup(manager.close)
        request = self.task()
        first = manager.submit(request)
        again = manager.submit(request)
        self.assertEqual(first["id"], again["id"])
        completed = self.wait(manager, request.task_id)
        self.assertEqual(completed["state"], "completed", completed)
        self.assertEqual(completed["artifact"]["document_revision"], request.document_revision)
        self.assertEqual(
            self.conn.execute("SELECT count(*) FROM workspace_artifact").fetchone()[0], 1
        )
        self.assertEqual(len(manager.list(self.workspace, "draft-1")), 1)

    def test_background_bounded_export_progress_never_moves_backwards_between_segments(self):
        from unittest.mock import patch

        from omnigallery.workspaces.audio_exports import AudioExportAdapter

        progress = []

        def renderer(request, target, trust, audio_format, *, runner):
            for _ in range(3):
                runner(["unused", str(target)], target.parent, request.duration)
            target.write_bytes(b"completed")

        def process(args, directory, duration, checkpoint, report):
            checkpoint()
            for value in (0, 40, 99):
                report(value)

        adapter = AudioExportAdapter(lambda _: None, renderer=renderer)
        with patch("omnigallery.workspaces.audio_exports.run_media_process", side_effect=process):
            target = adapter.render(self.task(), self.root, lambda: None, progress.append)
        self.assertTrue(target.is_file())

        self.assertEqual(progress, sorted(progress))
        self.assertEqual(progress[-1], 99)

    def test_delete_audio_export_hides_history_without_replaying_or_deleting_result(self):
        from unittest.mock import patch

        from omnigallery.workspaces.audio_exports import mount_audio_export_routes

        mount_audio_export_routes(
            self.client.app, "/api", lambda: None, lambda: None, lambda _: None
        )
        self.addCleanup(self.client.app.state.audio_exports.close)
        manager = AudioExports(lambda: self.conn, lambda _: None)
        self.addCleanup(manager.close)
        request = self.task()
        with patch.object(manager, "_wake") as wake:
            task = manager.submit(request)
            wake.reset_mock()
            route = f"/api/audio_studio/tasks/{task['id']}"
            query = {"workspace_id": self.workspace}
            with self.assertRaises(HTTPException) as active:
                manager.delete(self.workspace, task["id"])
            self.assertEqual(active.exception.status_code, 409)
            artifact = {"id": "kept-audio", "name": "completed.wav"}
            target = self.root / "completed.wav"
            target.write_bytes(b"published sound")
            self.conn.execute(
                "UPDATE audio_export_task SET state='completed',artifact=? WHERE id=?",
                (json.dumps(artifact), task["id"]),
            )
            self.conn.commit()
            self.assertEqual(manager.delete(self.workspace, task["id"]), {"deleted": task["id"]})
            self.assertEqual(manager.list(self.workspace), [])
            self.assertTrue(manager.submit(request)["deleted"])
            self.assertEqual(manager.get(self.workspace, task["id"])["artifact"], artifact)
            self.assertEqual(target.read_bytes(), b"published sound")
            wake.assert_not_called()
            # Route is protected and retains the same workspace boundary as other actions.
            self.assertEqual(self.client.delete(route, params=query).status_code, 200)
            self.assertEqual(
                self.client.delete(route, params={"workspace_id": str(uuid.uuid4())}).status_code,
                404,
            )

    def test_deleted_audio_cancel_receipt_survives_worker_cleanup_and_restart(self):
        from unittest.mock import Mock

        started, release = threading.Event(), threading.Event()
        self.addCleanup(release.set)

        def renderer(request, target, trust, audio_format, *, runner):
            target.write_bytes(b"partial sound")
            started.set()
            release.wait(3)

        publisher = Mock()
        manager = AudioExports(
            lambda: self.conn, lambda _: None, renderer=renderer, publisher=publisher
        )
        self.addCleanup(manager.close)
        task = manager.submit(self.task())
        self.assertTrue(started.wait(3))
        manager.cancel(self.workspace, task["id"])
        manager.delete(self.workspace, task["id"])
        release.set()
        self.assertTrue(manager.idle.wait(3))
        self.assertTrue(manager.get(self.workspace, task["id"])["deleted"])
        self.assertEqual(manager.list(self.workspace), [])
        self.assertFalse(manager._stage(self.workspace, task["id"]).exists())
        publisher.assert_not_called()
        restarted = AudioExports(
            lambda: self.conn, lambda _: None, renderer=renderer, publisher=publisher
        )
        self.addCleanup(restarted.close)
        self.assertEqual(restarted.list(self.workspace), [])

    def test_cancel_background_audio_cleans_staging_and_publishes_nothing(self):
        rendering = threading.Event()

        def renderer(request, output, trust, audio_format, *, runner):
            rendering.set()
            # The runner's checkpoint must interrupt a real process even before output arrives.
            import sys

            runner(
                [sys.executable, "-c", "import time;time.sleep(20)", "ignored"],
                output.parent,
                request.duration,
            )

        manager = AudioExports(lambda: self.conn, lambda _: None, renderer=renderer)
        self.addCleanup(manager.close)
        request = self.task()
        manager.submit(request)
        self.assertTrue(rendering.wait(5))
        manager.cancel(self.workspace, str(request.task_id))
        manager.close()
        self.assertEqual(manager.get(self.workspace, str(request.task_id))["state"], "cancelled")
        self.assertEqual(
            self.conn.execute("SELECT count(*) FROM workspace_artifact").fetchone()[0], 0
        )
        self.assertFalse(manager._stage(self.workspace, str(request.task_id)).exists())

    def test_rejection_after_dedup_is_explicit_but_conflict_never_discards_id(self):
        manager = AudioExports(lambda: self.conn, lambda _: None)
        self.addCleanup(manager.close)
        request = self.task()
        manager.submit(request)
        conflict = request.model_copy(update={"name": "different"})
        with self.assertRaises(HTTPException) as error:
            manager.submit(conflict)
        self.assertEqual(error.exception.status_code, 409)
        self.assertIsInstance(error.exception.detail, str)
        self.wait(manager, request.task_id)
        missing = request.model_copy(update={"task_id": uuid.uuid4(), "document_id": "deleted"})
        with self.assertRaises(HTTPException) as error:
            manager.submit(missing)
        self.assertEqual(error.exception.detail["type"], "audio_export_not_created")

    def test_deleting_state_removes_only_the_workspaces_audio_tasks(self):
        manager = AudioExports(lambda: self.conn, lambda _: None)
        self.addCleanup(manager.close)
        manager._wake = lambda: None
        request = self.task()
        manager.submit(request)
        other_workspace, other_id = str(uuid.uuid4()), str(uuid.uuid4())
        row = list(self.conn.execute("SELECT * FROM audio_export_task").fetchone())
        row[0], row[1] = other_id, other_workspace
        self.conn.execute(
            "INSERT INTO audio_export_task VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", row
        )
        self.conn.commit()
        delete_workspace_state(self.conn, self.workspace)
        self.assertEqual(
            self.conn.execute("SELECT id FROM audio_export_task").fetchall(), [(other_id,)]
        )
        self.assertEqual(
            self.conn.execute(
                "SELECT count(*) FROM workspace_state WHERE workspace_id=?", (self.workspace,)
            ).fetchone()[0],
            0,
        )

    def test_state_delete_stops_running_export_before_response_and_prevents_late_publication(self):
        rendering, release = threading.Event(), threading.Event()

        def renderer(request, output, trust, audio_format, *, runner):
            rendering.set()
            if not release.wait(5):
                raise RuntimeError("test release timeout")
            output.write_bytes(b"render finished after deletion began")

        manager = AudioExports(lambda: self.conn, lambda _: None, renderer=renderer)
        self.addCleanup(manager.close)
        self.client.app.state.audio_exports = manager
        mount_workspace_state_routes(self.client.app, "/api", lambda: None, lambda: None)
        request = self.task()
        manager.submit(request)
        self.assertTrue(rendering.wait(5))
        with ThreadPoolExecutor(max_workers=1) as pool:
            deletion = pool.submit(self.client.delete, f"/api/workspace_state/{self.workspace}")
            try:
                deadline = time.monotonic() + 5
                while self.workspace not in manager.removing and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertIn(self.workspace, manager.removing)
                self.assertFalse(deletion.done(), "deletion must wait for the running export")
            finally:
                release.set()
            response = deletion.result(timeout=5)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(
            self.conn.execute("SELECT count(*) FROM audio_export_task").fetchone()[0], 0
        )
        self.assertEqual(
            self.conn.execute("SELECT count(*) FROM workspace_artifact").fetchone()[0], 0
        )
        self.assertFalse(manager._stage(self.workspace, str(request.task_id)).exists())
        self.assertTrue(self.source.is_file(), "state deletion must preserve source media")
        with self.assertRaises(HTTPException) as error:
            manager.submit(request)
        self.assertEqual(error.exception.detail["type"], "audio_export_not_created")
