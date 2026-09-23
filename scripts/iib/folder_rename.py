"""Rename a managed child directory while retaining indexed media identities."""

import os
import re
import sqlite3


def _within(path: str, parent: str) -> bool:
    try:
        return os.path.commonpath((path, parent)) == parent
    except ValueError:  # Different Windows drives.
        return False


def _normalized(path: str) -> str:
    return os.path.normcase(os.path.realpath(os.path.abspath(path)))


def rename_managed_folder(conn: sqlite3.Connection, source: str, name: str, managed_roots: list[str]) -> str:
    source = os.path.abspath(source)
    name = name.strip()
    if not name or name in (".", "..") or any(char in name for char in ("/", "\\", "\0")) or any(ord(char) < 32 for char in name):
        raise ValueError("请输入单个有效的文件夹名称")
    if os.name == "nt" and (re.search(r'[<>:"|?*]', name) or name[-1] in ". " or re.match(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)", name, re.I)):
        raise ValueError("此名称不能用于 Windows 文件夹")
    if not os.path.isdir(source) or os.path.islink(source):
        raise ValueError("原文件夹不存在或不可改名")

    current = _normalized(source)
    roots = [_normalized(path) for path in managed_roots]
    if not any(_within(current, root) and current != root for root in roots):
        raise ValueError("只能改名已添加根目录内的子文件夹")
    if any(_within(root, current) for root in roots):
        raise ValueError("包含已添加根目录的文件夹不能改名")

    destination = os.path.join(os.path.dirname(source), name)
    if destination == source:
        return source
    if os.path.lexists(destination):
        raise ValueError("目标位置已有同名文件或文件夹")

    # A prefix rewrite retains image IDs, tags, notes, embeddings and manual order.
    prefix = source + os.sep
    suffix_start = len(source) + 1  # SQLite substr is one-based; include the separator.
    os.rename(source, destination)
    try:
        with conn:
            for table in ("image", "folders"):
                conn.execute(
                    f"UPDATE {table} SET path = ? || substr(path, ?) WHERE path = ? OR substr(path, 1, ?) = ?",
                    (destination, suffix_start, source, len(prefix), prefix),
                )
            conn.execute(
                "DELETE FROM dir_cover_cache WHERE folder_path IN (?, ?) OR substr(folder_path, 1, ?) = ?",
                (os.path.dirname(source), source, len(prefix), prefix),
            )
    except Exception:
        try:
            os.rename(destination, source)
        except OSError as rollback_error:
            raise RuntimeError(f"索引更新失败，且无法恢复原文件夹位置：{rollback_error}") from rollback_error
        raise
    return destination
