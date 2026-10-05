import io
import json
import shutil
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from backend.tests.integration import test_video_studio as support
from omnigallery.workspaces.video_previews import mount_video_preview_routes
from omnigallery.workspaces.video_render import REVERSE_BUFFER_BYTES, windows
from omnigallery.workspaces.video_studio import VideoDocument


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg required")
class VideoEffectsTests(unittest.TestCase):
    setUp = support.VideoStudioTests.setUp
    clip = support.VideoStudioTests.clip
    document = support.VideoStudioTests.document
    save_document = support.VideoStudioTests.save_document
    export = support.VideoStudioTests.export
    frame = support.VideoStudioTests.frame

    def result(self, document, **kwargs):
        response = self.export(document, **kwargs)
        self.assertEqual(response.status_code, 200, response.text)
        artifact = response.json()
        output = self.root / (artifact["id"] + ".mp4")
        output.write_bytes(
            self.client.get(f"/api/workspace_artifacts/{artifact['id']}/file").content
        )
        return output

    def test_multitrack_transform_keyframes_fade_and_selection_are_rendered(self):
        document = self.document()
        document["tracks"] = [
            {"id": "base", "kind": "video"},
            {"id": "above", "kind": "video"},
        ]
        document["visuals"] = [
            self.clip(self.image, "image", duration=2, trackId="base"),
            self.clip(
                self.video,
                "video",
                duration=2,
                trackId="above",
                transform={"scale": 0.5},
                keyframes=[
                    {"time": 0, "x": -0.25, "opacity": 0},
                    {"time": 2, "x": 0.25, "opacity": 1},
                ],
                fadeIn=0.2,
            ),
        ]
        document["sounds"], document["captions"] = [], []
        document["visuals"].reverse()  # Track stacking, not array order, determines the top layer.
        output = self.result(document, range={"start": 0.5, "end": 1.5})
        early, late = self.frame(output, 0.05), self.frame(output, 0.85)
        self.assertGreater(early.getpixel((10, 10))[0], 180)
        self.assertGreater(late.getpixel((180, 100))[2], early.getpixel((180, 100))[2] + 40)
        info = json.loads(
            subprocess.check_output(
                [
                    shutil.which("ffprobe"),
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "json",
                    str(output),
                ]
            )
        )
        self.assertAlmostEqual(float(info["format"]["duration"]), 1, delta=0.12)

    def test_crop_flip_rotation_and_rgb_color(self):
        source = self.root / "quadrants.png"
        image = Image.new("RGB", (320, 240), "red")
        image.paste("blue", (160, 0, 320, 240))
        image.save(source)
        document = self.document()
        document["visuals"] = [
            self.clip(
                source,
                "image",
                transform={
                    "crop": {"x": 0.5, "y": 0, "width": 0.5, "height": 1},
                    "fit": "stretch",
                    "flipX": True,
                    "rotation": 180,
                },
                color={"brightness": -0.5, "saturation": 0},
            )
        ]
        document["sounds"], document["captions"] = [], []
        output = self.result(document)
        pixel = self.frame(output, 0.4).getpixel((160, 120))
        self.assertLess(max(pixel) - min(pixel), 8)
        self.assertLess(max(pixel), 30)
        document["visuals"] = [
            self.clip(source, "image", transform={"flipX": True, "fit": "stretch"})
        ]
        flipped = self.frame(self.result(document), 0.4)
        self.assertGreater(flipped.getpixel((60, 120))[2], 150)
        self.assertGreater(flipped.getpixel((260, 120))[0], 150)
        document["visuals"] = [
            self.clip(source, "image", transform={"rotation": 90, "fit": "stretch"})
        ]
        rotated = self.frame(self.result(document), 0.4)
        self.assertGreater(rotated.getpixel((160, 50))[0], 150)
        self.assertGreater(rotated.getpixel((160, 190))[2], 150)

    def test_rgb_filters_clamp_between_stages_like_canvas(self):
        source = self.root / "rgb-filter.png"
        Image.new("RGB", (320, 240), (200, 100, 20)).save(source)
        document = self.document()
        document["visuals"] = [
            self.clip(
                source,
                "image",
                color={"brightness": 1, "contrast": 0.5, "saturation": 0},
            )
        ]
        document["sounds"], document["captions"] = [], []
        pixel = self.frame(self.result(document), 0.4).getpixel((160, 120))
        # Edge Canvas yields RGB(163,163,163); allow H.264/YUV and integer rounding.
        for channel in pixel:
            self.assertAlmostEqual(channel, 163, delta=8)

    def test_many_keyframes_and_fit_modes_remain_renderable(self):
        document = self.document()
        document["sounds"], document["captions"] = [], []
        document["visuals"] = [
            self.clip(
                self.video,
                "video",
                keyframes=[
                    {"time": i / 127, "opacity": i / 127, "scale": 0.5 + i / 254}
                    for i in range(128)
                ],
            )
        ]
        output = self.result(document)
        self.assertGreater(
            self.frame(output, 0.85).getpixel((160, 120))[2],
            self.frame(output, 0.1).getpixel((160, 120))[2] + 100,
        )
        source = self.root / "portrait.png"
        image = Image.new("RGB", (120, 240), "red")
        image.paste("green", (0, 0, 120, 30))
        image.save(source)
        colors = {}
        for fit in ("contain", "cover", "stretch"):
            document["visuals"] = [self.clip(source, "image", transform={"fit": fit})]
            colors[fit] = self.frame(self.result(document), 0.5)
        self.assertLess(max(colors["contain"].getpixel((5, 120))), 10)
        self.assertGreater(colors["cover"].getpixel((5, 120))[0], 180)
        self.assertGreater(colors["stretch"].getpixel((160, 5))[1], 80)
        self.assertGreater(colors["cover"].getpixel((160, 5))[0], 180)

    def test_freeze_reverse_and_styled_subtitle(self):
        source = self.root / "red-blue.mp4"
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
                "color=red:s=320x240:r=12:d=1",
                "-f",
                "lavfi",
                "-i",
                "color=blue:s=320x240:r=12:d=1",
                "-filter_complex",
                "[0:v][1:v]concat=n=2:v=1:a=0[v]",
                "-map",
                "[v]",
                "-c:v",
                "libx264",
                "-threads",
                "2",
                "-pix_fmt",
                "yuv420p",
                str(source),
            ],
            check=True,
            capture_output=True,
        )
        document = self.document()
        document["visuals"] = [self.clip(source, "video", duration=2, reverse=True)]
        document["sounds"], document["captions"] = [], []
        output = self.result(document)
        self.assertGreater(self.frame(output, 0.2).getpixel((160, 90))[2], 150)
        self.assertGreater(self.frame(output, 1.7).getpixel((160, 90))[0], 150)
        document["visuals"] = [self.clip(source, "video", sourceIn=1.99, duration=2, freeze=True)]
        document["captions"] = [
            {
                "id": "custom",
                "text": "STYLE",
                "start": 0.5,
                "duration": 1,
                "style": {
                    "fontSize": 42,
                    "bold": True,
                    "color": "#ffff00",
                    "background": "#00000080",
                    "x": 0.5,
                    "y": 0.4,
                },
            }
        ]
        output = self.result(document)
        first, last = self.frame(output, 0.2), self.frame(output, 1.8)
        self.assertGreater(first.getpixel((160, 90))[2], 150)
        self.assertGreater(last.getpixel((160, 90))[2], 150)
        self.assertNotEqual(
            first.crop((40, 60, 280, 140)).tobytes(),
            self.frame(output, 0.9).crop((40, 60, 280, 140)).tobytes(),
        )

    def test_track_hide_mute_solo_and_mix(self):
        document = self.document()
        document["tracks"] = [
            {"id": "shown", "kind": "video"},
            {"id": "hidden", "kind": "video", "hidden": True},
            {"id": "audible", "kind": "audio", "solo": True, "gain": 0.5},
            {"id": "other", "kind": "audio"},
        ]
        document["visuals"] = [
            self.clip(self.image, "image", trackId="shown"),
            self.clip(self.video, "video", trackId="hidden"),
        ]
        document["sounds"] = [
            self.clip(self.video, "video", trackId="audible", fadeIn=0.5, fadeOut=0.2),
            self.clip(self.video, "video", trackId="other"),
        ]
        document["captions"] = []
        output = self.result(document)
        self.assertGreater(self.frame(output, 0.5).getpixel((160, 90))[0], 150)
        sound = subprocess.check_output(
            [
                shutil.which("ffmpeg"),
                "-v",
                "error",
                "-i",
                str(output),
                "-f",
                "s16le",
                "-ac",
                "1",
                "-ar",
                "8000",
                "pipe:1",
            ]
        )
        import numpy as np

        values = np.frombuffer(sound, dtype="<i2")
        self.assertGreater(abs(values[3200:4800]).max(), 100)
        self.assertLess(abs(values[:500]).max(), abs(values[3200:4800]).max() / 2)

    def test_short_slow_audio_slice_keeps_sound_with_bounded_tempo_context(self):
        document = self.document()
        document["visuals"] = [self.clip(self.image, "image", duration=0.1)]
        document["sounds"] = [
            self.clip(self.video, "video", duration=0.1, sourceIn=0.5, rate=0.25, reverse=True)
        ]
        document["captions"] = []
        output = self.result(document)
        raw = subprocess.check_output(
            [
                shutil.which("ffmpeg"),
                "-v",
                "error",
                "-i",
                str(output),
                "-f",
                "s16le",
                "-ac",
                "1",
                "-ar",
                "8000",
                "pipe:1",
            ]
        )
        import numpy as np

        self.assertGreater(abs(np.frombuffer(raw, dtype="<i2")).max(), 100)

    def test_reverse_window_budget_and_input_decoders_are_bounded(self):
        document = self.document()
        document.update(width=3840, height=2160, fps=60)
        document["visuals"] = [self.clip(self.video, "video", duration=2, reverse=True)]
        model = VideoDocument.model_validate(document)
        intervals = windows(model, 0, 2, [(0, model.visuals[0])], [])
        for left, right in intervals:
            frames = round((right - left) * model.fps)
            self.assertLessEqual(frames * model.width * model.height * 4, REVERSE_BUFFER_BYTES)
        document = self.document()
        document["visuals"] *= 4
        document["captions"] = []
        processes = []
        original = subprocess.run

        def record(args, **kwargs):
            if "-filter_complex_threads" in args:
                processes.append(args)
            return original(args, **kwargs)

        with patch("omnigallery.workspaces.video_render.subprocess.run", side_effect=record):
            self.result(document)
        self.assertTrue(processes)
        self.assertLessEqual(max(args.count("-i") for args in processes), 2)

    def test_thumbnail_strip_small_frames_cache_version_and_reverse_audio(self):
        app = FastAPI()
        mount_video_preview_routes(app, "/api", lambda: None, lambda path: None)
        with TestClient(app) as client:
            params = {
                "workspace_id": self.workspace,
                "path": str(self.video),
                "start": 0,
                "end": 2,
                "count": 4,
                "width": 120,
            }
            response = client.get("/api/video_studio/thumbnails", params=params)
            self.assertEqual(response.status_code, 200, response.text)
            frames = response.json()["frames"]
            self.assertEqual(len(frames), 4)
            with patch.object(
                Path, "read_bytes", side_effect=AssertionError("No whole media read")
            ):
                image = client.get(frames[0]["url"])
            self.assertEqual(image.status_code, 200, image.text if image.status_code != 200 else "")
            self.assertLessEqual(max(Image.open(io.BytesIO(image.content)).size), 120)
            with patch(
                "omnigallery.workspaces.video_previews.subprocess.run",
                side_effect=AssertionError("cached"),
            ):
                self.assertEqual(client.get(frames[0]["url"]).status_code, 200)
            self.assertEqual(
                client.get(
                    "/api/video_studio/thumbnails", params={**params, "count": 25}
                ).status_code,
                422,
            )
            audio = client.get(
                "/api/video_studio/preview-audio",
                params={
                    "workspace_id": self.workspace,
                    "path": str(self.video),
                    "duration": 1,
                    "reverse": "true",
                },
            )
            self.assertEqual(audio.status_code, 200, audio.text if audio.status_code != 200 else "")
            self.assertTrue(audio.content.startswith(b"RIFF"))
            from omnigallery.workspaces.video_previews import PREVIEW_CONCURRENCY

            with PREVIEW_CONCURRENCY, PREVIEW_CONCURRENCY:
                busy = client.get(frames[1]["url"])
            self.assertEqual(busy.status_code, 429)
            self.assertEqual(busy.headers["Retry-After"], "1")
            self.video.touch()
            self.assertEqual(client.get(frames[0]["url"]).status_code, 409)
