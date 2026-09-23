import unittest

from scripts.iib.thumbnail_size import fit_short_edge


class ThumbnailSizeTest(unittest.TestCase):
    def test_landscape_and_portrait_use_short_edge(self):
        self.assertEqual(fit_short_edge((4000, 2000), 512), (1024, 512))
        self.assertEqual(fit_short_edge((2000, 4000), 512), (512, 1024))

    def test_small_images_are_not_upscaled(self):
        self.assertEqual(fit_short_edge((300, 200), 512), (300, 200))

    def test_extreme_panorama_is_bounded(self):
        self.assertEqual(fit_short_edge((20000, 1000), 512), (4096, 205))


if __name__ == "__main__":
    unittest.main()
