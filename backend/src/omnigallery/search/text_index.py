"""Maintain a substring index without changing the media table's column order."""

from sqlite3 import OperationalError


def _filename_sql(path):
    normalized = f"replace(coalesce({path}, ''), char(92), '/')"
    # rtrim removes filename characters up to the final slash, using SQLite
    # builtins so triggers also work on connections without Python functions.
    return f"substr({normalized}, length(rtrim({normalized}, replace({normalized}, '/', ''))) + 1)"


def has_text_index(conn):
    return (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE name = 'media_text_index' AND type = 'table'"
        ).fetchone()
        is not None
    )


def create_text_index(conn):
    if has_text_index(conn):
        installed = conn.execute(
            "SELECT count(*) FROM sqlite_master WHERE type = 'trigger' AND name IN "
            "('media_text_before_insert', 'media_text_insert', 'media_text_update', 'media_text_delete')"
        ).fetchone()[0]
        if installed == 4:
            return
    # DDL does not begin an implicit SQLite transaction. Without a savepoint,
    # an interrupted backfill leaves a visible index that later startups skip.
    conn.execute("SAVEPOINT media_text_initialization")
    try:
        _build_text_index(conn)
    except Exception as error:
        conn.execute("ROLLBACK TO media_text_initialization")
        if isinstance(error, OperationalError) and (
            "no such module: fts5" in str(error) or "no such tokenizer" in str(error)
        ):
            return
        raise
    finally:
        conn.execute("RELEASE media_text_initialization")


def _build_text_index(conn):
    conn.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS media_text_index "
        "USING fts5(filename, description, tokenize='trigram')"
    )
    conn.execute("DELETE FROM media_text_index")
    filename = _filename_sql("new.path")
    # INSERT OR REPLACE on media deletes its old row without invoking DELETE
    # triggers unless recursive_triggers is enabled. Remove that old entry first.
    conn.execute("""CREATE TRIGGER IF NOT EXISTS media_text_before_insert BEFORE INSERT ON media
        BEGIN
            DELETE FROM media_text_index WHERE rowid = (SELECT id FROM media WHERE path = new.path);
        END""")
    conn.execute(f"""CREATE TRIGGER IF NOT EXISTS media_text_insert AFTER INSERT ON media
        BEGIN
            INSERT OR REPLACE INTO media_text_index(rowid, filename, description)
            VALUES (new.id, {filename}, coalesce(new.description, ''));
        END""")
    conn.execute(f"""CREATE TRIGGER IF NOT EXISTS media_text_update AFTER UPDATE OF path, description ON media
        BEGIN
            INSERT OR REPLACE INTO media_text_index(rowid, filename, description)
            VALUES (new.id, {filename}, coalesce(new.description, ''));
        END""")
    conn.execute("""CREATE TRIGGER IF NOT EXISTS media_text_delete AFTER DELETE ON media
        BEGIN
            DELETE FROM media_text_index WHERE rowid = old.id;
        END""")
    conn.execute(
        "INSERT OR REPLACE INTO media_text_index(rowid, filename, description) "
        f"SELECT id, {_filename_sql('path')}, coalesce(description, '') FROM media"
    )
