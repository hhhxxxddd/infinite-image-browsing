import json
from pathlib import Path
import tempfile
import unittest

import piexif
from PIL import Image
from PIL.PngImagePlugin import PngInfo

from scripts.iib.parsers.index import parse_image_info
from scripts.iib.parsers.model import ImageGenerationInfo


GRAPH = {
    "1": {"class_type": "CLIPTextEncode", "inputs": {"text": "a red fox, forest"}},
    "2": {"class_type": "CLIPTextEncode", "inputs": {"text": "blurry"}},
    "3": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "model.safetensors"}},
    "4": {"class_type": "KSampler", "inputs": {
        "positive": ["1", 0], "negative": ["2", 0], "model": ["3", 0],
        "seed": 42, "steps": 20, "cfg": 7, "sampler_name": "euler", "scheduler": "normal",
    }},
}
PARAMETERS = "a red fox, forest\nNegative prompt: blurry\nSteps: 20, Sampler: Euler, CFG scale: 7, Seed: 42"


class ComfyUIOnlyTests(unittest.TestCase):
    def test_empty_generation_info_does_not_share_metadata(self):
        first = ImageGenerationInfo()
        second = ImageGenerationInfo()
        first.params.meta["Source Identifier"] = "ComfyUI"
        first.params.pos_prompt.append("first image")
        self.assertEqual(second.params.meta, {})
        self.assertEqual(second.params.pos_prompt, [])

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)

    def png(self, **metadata):
        path = self.folder / "image.png"
        info = PngInfo()
        for key, value in metadata.items():
            info.add_text(key, value)
        Image.new("RGB", (64, 32)).save(path, pnginfo=info)
        return path

    def assert_comfy(self, path):
        info = parse_image_info(str(path))
        self.assertEqual(info.params.meta["Source Identifier"], "ComfyUI")
        self.assertIn("a red fox", info.raw_info)
        self.assertEqual(info.params.meta["final_width"], 64)
        self.assertEqual(info.params.meta["final_height"], 32)
        return info

    def test_png_workflow(self):
        info = self.assert_comfy(self.png(prompt=json.dumps(GRAPH), workflow='{"nodes": []}'))
        self.assertIn("blurry", info.raw_info)
        self.assertIn("model.safetensors", info.raw_info)

    def test_custom_sampler(self):
        graph = json.loads(json.dumps(GRAPH))
        graph["4"]["class_type"] = "ClownsharKSampler"
        self.assert_comfy(self.png(prompt=json.dumps(graph)))

    def test_prompt_graph_in_parameters(self):
        self.assert_comfy(self.png(parameters=json.dumps(GRAPH)))

    def test_comfy_compatible_parameters(self):
        self.assert_comfy(self.png(prompt=json.dumps(GRAPH), parameters=PARAMETERS))

    def test_no_sampler(self):
        self.assert_comfy(self.png(prompt=json.dumps({"1": GRAPH["1"]})))

    def test_jpeg_and_webp(self):
        exif = piexif.dump({"0th": {
            piexif.ImageIFD.ImageDescription: b'workflow:{"nodes": []}',
            piexif.ImageIFD.Make: ("prompt:" + json.dumps(GRAPH)).encode(),
        }})
        for extension in ("jpg", "webp"):
            with self.subTest(extension=extension):
                path = self.folder / ("image." + extension)
                Image.new("RGB", (64, 32)).save(path, exif=exif)
                self.assert_comfy(path)

    def test_other_generators_and_plain_images_have_no_generation_info(self):
        cases = [
            {},
            {"parameters": PARAMETERS},
            {"parameters": "class_type, " + PARAMETERS},
            {"Software": "NovelAI", "Comment": json.dumps({"prompt": "a red fox", "steps": 20})},
            {"parameters": json.dumps({"sui_image_params": {"prompt": "a red fox"}})},
            {"invokeai_metadata": json.dumps({"positive_prompt": "a red fox"})},
            {"invokeai_graph": json.dumps({"nodes": {"core_metadata": {}}})},
        ]
        # Fooocus' adjacent HTML log and generic text sidecars must not enable parsing.
        (self.folder / "log.html").write_text('<div id="image_png">Fooocus</div>')
        (self.folder / "image.txt").write_text(PARAMETERS)
        for metadata in cases:
            with self.subTest(metadata=metadata):
                info = parse_image_info(str(self.png(**metadata)))
                self.assertEqual(info.raw_info, "")
                self.assertEqual(info.params.pos_prompt, [])
                self.assertEqual(info.params.meta, {"final_width": 64, "final_height": 32})

    def test_malformed_comfy_metadata_keeps_image_browsable(self):
        info = parse_image_info(str(self.png(prompt="{broken", workflow='{"nodes": []}')))
        self.assertEqual(info.raw_info, "")
        self.assertEqual(info.params.meta["final_width"], 64)


if __name__ == "__main__":
    unittest.main()
