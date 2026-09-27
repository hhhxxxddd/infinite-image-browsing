import json
import sqlite3
import unittest

from omnigallery.library.tag_repository import MediaTag, Tag
from omnigallery.storage.settings_repository import SettingsRepository


class TagRenameTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.addCleanup(self.conn.close)
        self.conn.execute("CREATE TABLE media (id INTEGER PRIMARY KEY)")
        self.conn.execute("INSERT INTO media VALUES (1)")
        Tag.create_table(self.conn)
        MediaTag.create_table(self.conn)
        SettingsRepository.create_table(self.conn)
        self.tag = Tag.get_or_create(self.conn, "风景", "custom")
        MediaTag(1, self.tag.id).save(self.conn)
        self.conn.commit()

    def test_rename_preserves_image_links_and_updates_rules(self):
        SettingsRepository.save_setting(
            self.conn,
            "auto_tag_rules",
            json.dumps(
                [
                    {
                        "tag": "风景",
                        "filters": [
                            {"field": "pos_prompt", "operator": "contains", "value": "sea"}
                        ],
                    }
                ]
            ),
        )

        renamed, old_name = Tag.rename_custom(self.conn, self.tag.id, " 海景 ")

        self.assertEqual(old_name, "风景")
        self.assertEqual((renamed.id, renamed.name), (self.tag.id, "海景"))
        self.assertEqual(
            [tag.id for tag in MediaTag.get_tags_for_image(self.conn, 1)], [self.tag.id]
        )
        self.assertEqual(
            SettingsRepository.get_setting(self.conn, "auto_tag_rules")[0]["tag"], "海景"
        )

    def test_duplicate_name_keeps_both_tags_and_image_link(self):
        other = Tag.get_or_create(self.conn, "海景", "custom")
        self.conn.commit()

        with self.assertRaisesRegex(ValueError, "已存在"):
            Tag.rename_custom(self.conn, self.tag.id, "海景")

        self.assertEqual(Tag.get(self.conn, self.tag.id).name, "风景")
        self.assertEqual(Tag.get(self.conn, other.id).name, "海景")
        self.assertEqual(
            [tag.id for tag in MediaTag.get_tags_for_image(self.conn, 1)], [self.tag.id]
        )

    def test_builtin_and_blank_name_cannot_be_renamed(self):
        like = next(tag for tag in Tag.get_all_custom_tag(self.conn) if tag.name == "like")
        with self.assertRaises(ValueError):
            Tag.rename_custom(self.conn, like.id, "收藏")
        with self.assertRaises(ValueError):
            Tag.rename_custom(self.conn, self.tag.id, "  ")

    def test_groups_preserve_tags_and_image_links(self):
        Tag.create_group(self.conn, "题材")
        self.conn.execute("UPDATE tag SET group_name = ? WHERE id = ?", ("题材", self.tag.id))
        self.assertEqual(Tag.get(self.conn, self.tag.id).group_name, "题材")
        Tag.rename_group(self.conn, "题材", "场景")
        self.assertEqual(Tag.get_groups(self.conn), ["场景"])
        self.assertEqual(Tag.get(self.conn, self.tag.id).group_name, "场景")
        Tag.remove_group(self.conn, "场景")
        self.assertEqual(Tag.get(self.conn, self.tag.id).group_name, "")
        self.assertEqual(
            [tag.id for tag in MediaTag.get_tags_for_image(self.conn, 1)], [self.tag.id]
        )


if __name__ == "__main__":
    unittest.main()
