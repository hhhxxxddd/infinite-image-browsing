from sqlite3 import Connection


class MediaAiNote:
    """User-approved inferred prompt; original embedded generation info stays separate."""

    @staticmethod
    def create_table(conn: Connection):
        conn.execute("""CREATE TABLE IF NOT EXISTS media_ai_note (
            media_id INTEGER PRIMARY KEY,
            inferred_prompt TEXT NOT NULL DEFAULT '',
            FOREIGN KEY (media_id) REFERENCES media(id)
        )""")


class AiSecret:
    """Provider credentials kept out of global settings sent to the frontend."""

    @staticmethod
    def create_table(conn: Connection):
        conn.execute("""CREATE TABLE IF NOT EXISTS ai_secret (
            name TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )""")
