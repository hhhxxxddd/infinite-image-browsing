import os


def is_video_simple(filepath):
    try:
        import filetype

        kind = filetype.guess(filepath)
        # print(f"File type guessed: {kind}")
        return kind and kind.mime.startswith("video/")
    except Exception:
        # 如果 filetype 模块不可用，使用简单的文件扩展名检查
        return isinstance(get_video_type(filepath), str)


def get_video_type(file_path):
    video_extensions = [".mp4", ".m4v", ".avi", ".mkv", ".mov", ".wmv", ".flv", ".ts", ".webm"]
    file_extension = file_path[file_path.rfind(".") :].lower()

    if file_extension in video_extensions:
        return file_extension[1:]
    else:
        return None


def is_image_file(filename: str) -> bool:
    if not isinstance(filename, str):
        return False

    extensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".avif", ".jpe"]
    extension = filename.split(".")[-1].lower()
    return f".{extension}" in extensions


def is_video_file(filename: str) -> bool:
    return isinstance(get_video_type(filename), str) and is_video_simple(filename)


def get_audio_type(file_path):
    audio_extensions = [".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".wma"]
    file_extension = file_path[file_path.rfind(".") :].lower()

    if file_extension in audio_extensions:
        return file_extension[1:]
    else:
        return None


def is_audio_file(filename: str) -> bool:
    return isinstance(get_audio_type(filename), str)


def is_valid_media_path(path):
    """
    判断给定的路径是否是图像文件
    """
    abs_path = os.path.abspath(path)  # 转为绝对路径
    if not os.path.exists(abs_path):  # 判断路径是否存在
        return False
    if not os.path.isfile(abs_path):  # 判断是否是文件
        return False
    return is_image_file(abs_path) or is_video_file(abs_path) or is_audio_file(abs_path)


def is_media_file(file_path):
    return is_image_file(file_path) or is_video_file(file_path) or is_audio_file(file_path)
