"""Large-file range requests should not depend on loading the whole media file."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from starlette.requests import Request

from scripts.iib.fastapi_video import (
    close_video_file_reader,
    range_requests_response,
    send_bytes_range_requests,
    video_file_handler,
)


class LargeVideoRangeTests(unittest.TestCase):
    def test_requested_range_is_clamped_to_end_of_file(self):
        scope = {"type": "http", "method": "GET", "path": "/stream_video",
                 "headers": [(b"range", b"bytes=5-100")]}
        with patch("scripts.iib.fastapi_video.os.stat") as stat:
            stat.return_value.st_size = 10
            response = range_requests_response(Request(scope), "small.mp4", "video/mp4")
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.headers["content-range"], "bytes 5-9/10")
        self.assertEqual(response.headers["content-length"], "5")

    def test_rename_closes_all_parallel_readers_for_one_video(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "clip.mp4")
            Path(path).write_bytes(b"abcdefgh")
            first = send_bytes_range_requests(path, 0, 7, chunk_size=2)
            second = send_bytes_range_requests(path, 0, 7, chunk_size=2)
            try:
                self.assertEqual(next(first), b"ab")
                self.assertEqual(next(second), b"ab")
                self.assertEqual(len(video_file_handler[path]), 2)
                close_video_file_reader(path)
                self.assertNotIn(path, video_file_handler)
                self.assertEqual(list(first), [])
                self.assertEqual(list(second), [])
            finally:
                first.close()
                second.close()

    def test_range_headers_above_ten_gibibytes(self):
        file_size = 12 * 1024 ** 3
        start = 10 * 1024 ** 3
        end = start + 1024 ** 2 - 1
        scope = {"type": "http", "method": "GET", "path": "/stream_video",
                 "headers": [(b"range", f"bytes={start}-{end}".encode())]}
        with patch("scripts.iib.fastapi_video.os.stat") as stat:
            stat.return_value.st_size = file_size
            response = range_requests_response(Request(scope), "large.mp4", "video/mp4")
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.headers["content-range"], f"bytes {start}-{end}/{file_size}")
        self.assertEqual(response.headers["content-length"], str(1024 ** 2))

    def test_reader_only_requests_the_selected_chunk(self):
        start = 10 * 1024 ** 3

        class FakeFile:
            def __init__(self):
                self.position = 0
                self.requested = []
                self.closed = False

            def seek(self, position):
                self.position = position

            def tell(self):
                return self.position

            def read(self, size):
                self.requested.append(size)
                self.position += size
                return b"x" * size

            def close(self):
                self.closed = True

        fake = FakeFile()
        with patch("builtins.open", return_value=fake):
            chunks = list(send_bytes_range_requests("large.mp4", start, start + 1024 ** 2 - 1))
        self.assertEqual(len(chunks), 1)
        self.assertEqual(fake.requested, [1024 ** 2])
        self.assertEqual(len(chunks[0]), 1024 ** 2)


if __name__ == "__main__":
    unittest.main()
