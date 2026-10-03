"""Bounded filesystem operations used by storage migration and maintenance."""

import hashlib
import os
import stat
from pathlib import Path


def is_link(path: Path) -> bool:
    return path.is_symlink() or path.is_junction()


def checked_path(path: Path) -> Path:
    """Reject links in every existing ancestor before resolving a managed path."""
    path = Path(os.path.abspath(path.expanduser()))
    for part in (path, *path.parents):
        if is_link(part):
            raise ValueError(f"数据路径不能包含符号链接或目录联接：{part}")
    return path.resolve()


def files_under(root: Path):
    """Never descend through links; reject non-regular files rather than copying them."""
    checked_path(root)
    if not root.exists():
        return
    if root.is_file():
        yield root
        return
    for directory, dirs, files in os.walk(root, followlinks=False):
        parent = Path(directory)
        for name in dirs:
            if is_link(parent / name):
                raise ValueError(f"数据目录中含符号链接或目录联接：{parent / name}")
        for name in files:
            path = parent / name
            if is_link(path) or not stat.S_ISREG(path.stat().st_mode):
                raise ValueError(f"数据目录中含不支持的文件：{path}")
            yield path


def digest(path: Path) -> bytes:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.digest()


class DirectoryLease:
    """Process lifetime lock, released by the OS even after an interrupted startup."""

    def __init__(self, directory: Path):
        directory = checked_path(directory)
        directory.mkdir(parents=True, exist_ok=True)
        self.stream = checked_path(directory / ".storage.lock").open("a+b")
        try:
            self.stream.seek(0, os.SEEK_END)
            if self.stream.tell() == 0:
                self.stream.write(b"0")
                self.stream.flush()
            self.stream.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(self.stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(self.stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            self.stream.close()
            raise OSError(f"应用数据目录正在被另一个服务使用，请先关闭它：{directory}") from error

    def close(self):
        self.stream.close()
