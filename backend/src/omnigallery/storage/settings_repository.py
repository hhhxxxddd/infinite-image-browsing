import json
from contextlib import closing
from datetime import datetime


class SettingsRepository:
    @classmethod
    def create_table(cls, conn):
        with closing(conn.cursor()) as cur:
            cur.execute(
                """CREATE TABLE IF NOT EXISTS global_setting (
                            setting_json TEXT,
                            name TEXT PRIMARY KEY,
                            created_time TEXT,
                            modified_time TEXT
                        )"""
            )

    @classmethod
    def get_setting(cls, conn, name):
        with closing(conn.cursor()) as cur:
            cur.execute("SELECT setting_json FROM global_setting WHERE name = ?", (name,))
            result = cur.fetchone()
            if result:
                return json.loads(result[0])
            else:
                return None

    @classmethod
    def save_setting(cls, conn, name: str, setting: str):
        json.loads(setting)  # check if it is valid json
        with closing(conn.cursor()) as cur:
            cur.execute(
                """INSERT INTO global_setting (setting_json, name, created_time, modified_time)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(name) DO UPDATE SET setting_json = excluded.setting_json, modified_time = excluded.modified_time
                """,
                (setting, name, datetime.now().isoformat(), datetime.now().isoformat()),
            )
            conn.commit()

    @classmethod
    def remove_setting(cls, conn, name: str):
        with closing(conn.cursor()) as cur:
            cur.execute("DELETE FROM global_setting WHERE name = ?", (name,))
            conn.commit()

    @classmethod
    def get_all_settings(cls, conn):
        with closing(conn.cursor()) as cur:
            cur.execute("SELECT * FROM global_setting")
            rows = cur.fetchall()
            settings = {}
            for row in rows:
                settings[row[1]] = json.loads(row[0])
            return settings
