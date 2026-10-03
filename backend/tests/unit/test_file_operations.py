import errno
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from omnigallery.library.file_operations import (
    copy_file_exclusive,
    copy_media_exclusive,
    move_file_exclusive,
)


class ExclusiveFileTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.source, self.target = self.root / "source.png", self.root / "target.png"
        self.source.write_bytes(b"original")

    def test_destination_arriving_after_preflight_is_not_overwritten(self):
        self.target.write_bytes(b"existing")
        for transfer in (copy_file_exclusive, move_file_exclusive):
            with self.assertRaises(FileExistsError):
                transfer(str(self.source), str(self.target))
            self.assertEqual(self.source.read_bytes(), b"original")
            self.assertEqual(self.target.read_bytes(), b"existing")

    def test_cross_volume_fallback_never_clobbers_existing_files(self):
        self.target.write_bytes(b"existing")
        with (
            patch(
                "omnigallery.library.file_operations.os.link", side_effect=OSError("cross-volume")
            ),
            patch(
                "omnigallery.library.file_operations.os.rename",
                side_effect=OSError(errno.EXDEV, "cross-volume"),
            ),
            self.assertRaises(FileExistsError),
        ):
            move_file_exclusive(str(self.source), str(self.target))
        self.assertEqual(self.source.read_bytes(), b"original")
        self.assertEqual(self.target.read_bytes(), b"existing")

    def test_sidecar_failure_removes_only_the_new_copy(self):
        sidecar = self.source.with_suffix(".txt")
        sidecar.write_bytes(b"metadata")
        real_copy = copy_file_exclusive

        def copy(source, destination):
            if source == str(sidecar):
                raise PermissionError("cannot read sidecar")
            real_copy(source, destination)

        with (
            patch("omnigallery.library.file_operations.copy_file_exclusive", side_effect=copy),
            self.assertRaises(PermissionError),
        ):
            copy_media_exclusive(str(self.source), str(self.target), str(sidecar))
        self.assertFalse(self.target.exists())
        self.assertFalse(self.target.with_suffix(".txt").exists())
        self.assertEqual(self.source.read_bytes(), b"original")
        self.assertEqual(sidecar.read_bytes(), b"metadata")
