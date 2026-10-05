import math
import shutil
import subprocess
import unittest

from pydantic import ValidationError

from omnigallery.workspaces.video_local_effects import (
    LocalVideoEffects,
    LocalVideoRegion,
    color_channel,
    local_effects_graph,
    region_coverage,
)


def region(**patch):
    return LocalVideoRegion(id="one", x=0.25, y=0.25, width=0.5, height=0.5, **patch)


class LocalVideoEffectValidationTests(unittest.TestCase):
    def test_invalid_regions_colors_and_duplicate_ids_are_rejected(self):
        for values in (
            {"gamma": 0},
            {"exposure": math.inf},
            {"temperature": 2},
            {"regions": [region()] * 2},
            {"regions": [region().model_copy(update={"id": str(i)}) for i in range(9)]},
        ):
            with self.subTest(values=values), self.assertRaises(ValidationError):
                LocalVideoEffects.model_validate(values)
        with self.assertRaises(ValidationError):
            LocalVideoRegion(id="outside", x=0.9, y=0, width=0.2, height=1)

    def test_graph_has_no_new_decode_inputs_and_unique_sequential_labels(self):
        effects = LocalVideoEffects(
            regions=[region(effect="blur").model_copy(update={"id": str(i)}) for i in range(8)]
        )
        graph = local_effects_graph("input", "output", effects, 3840, 2160, "clip7")
        self.assertEqual(sum("split=3" in node for node in graph), 8)
        self.assertFalse(any("movie=" in node or "buffer=" in node for node in graph))
        self.assertIn("[clip7_r7]format=gbrap[output]", graph)
        for args in (("bad;filter", "out", 10, 10), ("in", "out", 8192, 8192)):
            with self.assertRaises(ValueError):
                local_effects_graph(args[0], args[1], effects, args[2], args[3], "safe")


@unittest.skipUnless(shutil.which("ffmpeg"), "FFmpeg required")
class LocalVideoEffectRenderTests(unittest.TestCase):
    width, height = 32, 24

    def render(self, pixels, effects):
        graph = ";".join(local_effects_graph("0:v", "out", effects, self.width, self.height, "fx"))
        process = subprocess.run(
            [
                shutil.which("ffmpeg"),
                "-nostdin",
                "-v",
                "error",
                "-filter_complex_threads",
                "1",
                "-f",
                "rawvideo",
                "-pixel_format",
                "rgba",
                "-video_size",
                f"{self.width}x{self.height}",
                "-i",
                "pipe:0",
                "-filter_complex",
                graph,
                "-map",
                "[out]",
                "-frames:v",
                "1",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgba",
                "pipe:1",
            ],
            input=bytes(pixels),
            capture_output=True,
            timeout=20,
        )
        self.assertEqual(process.returncode, 0, process.stderr.decode(errors="replace"))
        self.assertEqual(len(process.stdout), self.width * self.height * 4)
        return process.stdout

    def solid(self, color=(100, 80, 60, 200)):
        return bytes(color) * (self.width * self.height)

    def test_new_color_math_matches_canvas_equations_and_keeps_alpha(self):
        effects = LocalVideoEffects(exposure=0.7, temperature=0.6, tint=-0.4, gamma=1.4)
        result = self.render(self.solid(), effects)
        expected = [
            math.floor(color_channel(value, channel, effects))
            for channel, value in enumerate((100, 80, 60))
        ]
        self.assertEqual(list(result[:4]), [*expected, 200])
        self.assertEqual(list(result[-4:]), [*expected, 200])

    def test_rectangle_ellipse_inverse_and_soft_alpha_match_pixel_center_equations(self):
        for shape in ("rectangle", "ellipse"):
            for invert in (False, True):
                for feather in (0, 0.2):
                    with self.subTest(shape=shape, invert=invert, feather=feather):
                        mask = region(shape=shape, effect="mask", invert=invert, feather=feather)
                        result = self.render(self.solid(), LocalVideoEffects(regions=[mask]))
                        for y in range(self.height):
                            for x in range(self.width):
                                offset = (y * self.width + x) * 4
                                expected = math.floor(
                                    200 * (1 - region_coverage(mask, x, y, self.width, self.height))
                                )
                                self.assertAlmostEqual(result[offset + 3], expected, delta=1)
                                self.assertEqual(list(result[offset : offset + 3]), [100, 80, 60])

    def test_mosaic_samples_fixed_cells_only_inside_region(self):
        source = bytes(
            value
            for y in range(self.height)
            for x in range(self.width)
            for value in (x * 7, y * 9, x + y, 180)
        )
        mask = region(effect="mosaic", strength=1)
        result = self.render(source, LocalVideoEffects(regions=[mask]))
        block = max(2, math.floor(0.08 * min(self.width, self.height) + 0.5))
        for y in range(self.height):
            for x in range(self.width):
                offset = (y * self.width + x) * 4
                sx, sy = x, y
                if region_coverage(mask, x, y, self.width, self.height):
                    sx = min(self.width - 1, x // block * block + block // 2)
                    sy = min(self.height - 1, y // block * block + block // 2)
                expected = (sy * self.width + sx) * 4
                self.assertEqual(result[offset : offset + 4], source[expected : expected + 4])

    def test_blur_changes_selected_pixels_only_and_retains_transparency(self):
        source = bytes(
            value
            for y in range(self.height)
            for x in range(self.width)
            for value in ((255 if x == 16 and y == 12 else 0), 0, 0, 177)
        )
        result = self.render(source, LocalVideoEffects(regions=[region(effect="blur", strength=1)]))
        pixel = (12 * self.width + 16) * 4
        self.assertAlmostEqual(result[pixel], 28, delta=2)
        self.assertGreater(result[pixel - 4], 20)
        self.assertEqual(result[3::4], source[3::4])
        self.assertEqual(result[: self.width * 4 * 6], source[: self.width * 4 * 6])

    def test_soft_inverse_blur_matches_separable_canvas_box_passes_at_frame_edges(self):
        # Deliberately includes high-contrast frame edges and partial alpha.
        width, height = self.width, self.height
        source = bytes(
            value
            for y in range(height)
            for x in range(width)
            for value in (
                (x * 53 + y * 31) % 256,
                (x * 17 + y * 73) % 256,
                (x * 3 + y * 11) % 256,
                123,
            )
        )
        mask = region(effect="blur", strength=1, feather=0.2, invert=True, shape="ellipse")
        result = self.render(source, LocalVideoEffects(regions=[mask]))
        radius = max(1, math.floor(0.04 * min(width, height) + 0.5))
        divisor = 2 * radius + 1

        def reflect(value, extent):
            return -value - 1 if value < 0 else extent * 2 - value - 1 if value >= extent else value

        blurred = bytearray(source)
        for channel in range(3):
            horizontal = [
                math.floor(
                    sum(
                        source[(y * width + reflect(x + k, width)) * 4 + channel]
                        for k in range(-radius, radius + 1)
                    )
                    / divisor
                    + 0.5
                )
                for y in range(height)
                for x in range(width)
            ]
            for y in range(height):
                for x in range(width):
                    blurred[(y * width + x) * 4 + channel] = math.floor(
                        sum(
                            horizontal[reflect(y + k, height) * width + x]
                            for k in range(-radius, radius + 1)
                        )
                        / divisor
                        + 0.5
                    )
        for y in range(height):
            for x in range(width):
                coverage = math.floor(region_coverage(mask, x, y, width, height) * 255) / 255
                offset = (y * width + x) * 4
                for channel in range(3):
                    expected = math.floor(
                        source[offset + channel] * (1 - coverage)
                        + blurred[offset + channel] * coverage
                        + 0.5
                    )
                    self.assertAlmostEqual(
                        result[offset + channel],
                        expected,
                        delta=1,
                        msg=f"pixel {x},{y}, channel {channel}",
                    )
                self.assertEqual(result[offset + 3], 123)

    def test_sequential_regions_preserve_alpha_and_are_not_flattened_to_black(self):
        effects = LocalVideoEffects(
            regions=[
                region(effect="mask"),
                region(effect="blur").model_copy(update={"id": "two"}),
                region(effect="mosaic").model_copy(update={"id": "three"}),
            ]
        )
        result = self.render(self.solid(), effects)
        center = (12 * self.width + 16) * 4
        self.assertEqual(list(result[center : center + 4]), [100, 80, 60, 0])
        self.assertEqual(list(result[:4]), [100, 80, 60, 200])


if __name__ == "__main__":
    unittest.main()
