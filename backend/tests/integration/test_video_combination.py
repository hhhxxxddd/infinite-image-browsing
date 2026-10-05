"""Real media regression for crop/fit, local effects, animation and overlap together."""

import copy
import hashlib
import io
import json
import math
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageStat

from omnigallery.workspaces.video_studio import HIDDEN, VideoExport, render_video


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg required")
class VideoCombinationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.evidence = os.environ.get("VIDEO_COMBINATION_EVIDENCE_DIR")
        self.commands = []
        self.metrics = {}
        self.background = self.root / "background.png"
        self.before = self.root / "before.png"
        self.pattern = self.root / "pattern.png"
        self.video = self.root / "pattern.mp4"
        Image.new("RGB", (320, 240), (18, 25, 33)).save(self.background)
        Image.new("RGB", (320, 240), (220, 45, 60)).save(self.before)
        image = Image.new("RGB", (480, 270))
        image.putdata(
            [
                ((35, 90, 230) if ((x // 5 + y // 5) % 2) else (230, 190, 30))
                for y in range(270)
                for x in range(480)
            ]
        )
        image.save(self.pattern)
        subprocess.run(
            [
                shutil.which("ffmpeg"),
                "-nostdin",
                "-v",
                "error",
                "-y",
                "-loop",
                "1",
                "-i",
                str(self.pattern),
                "-t",
                "4",
                "-vf",
                "fps=12",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                str(self.video),
            ],
            check=True,
            capture_output=True,
            timeout=30,
            creationflags=HIDDEN,
        )
        self.fingerprints = {
            path.name: hashlib.sha256(path.read_bytes()).hexdigest()
            for path in (self.background, self.before, self.pattern, self.video)
        }

    def clip(self, identity, path, **fields):
        return {
            "id": identity,
            "name": path.name,
            "path": str(path),
            "kind": "video" if path.suffix == ".mp4" else "image",
            "start": 0,
            "sourceIn": 0,
            "sourceDuration": 4,
            "duration": 3,
            "rate": 1,
            "gain": 1,
            **fields,
        }

    def document(self):
        return {
            "version": 1,
            "width": 320,
            "height": 240,
            "fps": 12,
            "tracks": [{"id": "base", "kind": "video"}, {"id": "foreground", "kind": "video"}],
            "visuals": [
                self.clip("base", self.background, trackId="base"),
                self.clip("before", self.before, trackId="foreground", duration=2),
                self.clip(
                    "after",
                    self.video,
                    trackId="foreground",
                    start=1,
                    duration=2,
                    transform={
                        "fit": "contain",
                        "crop": {"x": 0.125, "y": 0.1, "width": 0.75, "height": 0.8},
                        "flipX": True,
                        "scale": 0.85,
                        "rotation": 5,
                    },
                    color={"brightness": 0.08, "contrast": 0.9, "saturation": 0.8},
                    keyframes=[
                        {
                            "time": 1,
                            "x": 0.08,
                            "y": 0.05,
                            "scale": 0.7,
                            "rotation": 35,
                            "opacity": 0.8,
                            "easing": "easeInOut",
                        }
                    ],
                    transitionIn={"previousId": "before", "duration": 1, "easing": "easeInOut"},
                    localEffects={
                        "exposure": 0.25,
                        "temperature": 0.15,
                        "tint": -0.1,
                        "gamma": 1.1,
                        "regions": [
                            {
                                "id": "blur",
                                "shape": "rectangle",
                                "effect": "blur",
                                "x": 0.1,
                                "y": 0.2,
                                "width": 0.25,
                                "height": 0.6,
                                "strength": 1,
                            },
                            {
                                "id": "mosaic",
                                "shape": "rectangle",
                                "effect": "mosaic",
                                "x": 0.5,
                                "y": 0.2,
                                "width": 0.32,
                                "height": 0.6,
                                "strength": 1,
                            },
                        ],
                    },
                ),
            ],
            "sounds": [],
            "captions": [],
            "markers": [],
        }

    def render(self, name, document, selected_range=None):
        directory = self.root / name
        directory.mkdir()
        target = directory / "output.mp4"
        request = VideoExport(
            workspace_id="d96aaedf-4107-45ed-b22d-54e56ece5a28",
            document_id="video-combination-qa",
            document_revision="0" * 64,
            name=f"{name}.mp4",
            document=document,
            range=selected_range,
        )

        def trusted(path):
            self.assertTrue(Path(path).resolve().is_relative_to(self.root))

        def run(args, stage, duration, **progress):
            self.commands.append({"inputs": args.count("-i"), "seconds": duration, **progress})
            process = subprocess.run(
                args, cwd=stage, capture_output=True, timeout=90, creationflags=HIDDEN
            )
            self.assertEqual(process.returncode, 0, process.stderr.decode(errors="replace"))

        render_video(request, target, directory, trusted, run_process=run)
        if self.evidence:
            evidence = Path(self.evidence).resolve()
            evidence.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(target, evidence / f"{name}.mp4")
            (evidence / f"{name}-document.json").write_text(
                request.model_dump_json(indent=2), encoding="utf-8"
            )
        return target

    def frame(self, path, time, name=None):
        process = subprocess.run(
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
        frame = Image.open(io.BytesIO(process.stdout)).convert("RGB")
        if name and self.evidence:
            frame.save(Path(self.evidence) / f"{name}.png")
        return frame

    def record(self, name):
        self.assertLessEqual(max(command["inputs"] for command in self.commands), 2)
        for path in (self.background, self.before, self.pattern, self.video):
            self.assertEqual(
                hashlib.sha256(path.read_bytes()).hexdigest(), self.fingerprints[path.name]
            )
        if self.evidence:
            evidence = Path(self.evidence)
            for path in (self.background, self.before, self.pattern, self.video):
                shutil.copyfile(path, evidence / path.name)
            (evidence / f"{name}-metrics.json").write_text(
                json.dumps(
                    {"metrics": self.metrics, "commands": self.commands, "sourcesUnchanged": True},
                    indent=2,
                ),
                encoding="utf-8",
            )

    def test_combined_animation_overlap_and_selected_range_keep_original_time(self):
        document = self.document()
        full = self.render("video-combination-full", document)
        selected = self.render("video-combination-range", document, {"start": 1.25, "end": 2.75})
        for time in (1.25, 1.5, 1.75, 2.25):
            original = self.frame(full, time, f"video-full-{time}")
            rebased = self.frame(selected, time - 1.25, f"video-range-{time}")
            deltas = [
                abs(a - b) for a, b in zip(original.tobytes(), rebased.tobytes(), strict=True)
            ]
            mean = sum(deltas) / len(deltas)
            self.metrics[f"rangeFrame{time}MeanChannelError"] = mean
            self.assertLess(mean, 3, f"range frame {time} restarted an animation or transition")
        # Removing the transition exposes the same animated/effected layer at full envelope alpha.
        # At an opaque lower layer, actual overlap alpha is independently observable by blending it.
        plain = copy.deepcopy(document)
        plain["visuals"][2].pop("transitionIn")
        without_transition = self.render(
            "video-combination-no-transition", plain, {"start": 1.25, "end": 1.75}
        )
        before = self.frame(full, 0.5)
        for time, weight in ((1.25, 0.15625), (1.5, 0.5)):
            transitioned = self.frame(full, time)
            no_transition = self.frame(without_transition, time - 1.25)
            for x, y in ((130, 110), (160, 120), (190, 130), (220, 140)):
                for actual, base, final in zip(
                    transitioned.getpixel((x, y)),
                    before.getpixel((x, y)),
                    no_transition.getpixel((x, y)),
                    strict=True,
                ):
                    self.assertAlmostEqual(actual, base + (final - base) * weight, delta=12)
        self.record("video-combination-range")

    def test_blur_and_mosaic_are_local_before_flip_rotation_scale_and_legacy_color(self):
        document = self.document()
        processed = self.render(
            "video-combination-processed", document, {"start": 2.25, "end": 2.75}
        )
        baseline = copy.deepcopy(document)
        baseline["visuals"][2]["localEffects"]["regions"] = []
        unchanged = self.render(
            "video-combination-no-regions", baseline, {"start": 2.25, "end": 2.75}
        )
        actual = self.frame(processed, 0.25, "video-combination-processed-frame")
        source = self.frame(unchanged, 0.25, "video-combination-no-regions-frame")

        def world(x, y):
            # This is the final held pose; coordinates describe the fitted plane before flip.
            xx, yy = -(x - 160) * 0.7, (y - 120) * 0.7
            angle = math.radians(35)
            return (
                round(185.6 + xx * math.cos(angle) - yy * math.sin(angle)),
                round(132 + xx * math.sin(angle) + yy * math.cos(angle)),
            )

        for label, xs, ys in (
            ("blur", range(45, 105, 3), range(80, 160, 3)),
            # All sample centers are safely within one nineteen-pixel mosaic cell.
            ("mosaic", range(174, 186), range(98, 110)),
        ):
            values, originals = [], []
            for x in xs:
                for y in ys:
                    point = world(x, y)
                    values.append(actual.getpixel(point))
                    originals.append(source.getpixel(point))
            patch = Image.new("RGB", (len(values), 1))
            patch.putdata(values)
            reference = Image.new("RGB", (len(originals), 1))
            reference.putdata(originals)
            variance = sum(ImageStat.Stat(patch).var)
            original_variance = sum(ImageStat.Stat(reference).var)
            self.metrics[f"{label}Variance"] = variance
            self.metrics[f"{label}UnprocessedVariance"] = original_variance
            self.assertGreater(original_variance, 300)
            self.assertLess(variance, original_variance * 0.15)
        # A region-free location keeps global/local color and transform unchanged.
        outside = [world(x, y) for x in range(120, 145) for y in range(90, 145)]
        delta = sum(
            abs(a - b)
            for point in outside
            for a, b in zip(actual.getpixel(point), source.getpixel(point), strict=True)
        ) / (len(outside) * 3)
        self.metrics["outsideRegionsMeanChannelError"] = delta
        self.assertLess(delta, 5)
        self.record("video-combination-local")


if __name__ == "__main__":
    unittest.main()
