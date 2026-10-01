import sqlite3
import unittest
from contextlib import closing
from unittest.mock import Mock

from omnigallery.library.media_repository import Media
from omnigallery.search.query import compile_search_query
from omnigallery.search.text_index import create_text_index, has_text_index


class TextIndexTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.addCleanup(self.conn.close)
        Media.create_table(self.conn)
        self.conn.executescript("""
            CREATE TABLE tag(id INTEGER PRIMARY KEY, name TEXT);
            CREATE TABLE media_tag(media_id INTEGER, tag_id INTEGER);
            INSERT INTO tag VALUES(1, '喜欢'), (2, '夜景');
            INSERT INTO media_tag VALUES(2, 1), (3, 2);
        """)
        self.conn.create_function(
            "search_filename", 1, lambda p: p.replace("\\", "/").rsplit("/", 1)[-1]
        )
        self.conn.create_function("search_tag_label", 1, lambda p: "")
        self.conn.executemany(
            "INSERT INTO media(id, path, description) VALUES (?, ?, ?)",
            [
                (1, r"C:\parent\山川风景.JPG", "星空夜景"),
                (2, "/parent/cat_100%.png", 'a "quoted" skyline'),
                (3, "/parent/猫咪.png", "café CAFÉ"),
                (4, "/parent/another.png", ""),
            ],
        )
        self.conn.commit()

    def ids(self, query, indexed=True):
        clause, params = compile_search_query(query, indexed=indexed)
        return [
            row[0]
            for row in self.conn.execute(
                "SELECT id FROM media WHERE " + clause + " ORDER BY id", params
            )
        ]

    def test_indexed_search_keeps_substrings_unicode_escaping_and_boolean_semantics(self):
        cases = {
            "山川风": [1],
            "name:川风景": [1],
            "desc:星空夜": [1],
            "name:cat": [2],
            'name:"100%"': [2],
            'name:"cat_"': [2],
            'desc:"\\"quoted\\""': [2],
            "猫": [3],
            "desc:café": [3],
            "tag:喜欢": [2],
            "喜欢": [2],
            "夜景": [1, 3],
            "(name:cat OR 山川风) NOT tag:喜欢": [1],
            "NOT desc:skyline": [1, 3, 4],
            "name:parent": [],
            "missing-term": [],
        }
        for query, expected in cases.items():
            with self.subTest(query=query):
                self.assertEqual(self.ids(query), expected)
                self.assertEqual(self.ids(query, indexed=False), expected)

    def test_insert_replace_rename_description_delete_and_rollback_update_the_index(self):
        self.conn.execute(
            "UPDATE media SET path = '/sunshine.png', description = '森林美景' WHERE id = 1"
        )
        self.assertEqual(self.ids("sunshine"), [1])
        self.assertEqual(self.ids("森林美"), [1])
        self.assertEqual(self.ids("山川风"), [])
        self.conn.rollback()
        self.assertEqual(self.ids("山川风"), [1])
        self.conn.execute(
            "INSERT OR REPLACE INTO media(path, description) VALUES ('/parent/another.png', 'replacement')"
        )
        self.assertEqual(
            self.conn.execute("SELECT count(*) FROM media_text_index").fetchone()[0], 4
        )
        self.conn.execute("DELETE FROM media WHERE id = 1")
        self.assertEqual(self.ids("山川风"), [])

    def test_existing_records_are_backfilled_once(self):
        with closing(sqlite3.connect(":memory:")) as conn:
            conn.executescript("""CREATE TABLE media(id INTEGER PRIMARY KEY, path TEXT, description TEXT);
                INSERT INTO media VALUES(1, 'C:\\existing\\before.png', 'old description');""")
            create_text_index(conn)
            create_text_index(conn)
            self.assertEqual(
                conn.execute("SELECT filename, description FROM media_text_index").fetchall(),
                [("before.png", "old description")],
            )

    def test_missing_fts_extension_falls_back_but_other_database_errors_surface(self):
        for message, supported_fallback in [
            ("no such module: fts5", True),
            ("disk I/O error", False),
        ]:
            with closing(sqlite3.connect(":memory:")) as connection:
                conn = Mock(wraps=connection)

                def execute(sql, failure_message=message):
                    if sql.startswith("CREATE VIRTUAL TABLE"):
                        raise sqlite3.OperationalError(failure_message)
                    return connection.execute(sql)

                conn.execute.side_effect = execute
                if supported_fallback:
                    create_text_index(conn)
                else:
                    with self.assertRaises(sqlite3.OperationalError):
                        create_text_index(conn)
                self.assertFalse(has_text_index(connection))
                self.assertFalse(connection.in_transaction)
        self.assertTrue(has_text_index(self.conn))

    def test_failed_initialization_rolls_back_ddl_without_committing_callers_changes(self):
        with closing(sqlite3.connect(":memory:")) as conn:
            conn.execute("CREATE TABLE media(id INTEGER PRIMARY KEY, path TEXT, description TEXT)")
            conn.execute("INSERT INTO media VALUES(1, '/before.png', 'pending')")
            conn.set_authorizer(
                lambda action, name, *args: (
                    sqlite3.SQLITE_DENY
                    if action == sqlite3.SQLITE_CREATE_TRIGGER and name == "media_text_update"
                    else sqlite3.SQLITE_OK
                )
            )
            with self.assertRaises(sqlite3.DatabaseError):
                create_text_index(conn)
            conn.set_authorizer(None)
            self.assertFalse(has_text_index(conn))
            self.assertEqual(
                conn.execute("SELECT count(*) FROM sqlite_master WHERE type='trigger'").fetchone()[
                    0
                ],
                0,
            )
            self.assertEqual(conn.execute("SELECT count(*) FROM media").fetchone()[0], 1)
            self.assertTrue(conn.in_transaction)
            create_text_index(conn)
            self.assertEqual(
                conn.execute("SELECT filename FROM media_text_index").fetchall(), [("before.png",)]
            )
            conn.rollback()
            self.assertFalse(has_text_index(conn))

    def test_incomplete_existing_index_is_rebuilt_with_all_triggers(self):
        with closing(sqlite3.connect(":memory:")) as conn:
            conn.executescript("""CREATE TABLE media(id INTEGER PRIMARY KEY, path TEXT, description TEXT);
                INSERT INTO media VALUES(1, '/before.png', 'old');
                CREATE VIRTUAL TABLE media_text_index USING fts5(filename, description, tokenize='trigram');
                INSERT INTO media_text_index(rowid, filename) VALUES(99, 'stale');""")
            create_text_index(conn)
            self.assertEqual(
                conn.execute("SELECT rowid, filename FROM media_text_index").fetchall(),
                [(1, "before.png")],
            )
            conn.execute("UPDATE media SET path='/renamed.png' WHERE id=1")
            self.assertEqual(
                conn.execute("SELECT filename FROM media_text_index").fetchall(), [("renamed.png",)]
            )
