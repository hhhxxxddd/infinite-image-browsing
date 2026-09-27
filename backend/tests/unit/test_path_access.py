import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from omnigallery.infrastructure.route_context import RouteContext


class PathAccessTests(unittest.TestCase):
    def test_only_navigation_allows_ancestors(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            library = root / "album"
            library.mkdir()
            context = RouteContext()
            context.mem["all_scanned_paths"] = [str(library)]
            with patch("omnigallery.infrastructure.route_context.enable_access_control", True):
                self.assertTrue(context.is_path_trusted(str(library)))
                self.assertTrue(context.is_path_trusted(str(library / "image.png")))
                self.assertFalse(context.is_path_trusted(str(root)))
                self.assertTrue(context.is_path_browsable(str(root)))
                self.assertTrue(context.is_path_browsable(str(library)))
                self.assertFalse(context.is_path_trusted(str(root / "al")))
                self.assertFalse(context.is_path_trusted(str(root / "album-copy")))
                self.assertFalse(context.is_path_trusted(str(library / ".." / "other")))
                self.assertFalse(context.is_path_browsable(str(root / "album-copy")))
                with self.assertRaises(HTTPException) as rejected:
                    context.check_path_trust(str(root))
                self.assertEqual(rejected.exception.status_code, 403)

    def test_explicit_empty_parent_list_has_no_allowed_roots(self):
        context = RouteContext()
        context.mem["all_scanned_paths"] = [os.getcwd()]
        self.assertTrue(context.is_path_under_parents(os.getcwd()))
        self.assertFalse(context.is_path_under_parents(os.getcwd(), []))
