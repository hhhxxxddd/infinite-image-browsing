import shutil
import unittest

from PIL import Image
from pydantic import ValidationError

from backend.tests.integration import test_video_studio as support
from omnigallery.workspaces.video_caption_layout import caption_lines
from omnigallery.workspaces.video_render import write_ass
from omnigallery.workspaces.video_studio import VideoDocument


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg required")
class VideoAnimationTests(unittest.TestCase):
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

    def plain(self):
        document = self.document()
        document["sounds"], document["captions"] = [], []
        return document

    def test_rotation_easing_and_retained_curve_ranges_are_rendered(self):
        source = self.root / "halves.png"
        image = Image.new("RGB", (320, 240), "red")
        image.paste("blue", (160, 0, 320, 240))
        image.save(source)
        document = self.plain()
        document["visuals"] = [
            self.clip(source, "image", keyframes=[{"time": 1, "rotation": 90, "easing": "easeIn"}])
        ]
        output = self.result(document)
        self.assertGreater(self.frame(output, 0.5).getpixel((200, 40))[2], 180)
        self.assertGreater(self.frame(output, 0.9).getpixel((200, 40))[0], 180)
        # A trimmed curve keeps the original easing interval, rather than restarting it.
        document["visuals"] = [
            self.clip(
                source,
                "image",
                duration=0.5,
                transform={"rotation": 22.5},
                keyframes=[
                    {
                        "time": 0.5,
                        "rotation": 90,
                        "curves": {"rotation": {"easing": "easeIn", "start": 0.5, "end": 1}},
                    }
                ],
            )
        ]
        trimmed = self.result(document)
        original = self.frame(output, 0.75)
        rebased = self.frame(trimmed, 0.25)
        for pixel in [(70, 90), (160, 60), (200, 40), (230, 170)]:
            for a, b in zip(original.getpixel(pixel), rebased.getpixel(pixel), strict=True):
                self.assertAlmostEqual(a, b, delta=10)

    def test_transition_uses_actual_overlap_easing_and_export_range_progress(self):
        document = self.plain()
        before = self.clip(self.image, "image", duration=2)
        document["visuals"] = [
            before,
            self.clip(
                self.video,
                "video",
                start=1,
                duration=2,
                transitionIn={"previousId": before["id"], "duration": 1, "easing": "easeIn"},
            ),
        ]
        output = self.result(document, range={"start": 1.25, "end": 1.75})
        red, green, blue = self.frame(output, 0.25).getpixel((160, 120))
        self.assertAlmostEqual(red, 230 * 0.75, delta=12)
        self.assertLess(green, 35)
        self.assertAlmostEqual(blue, 24 * 0.75 + 255 * 0.25, delta=12)

    def test_local_mask_is_fitted_before_flip_and_rotation_and_keeps_lower_layers(self):
        document = self.plain()
        document["tracks"] = [{"id": "base", "kind": "video"}, {"id": "top", "kind": "video"}]
        document["visuals"] = [
            self.clip(self.image, "image", trackId="base"),
            self.clip(
                self.video,
                "video",
                trackId="top",
                transform={"flipX": True, "rotation": 90},
                localEffects={
                    "regions": [
                        {
                            "id": "hole",
                            "shape": "rectangle",
                            "effect": "mask",
                            "x": 0,
                            "y": 0,
                            "width": 0.5,
                            "height": 0.5,
                        }
                    ]
                },
            ),
        ]
        frame = self.frame(self.result(document), 0.4)
        self.assertGreater(frame.getpixel((200, 160))[0], 180)
        self.assertGreater(frame.getpixel((100, 80))[2], 180)

    def test_caption_width_wrap_and_curve_validation(self):
        document = self.plain()
        document["captions"] = [
            {
                "id": "cue",
                "start": 0,
                "duration": 1,
                "text": "HELLO WORLD WIDE TEXT",
                "style": {"maxWidth": 0.3, "wrap": True},
            }
        ]
        parsed = VideoDocument.model_validate(document)
        self.assertGreater(len(caption_lines(parsed.captions[0], parsed.width)), 1)
        output = self.root / "captions.ass"
        self.assertTrue(write_ass(parsed, 0, 1, output))
        self.assertIn(r"\N", output.read_text(encoding="utf-8"))
        parsed.captions[0].style.wrap = False
        self.assertEqual(caption_lines(parsed.captions[0], parsed.width), ["HELLO WORLD WIDE TEXT"])
        document["captions"][0]["style"]["maxWidth"] = 0.01
        with self.assertRaises(ValidationError):
            VideoDocument.model_validate(document)
        document["captions"] = []
        document["visuals"][0]["keyframes"] = [
            {
                "time": 1,
                "rotation": 90,
                "curves": {"rotation": {"easing": "easeOut", "start": 0.7, "end": 0.2}},
            }
        ]
        with self.assertRaises(ValidationError):
            VideoDocument.model_validate(document)
