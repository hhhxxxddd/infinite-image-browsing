import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from backend.tests.support.database import isolate_database
from omnigallery.infrastructure.database import Database


class DatabaseIsolationTests(unittest.TestCase):
    def test_cleanup_closes_worker_connections_and_restores_database_state(self):
        original_path, original_local = Database.path, Database.local
        fixture = unittest.TestCase()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory).resolve() / "isolated.db"
            connections = isolate_database(fixture, path)
            try:
                main = Database.get_connection()
                self.assertIs(main, Database.get_connection())
                with ThreadPoolExecutor(max_workers=1) as executor:
                    worker = executor.submit(Database.get_connection).result()
                    self.assertIs(worker, executor.submit(Database.get_connection).result())
                self.assertIsNot(main, worker)
                self.assertEqual(len(connections), 2)
                for conn in connections:
                    self.assertEqual(Path(conn.execute("PRAGMA database_list").fetchone()[2]), path)
            finally:
                fixture.doCleanups()
            self.assertEqual(Database.path, original_path)
            self.assertIs(Database.local, original_local)
            for conn in connections:
                with self.assertRaises(sqlite3.ProgrammingError):
                    conn.execute("SELECT 1")
