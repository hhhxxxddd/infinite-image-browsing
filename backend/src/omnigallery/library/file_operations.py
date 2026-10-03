"""File transfers that never replace an existing destination."""

import errno
import os
import shutil
import stat


def _remove_created_file(path: str) -> None:
    if os.name == "nt":
        os.chmod(path, os.stat(path).st_mode | stat.S_IWRITE)
    os.unlink(path)


def copy_file_exclusive(source: str, destination: str) -> None:
    # Exclusive creation also rejects symlinks and files arriving after a preflight.
    with open(destination, "xb") as output:
        try:
            with open(source, "rb") as input_file:
                shutil.copyfileobj(input_file, output)
            output.flush()
            os.fsync(output.fileno())
            shutil.copystat(source, destination)
        except Exception:
            output.close()
            _remove_created_file(destination)
            raise


def move_file_exclusive(source: str, destination: str) -> None:
    if os.name == "nt":
        # Windows rename is exclusive and also handles read-only source files.
        try:
            os.rename(source, destination)
            return
        except OSError as error:
            if error.errno != errno.EXDEV and getattr(error, "winerror", None) != 17:
                raise
        copy_file_exclusive(source, destination)
        try:
            os.unlink(source)
        except Exception:
            _remove_created_file(destination)
            raise
        return
    try:
        os.link(source, destination)
    except FileExistsError:
        raise
    except OSError:
        # Cross-volume moves and filesystems without hard links still use an
        # exclusive destination; shutil.move can overwrite on its fallback path.
        copy_file_exclusive(source, destination)
    try:
        os.unlink(source)
    except Exception:
        _remove_created_file(destination)
        raise


def copy_media_exclusive(source: str, destination: str, sidecar: str | None) -> None:
    pairs = [(source, destination)]
    if sidecar:
        pairs.append((sidecar, os.path.splitext(destination)[0] + ".txt"))
    targets = [target for _, target in pairs]
    if len(set(map(os.path.normcase, targets))) != len(targets):
        raise FileExistsError("媒体和侧车文件的目标名称冲突")
    for target in targets:
        if os.path.lexists(target):
            raise FileExistsError(target)
    created = []
    try:
        for original, target in pairs:
            copy_file_exclusive(original, target)
            created.append(target)
    except Exception:
        for target in reversed(created):
            _remove_created_file(target)
        raise
