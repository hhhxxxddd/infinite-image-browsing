"""Video covers follow the file revision, even when the UI date stays unchanged."""

import base64
import io
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import av
import numpy as np
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from omnigallery.infrastructure.auth import verify_secret
from omnigallery.library.content_routes import mount_routes
from omnigallery.library.video_covers import generate_video_covers, video_cover_cache_path
from omnigallery.storage.maintenance import clear_cache


class VideoCoverCacheTests(unittest.TestCase):
    def test_same_second_replacement_updates_prefetched_and_route_cover(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            media = root / "media"
            media.mkdir()
            video = media / "clip.mp4"
            cache = root / "cache"
            timestamp_ns = 1_700_000_000_100_000_000

            def write_video(color, offset_ns):
                with av.open(str(video), "w") as output:
                    stream = output.add_stream("mpeg4", rate=24)
                    stream.width, stream.height = 64, 32
                    stream.pix_fmt = "yuv420p"
                    for _ in range(20):
                        frame = av.VideoFrame.from_ndarray(
                            np.full((32, 64, 3), color, dtype=np.uint8), format="rgb24"
                        )
                        for packet in stream.encode(frame):
                            output.mux(packet)
                    for packet in stream.encode():
                        output.mux(packet)
                os.utime(video, ns=(timestamp_ns + offset_ns, timestamp_ns + offset_ns))

            app = FastAPI()
            context = SimpleNamespace(
                api_base="/api",
                cache_base_dir=str(cache),
                check_path_trust=lambda path: None,
                is_path_under_parents=lambda path: True,
            )
            mount_routes(app, context)
            app.dependency_overrides[verify_secret] = lambda: None
            with (
                patch("omnigallery.library.video_covers.get_cache_dir", return_value=str(cache)),
                patch(
                    "omnigallery.library.video_covers.storage_root",
                    return_value=root / "project-data",
                ),
                patch(
                    "omnigallery.library.content_routes.Database.get_connection", return_value=None
                ),
                patch("omnigallery.library.content_routes.get_sync_settings", return_value={}),
                patch(
                    "omnigallery.library.content_routes.is_protected_online_path",
                    return_value=False,
                ),
                TestClient(app) as client,
            ):
                write_video((230, 20, 20), 0)
                first_cache = Path(video_cover_cache_path(str(video), str(cache)))
                generate_video_covers([str(media)])
                self.assertTrue(first_cache.is_file())
                request = {"path": str(video), "mt": "2023-11-14 22:13:20"}
                first = client.get("/api/video_cover", params=request)
                self.assertEqual(first.status_code, 200, first.text[:300])

                write_video((20, 20, 230), 1_000_000)
                second_cache = Path(video_cover_cache_path(str(video), str(cache)))
                self.assertNotEqual(first_cache, second_cache)
                second = client.get("/api/video_cover", params=request)
                self.assertEqual(second.status_code, 200, second.text[:300])
                self.assertTrue(second_cache.is_file())
                with (
                    Image.open(io.BytesIO(first.content)) as old,
                    Image.open(io.BytesIO(second.content)) as new,
                ):
                    self.assertGreater(old.convert("RGB").getpixel((32, 16))[0], 150)
                    self.assertGreater(new.convert("RGB").getpixel((32, 16))[2], 150)

                manual = io.BytesIO()
                Image.new("RGB", (64, 32), (20, 210, 20)).save(manual, format="WEBP")
                selected = client.post(
                    "/api/set_target_frame_as_video_cover",
                    json={
                        "path": str(video),
                        "updated_time": request["mt"],
                        "base64_img": base64.b64encode(manual.getvalue()).decode(),
                    },
                )
                self.assertEqual(selected.status_code, 200, selected.text[:300])
                self.assertEqual(clear_cache(root)["removed_files"], 2)
                self.assertEqual(len(list((root / "project-data/media-covers").glob("*.webp"))), 1)
                current = client.get("/api/video_cover", params=request)
                with Image.open(io.BytesIO(current.content)) as image:
                    self.assertGreater(image.convert("RGB").getpixel((32, 16))[1], 150)


if __name__ == "__main__":
    unittest.main()
