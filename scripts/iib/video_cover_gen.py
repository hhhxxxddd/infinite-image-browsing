import hashlib
import os
import threading
import uuid
from scripts.iib.tool import get_formatted_date, get_cache_dir, is_video_file
from concurrent.futures import ThreadPoolExecutor
import time

_cover_decode_slots = threading.BoundedSemaphore(2)
_cover_max_edge = 1280


def read_video_cover_frame(path):
  import imageio.v3 as iio
  try:
    return iio.imread(path, index=16, plugin="pyav")
  except (IndexError, StopIteration):
    # Very short clips can have fewer than 17 frames.
    return iio.imread(path, index=0, plugin="pyav")


def write_video_cover(path, cache_path):
  """Decode at most two covers at a time and cache a card-sized image atomically."""
  from PIL import Image

  with _cover_decode_slots:
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
    finally:
      if os.path.exists(temporary_path):
        os.remove(temporary_path)


def generate_video_covers(dirs,verbose=False):
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
      stat = item.stat()
      t = get_formatted_date(stat.st_mtime)
      hash_dir = hashlib.md5((path + t).encode("utf-8")).hexdigest()
      cache_dir = os.path.join(cache_base_dir, "iib_cache", "video_cover", hash_dir)
      cache_path = os.path.join(cache_dir, "cover.webp")

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
