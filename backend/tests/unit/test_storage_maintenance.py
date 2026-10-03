import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from omnigallery.storage import maintenance


class StorageMaintenanceTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name).resolve()

    def file(self, relative, content=b"12345"):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    def test_clear_only_regenerable_files_and_report_actual_reclaimed_bytes(self):
        thumbnail = self.file("cache/thumbnails/image/256.webp")
        generated = self.file("cache/thumbnails/video_cover/generated/cover.webp")
        self.file("cache/thumbnails/video_cover/generated/.generated", b"")
        protected = [
            self.file(path)
            for path in (
                "cache/thumbnails/video_cover/old-or-manual/cover.webp",
                "project-data/media-covers/manual.webp",
                "project-data/edit/snapshot.blob",
                "templates/template.json",
                "exports/archive.zip",
                "db/omnigallery.db",
                "models/weights.bin",
                "ai-runtime/python.exe",
                "gguf-runtime/server.exe",
                "media-runtime/ffmpeg.exe",
                "cache/huggingface/model.bin",
            )
        ]
        self.assertEqual(maintenance.usage(self.root)["reclaimable_bytes"], 10)
        result = maintenance.clear_cache(self.root)
        self.assertEqual(result["released_bytes"], 10)
        self.assertEqual(result["removed_files"], 2)
        self.assertFalse(thumbnail.exists())
        self.assertFalse(generated.exists())
        self.assertTrue(all(path.is_file() for path in protected))

    def test_in_flight_cache_and_current_process_temporary_files_are_preserved(self):
        image = self.file("cache/thumbnails/key/256.webp")
        temporary = self.file("tmp/rendering.wav")
        with maintenance.use_cache(image):
            self.assertEqual(maintenance.usage(self.root)["reclaimable_bytes"], 0)
            self.assertEqual(maintenance.clear_cache(self.root)["removed_files"], 0)
            self.assertTrue(image.exists())
        self.assertTrue(temporary.exists())
        with patch.object(maintenance, "_started", time.time() + 10):
            result = maintenance.clear_cache(self.root)
        self.assertEqual(result["removed_files"], 2)

    def test_symlink_does_not_expand_cleanup_or_usage_scope(self):
        external = self.file("user-original.webp", b"keep original")
        link = self.root / "cache/thumbnails/link.webp"
        link.parent.mkdir(parents=True)
        try:
            link.symlink_to(external)
        except OSError:
            self.skipTest("This account cannot create symlinks")
        self.assertEqual(maintenance.usage(self.root)["reclaimable_bytes"], 0)
        self.assertEqual(maintenance.clear_cache(self.root)["removed_files"], 0)
        self.assertEqual(external.read_bytes(), b"keep original")


if __name__ == "__main__":
    unittest.main()
