"""Regression checks for size filters combined with tag search and pagination."""

from pathlib import Path
import re
import sqlite3
import tempfile
import unittest

from pydantic import ValidationError

from scripts.iib.db.datamodel import Image, ImageTag
from scripts.iib.db.search_filters import MediaSearchFilters
from scripts.iib.db.size_filter import ImageSizeFilter
from scripts.iib.db.search_query import SearchQueryError


class SizeFilterTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.conn = sqlite3.connect(":memory:")
        self.addCleanup(self.conn.close)
        self.conn.executescript("""
            CREATE TABLE image (id INTEGER PRIMARY KEY, path TEXT, exif TEXT, size INTEGER, date TEXT, exif_edited INTEGER, description TEXT NOT NULL DEFAULT '');
            CREATE TABLE tag (id INTEGER PRIMARY KEY, name TEXT, type TEXT);
            CREATE TABLE image_tag (image_id INTEGER, tag_id INTEGER);
        """)
        for image_id, size in enumerate([
            "1920 × 1080", "3840 × 2160", "1080 × 1920", "2688 × 1152",
            "Unknown Size", "1920 × 1080", "0 × 1080",
        ], start=1):
            path = Path(self.folder.name) / ("portraits" if image_id == 3 else "landscapes") / f"{image_id}.jpg"
            path.parent.mkdir(exist_ok=True)
            path.touch()
            self.conn.execute("INSERT INTO image VALUES (?, ?, 'wallpaper', 0, '2026-01-01', 0, '')", (image_id, str(path)))
            self.conn.execute("INSERT INTO tag VALUES (?, ?, 'size')", (image_id, size))
            self.conn.execute("INSERT INTO image_tag VALUES (?, ?)", (image_id, image_id))
        self.conn.executemany("INSERT INTO tag VALUES (?, ?, 'custom')", [
            (100, "favorite"), (101, "wallpaper"), (102, "1920 × 1080")
        ])
        self.conn.executemany("INSERT INTO image_tag VALUES (?, ?)", [
            (1, 100), (1, 101), (2, 100), (3, 101), (5, 102), (6, 101)
        ])

    def search(self, dimensions=None, tags=None, **kwargs):
        return ImageTag.get_images_by_tags(
            self.conn,
            tags or {"and": [], "or": [], "not": []},
            size_tag_ids=ImageSizeFilter(**(dimensions or {})).matching_tag_ids(self.conn),
            **kwargs,
        )

    def ids(self, dimensions=None, **kwargs):
        images, _ = self.search(dimensions, **kwargs)
        return [image.id for image in images]

    def test_exact_size_excludes_unknown_and_custom_size_labels(self):
        self.assertEqual(self.ids({"width": 1920, "height": 1080}), [6, 1])
        self.assertEqual(self.ids({"width": 1080, "height": 1920}), [3])

    def test_ratios_match_multiple_resolutions_and_preserve_orientation(self):
        self.assertEqual(self.ids({"ratio_width": 16, "ratio_height": 9}), [6, 2, 1])
        self.assertEqual(self.ids({"ratio_width": 32, "ratio_height": 18}), [6, 2, 1])
        self.assertEqual(self.ids({"ratio_width": 9, "ratio_height": 16}), [3])
        self.assertEqual(self.ids({"ratio_width": 21, "ratio_height": 9}), [4])

    def test_size_and_ratio_must_both_match(self):
        size = {"width": 1920, "height": 1080}
        self.assertEqual(self.ids(size | {"ratio_width": 16, "ratio_height": 9}), [6, 1])
        self.assertEqual(self.ids(size | {"ratio_width": 1, "ratio_height": 1}), [])

    def test_size_is_independent_of_boolean_tag_groups(self):
        ratio = {"ratio_width": 16, "ratio_height": 9}
        self.assertEqual(self.ids(ratio, tags={"and": [100, 101], "or": [], "not": []}), [1])
        self.assertEqual(self.ids(ratio, tags={"and": [], "or": [101], "not": [100]}), [6])
        self.assertEqual(self.ids(ratio, tags={"and": [100], "or": [101], "not": []}), [1])

    def test_folder_scope_and_pagination(self):
        ratio = {"ratio_width": 16, "ratio_height": 9}
        self.assertEqual(self.ids(ratio, folder_paths=[str(Path(self.folder.name) / "portraits")]), [])
        ids = []
        cursor = ""
        for _ in range(5):
            images, page = self.search(ratio, limit=1, cursor=cursor)
            ids.extend(image.id for image in images)
            if not page.has_next:
                break
            cursor = page.next
        self.assertEqual(ids, [6, 2, 1])

    def test_missing_size_never_falls_back_to_all_images(self):
        images, cursor = self.search({"width": 17, "height": 23})
        self.assertEqual(images, [])
        self.assertFalse(cursor.has_next)
        self.assertEqual(self.ids(), [7, 6, 5, 4, 3, 2, 1])

    def test_random_sort_still_applies_size_filter(self):
        self.assertEqual(set(self.ids({"width": 1920, "height": 1080}, random_sort=True)), {1, 6})

    def test_invalid_or_incomplete_dimensions_are_rejected(self):
        for values in [
            {"width": 1024}, {"ratio_height": 9},
            {"width": 0, "height": 1}, {"width": -1, "height": 1},
            {"width": 1.5, "height": 1}, {"width": True, "height": 1},
            {"ratio_width": 16, "ratio_height": 0},
            {"width": 1_000_001, "height": 1},
        ]:
            with self.subTest(values=values), self.assertRaises(ValidationError):
                ImageSizeFilter(**values)

    def text_search(self, filters=None, **kwargs):
        clauses, params = MediaSearchFilters(**(filters or {})).sql_conditions(self.conn)
        return Image.find_by_substring(self.conn, filter_clauses=clauses, filter_params=params, **kwargs)

    def test_text_search_combines_keyword_tags_and_dimensions(self):
        filters = {"dimensions": {"ratio_width": 16, "ratio_height": 9}, "and_tags": [101], "not_tags": [100]}
        images, _ = self.text_search(filters, substring="wallpaper")
        self.assertEqual([image.id for image in images], [6])
        images, _ = self.text_search(filters, substring="wallpaper", filename_only=True)
        self.assertEqual(images, [])

    def test_folder_scope_uses_literal_boundaries_and_can_exclude_descendants(self):
        root = Path(self.folder.name) / 'landscapes'
        nested = root / 'nested'
        nested.mkdir()
        (nested / '8.jpg').touch()
        self.conn.execute("INSERT INTO image VALUES (8, ?, '', 0, '2026-01-01', 0, '')", (str(nested / '8.jpg'),))
        self.assertEqual([image.id for image in self.text_search({'folder_path': str(root)}, substring='')[0]], [8, 7, 6, 5, 4, 2, 1])
        self.assertEqual([image.id for image in self.text_search({'folder_path': str(root), 'include_subfolders': False}, substring='')[0]], [7, 6, 5, 4, 2, 1])
        self.assertEqual(self.text_search({'folder_path': str(root) + '2'}, substring='')[0], [])

    def test_text_search_matches_filename_tags_and_description_but_not_parent_or_geninfo(self):
        self.conn.execute("UPDATE image SET description = '蓝色海岸' WHERE id = 2")
        self.conn.execute("UPDATE image SET path = ? WHERE id = 4", (str(Path(self.folder.name) / 'wallpaper' / '4.jpg'),))
        (Path(self.folder.name) / 'wallpaper').mkdir()
        (Path(self.folder.name) / 'wallpaper' / '4.jpg').touch()
        self.assertEqual([image.id for image in self.text_search(substring='蓝色海岸')[0]], [2])
        self.assertEqual([image.id for image in self.text_search(substring='favorite')[0]], [2, 1])
        self.assertEqual([image.id for image in self.text_search(substring='wallpaper')[0]], [6, 3, 1])
        self.assertEqual(self.text_search(substring='wallpaper', filename_only=True)[0], [])
        self.assertEqual([image.id for image in self.text_search(substring='4.jpg')[0]], [4])
        self.conn.create_function('regexp', 2, lambda pattern, value: bool(re.search(pattern, value or '', re.IGNORECASE)))
        self.assertEqual([image.id for image in self.text_search(substring='', regexp='蓝色.*岸')[0]], [2])
        self.assertEqual(self.text_search(substring='', regexp='wallpaper', filename_only=True)[0], [])

    def test_text_search_tag_only_and_empty_filters(self):
        images, _ = self.text_search({"and_tags": [100, 101]}, substring="")
        self.assertEqual([image.id for image in images], [1])
        images, _ = self.text_search({"or_tags": [100, 101], "not_tags": [101]}, substring="")
        self.assertEqual([image.id for image in images], [2])
        images, _ = self.text_search(substring="")
        self.assertEqual(len(images), 7)

    def test_search_directives_boolean_grouping_and_validation(self):
        self.conn.execute("UPDATE image SET description = '蓝色海岸 日落' WHERE id = 2")
        def found(query):
            return [image.id for image in self.text_search(substring=query)[0]]
        self.assertEqual(found('tag:favorite'), [2, 1])
        self.assertEqual(found('tag:favorite -tag:wallpaper'), [2])
        self.assertEqual(found('(tag:favorite OR tag:wallpaper) -tag:favorite'), [6, 3])
        self.assertEqual(found('desc:"蓝色海岸 日落"'), [2])
        self.assertEqual(found('name:2.jpg has:desc'), [2])
        self.assertEqual(found('-has:desc tag:wallpaper'), [6, 3, 1])
        self.assertEqual(found('tag:"1920 × 1080"'), [6, 5, 1])
        self.assertEqual(found('favorite 日落'), [2])
        self.conn.execute("INSERT INTO tag VALUES (103, 'like', 'custom')")
        self.conn.execute("INSERT INTO image_tag VALUES (1, 103)")
        self.assertEqual(found('tag:喜欢'), [1])
        with self.assertRaises(SearchQueryError):
            found('tag:')
        with self.assertRaises(SearchQueryError):
            found('(tag:favorite OR')
        with self.assertRaises(SearchQueryError):
            found('site:example.com')

    def test_filter_categories_match_any_within_and_every_across(self):
        self.conn.executemany("INSERT INTO tag VALUES (?, ?, 'Model')", [
            (200, "model-a"), (201, "model-b")
        ])
        self.conn.executemany("INSERT INTO image_tag VALUES (?, ?)", [
            (1, 200), (3, 201), (4, 200)
        ])
        filters = {"tag_groups": {"custom": [100, 101], "Model": [200, 201]}}
        images, _ = self.text_search(filters, substring="")
        self.assertEqual([image.id for image in images], [3, 1])
        images, _ = self.text_search(filters | {"not_tags": [100]}, substring="")
        self.assertEqual([image.id for image in images], [3])

    def test_text_filter_pagination_and_unknown_size(self):
        filters = {"dimensions": {"ratio_width": 16, "ratio_height": 9}}
        ids, cursor = [], ""
        for _ in range(5):
            images, page = self.text_search(filters, substring="", limit=1, cursor=cursor)
            ids.extend(image.id for image in images)
            if not page.has_next:
                break
            cursor = page.next
        self.assertEqual(ids, [6, 2, 1])
        images, _ = self.text_search({"dimensions": {"width": 17, "height": 23}}, substring="")
        self.assertEqual(images, [])

    def test_visual_search_candidates_use_same_filters(self):
        filters = MediaSearchFilters(and_tags=[100], dimensions={"ratio_width": 16, "ratio_height": 9})
        clauses, params = filters.sql_conditions(self.conn)
        rows = self.conn.execute("SELECT image.id FROM image WHERE " + " AND ".join(clauses), params).fetchall()
        self.assertEqual({row[0] for row in rows}, {1, 2})


if __name__ == "__main__":
    unittest.main()
