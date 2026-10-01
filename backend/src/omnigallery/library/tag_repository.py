import json
import os
from contextlib import closing
from datetime import datetime
from sqlite3 import Connection

from omnigallery.library.media_repository import Media
from omnigallery.library.schemas import Cursor
from omnigallery.library.tag_labels import (
    FAVORITE_TAG_NAME,
    LEGACY_FAVORITE_TAG_NAME,
    tags_translate,
)


class Tag:
    def __init__(self, name: str, score: int, type: str, count=0, color="", group_name=""):
        self.name = (
            FAVORITE_TAG_NAME if type == "custom" and name == LEGACY_FAVORITE_TAG_NAME else name
        )
        self.score = score
        self.type = type
        self.count = count
        self.id = None
        self.color = color or (
            "#b8474e" if self.name == FAVORITE_TAG_NAME and type == "custom" else ""
        )
        self.group_name = group_name
        self.display_name = (
            tags_translate.get(self.name) if self.name != FAVORITE_TAG_NAME else None
        )

    @staticmethod
    def validate_tag_name(name: str):
        if not name:
            return None

        # Check if name starts with Chinese characters
        if len(name) > 0 and "\u4e00" <= name[0] <= "\u9fff":
            # Chinese starts: max 12 characters
            if len(name) > 12:
                return "INVALID_TAG_NAME_TOO_LONG"
        else:
            # Other languages: max 8 words and 40 characters
            words = name.split()
            if len(words) > 8 and len(name) > 40:
                return "INVALID_TAG_TOO_MANY_WORDS"

        return None

    def save(self, conn):
        with closing(conn.cursor()) as cur:
            cur.execute(
                "INSERT OR REPLACE INTO tag (id, name, score, type, count, color, group_name) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    self.id,
                    self.name,
                    self.score,
                    self.type,
                    self.count,
                    self.color,
                    self.group_name,
                ),
            )
            self.id = cur.lastrowid

    @classmethod
    def rename_custom(cls, conn: Connection, tag_id: int, new_name: str):
        from omnigallery.storage.settings_repository import SettingsRepository

        name = new_name.strip()
        if name == LEGACY_FAVORITE_TAG_NAME:
            name = FAVORITE_TAG_NAME
        if not name or len(name) > 40 or cls.validate_tag_name(name):
            raise ValueError("标签名称无效或过长")
        tag = cls.get(conn, tag_id)
        if tag is None or tag.type != "custom":
            raise ValueError("找不到自定义标签")
        if tag.name == FAVORITE_TAG_NAME:
            raise ValueError("内置“喜欢”标签不能改名")
        old_name = tag.name
        if name == old_name:
            return tag, old_name

        with conn:
            # The table's unique constraint uses ON CONFLICT REPLACE. Guard the
            # UPDATE inside the statement so a duplicate never deletes another
            # tag and its image associations.
            updated = conn.execute(
                """UPDATE tag SET name = ? WHERE id = ? AND type = 'custom'
                AND NOT EXISTS (SELECT 1 FROM tag WHERE name = ? AND type = 'custom')""",
                (name, tag_id, name),
            )
            if updated.rowcount != 1:
                raise ValueError("标签名称已存在")

            def update_setting(setting_name, value):
                conn.execute(
                    """UPDATE global_setting SET setting_json = ?, modified_time = ?
                    WHERE name = ?""",
                    (
                        json.dumps(value, ensure_ascii=False),
                        datetime.now().isoformat(),
                        setting_name,
                    ),
                )

            rules = SettingsRepository.get_setting(conn, "auto_tag_rules")
            if isinstance(rules, list):
                renamed_rules = [
                    {**rule, "tag": name}
                    if isinstance(rule, dict) and rule.get("tag") == old_name
                    else rule
                    for rule in rules
                ]
                if renamed_rules != rules:
                    update_setting("auto_tag_rules", renamed_rules)

        return cls.get(conn, tag_id), old_name

    @classmethod
    def remove(cls, conn, tag_id):
        with closing(conn.cursor()) as cur:
            cur.execute("DELETE FROM tag WHERE id = ?", (tag_id,))
            conn.commit()

    @classmethod
    def get(cls, conn: Connection, id):
        with closing(conn.cursor()) as cur:
            cur.execute("SELECT * FROM tag WHERE id = ?", (id,))
            row = cur.fetchone()
            if row is None:
                return None
            else:
                return cls.from_row(row)

    @classmethod
    def get_all_custom_tag(cls, conn):
        with closing(conn.cursor()) as cur:
            cur.execute("SELECT * FROM tag where type = 'custom'")
            rows = cur.fetchall()
            tags: list[Tag] = []
            for row in rows:
                tags.append(cls.from_row(row))
            return tags

    @classmethod
    def get_all(cls, conn):
        with closing(conn.cursor()) as cur:
            cur.execute("SELECT COUNT(*) FROM tag")
            total_count = cur.fetchone()[0]

            tags: list[Tag] = []

            if total_count > 4096:
                # Get all non-pos tags
                cur.execute("SELECT * FROM tag WHERE type != 'pos'")
                rows = cur.fetchall()
                for row in rows:
                    tags.append(cls.from_row(row))

                # Get top 4096 pos tags ordered by count (descending)
                cur.execute("SELECT * FROM tag WHERE type = 'pos' ORDER BY count DESC LIMIT 4096")
                pos_rows = cur.fetchall()
                for row in pos_rows:
                    tags.append(cls.from_row(row))
            else:
                # Get all tags normally
                cur.execute("SELECT * FROM tag")
                rows = cur.fetchall()
                for row in rows:
                    tags.append(cls.from_row(row))

            print(f"tag: loaded {len(tags)} tags (total: {total_count})")
            return tags

    @classmethod
    def get_or_create(cls, conn: Connection, name: str, type: str):
        assert name and type
        if type == "custom" and name == LEGACY_FAVORITE_TAG_NAME:
            name = FAVORITE_TAG_NAME

        # Validate tag name
        error_name = cls.validate_tag_name(name)
        if error_name:
            # Return None for invalid tag names
            return None

        with closing(conn.cursor()) as cur:
            cur.execute("SELECT tag.* FROM tag WHERE name = ? and type = ?", (name, type))
            row = cur.fetchone()
            if row is None:
                tag = cls(name=name, score=0, type=type)
                tag.save(conn)
                return tag
            else:
                return cls.from_row(row)

    @classmethod
    def from_row(cls, row: tuple):
        tag = cls(
            name=row[1], score=row[2], type=row[3], count=row[4], color=row[5], group_name=row[6]
        )
        tag.id = row[0]
        return tag

    @classmethod
    def create_table(cls, conn):
        with closing(conn.cursor()) as cur:
            cur.execute(
                """CREATE TABLE IF NOT EXISTS tag (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            score INTEGER,
            type TEXT,
            count INTEGER,
            color TEXT DEFAULT '',
            group_name TEXT NOT NULL DEFAULT '',
            UNIQUE(name, type) ON CONFLICT REPLACE
            );
            """
            )
            cur.execute("CREATE INDEX IF NOT EXISTS tag_idx_name ON tag(name)")
            cur.execute("CREATE TABLE IF NOT EXISTS tag_group (name TEXT PRIMARY KEY)")
        cls.migrate_favorite_tag(conn)
        conn.execute(
            "INSERT OR IGNORE INTO tag(name, score, type, count, color) VALUES (?, 0, 'custom', 0, '#b8474e')",
            (FAVORITE_TAG_NAME,),
        )

    @classmethod
    def migrate_favorite_tag(cls, conn: Connection):
        """Rename in place so existing favorites and saved tag IDs keep working."""
        legacy = conn.execute(
            "SELECT id FROM tag WHERE name = ? AND type = 'custom'", (LEGACY_FAVORITE_TAG_NAME,)
        ).fetchone()
        if legacy is None:
            return
        conn.execute("SAVEPOINT favorite_tag_migration")
        try:
            current = conn.execute(
                "SELECT id FROM tag WHERE name = ? AND type = 'custom'", (FAVORITE_TAG_NAME,)
            ).fetchone()
            tables = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN "
                    "('media_tag', 'workspace_artifact_tag', 'global_setting')"
                )
            }
            if current is not None and current[0] != legacy[0]:
                # Avoid the unique constraint's REPLACE policy deleting links.
                for table, owner in (
                    ("media_tag", "media_id"),
                    ("workspace_artifact_tag", "artifact_id"),
                ):
                    if table not in tables:
                        continue
                    timestamp = ", created_at" if table == "media_tag" else ""
                    conn.execute(
                        f"INSERT OR IGNORE INTO {table} ({owner}, tag_id{timestamp}) "
                        f"SELECT {owner}, ?{timestamp} FROM {table} WHERE tag_id = ?",
                        (legacy[0], current[0]),
                    )
                    conn.execute(f"DELETE FROM {table} WHERE tag_id = ?", (current[0],))
                conn.execute("DELETE FROM tag WHERE id = ?", (current[0],))
                if "media_tag" in tables:
                    conn.execute(
                        "UPDATE tag SET count = (SELECT count(*) FROM media_tag WHERE tag_id = ?) WHERE id = ?",
                        (legacy[0], legacy[0]),
                    )
            conn.execute("UPDATE tag SET name = ? WHERE id = ?", (FAVORITE_TAG_NAME, legacy[0]))
            if "global_setting" in tables:
                setting = conn.execute(
                    "SELECT setting_json FROM global_setting WHERE name = 'auto_tag_rules'"
                ).fetchone()
                if setting:
                    rules = json.loads(setting[0])
                    if isinstance(rules, list):
                        renamed = [
                            {**rule, "tag": FAVORITE_TAG_NAME}
                            if isinstance(rule, dict)
                            and rule.get("tag") == LEGACY_FAVORITE_TAG_NAME
                            else rule
                            for rule in rules
                        ]
                        if renamed != rules:
                            conn.execute(
                                "UPDATE global_setting SET setting_json = ?, modified_time = ? "
                                "WHERE name = 'auto_tag_rules'",
                                (
                                    json.dumps(renamed, ensure_ascii=False),
                                    datetime.now().isoformat(),
                                ),
                            )
        except Exception:
            conn.execute("ROLLBACK TO favorite_tag_migration")
            raise
        finally:
            conn.execute("RELEASE favorite_tag_migration")

    @classmethod
    def get_groups(cls, conn):
        return [
            row[0]
            for row in conn.execute("SELECT name FROM tag_group ORDER BY name COLLATE NOCASE")
        ]

    @classmethod
    def create_group(cls, conn, name: str):
        name = name.strip()
        if not name or len(name) > 40 or name == "未分组":
            raise ValueError("分组名称须为 1–40 个字符，且不能为“未分组”")
        with conn:
            conn.execute("INSERT INTO tag_group(name) VALUES (?)", (name,))

    @classmethod
    def rename_group(cls, conn, old_name: str, new_name: str):
        new_name = new_name.strip()
        if not new_name or len(new_name) > 40 or new_name == "未分组":
            raise ValueError("分组名称须为 1–40 个字符，且不能为“未分组”")
        with conn:
            if (
                conn.execute(
                    "UPDATE tag_group SET name = ? WHERE name = ? AND NOT EXISTS (SELECT 1 FROM tag_group WHERE name = ?)",
                    (new_name, old_name, new_name),
                ).rowcount
                != 1
            ):
                raise ValueError("分组不存在或名称已存在")
            conn.execute(
                "UPDATE tag SET group_name = ? WHERE type = 'custom' AND group_name = ?",
                (new_name, old_name),
            )

    @classmethod
    def remove_group(cls, conn, name: str):
        with conn:
            conn.execute(
                "UPDATE tag SET group_name = '' WHERE type = 'custom' AND group_name = ?", (name,)
            )
            conn.execute("DELETE FROM tag_group WHERE name = ?", (name,))


class MediaTag:
    def __init__(self, media_id: int, tag_id: int):
        assert tag_id and media_id
        self.media_id = media_id
        self.tag_id = tag_id

    def save(self, conn):
        with closing(conn.cursor()) as cur:
            cur.execute(
                "INSERT INTO media_tag (media_id, tag_id, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
                (self.media_id, self.tag_id),
            )

    def save_or_ignore(self, conn):
        with closing(conn.cursor()) as cur:
            cur.execute(
                "INSERT OR IGNORE INTO media_tag (media_id, tag_id, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
                (self.media_id, self.tag_id),
            )

    @classmethod
    def get_tags_for_image(
        cls,
        conn: Connection,
        media_id: int,
        tag_id: int | None = None,
        type: str | None = None,
    ):
        with closing(conn.cursor()) as cur:
            query = "SELECT tag.* FROM tag INNER JOIN media_tag ON tag.id = media_tag.tag_id WHERE media_tag.media_id = ?"
            params = [media_id]
            if tag_id:
                query += " AND media_tag.tag_id = ?"
                params.append(tag_id)
            if type:
                query += " AND tag.type = ?"
                params.append(type)
            cur.execute(query, tuple(params))
            rows = cur.fetchall()
            return [Tag.from_row(x) for x in rows]

    @classmethod
    def set_custom_tags(cls, conn: Connection, media_id: int, tag_ids: list[int]):
        """Replace custom selections atomically; keep generated/index tags intact."""
        ids = set(tag_ids)
        valid = {tag.id for tag in Tag.get_all_custom_tag(conn)}
        if not ids.issubset(valid):
            raise ValueError("自定义标签不存在")
        with conn:
            placeholders = ",".join("?" for _ in ids)
            conn.execute(
                "DELETE FROM media_tag WHERE media_id = ? "
                "AND tag_id IN (SELECT id FROM tag WHERE type = 'custom')"
                + (f" AND tag_id NOT IN ({placeholders})" if ids else ""),
                (media_id, *ids),
            )
            conn.executemany(
                "INSERT OR IGNORE INTO media_tag (media_id, tag_id, created_at) "
                "VALUES (?, ?, CURRENT_TIMESTAMP)",
                [(media_id, tag_id) for tag_id in ids],
            )

    @classmethod
    def get_images_for_tag(cls, conn: Connection, tag_id):
        from omnigallery.library.media_repository import Media

        with closing(conn.cursor()) as cur:
            cur.execute(
                "SELECT media.* FROM media INNER JOIN media_tag ON media.id = media_tag.media_id WHERE media_tag.tag_id = ?",
                (tag_id,),
            )
            rows = cur.fetchall()
            images = []
            for row in rows:
                images.append(Media.from_row(row))
            return images

    @classmethod
    def create_table(cls, conn):
        with closing(conn.cursor()) as cur:
            cur.execute(
                """CREATE TABLE IF NOT EXISTS media_tag (
                            media_id INTEGER,
                            tag_id INTEGER,
                            created_at TIMESTAMP,
                            FOREIGN KEY (media_id) REFERENCES media(id),
                            FOREIGN KEY (tag_id) REFERENCES tag(id),
                            PRIMARY KEY (media_id, tag_id)
                        )"""
            )

    @classmethod
    def get_images_by_tags(
        cls,
        conn: Connection,
        tag_dict: dict[str, list[int]],
        limit: int = 500,
        cursor="",
        folder_paths: list[str] = None,
        random_sort: bool = False,
        size_tag_ids: list[int] | None = None,
    ) -> tuple[list[Media], Cursor]:
        from omnigallery.library.media_repository import Media
        from omnigallery.library.pagination import make_page_cursor, page_cursor_clause

        if size_tag_ids == []:
            return [], Cursor(has_next=False)
        query = """
            SELECT media.id, media.path, media.size,media.date
            FROM media
            INNER JOIN media_tag ON media.id = media_tag.media_id
        """

        where_clauses = []
        params = []

        for operator, tag_ids in tag_dict.items():
            if operator == "and" and tag_dict["and"]:
                where_clauses.append("tag_id IN ({})".format(",".join("?" * len(tag_ids))))
                params.extend(tag_ids)
            elif operator == "not" and tag_dict["not"]:
                where_clauses.append(
                    """(media_id NOT IN (
  SELECT media_id
  FROM media_tag
  WHERE tag_id IN ({})
))""".format(",".join("?" * len(tag_ids)))
                )
                params.extend(tag_ids)
            elif operator == "or" and tag_dict["or"]:
                where_clauses.append(
                    """(media_id IN (
  SELECT media_id
  FROM media_tag
  WHERE tag_id IN ({})
  GROUP BY media_id
  HAVING COUNT(DISTINCT tag_id) >= 1
)
)""".format(",".join("?" * len(tag_ids)))
                )
                params.extend(tag_ids)

        if folder_paths:
            folder_clauses = []
            for folder_path in folder_paths:
                folder_clauses.append("(media.path LIKE ?)")
                params.append(os.path.join(folder_path, "%"))
                print(folder_path)
            where_clauses.append("(" + " OR ".join(folder_clauses) + ")")

        # Keep size matching independent of the user's AND/OR/NOT tag groups.
        if size_tag_ids is not None:
            where_clauses.append(
                "media.id IN (SELECT media_id FROM media_tag WHERE tag_id IN ({}))".format(
                    ",".join("?" * len(size_tag_ids))
                )
            )
            params.extend(size_tag_ids)

        if not random_sort:
            cursor_clause = page_cursor_clause(cursor, params)
            if cursor_clause:
                where_clauses.append(cursor_clause)
        if where_clauses:
            query += " WHERE " + " AND ".join(where_clauses)
        query += " GROUP BY media.id"
        if "and" in tag_dict and tag_dict["and"]:
            query += " HAVING COUNT(DISTINCT tag_id) = ?"
            params.append(len(tag_dict["and"]))

        if random_sort:
            query += " ORDER BY RANDOM() LIMIT ?"
            # For random sort, use offset-based pagination
            if cursor:
                try:
                    offset = int(cursor)
                    query = query.replace("LIMIT ?", f"LIMIT ? OFFSET {offset}")
                except (ValueError, TypeError):
                    pass  # Invalid cursor, start from beginning
        else:
            query += " ORDER BY media.date DESC, media.id DESC LIMIT ?"
        params.append(limit)
        api_cur = Cursor()
        with closing(conn.cursor()) as cur:
            cur.execute(query, params)
            rows = cur.fetchall()
            images = []
            deleted_ids = []
            for row in rows:
                img = Media(id=row[0], path=row[1], size=row[2], date=row[3])
                if os.path.exists(img.path):
                    images.append(img)
                else:
                    deleted_ids.append(img.id)
            Media.safe_batch_remove(conn, deleted_ids)
            api_cur.has_next = len(rows) >= limit
            if random_sort:
                if images:
                    # For random sort, use offset-based cursor
                    current_offset = int(cursor) if cursor else 0
                    api_cur.next = str(current_offset + len(images))
            elif rows:
                # Advance past the last row read, not the last row kept: a
                # trailing run of deleted files would otherwise rewind.
                api_cur.next = make_page_cursor(rows[-1][3], rows[-1][0])
            return images, api_cur

    @classmethod
    def batch_get_tags_by_path(
        cls, conn: Connection, paths: list[str], type="custom"
    ) -> dict[str, list[Tag]]:
        if not paths:
            return {}
        tag_dict = {}
        with closing(conn.cursor()) as cur:
            placeholders = ",".join("?" * len(paths))
            query = f"""
                SELECT media.path, tag.* FROM media_tag
                INNER JOIN media ON media_tag.media_id = media.id
                INNER JOIN tag ON media_tag.tag_id = tag.id
                WHERE tag.type = '{type}' AND media.path IN ({placeholders})
            """
            cur.execute(query, paths)
            rows = cur.fetchall()
            for row in rows:
                path = row[0]
                tag = Tag.from_row(row[1:])
                if path in tag_dict:
                    tag_dict[path].append(tag)
                else:
                    tag_dict[path] = [tag]
        return tag_dict

    @classmethod
    def remove(
        cls,
        conn: Connection,
        media_id: int | None = None,
        tag_id: int | None = None,
    ) -> None:
        assert media_id or tag_id
        with closing(conn.cursor()) as cur:
            if tag_id and media_id:
                cur.execute(
                    "DELETE FROM media_tag WHERE media_id = ? and tag_id = ?",
                    (media_id, tag_id),
                )
            elif tag_id:
                cur.execute("DELETE FROM media_tag WHERE tag_id = ?", (tag_id,))
            else:
                cur.execute("DELETE FROM media_tag WHERE media_id = ?", (media_id,))
            conn.commit()
