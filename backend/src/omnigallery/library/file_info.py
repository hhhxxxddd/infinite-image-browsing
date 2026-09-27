import os

from omnigallery.infrastructure.formatting import (
    get_created_date_by_stat,
    get_formatted_date,
    human_readable_size,
)


def get_file_info_by_path(fullpath: str, is_under_scanned_path=True):
    stat = os.stat(fullpath)
    date = get_formatted_date(stat.st_mtime)
    name = os.path.basename(fullpath)
    created_time = get_created_date_by_stat(stat)
    if os.path.isfile(fullpath):
        bytes = stat.st_size
        size = human_readable_size(bytes)
        return {
            "type": "file",
            "date": date,
            "size": size,
            "name": name,
            "bytes": bytes,
            "created_time": created_time,
            "fullpath": fullpath,
            "is_under_scanned_path": is_under_scanned_path,
        }

    elif os.path.isdir(fullpath):
        return {
            "type": "dir",
            "date": date,
            "created_time": created_time,
            "size": "-",
            "name": name,
            "is_under_scanned_path": is_under_scanned_path,
            "fullpath": fullpath,
        }
    return {}
