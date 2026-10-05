import base64
import copy
import io
import math
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import uuid
import wave
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from omnigallery.workspaces.audio_mix_cache import (
    RATE,
    AudioMixCacheManager,
    float_wave_bytes,
    inspect_float_wave,
    mount_audio_mix_cache_routes,
)


class AudioMixCacheTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = self.root / "source.wav"
        self.source.write_bytes(b"original-source")
        self.workspace = str(uuid.uuid4())
        self.managers = []

    def manager(self, **changes):
        options = {
            "root": self.root / "cache",
            "validate_workspace": lambda _: None,
            "source_resolver": lambda kind, doc, workspace, trust: [Path(doc["path"])],
            "revision_payload": lambda kind, doc: {
                key: doc[key] for key in ("path", "duration", "gain")
            },
            "duration_fn": lambda kind, doc: doc["duration"],
            "normalizer": lambda kind, doc: copy.deepcopy(doc),
            "renderer": self.render,
            "free_reserve": 0,
        }
        options.update(changes)
        manager = AudioMixCacheManager(**options)
        self.managers.append(manager)
        self.addCleanup(manager.close)
        return manager

    def document(self, **changes):
        return {"path": str(self.source), "duration": 0.2, "gain": 1, **changes}

    @staticmethod
    def values(doc):
        count = max(1, round(doc["duration"] * RATE))
        left = np.sin(np.arange(count) * 0.01).astype("<f4") * doc["gain"]
        return np.column_stack((left, left * 0.5))

    def render(self, kind, document, sources, target, directory, *, cancelled, on_progress):
        on_progress("mixing", 0.5)
        target.write_bytes(float_wave_bytes(self.values(document)))

    def wait(self, manager, job, state="ready"):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            result = manager.get(job["id"], self.workspace)
            if result["state"] not in ("queued", "running"):
                self.assertEqual(result["state"], state, result)
                return result
            time.sleep(0.005)
        self.fail(f"Mix task did not finish: {result}")

    @staticmethod
    def pcm(body):
        stream = io.BytesIO(body)
        stream.seek(40)
        count = struct.unpack("<I", stream.read(4))[0]
        return np.frombuffer(stream.read(count), dtype="<f4").reshape(-1, 2)

    def test_start_reuses_sound_revision_and_chunks_keep_sample_clock_and_tail_silence(self):
        manager = self.manager()
        doc = self.document()
        job = manager.start(self.workspace, "audio", doc)
        result = self.wait(manager, job)
        self.assertEqual(result["progress"], 1)
        reused = manager.start(self.workspace, "audio", {**doc, "captions": ["visual only"]})
        self.assertEqual(reused["id"], job["id"])
        body, encoded_peaks = manager.chunk(job["id"], self.workspace, 0.037, 0.2)
        samples = self.pcm(body)
        expected = np.pad(self.values(doc)[1776:], ((0, 1776), (0, 0)))
        np.testing.assert_array_equal(samples, expected)
        peaks = np.frombuffer(base64.b64decode(encoded_peaks), dtype="<f4").reshape(-1, 2)
        np.testing.assert_array_equal(peaks, np.max(np.abs(samples.reshape(-1, 2400, 2)), axis=1))
        silent, _ = manager.chunk(job["id"], self.workspace, 120, 0.1)
        self.assertFalse(np.any(self.pcm(silent)))
        with self.assertRaises(HTTPException) as invalid:
            manager.chunk(job["id"], self.workspace, 0, 12.001)
        self.assertEqual(invalid.exception.status_code, 422)

    def test_source_mutation_expires_ready_pcm_and_changes_revision(self):
        manager = self.manager()
        doc = self.document()
        job = manager.start(self.workspace, "audio", doc)
        self.wait(manager, job)
        with manager.lease_ready(self.workspace, "audio", doc) as path:
            self.assertIsNotNone(path)
            self.source.write_bytes(b"changed-and-longer-source")
            self.assertEqual(manager.get(job["id"], self.workspace)["state"], "expired")
            self.assertTrue(path.exists(), "Pinned export must not be deleted halfway through")
        self.assertFalse(path.exists())
        with manager.lease_ready(self.workspace, "audio", doc) as path:
            self.assertIsNone(path)
        fresh = manager.start(self.workspace, "audio", doc)
        self.assertNotEqual(fresh["revision"], job["revision"])
        self.wait(manager, fresh)

    def test_mutation_during_render_never_publishes_stale_pcm(self):
        def renderer(*args, **kwargs):
            self.render(*args, **kwargs)
            self.source.write_bytes(b"changed-during-render")

        manager = self.manager(renderer=renderer)
        job = manager.start(self.workspace, "audio", self.document())
        result = self.wait(manager, job, "failed")
        self.assertIn("变化", result["error"])
        self.assertFalse(manager.jobs[job["id"]].folder.exists())

    def test_queue_cancel_reaps_running_process_and_releases_capacity(self):
        from omnigallery.workspaces.video_audio import cancellable_process

        began = threading.Event()
        process = []
        original = subprocess.Popen

        def popen(*args, **kwargs):
            child = original(*args, **kwargs)
            process.append(child)
            began.set()
            return child

        def blocked(kind, doc, sources, target, directory, *, cancelled, on_progress):
            cancellable_process(
                [sys.executable, "-c", "import time; time.sleep(60)"], directory, 1, cancelled
            )

        manager = self.manager(renderer=blocked, max_active=2)
        with patch("omnigallery.workspaces.video_audio.subprocess.Popen", side_effect=popen):
            first = manager.start(self.workspace, "audio", self.document())
            self.assertTrue(began.wait(2))
            queued = manager.start(self.workspace, "audio", self.document(gain=2))
            self.assertEqual(queued["state"], "queued")
            with self.assertRaises(HTTPException) as full:
                manager.start(self.workspace, "audio", self.document(gain=3))
            self.assertEqual(full.exception.status_code, 429)
            self.assertEqual(manager.cancel(queued["id"], self.workspace)["state"], "cancelled")
            manager.cancel(first["id"], self.workspace)
            self.wait(manager, first, "cancelled")
        self.assertIsNotNone(process[0].poll(), "Cancellation must reap the actual decoder")
        self.assertFalse(manager.jobs[first["id"]].folder.exists())
        manager.renderer = self.render
        retry = manager.start(self.workspace, "audio", self.document(gain=4))
        self.wait(manager, retry)

    def test_lru_evicts_unpinned_cache_and_preserves_export_lease(self):
        manager = self.manager(budget_bytes=240000)
        one = manager.start(self.workspace, "audio", self.document())
        self.wait(manager, one)
        with manager.lease_ready(self.workspace, "audio", self.document()) as pinned:
            two = manager.start(self.workspace, "audio", self.document(gain=2))
            self.wait(manager, two)
            three = manager.start(self.workspace, "audio", self.document(gain=3))
            self.wait(manager, three)
            self.assertTrue(pinned.exists())
            self.assertEqual(manager.get(one["id"], self.workspace)["state"], "ready")
            self.assertEqual(manager.get(two["id"], self.workspace)["state"], "expired")
        self.assertLessEqual(sum(record["size"] for record in manager.records.values()), 240000)

    def test_capacity_waits_for_pins_and_does_not_delete_an_export_input(self):
        manager = self.manager(budget_bytes=200000)
        doc = self.document()
        job = manager.start(self.workspace, "audio", doc)
        self.wait(manager, job)
        with manager.lease_ready(self.workspace, "audio", doc) as path:
            with self.assertRaises(HTTPException) as busy:
                manager.start(self.workspace, "audio", self.document(gain=2))
            self.assertEqual(busy.exception.status_code, 507)
            self.assertTrue(path.exists())
            self.assertEqual(manager.get(job["id"], self.workspace)["state"], "ready")

    def test_workspace_cleanup_waits_for_export_pin_blocks_starts_and_removes_only_owned_cache(
        self,
    ):
        manager = self.manager()
        doc = self.document()
        job = manager.start(self.workspace, "audio", doc)
        self.wait(manager, job)
        other_workspace = str(uuid.uuid4())
        other = manager.start(other_workspace, "audio", doc)
        deadline = time.monotonic() + 3
        while manager.get(other["id"], other_workspace)["state"] != "ready":
            self.assertLess(time.monotonic(), deadline)
            time.sleep(0.005)
        entered = threading.Event()

        def remove():
            with manager.removing_workspace(self.workspace):
                entered.set()

        with manager.lease_ready(self.workspace, "audio", doc) as pinned:
            worker = threading.Thread(target=remove)
            worker.start()
            deadline = time.monotonic() + 2
            while not manager.blocked.get(self.workspace):
                self.assertLess(time.monotonic(), deadline)
                time.sleep(0.005)
            self.assertFalse(entered.wait(0.05))
            with self.assertRaises(HTTPException) as blocked:
                manager.start(self.workspace, "audio", doc)
            self.assertEqual(blocked.exception.status_code, 409)
            self.assertTrue(pinned.exists())
        self.assertTrue(entered.wait(1))
        worker.join(1)
        self.assertFalse(pinned.exists())
        self.assertTrue(manager.jobs[other["id"]].path.exists())

    def test_workspace_scope_and_readonly_router_do_not_create_artifacts(self):
        manager = self.manager()
        app = FastAPI()

        async def authorize():
            pass

        mount_audio_mix_cache_routes(app, "/api", authorize, lambda _: None, manager=manager)
        with TestClient(app) as client:
            submitted = client.post(
                "/api/audio_mix_cache/start",
                json={"workspace_id": self.workspace, "kind": "audio", "document": self.document()},
            )
            self.assertEqual(submitted.status_code, 200, submitted.text)
            job = submitted.json()
            self.wait(manager, job)
            key = job["id"]
            wrong = {"workspace_id": str(uuid.uuid4())}
            self.assertEqual(
                client.get("/api/audio_mix_cache/" + key, params=wrong).status_code, 404
            )
            self.assertEqual(
                client.post("/api/audio_mix_cache/" + key + "/cancel", params=wrong).status_code,
                404,
            )
            self.assertEqual(
                client.get("/api/audio_mix_cache/" + key + "/chunk", params=wrong).status_code, 404
            )
            response = client.get(
                "/api/audio_mix_cache/" + key + "/chunk",
                params={"workspace_id": self.workspace, "start": 0, "duration": 0.1},
            )
            self.assertEqual(
                response.status_code, 200, response.text if response.status_code != 200 else ""
            )
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertIn("X-Audio-Level-Peaks", response.headers)
        self.assertEqual(
            set(path.name for path in manager.jobs[key].folder.iterdir()), {"mix.wav", "ready.json"}
        )

    def test_restart_recovers_ready_revision_but_discards_incomplete_output(self):
        manager = self.manager()
        doc = self.document()
        job = manager.start(self.workspace, "audio", doc)
        self.wait(manager, job)
        manager.close()
        unfinished = manager._root() / self.workspace / str(uuid.uuid4())
        unfinished.mkdir()
        (unfinished / "mix.wav").write_bytes(b"partial")
        restored = self.manager(
            renderer=lambda *args, **kwargs: self.fail("Ready mix must be reused")
        )
        resumed = restored.start(self.workspace, "audio", doc)
        self.assertEqual(resumed["id"], job["id"])
        self.assertEqual(resumed["state"], "ready")
        self.assertFalse(unfinished.exists())

    def test_budget_and_deleted_workspace_fail_before_scheduling(self):
        manager = self.manager(budget_bytes=100000)
        with self.assertRaises(HTTPException) as budget:
            manager.start(self.workspace, "audio", self.document(duration=21600))
        self.assertEqual(budget.exception.status_code, 507)
        self.assertFalse(manager.jobs)

        def deleted(_):
            raise HTTPException(404, "Deleted")

        manager.validate_workspace = deleted
        with self.assertRaises(HTTPException) as unavailable:
            manager.start(self.workspace, "audio", self.document())
        self.assertEqual(unavailable.exception.status_code, 404)

    def test_free_space_budget_rejects_without_starting_decoder(self):
        manager = self.manager(renderer=lambda *args, **kwargs: self.fail("Must not decode"))
        with patch(
            "omnigallery.workspaces.audio_mix_cache.shutil.disk_usage",
            return_value=SimpleNamespace(free=1),
        ):
            with self.assertRaises(HTTPException) as insufficient:
                manager.start(self.workspace, "audio", self.document())
        self.assertEqual(insufficient.exception.status_code, 507)
        self.assertFalse(manager.jobs)

    def test_workspace_cleanup_and_shutdown_cancel_active_computes(self):
        began = threading.Event()
        stopped = threading.Event()

        def blocked(kind, doc, sources, target, directory, *, cancelled, on_progress):
            began.set()
            cancelled.wait(5)
            stopped.set()
            raise ValueError("cancelled")

        manager = self.manager(renderer=blocked)
        job = manager.start(self.workspace, "audio", self.document())
        self.assertTrue(began.wait(1))
        with manager.removing_workspace(self.workspace):
            self.assertTrue(stopped.is_set())
            self.assertFalse(manager.jobs[job["id"]].folder.exists())
            with self.assertRaises(HTTPException) as missing:
                manager.get(job["id"], self.workspace)
            self.assertEqual(missing.exception.status_code, 404)
        began.clear()
        stopped.clear()
        second = manager.start(self.workspace, "audio", self.document(gain=2))
        self.assertTrue(began.wait(1))
        manager.close()
        self.assertTrue(stopped.is_set())
        self.assertFalse(manager.worker.is_alive())
        self.assertFalse(manager.jobs[second["id"]].folder.exists())

    def test_cleanup_after_restart_removes_persisted_workspace_cache(self):
        manager = self.manager()
        job = manager.start(self.workspace, "audio", self.document())
        self.wait(manager, job)
        path = manager.jobs[job["id"]].path
        manager.close()
        fresh = self.manager()
        with fresh.removing_workspace(self.workspace):
            self.assertFalse(path.exists())

    def test_record_limit_keeps_tiny_mix_metadata_bounded(self):
        manager = self.manager(max_history=3)
        for gain in range(1, 10):
            job = manager.start(self.workspace, "audio", self.document(duration=0, gain=gain))
            self.wait(manager, job)
        self.assertLessEqual(len(manager.records), 3)
        self.assertLessEqual(len(manager.jobs), 3)
        self.assertLessEqual(len(list(manager._root().glob("*/*/ready.json"))), 3)

    def test_two_clients_share_computation_and_releasing_one_does_not_cancel_the_other(self):
        began = threading.Event()
        cancelled_event = []

        def blocked(kind, doc, sources, target, directory, *, cancelled, on_progress):
            cancelled_event.append(cancelled)
            began.set()
            cancelled.wait(3)
            raise ValueError("cancelled")

        manager = self.manager(renderer=blocked)
        one, two = str(uuid.uuid4()), str(uuid.uuid4())
        job = manager.start(self.workspace, "audio", self.document(), one)
        self.assertTrue(began.wait(1))
        shared = manager.start(self.workspace, "audio", self.document(), two)
        self.assertEqual(shared["id"], job["id"])
        released = manager.cancel(job["id"], self.workspace, one)
        self.assertEqual(released["state"], "running")
        self.assertFalse(cancelled_event[0].is_set())
        renewed = manager.get(job["id"], self.workspace, two)
        self.assertEqual(renewed["state"], "running")
        manager.cancel(job["id"], self.workspace, two)
        self.wait(manager, job, "cancelled")
        self.assertTrue(cancelled_event[0].is_set())

    def test_interest_ttl_cancels_abandoned_job_but_status_heartbeats_keep_it_alive(self):
        began = threading.Event()

        def blocked(kind, doc, sources, target, directory, *, cancelled, on_progress):
            began.set()
            cancelled.wait(3)
            raise ValueError("cancelled")

        manager = self.manager(renderer=blocked, interest_ttl=0.08)
        client = str(uuid.uuid4())
        job = manager.start(self.workspace, "audio", self.document(), client)
        self.assertTrue(began.wait(1))
        for _ in range(6):
            time.sleep(0.025)
            self.assertEqual(manager.get(job["id"], self.workspace, client)["state"], "running")
        self.wait(manager, job, "cancelled")

    def test_released_client_cannot_rejoin_with_late_status_and_a_new_interest_can_share(self):
        began = threading.Event()

        def blocked(kind, doc, sources, target, directory, *, cancelled, on_progress):
            began.set()
            cancelled.wait(3)
            raise ValueError("cancelled")

        manager = self.manager(renderer=blocked)
        one, two, fresh = (str(uuid.uuid4()) for _ in range(3))
        job = manager.start(self.workspace, "audio", self.document(), one)
        self.assertTrue(began.wait(1))
        manager.start(self.workspace, "audio", self.document(), two)
        manager.cancel(job["id"], self.workspace, one)
        # This models a status request already sent before the first viewer left.
        self.assertEqual(manager.get(job["id"], self.workspace, one)["state"], "running")
        with self.assertRaises(HTTPException) as retired:
            manager.start(self.workspace, "audio", self.document(), one)
        self.assertEqual(retired.exception.status_code, 409)
        current = manager.start(self.workspace, "audio", self.document(), fresh)
        self.assertEqual(current["id"], job["id"])
        manager.cancel(job["id"], self.workspace, two)
        self.assertEqual(manager.get(job["id"], self.workspace, fresh)["state"], "running")
        manager.cancel(job["id"], self.workspace, fresh)
        self.wait(manager, job, "cancelled")

    def test_interest_tombstones_are_bounded_without_reviving_released_clients(self):
        began = threading.Event()

        def blocked(kind, doc, sources, target, directory, *, cancelled, on_progress):
            began.set()
            cancelled.wait(3)
            raise ValueError("cancelled")

        manager = self.manager(renderer=blocked)
        owner = str(uuid.uuid4())
        job = manager.start(self.workspace, "audio", self.document(), owner)
        self.assertTrue(began.wait(1))
        for _ in range(255):
            viewer = str(uuid.uuid4())
            self.assertEqual(
                manager.start(self.workspace, "audio", self.document(), viewer)["id"], job["id"]
            )
            manager.cancel(job["id"], self.workspace, viewer)
            manager.get(job["id"], self.workspace, viewer)
        with self.assertRaises(HTTPException) as full:
            manager.start(self.workspace, "audio", self.document(), str(uuid.uuid4()))
        self.assertEqual(full.exception.status_code, 429)
        # The original owner can still release at capacity, cancelling the computation.
        manager.cancel(job["id"], self.workspace, owner)
        self.wait(manager, job, "cancelled")

    def test_cancelling_compute_is_not_reused_and_legacy_interest_remains_compatible(self):
        began = threading.Event()
        finish = threading.Event()

        def blocked(kind, doc, sources, target, directory, *, cancelled, on_progress):
            began.set()
            finish.wait(2)
            if cancelled.is_set():
                raise ValueError("cancelled")
            self.render(
                kind, doc, sources, target, directory, cancelled=cancelled, on_progress=on_progress
            )

        manager = self.manager(renderer=blocked)
        client = str(uuid.uuid4())
        job = manager.start(self.workspace, "audio", self.document(), client)
        self.assertTrue(began.wait(1))
        manager.cancel(job["id"], self.workspace, client)
        fresh = manager.start(self.workspace, "audio", self.document(), client)
        self.assertNotEqual(fresh["id"], job["id"])
        finish.set()
        self.wait(manager, job, "cancelled")
        self.wait(manager, fresh)
        legacy = manager.start(self.workspace, "audio", self.document(gain=2))
        self.wait(manager, legacy)
        self.assertEqual(
            manager.revision(self.workspace, "audio", self.document(gain=2)), legacy["revision"]
        )

    def test_failed_compute_can_retry_and_idle_worker_accepts_new_task(self):
        def fail(*args, **kwargs):
            raise ValueError("bad source")

        manager = self.manager(renderer=fail)
        first = manager.start(self.workspace, "audio", self.document())
        self.wait(manager, first, "failed")
        manager.renderer = self.render
        second = manager.start(self.workspace, "audio", self.document())
        self.wait(manager, second)
        self.assertNotEqual(first["id"], second["id"])
        time.sleep(0.03)
        third = manager.start(self.workspace, "audio", self.document(gain=2))
        self.wait(manager, third)

    def test_rf64_headers_and_bounded_reads_do_not_load_entire_file(self):
        manager = self.manager()
        job = manager.start(self.workspace, "audio", self.document())
        self.wait(manager, job)
        path = manager.jobs[job["id"]].path
        values = self.values(self.document())
        raw = values.astype("<f4").tobytes()
        fmt = struct.pack("<HHIIHH", 3, 2, RATE, RATE * 8, 8, 32)
        ds64 = struct.pack("<QQQI", len(raw) + 72, len(raw), len(values), 0)
        header = b"RF64\xff\xff\xff\xffWAVEds64" + struct.pack("<I", 28) + ds64
        header += b"fmt " + struct.pack("<I", 16) + fmt
        header += b"data\xff\xff\xff\xff"
        path.write_bytes(header + raw)
        self.assertEqual(inspect_float_wave(path).frames, len(values))
        with patch.object(
            Path, "read_bytes", side_effect=AssertionError("Whole file read prohibited")
        ):
            body, _ = manager.chunk(job["id"], self.workspace, 0.03, 0.02)
        np.testing.assert_array_equal(self.pcm(body), values[1440:2400])
        path.write_bytes(header + raw[:-4])
        with self.assertRaises(HTTPException) as truncated:
            manager.chunk(job["id"], self.workspace, 0, 0.1)
        self.assertEqual(truncated.exception.status_code, 409)
        self.assertEqual(manager.get(job["id"], self.workspace)["state"], "expired")


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg required")
class RealAudioMixCacheTests(unittest.TestCase):
    def test_real_stateful_audio_mix_chunks_and_export_are_identical_and_visual_edits_reuse(self):
        from omnigallery.workspaces.audio_mix_render import export_mix_slice

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "voice.wav"
            count = RATE * 3
            amplitude = np.where(np.arange(count) < count // 2, 0.08, 0.7)
            tone = np.sin(np.arange(count) * (2 * math.pi * 440 / RATE)) * amplitude
            pcm = np.column_stack((tone, tone * 0.6))
            with wave.open(str(source), "wb") as output:
                output.setnchannels(2)
                output.setsampwidth(2)
                output.setframerate(RATE)
                output.writeframes((pcm * 32767).astype("<i2").tobytes())
            workspace = str(uuid.uuid4())
            document = {
                "version": 1,
                "tracks": [
                    {
                        "id": "voice",
                        "name": "Voice",
                        "clips": [
                            {
                                "id": "source",
                                "path": str(source),
                                "name": "Voice",
                                "sourceKind": "audio",
                                "start": 0,
                                "sourceIn": 0,
                                "duration": 3,
                                "rate": 1,
                                "gain": 1,
                                "fadeIn": 0.1,
                                "fadeOut": 0.1,
                                "envelopeDuration": 3,
                            }
                        ],
                    }
                ],
                "processing": {"compressor": "voice", "normalize": "voice"},
            }
            manager = AudioMixCacheManager(
                root=root / "cache", validate_workspace=lambda _: None, free_reserve=0
            )
            try:
                job = manager.start(workspace, "audio", document)
                deadline = time.monotonic() + 30
                while (result := manager.get(job["id"], workspace))["state"] in (
                    "queued",
                    "running",
                ):
                    self.assertLess(time.monotonic(), deadline, result)
                    time.sleep(0.01)
                self.assertEqual(result["state"], "ready", result)
                left, _ = manager.chunk(job["id"], workspace, 0, 1.111)
                right, _ = manager.chunk(job["id"], workspace, 1.111, 1.889)
                with manager.lease_ready(workspace, "audio", document) as cached:
                    target = root / "export.wav"
                    export_mix_slice(cached, target, root, 0, 3, float_output=True)
                    info = inspect_float_wave(target)
                    with target.open("rb") as stream:
                        stream.seek(info.offset)
                        exported = np.frombuffer(stream.read(info.frames * 8), dtype="<f4").reshape(
                            -1, 2
                        )
                joined = np.concatenate(
                    (AudioMixCacheTests.pcm(left), AudioMixCacheTests.pcm(right))
                )
                np.testing.assert_array_equal(joined, exported)
                edited = copy.deepcopy(document)
                edited["tracks"][0]["name"] = "Renamed"
                edited["markers"] = [{"id": "marker", "name": "Note", "time": 100}]
                self.assertEqual(manager.start(workspace, "audio", edited)["id"], job["id"])
                clip = document["tracks"][0]["clips"][0]
                video_clip = {key: value for key, value in clip.items() if key != "sourceKind"}
                video_clip.update(kind="audio", sourceDuration=3)
                video = {
                    "version": 1,
                    "width": 640,
                    "height": 360,
                    "fps": 30,
                    "visuals": [],
                    "sounds": [video_clip],
                    "captions": [],
                    "markers": [],
                    "processing": document["processing"],
                }
                video_job = manager.start(workspace, "video", video)
                deadline = time.monotonic() + 30
                while (result := manager.get(video_job["id"], workspace))["state"] in (
                    "queued",
                    "running",
                ):
                    self.assertLess(time.monotonic(), deadline, result)
                    time.sleep(0.01)
                self.assertEqual(result["state"], "ready", result)
                video_samples, _ = manager.chunk(video_job["id"], workspace, 0, 3)
                np.testing.assert_array_equal(AudioMixCacheTests.pcm(video_samples), exported)
                # Unrelated picture duration or caption styling does not alter the sound key.
                video["captions"] = [
                    {"id": "caption", "text": "Visual only", "start": 0, "duration": 100}
                ]
                video["width"] = 720
                video["fps"] = 60
                self.assertEqual(manager.start(workspace, "video", video)["id"], video_job["id"])
                silent, _ = manager.chunk(video_job["id"], workspace, 30, 0.1)
                self.assertFalse(np.any(AudioMixCacheTests.pcm(silent)))

                def denied(_):
                    raise HTTPException(403, "Untrusted source")

                manager.check_path_trust = denied
                with self.assertRaises(HTTPException) as untrusted:
                    manager.start(workspace, "video", video)
                self.assertEqual(untrusted.exception.status_code, 403)
                self.assertEqual(manager.get(video_job["id"], workspace)["state"], "expired")
            finally:
                manager.close()


if __name__ == "__main__":
    unittest.main()
