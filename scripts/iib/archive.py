"""Persistent archive destinations and collision-free ZIP output."""
import os
import tempfile
from datetime import datetime
from .tool import create_zip_file


def archive_settings(directory, base_directory):
    default = os.path.abspath(os.path.join(base_directory, "zip_temp"))
    custom = directory.strip()
    if custom:
        if "\0" in custom or not os.path.isabs(custom):
            raise ValueError("请填写运行媒体库的机器上的绝对目录路径")
        custom = os.path.normpath(custom)
    return {"directory": custom or default, "custom_directory": custom, "default_directory": default}


def check_archive_directory(directory):
    os.makedirs(directory, exist_ok=True)
    with tempfile.TemporaryFile(dir=directory):
        pass


def write_archive(paths, directory, compress):
    os.makedirs(directory, exist_ok=True)
    prefix = datetime.now().strftime("iib_archive_%Y-%m-%d_%H-%M-%S_")
    fd, output = tempfile.mkstemp(prefix=prefix, suffix=".zip", dir=directory)
    os.close(fd)
    try:
        create_zip_file(paths, output, compress)
    except Exception:
        os.remove(output)
        raise
    return os.path.abspath(output)
