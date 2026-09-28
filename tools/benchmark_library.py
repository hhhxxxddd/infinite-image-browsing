"""Benchmark media pagination and text search on an isolated in-memory database."""

import argparse
import json
import sqlite3
import statistics
import time
from contextlib import closing
from unittest.mock import patch

from omnigallery.library.media_order import ensure_media_order
from omnigallery.library.media_repository import Media
from omnigallery.library.tag_repository import MediaTag, Tag


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--size", type=int, default=100_000)
    parser.add_argument("--rounds", type=int, default=7)
    args = parser.parse_args()
    if args.size < 1000 or args.rounds < 1:
        parser.error("size must be at least 1000 and rounds must be positive")
    with closing(sqlite3.connect(":memory:")) as conn:
        Media.create_table(conn)
        Tag.create_table(conn)
        MediaTag.create_table(conn)
        ensure_media_order(conn)
        conn.executemany(
            "INSERT INTO media(path,exif,size,date,description,width,height) VALUES(?,?,?,?,?,?,?)",
            (
                (
                    f"C:/bench/picture-{i:08d}.png",
                    "x" * 256,
                    102400,
                    f"{i:012d}",
                    "landscape",
                    1024,
                    1024,
                )
                for i in range(args.size)
            ),
        )
        conn.commit()
        depth = args.size * 9 // 10
        boundary = args.size - depth
        cases = [
            ("date_first", dict(substring="")),
            ("date_deep", dict(substring="", cursor=f"{boundary:012d}|{boundary + 1}")),
            ("text_absent", dict(substring="missing-term")),
        ]
        results = []
        with (
            patch("omnigallery.library.media_repository.os.path.exists", return_value=True),
            patch("omnigallery.storage.cloud_files.get_sync_settings", return_value={}),
            patch("omnigallery.storage.cloud_files.online_only_paths", return_value=set()),
        ):
            for manual in (False, True):
                if manual:
                    conn.executemany(
                        "INSERT INTO media_order VALUES(?,?)",
                        ((i + 1, args.size - i - 1) for i in range(args.size)),
                    )
                    conn.commit()
                    cases = [
                        ("manual_first", dict(substring="", manual_order=True)),
                        (
                            "manual_deep",
                            dict(
                                substring="",
                                manual_order=True,
                                cursor=f"manual:p:{depth - 1}:{boundary + 1}",
                            ),
                        ),
                    ]
                for name, options in cases:
                    elapsed = []
                    for _ in range(args.rounds):
                        start = time.perf_counter()
                        Media.find_by_substring(conn, limit=100, **options)
                        elapsed.append((time.perf_counter() - start) * 1000)
                    results.append(dict(case=name, median_ms=round(statistics.median(elapsed), 3)))
        print(
            json.dumps(
                dict(
                    rows=args.size,
                    rounds=args.rounds,
                    sqlite=sqlite3.sqlite_version,
                    results=results,
                ),
                indent=2,
            )
        )


if __name__ == "__main__":
    main()
