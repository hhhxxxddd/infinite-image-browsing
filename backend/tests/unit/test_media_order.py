import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from unittest.mock import patch

from omnigallery.library.media_order import move_media, swap_media
from omnigallery.library.media_repository import Media


class MediaOrderTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.TemporaryDirectory()
        self.addCleanup(self.root.cleanup)
        self.conn = sqlite3.connect(os.path.join(self.root.name, "test.db"))
        self.addCleanup(self.conn.close)
        self.conn.executescript("""
          CREATE TABLE media (id INTEGER PRIMARY KEY, path TEXT, exif TEXT, size INTEGER, date TEXT, exif_edited INTEGER, description TEXT NOT NULL DEFAULT '');
          CREATE TABLE tag (id INTEGER PRIMARY KEY, name TEXT, type TEXT);
          CREATE TABLE media_tag (media_id INTEGER, tag_id INTEGER);
          CREATE TABLE media_embedding (media_id INTEGER);
          CREATE TABLE media_qwen_visual_embedding (media_id INTEGER);
          CREATE TABLE media_ai_note (media_id INTEGER);
          CREATE TABLE media_embedding_fail (media_id INTEGER);
        """)
        self.paths = {}
        for i in range(1, 7):
            path = os.path.join(self.root.name, f"{i}.jpg")
            open(path, "w").close()
            self.paths[i] = path
            self.conn.execute(
                "INSERT INTO media VALUES (?, ?, 'photo', 0, '2026-01-01', 0, '')", (i, path)
            )
        self.conn.commit()

    def ids(self, **kwargs):
        files, cursor = Media.find_by_substring(self.conn, "", manual_order=True, **kwargs)
        return [media.id for media in files], cursor

    def test_default_and_move_before_after(self):
        self.assertEqual(self.ids()[0], [6, 5, 4, 3, 2, 1])
        move_media(self.conn, [self.paths[1]], self.paths[5])
        self.assertEqual(self.ids()[0], [6, 1, 5, 4, 3, 2])
        move_media(self.conn, [self.paths[6]], self.paths[2], True)
        self.assertEqual(self.ids()[0], [1, 5, 4, 3, 2, 6])

    def test_default_order_pagination_without_manual_positions(self):
        first, cursor = self.ids(limit=2)
        self.assertFalse(cursor.next.startswith("manual:"))
        second, cursor = self.ids(limit=2, cursor=cursor.next)
        third, _ = self.ids(limit=2, cursor=cursor.next)
        self.assertEqual(first + second + third, [6, 5, 4, 3, 2, 1])

    def test_group_order_and_filtered_pagination(self):
        move_media(self.conn, [self.paths[1], self.paths[3]], self.paths[6])
        self.assertEqual(self.ids()[0], [3, 1, 6, 5, 4, 2])
        self.conn.execute("INSERT INTO tag VALUES (1, 'Image', 'Media Type')")
        self.conn.executemany("INSERT INTO media_tag VALUES (?, 1)", [(1,), (3,), (4,)])
        first, cursor = self.ids(limit=2, media_type="image")
        self.assertTrue(cursor.next.startswith("manual:"))
        second, _ = self.ids(limit=2, media_type="image", cursor=cursor.next)
        self.assertEqual(first + second, [3, 1, 4])
        self.assertEqual(Media.find_by_substring(self.conn, "", limit=6)[0][0].id, 6)

    def test_persists_and_appends_new_files(self):
        move_media(self.conn, [self.paths[1]], self.paths[6])
        with closing(sqlite3.connect(os.path.join(self.root.name, "test.db"))) as other:
            files, _ = Media.find_by_substring(other, "", manual_order=True)
            self.assertEqual(files[0].id, 1)
        path = os.path.join(self.root.name, "new.jpg")
        open(path, "w").close()
        self.conn.execute("INSERT INTO media VALUES (7, ?, '', 0, '2027-01-01', 0, '')", (path,))
        self.conn.commit()
        self.assertEqual(self.ids()[0][-1], 7)
        move_media(self.conn, [path], self.paths[1])
        self.assertEqual(self.ids()[0][0], 7)

    def test_bad_target_rolls_back_and_self_drop_is_noop(self):
        before = self.ids()[0]
        with self.assertRaises(ValueError):
            move_media(self.conn, [self.paths[1]], "missing")
        self.assertEqual(self.ids()[0], before)
        move_media(self.conn, [self.paths[1]], self.paths[1])
        self.assertEqual(self.ids()[0], before)

    def test_swap_exchanges_only_two_positions_and_persists(self):
        swap_media(self.conn, self.paths[6], self.paths[2])
        self.assertEqual(self.ids()[0], [2, 5, 4, 3, 6, 1])
        with closing(sqlite3.connect(os.path.join(self.root.name, "test.db"))) as other:
            files, _ = Media.find_by_substring(other, "", manual_order=True)
            self.assertEqual([media.id for media in files], [2, 5, 4, 3, 6, 1])

    def test_swap_missing_target_rolls_back_and_self_drop_is_noop(self):
        before = self.ids()[0]
        with self.assertRaises(ValueError):
            swap_media(self.conn, self.paths[1], "missing")
        self.assertEqual(self.ids()[0], before)
        swap_media(self.conn, self.paths[1], self.paths[1])
        self.assertEqual(self.ids()[0], before)

    def test_reset(self):
        move_media(self.conn, [self.paths[1]], self.paths[6])
        self.conn.execute("DELETE FROM media_order")
        self.assertEqual(self.ids()[0], [6, 5, 4, 3, 2, 1])

    def test_cursor_crosses_into_new_files_and_keeps_equal_date_tiebreakers(self):
        move_media(self.conn, [self.paths[1]], self.paths[6])
        for media_id in (7, 8, 9):
            path = os.path.join(self.root.name, f"{media_id}.jpg")
            open(path, "w").close()
            self.conn.execute(
                "INSERT INTO media VALUES (?, ?, '', 0, '2027-01-01', 0, '')", (media_id, path)
            )
        self.conn.commit()
        first, cursor = self.ids(limit=4)
        second, cursor = self.ids(limit=4, cursor=cursor.next)
        third, _ = self.ids(limit=4, cursor=cursor.next)
        self.assertEqual(first + second + third, [1, 6, 5, 4, 3, 2, 9, 8, 7])

    def test_deleted_file_does_not_skip_next_position(self):
        swap_media(self.conn, self.paths[6], self.paths[2])
        os.remove(self.paths[5])
        first, cursor = self.ids(limit=2)
        second, _ = self.ids(limit=2, cursor=cursor.next)
        self.assertEqual(first, [2])
        self.assertEqual(second, [4, 3])

    def test_legacy_offset_cursor_transitions_to_position_cursor(self):
        swap_media(self.conn, self.paths[6], self.paths[2])
        page, cursor = self.ids(limit=2, cursor="manual:2")
        self.assertEqual(page, [4, 3])
        following, _ = self.ids(limit=2, cursor=cursor.next)
        self.assertEqual(following, [6, 1])

    def test_invalid_position_cursor_is_rejected(self):
        swap_media(self.conn, self.paths[6], self.paths[2])
        for cursor in ("manual:p:0:bad", "manual:p:-1:2", "manual:d:bad"):
            with self.subTest(cursor=cursor), self.assertRaises(ValueError):
                self.ids(cursor=cursor)

    def test_swapping_the_page_boundary_does_not_repeat_a_loaded_card(self):
        swap_media(self.conn, self.paths[6], self.paths[2])
        first, cursor = self.ids(limit=3)
        swap_media(self.conn, self.paths[4], self.paths[5])
        second, _ = self.ids(limit=3, cursor=cursor.next)
        self.assertEqual(set(first + second), set(range(1, 7)))
        self.assertEqual(len(first + second), 6)

    def test_subsequent_swaps_do_not_scan_to_fill_existing_positions(self):
        swap_media(self.conn, self.paths[6], self.paths[2])
        with patch(
            "omnigallery.library.media_order._ensure_media_positions",
            side_effect=AssertionError("unnecessary scan"),
        ):
            swap_media(self.conn, self.paths[5], self.paths[1])
        self.assertEqual(self.ids()[0], [2, 1, 4, 3, 6, 5])


if __name__ == "__main__":
    unittest.main()
