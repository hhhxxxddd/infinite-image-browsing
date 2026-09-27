"""Checks motion detection without opening the user's media library."""

import tempfile
import unittest
from pathlib import Path

from PIL import Image

from omnigallery.metadata.motion import is_animated_image


class MediaMotionTests(unittest.TestCase):
    def test_static_and_animated_images(self):
        with tempfile.TemporaryDirectory() as folder:
            first = Image.new("RGB", (8, 8), "red")
            second = Image.new("RGB", (8, 8), "blue")
            for extension in ("gif", "webp"):
                with self.subTest(extension=extension):
                    path = Path(folder) / f"animated.{extension}"
                    first.save(path, save_all=True, append_images=[second], duration=100, loop=0)
                    stat = path.stat()
                    self.assertTrue(is_animated_image(str(path), stat.st_mtime_ns, stat.st_size))

            path = Path(folder) / "static.png"
            first.save(path)
            stat = path.stat()
            self.assertFalse(is_animated_image(str(path), stat.st_mtime_ns, stat.st_size))


if __name__ == "__main__":
    unittest.main()
