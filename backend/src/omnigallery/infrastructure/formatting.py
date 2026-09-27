import json
import os
import re
from datetime import datetime


def human_readable_size(size_bytes):
    """
    Converts bytes to a human-readable format.
    """
    # define the size units
    units = ("B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB")
    # calculate the logarithm of the input value with base 1024
    size = int(size_bytes)
    if size == 0:
        return "0B"
    i = 0
    while size >= 1024 and i < len(units) - 1:
        size /= 1024
        i += 1
    # round the result to two decimal points and return as a string
    return f"{size:.2f} {units[i]}"


pattern = re.compile(r"(\d+\.?\d*)([KMGT]?B)", re.IGNORECASE)


def convert_to_bytes(file_size_str):
    match = re.match(pattern, file_size_str)
    if match:
        size_str, unit_str = match.groups()
        size = float(size_str)
        unit = unit_str.upper()
        if unit == "KB":
            size *= 1024
        elif unit == "MB":
            size *= 1024**2
        elif unit == "GB":
            size *= 1024**3
        elif unit == "TB":
            size *= 1024**4
        return int(size)
    else:
        raise ValueError(f"Invalid file size string '{file_size_str}'")


def get_formatted_date(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp).strftime("%Y-%m-%d %H:%M:%S")


def get_modified_date(folder_path: str):
    return get_formatted_date(os.path.getmtime(folder_path))


def get_created_date(folder_path: str):
    return get_formatted_date(os.path.getctime(folder_path))


is_st_birthtime_available = True


def get_created_date_by_stat(stat: os.stat_result):
    global is_st_birthtime_available
    try:
        if is_st_birthtime_available:
            return get_formatted_date(stat.st_birthtime)
        else:
            return get_formatted_date(stat.st_ctime)
    except Exception:
        is_st_birthtime_available = False
        return get_formatted_date(stat.st_ctime)


def birthtime_sort_key_fn(x):
    stat = x.stat()
    global is_st_birthtime_available
    try:
        if is_st_birthtime_available and hasattr(stat, "st_birthtime"):
            return stat.st_birthtime
        else:
            return stat.st_ctime
    except Exception:
        is_st_birthtime_available = False
        return stat.st_ctime


def unquote(text):
    if len(text) == 0 or text[0] != '"' or text[-1] != '"':
        return text

    try:
        return json.loads(text)
    except Exception:
        return text


def replace_punctuation(input_string):
    return input_string.replace(",", " ").replace("\n", " ")
