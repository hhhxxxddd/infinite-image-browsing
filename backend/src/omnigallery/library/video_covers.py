import hashlib
import os
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from omnigallery.config import get_cache_dir
from omnigallery.library.media_types import is_video_file
from omnigallery.storage.maintenance import use_cache
from omnigallery.storage.project_files import storage_root

_cover_decode_slots = threading.BoundedSemaphore(2)
_cover_max_edge = 1280


def video_cover_cache_path(path, cache_base_dir):
    """Use the real file revision so same-second replacements cannot reuse an old cover."""
    source = os.path.normpath(path)
    stat = os.stat(source)
    identity = f"{source}\0{stat.st_mtime_ns}\0{stat.st_size}"
    hash_dir = hashlib.md5(identity.encode("utf-8")).hexdigest()
    return os.path.join(cache_base_dir, "thumbnails", "video_cover", hash_dir, "cover.webp")


def read_video_cover_frame(path):
    import av

    with av.open(path) as container:
        first = None
        for index, frame in enumerate(container.decode(video=0)):
            if first is None:
                first = frame
            if index == 16:
                return frame.to_ndarray(format="rgb24")
        if first is None:
            raise ValueError("Video contains no decodable frames")
        # Very short clips can have fewer than 17 frames.
        return first.to_ndarray(format="rgb24")


def custom_video_cover_path(path):
    identity = Path(video_cover_cache_path(path, "")).parent.name
    return storage_root() / "media-covers" / f"{identity}.webp"


def write_video_cover(path, cache_path):
    """Decode at most two covers at a time and cache a card-sized image atomically."""
    from PIL import Image

    with use_cache(cache_path), _cover_decode_slots:
        if os.path.exists(cache_path):
            return
        frame = read_video_cover_frame(path)
        cover = Image.fromarray(frame).convert("RGB")
        cover.thumbnail((_cover_max_edge, _cover_max_edge), Image.Resampling.LANCZOS)
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        temporary_path = f"{cache_path}.{uuid.uuid4().hex}.tmp"
        try:
            cover.save(temporary_path, format="WEBP", quality=85)
            os.replace(temporary_path, cache_path)
            (Path(cache_path).parent / ".generated").touch()
        finally:
            if os.path.exists(temporary_path):
                os.remove(temporary_path)


def generate_video_covers(dirs, verbose=False):
    start_time = time.time()

    cache_base_dir = get_cache_dir()

    def process_video(item):
        if item.is_dir():
            if item.name == "node_modules":
                return
            verbose and print(f"Processing directory: {item.path}")
            with os.scandir(item.path) as entries:
                for sub_item in entries:
                    process_video(sub_item)
            return
        if not os.path.exists(item.path) or not is_video_file(item.path):
            return

        try:
            path = os.path.normpath(item.path)
            cache_path = video_cover_cache_path(path, cache_base_dir)

            # 如果缓存文件存在，则直接返回该文件
            if os.path.exists(cache_path):
                print(f"Video cover already exists: {path}")
                return

            write_video_cover(path, cache_path)
            verbose and print(f"Video cover generated: {path}")
        except Exception as e:
            print(f"Error generating video cover: {path}")
            print(e)

    with ThreadPoolExecutor(max_workers=4) as executor:
        for dir_path in dirs:
            with os.scandir(dir_path) as entries:
                for item in entries:
                    executor.submit(process_video, item)

    print("Video covers generated successfully.")
    end_time = time.time()
    execution_time = end_time - start_time
    print(f"Execution time: {execution_time} seconds")
