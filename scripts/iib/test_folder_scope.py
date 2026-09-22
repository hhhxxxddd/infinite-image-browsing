import os
import sqlite3
import unittest

from scripts.iib.db.search_filters import MediaSearchFilters


class FolderScopeTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        self.addCleanup(self.conn.close)
        self.conn.executescript('''
            CREATE TABLE image (id INTEGER PRIMARY KEY, path TEXT);
            CREATE TABLE image_tag (image_id INTEGER, tag_id INTEGER);
        ''')
        self.root = os.path.abspath('photos_100%')
        self.conn.executemany('INSERT INTO image VALUES (?, ?)', [
            (1, os.path.join(self.root, 'first.jpg')),
            (2, os.path.join(self.root, 'child', 'second.jpg')),
            (3, os.path.join(self.root + '-other', 'third.jpg')),
            (4, os.path.join(os.path.abspath('photosX100more'), 'fourth.jpg')),
        ])
        self.conn.execute('INSERT INTO image_tag VALUES (2, 9)')

    def ids(self, **kwargs):
        clauses, params = MediaSearchFilters(**kwargs).sql_conditions(self.conn)
        query = 'SELECT id FROM image' + (' WHERE ' + ' AND '.join(clauses) if clauses else '') + ' ORDER BY id'
        return [row[0] for row in self.conn.execute(query, params)]

    def test_scope_uses_literal_directory_boundaries(self):
        self.assertEqual(self.ids(folder_path=self.root), [1, 2])
        self.assertEqual(self.ids(folder_path=self.root + os.sep), [1, 2])

    def test_current_directory_only_excludes_descendants(self):
        self.assertEqual(self.ids(folder_path=self.root, include_subfolders=False), [1])

    def test_nested_scope_and_tags_are_combined(self):
        self.assertEqual(self.ids(folder_path=os.path.join(self.root, 'child')), [2])
        self.assertEqual(self.ids(folder_path=self.root, and_tags=[9]), [2])
        self.assertEqual(self.ids(folder_path=self.root, not_tags=[9]), [1])

    def test_no_scope_preserves_library_and_unknown_scope_returns_empty(self):
        self.assertEqual(self.ids(), [1, 2, 3, 4])
        self.assertEqual(self.ids(folder_path=os.path.join(self.root, 'missing')), [])


if __name__ == '__main__':
    unittest.main()
