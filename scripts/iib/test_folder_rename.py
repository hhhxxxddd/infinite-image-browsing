"""Directory renames preserve the identity and annotations of indexed media."""

from pathlib import Path
import sqlite3
import tempfile
import unittest

from scripts.iib.folder_rename import rename_managed_folder


class FolderRenameTests(unittest.TestCase):
    def test_renames_subtree_without_losing_media_relations(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            child = root / "old"
            nested = child / "nested"
            nested.mkdir(parents=True)
            first = child / "first.jpg"
            second = nested / "second.jpg"
            first.touch()
            second.touch()
            conn = sqlite3.connect(":memory:")
            conn.executescript("""
                CREATE TABLE image (id INTEGER PRIMARY KEY, path TEXT UNIQUE);
                CREATE TABLE folders (path TEXT);
                CREATE TABLE dir_cover_cache (folder_path TEXT PRIMARY KEY);
                CREATE TABLE image_tag (image_id INTEGER, tag_id INTEGER);
                CREATE TABLE media_order (image_id INTEGER PRIMARY KEY, position INTEGER);
            """)
            conn.executemany("INSERT INTO image VALUES (?, ?)", [(1, str(first)), (2, str(second))])
            conn.executemany("INSERT INTO folders VALUES (?)", [(str(child),), (str(nested),)])
            conn.executemany("INSERT INTO dir_cover_cache VALUES (?)", [(str(root),), (str(child),)])
            conn.execute("INSERT INTO image_tag VALUES (1, 7)")
            conn.execute("INSERT INTO media_order VALUES (1, 4)")

            new_path = rename_managed_folder(conn, str(child), "new", [str(root)])
            self.assertEqual(new_path, str(root / "new"))
            self.assertFalse(child.exists())
            self.assertTrue((root / "new" / "nested" / "second.jpg").exists())
            self.assertEqual(conn.execute("SELECT id, path FROM image ORDER BY id").fetchall(), [
                (1, str(root / "new" / "first.jpg")), (2, str(root / "new" / "nested" / "second.jpg"))
            ])
            self.assertEqual(conn.execute("SELECT path FROM folders ORDER BY path").fetchall(), [
                (str(root / "new"),), (str(root / "new" / "nested"),)
            ])
            self.assertEqual(conn.execute("SELECT count(*) FROM dir_cover_cache").fetchone()[0], 0)
            self.assertEqual(conn.execute("SELECT * FROM image_tag").fetchall(), [(1, 7)])
            self.assertEqual(conn.execute("SELECT * FROM media_order").fetchall(), [(1, 4)])
            conn.close()

    def test_rejects_registered_roots_and_conflicts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            child = root / "child"
            child.mkdir()
            (root / "taken").mkdir()
            conn = sqlite3.connect(":memory:")
            with self.assertRaisesRegex(ValueError, "根目录"):
                rename_managed_folder(conn, str(root), "renamed", [str(root)])
            with self.assertRaisesRegex(ValueError, "已有同名"):
                rename_managed_folder(conn, str(child), "taken", [str(root)])
            with self.assertRaisesRegex(ValueError, "包含已添加根目录"):
                rename_managed_folder(conn, str(child), "renamed", [str(root), str(child / "other-root")])
            self.assertTrue(child.exists())
            conn.close()

    def test_database_failure_restores_original_folder(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            child = root / "child"
            child.mkdir()
            conn = sqlite3.connect(":memory:")
            with self.assertRaises(sqlite3.OperationalError):
                rename_managed_folder(conn, str(child), "new", [str(root)])
            self.assertTrue(child.exists())
            self.assertFalse((root / "new").exists())
            conn.close()


if __name__ == "__main__":
    unittest.main()
