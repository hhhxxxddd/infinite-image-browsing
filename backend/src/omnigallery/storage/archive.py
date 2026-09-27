"""Persistent archive destinations and collision-free ZIP output."""

import os
import tempfile
import zipfile
from datetime import datetime


def archive_settings(directory, base_directory):
    default = os.path.abspath(os.path.join(base_directory, "exports"))
    custom = directory.strip()
    if custom:
        if "\0" in custom or not os.path.isabs(custom):
            raise ValueError("请填写运行媒体库的机器上的绝对目录路径")
        custom = os.path.normpath(custom)
    return {
        "directory": custom or default,
        "custom_directory": custom,
        "default_directory": default,
    }


def check_archive_directory(directory):
    os.makedirs(directory, exist_ok=True)
    with tempfile.TemporaryFile(dir=directory):
        pass


def write_archive(paths, directory, compress):
    os.makedirs(directory, exist_ok=True)
    prefix = datetime.now().strftime("omnigallery_archive_%Y-%m-%d_%H-%M-%S_")
    fd, output = tempfile.mkstemp(prefix=prefix, suffix=".zip", dir=directory)
    os.close(fd)
    try:
        create_zip_file(paths, output, compress)
    except Exception:
        os.remove(output)
        raise
    return os.path.abspath(output)


def create_zip_file(file_paths: list[str], zip_file_name: str, compress=False):
    """
    将文件打包成一个压缩包

    Args:
        file_paths: 文件路径的列表
        zip_file_name: 压缩包的文件名

    Returns:
        无返回值
    """
    with zipfile.ZipFile(
        zip_file_name, "w", zipfile.ZIP_DEFLATED if compress else zipfile.ZIP_STORED
    ) as zip_file:
        for file_path in file_paths:
            if os.path.isfile(file_path):
                zip_file.write(file_path, os.path.basename(file_path))
            elif os.path.isdir(file_path):
                for root, _, files in os.walk(file_path):
                    for file in files:
                        full_path = os.path.join(root, file)
                        zip_file.write(full_path, os.path.relpath(full_path, file_path))
