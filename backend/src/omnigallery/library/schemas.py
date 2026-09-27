from typing import TypedDict


class FileInfo(TypedDict):
    type: str
    date: float
    size: int
    name: str
    bytes: bytes
    created_time: float
    fullpath: str
    width: int | None
    height: int | None


class Cursor:
    def __init__(self, has_next=True, next=""):
        self.has_next = has_next
        self.next = next
