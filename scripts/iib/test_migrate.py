"""The path migration CLI must update only the requested database."""

import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path


class MigrateDatabaseTests(unittest.TestCase):
    def test_custom_db_path_does_not_overwrite_default_database(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "custom.db"
            unrelated = root / "iib.db"
            unrelated.write_bytes(b"another database must stay untouched")
            with closing(sqlite3.connect(database)) as conn:
                for table in ("image", "extra_path", "folders"):
                    conn.execute(f"CREATE TABLE {table} (path TEXT PRIMARY KEY)")
                conn.executemany(
                    "INSERT INTO image(path) VALUES (?)",
                    [("/archive/photo.jpg",), ("/archive-old/photo.jpg",)],
                )
                conn.execute("INSERT INTO extra_path(path) VALUES ('/archive')")
                conn.execute("INSERT INTO folders(path) VALUES ('/archive/nested')")
                conn.commit()

            script = Path(__file__).resolve().parents[2] / "migrate.py"
            result = subprocess.run(
                [sys.executable, str(script), "--db_path", str(database),
                 "--old_dir", "/archive", "--new_dir", "/library"],
                cwd=root, capture_output=True, text=True, check=False,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(unrelated.read_bytes(), b"another database must stay untouched")
            with closing(sqlite3.connect(database)) as conn:
                self.assertEqual(
                    {row[0] for row in conn.execute("SELECT path FROM image")},
                    {"/library/photo.jpg", "/archive-old/photo.jpg"},
                )
                self.assertEqual(conn.execute("SELECT path FROM extra_path").fetchone()[0], "/library")
                self.assertEqual(conn.execute("SELECT path FROM folders").fetchone()[0], "/library/nested")
            self.assertFalse((root / "db_migrate_temp.db").exists())


if __name__ == "__main__":
    unittest.main()
