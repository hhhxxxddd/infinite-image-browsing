"""Migrate indexed paths in one existing SQLite database."""

import argparse
import os
import shutil
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path


def replace_path(old_base: str, new_base: str):
    """Replace only the selected directory and its descendants."""
    old_base = old_base.rstrip("/\\")
    new_prefix = new_base.rstrip("/\\")
    if not old_base or not new_base.strip():
        raise ValueError("迁移路径不能为空，且旧路径不能是文件系统根目录")

    def replace_func(path: str):
        if path == old_base:
            return new_base
        if path and path.startswith(old_base) and path[len(old_base):len(old_base) + 1] in ("/", "\\"):
            return new_prefix + path[len(old_base):]
        return path

    return replace_func


def update_paths(conn: sqlite3.Connection, table_name: str, old_base: str):
    """Update one of the known path tables without treating % or _ as wildcards."""
    if table_name not in ("image", "extra_path", "folders"):
        raise ValueError("不支持的路径表")
    old_base = old_base.rstrip("/\\")
    conn.execute(
        f"UPDATE {table_name} SET path = replace_path(path) WHERE substr(path, 1, ?) = ?",
        (len(old_base), old_base),
    )


def migrate_database(db_path: str, old_base: str, new_base: str):
    """Stage a consistent copy and replace only the requested database on success."""
    replace_func = replace_path(old_base, new_base)
    source = Path(db_path).expanduser().resolve()
    if not source.is_file():
        raise FileNotFoundError(f"数据库不存在：{source}")

    fd, temporary_name = tempfile.mkstemp(prefix=f".{source.name}.", suffix=".tmp", dir=source.parent)
    os.close(fd)
    staged = Path(temporary_name)
    try:
        # SQLite backup includes uncheckpointed WAL data; copying only the main
        # file can silently discard recent library changes.
        with closing(sqlite3.connect(source)) as original, closing(sqlite3.connect(staged)) as copy:
            original.backup(copy)
        with closing(sqlite3.connect(staged)) as conn:
            conn.create_function("replace_path", 1, replace_func)
            with conn:
                existing_tables = {
                    row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
                }
                if not existing_tables.intersection(("image", "extra_path", "folders")):
                    raise ValueError("数据库中没有可迁移的媒体路径表")
                for table_name in ("image", "extra_path", "folders"):
                    if table_name in existing_tables:
                        update_paths(conn, table_name, old_base)
        shutil.copymode(source, staged)
        os.replace(staged, source)
    finally:
        staged.unlink(missing_ok=True)


def setup_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Migrate indexed paths in an existing IIB SQLite database."
    )
    parser.add_argument(
        "--db_path", default="iib.db", help="要迁移的数据库路径，默认 iib.db"
    )
    parser.add_argument("--old_dir", required=True, help="旧目录路径")
    parser.add_argument("--new_dir", required=True, help="新目录路径")
    return parser


if __name__ == "__main__":
    args = setup_parser().parse_args()
    migrate_database(args.db_path, args.old_dir, args.new_dir)
    print("Database migration completed successfully.")
