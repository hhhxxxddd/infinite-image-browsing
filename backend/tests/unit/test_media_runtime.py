"""Managed FFmpeg updates must not replace a working runtime on failure."""

import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from omnigallery.infrastructure import media_runtime


class MediaRuntimeTests(unittest.TestCase):
    def test_managed_binaries_take_precedence(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            active = root / ("a" * 32) / "bin"
            active.mkdir(parents=True)
            for name in ("ffmpeg.exe", "ffprobe.exe"):
                (active / name).touch()
            (root / "active.json").write_text(json.dumps({"directory": "a" * 32}), encoding="utf-8")
            with patch.object(media_runtime, "RUNTIME_ROOT", root):
                ffmpeg, ffprobe, source = media_runtime.binaries()
            self.assertEqual(
                (ffmpeg, ffprobe, source),
                (str(active / "ffmpeg.exe"), str(active / "ffprobe.exe"), "managed"),
            )

    def test_install_switches_pointer_only_after_validation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            old = "a" * 32
            (root / old).mkdir()
            pointer = root / "active.json"
            pointer.write_text(json.dumps({"directory": old}), encoding="utf-8")

            def unpack(_archive, stage):
                (stage / "bin").mkdir()
                (stage / "bin/ffmpeg.exe").touch()
                (stage / "bin/ffprobe.exe").touch()

            with (
                patch.object(media_runtime, "RUNTIME_ROOT", root),
                patch.object(media_runtime, "_download", side_effect=lambda path: path.touch()),
                patch.object(media_runtime, "_unpack", side_effect=unpack),
                patch.object(media_runtime, "_validate", side_effect=RuntimeError("bad binary")),
            ):
                media_runtime.install()
                self.assertEqual(json.loads(pointer.read_text())["directory"], old)
                self.assertEqual(len(list(root.iterdir())), 2)
                self.assertIn("bad binary", media_runtime._job["error"])

            with (
                patch.object(media_runtime, "RUNTIME_ROOT", root),
                patch.object(media_runtime, "_download", side_effect=lambda path: path.touch()),
                patch.object(media_runtime, "_unpack", side_effect=unpack),
                patch.object(media_runtime, "_validate"),
            ):
                media_runtime.install()
                new = json.loads(pointer.read_text())["directory"]
                self.assertNotEqual(new, old)
                self.assertTrue((root / new / "bin/ffmpeg.exe").is_file())
                self.assertTrue((root / old).exists())

    def test_unpack_only_copies_executables(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            archive = root / "source.zip"
            stage = root / "stage"
            stage.mkdir()
            with zipfile.ZipFile(archive, "w") as source:
                source.writestr("ffmpeg/bin/ffmpeg.exe", b"ffmpeg")
                source.writestr("ffmpeg/bin/ffprobe.exe", b"ffprobe")
                source.writestr("ffmpeg/doc/large.txt", b"unneeded")
            media_runtime._unpack(archive, stage)
            self.assertEqual((stage / "bin/ffmpeg.exe").read_bytes(), b"ffmpeg")
            self.assertFalse((stage / "ffmpeg").exists())


if __name__ == "__main__":
    unittest.main()
