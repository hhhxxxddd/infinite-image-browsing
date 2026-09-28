import heapq
import os

from omnigallery.infrastructure.database import Database
from omnigallery.infrastructure.formatting import (
    birthtime_sort_key_fn,
    get_created_date_by_stat,
    get_formatted_date,
)
from omnigallery.library.cover_repository import DirectoryCoverCache
from omnigallery.library.media_types import (
    get_video_type,
    is_audio_file,
    is_image_file,
    is_video_file,
)
from omnigallery.storage.cloud_files import get_sync_settings, online_only_paths


def get_top_4_media_info(folder_path):
    """
    获取给定文件夹路径下的前4个媒体文件的完整路径。

    参数:
    folder_path (str): 文件夹的路径。

    返回值:
    list: 包含前4个媒体文件完整路径的列表。
    """
    conn = Database.get_connection()
    if DirectoryCoverCache.is_cache_expired(conn, folder_path):
        media_files = get_media_files_from_folder(folder_path)
        DirectoryCoverCache.cache_media_files(conn, folder_path, media_files)
    else:
        media_files = DirectoryCoverCache.get_cached_media_files(conn, folder_path)

    settings = get_sync_settings(conn)
    cloud_paths = online_only_paths((item["fullpath"] for item in media_files), settings)
    return [item for item in media_files if item["fullpath"] not in cloud_paths][:4]


def get_media_files_from_folder(folder_path):
    """
    从文件夹中获取媒体文件的完整路径。

    参数:
    folder_path (str): 文件夹的路径。

    返回值:
    list: 包含媒体文件完整路径的列表。
    """
    media_files = []
    with os.scandir(folder_path) as entries:

        def candidates():
            for entry in entries:
                try:
                    if entry.is_file() and (
                        is_image_file(entry.name)
                        or is_audio_file(entry.name)
                        or is_video_file(entry.path)
                    ):
                        yield birthtime_sort_key_fn(entry), entry
                except OSError:
                    continue

        newest = heapq.nlargest(4, candidates(), key=lambda item: item[0])
        for _, entry in newest:
            try:
                stat = entry.stat()
                date = get_formatted_date(stat.st_mtime)
                created_time = get_created_date_by_stat(stat)
                media_files.append(
                    {
                        "fullpath": entry.path,
                        "media_type": "video" if get_video_type(entry.path) else "image",
                        "type": "file",
                        "date": date,
                        "created_time": created_time,
                        "name": entry.name,
                    }
                )
            except OSError:
                continue

    return media_files
