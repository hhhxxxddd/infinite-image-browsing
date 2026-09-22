import os
import sqlite3
import tempfile
import unittest
from scripts.iib.db.datamodel import Image
from scripts.iib.db.media_order import move_media, ensure_media_order


class MediaOrderTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.TemporaryDirectory()
        self.addCleanup(self.root.cleanup)
        self.conn = sqlite3.connect(os.path.join(self.root.name, "test.db"))
        self.addCleanup(self.conn.close)
        self.conn.executescript("""
          CREATE TABLE image (id INTEGER PRIMARY KEY, path TEXT, exif TEXT, size INTEGER, date TEXT, exif_edited INTEGER);
          CREATE TABLE tag (id INTEGER PRIMARY KEY, name TEXT, type TEXT);
          CREATE TABLE image_tag (image_id INTEGER, tag_id INTEGER);
        """)
        self.paths = {}
        for i in range(1, 7):
            path = os.path.join(self.root.name, f"{i}.jpg")
            open(path, "w").close()
            self.paths[i] = path
            self.conn.execute("INSERT INTO image VALUES (?, ?, 'photo', 0, '2026-01-01', 0)", (i, path))
        self.conn.commit()

    def ids(self, **kwargs):
        files, cursor = Image.find_by_substring(self.conn, "", manual_order=True, **kwargs)
        return [image.id for image in files], cursor

    def test_default_and_move_before_after(self):
        self.assertEqual(self.ids()[0], [6, 5, 4, 3, 2, 1])
        move_media(self.conn, [self.paths[1]], self.paths[5])
        self.assertEqual(self.ids()[0], [6, 1, 5, 4, 3, 2])
        move_media(self.conn, [self.paths[6]], self.paths[2], True)
        self.assertEqual(self.ids()[0], [1, 5, 4, 3, 2, 6])

    def test_group_order_and_filtered_pagination(self):
        move_media(self.conn, [self.paths[1], self.paths[3]], self.paths[6])
        self.assertEqual(self.ids()[0], [3, 1, 6, 5, 4, 2])
        self.conn.execute("INSERT INTO tag VALUES (1, 'Image', 'Media Type')")
        self.conn.executemany("INSERT INTO image_tag VALUES (?, 1)", [(1,), (3,), (4,)])
        first, cursor = self.ids(limit=2, media_type='image')
        second, _ = self.ids(limit=2, media_type='image', cursor=cursor.next)
        self.assertEqual(first + second, [3, 1, 4])
        self.assertEqual(Image.find_by_substring(self.conn, '', limit=6)[0][0].id, 6)

    def test_persists_and_appends_new_files(self):
        move_media(self.conn, [self.paths[1]], self.paths[6])
        with sqlite3.connect(os.path.join(self.root.name, 'test.db')) as other:
            files, _ = Image.find_by_substring(other, '', manual_order=True)
            self.assertEqual(files[0].id, 1)
        path = os.path.join(self.root.name, 'new.jpg')
        open(path, 'w').close()
        self.conn.execute("INSERT INTO image VALUES (7, ?, '', 0, '2027-01-01', 0)", (path,))
        self.conn.commit()
        self.assertEqual(self.ids()[0][-1], 7)
        move_media(self.conn, [path], self.paths[1])
        self.assertEqual(self.ids()[0][0], 7)

    def test_bad_target_rolls_back_and_self_drop_is_noop(self):
        before = self.ids()[0]
        with self.assertRaises(ValueError):
            move_media(self.conn, [self.paths[1]], 'missing')
        self.assertEqual(self.ids()[0], before)
        move_media(self.conn, [self.paths[1]], self.paths[1])
        self.assertEqual(self.ids()[0], before)

    def test_reset(self):
        move_media(self.conn, [self.paths[1]], self.paths[6])
        self.conn.execute('DELETE FROM media_order')
        self.assertEqual(self.ids()[0], [6, 5, 4, 3, 2, 1])


if __name__ == '__main__':
    unittest.main()
