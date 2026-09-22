"""Offline regression checks for dependency upgrades; no user database is opened."""
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import av
import hnswlib
import imageio.v3 as iio
import numpy as np
from PIL import Image


class RuntimeTests(unittest.TestCase):
    def test_native_avif_and_webp(self):
        for format_name in ("AVIF", "WEBP"):
            with self.subTest(format=format_name):
                output = io.BytesIO()
                Image.new("RGB", (64, 32), "red").save(output, format=format_name)
                output.seek(0)
                with Image.open(output) as image:
                    image.load()
                    self.assertEqual(image.size, (64, 32))

    def test_pyav_imageio_video_cover(self):
        with tempfile.TemporaryDirectory() as folder:
            video = Path(folder) / "clip.mp4"
            with av.open(str(video), "w") as output:
                stream = output.add_stream("mpeg4", rate=24)
                stream.width, stream.height = 64, 32
                stream.pix_fmt = "yuv420p"
                for _ in range(24):
                    frame = av.VideoFrame.from_ndarray(np.full((32, 64, 3), 127, dtype=np.uint8), format="rgb24")
                    for packet in stream.encode(frame):
                        output.mux(packet)
                for packet in stream.encode():
                    output.mux(packet)
            frame = iio.imread(video, index=16, plugin="pyav")
            self.assertEqual(frame.shape, (32, 64, 3))
            cover = Path(folder) / "cover.webp"
            iio.imwrite(cover, frame, extension=".webp")
            with Image.open(cover) as image:
                self.assertEqual(image.size, (64, 32))

    def test_numpy_hnsw_search_and_reload(self):
        vectors = np.eye(3, dtype=np.float32)
        index = hnswlib.Index(space="cosine", dim=3)
        index.init_index(max_elements=3, ef_construction=100, M=16)
        index.add_items(vectors, np.arange(3))
        with tempfile.TemporaryDirectory() as folder:
            path = str(Path(folder) / "index.bin")
            index.save_index(path)
            restored = hnswlib.Index(space="cosine", dim=3)
            restored.load_index(path)
            labels, distances = restored.knn_query(vectors[1], k=1)
            self.assertEqual(labels[0, 0], 1)
            self.assertAlmostEqual(distances[0, 0], 0)

    def test_api_startup_and_default_port(self):
        # The subprocess releases SQLite connections from worker threads before cleanup.
        with tempfile.TemporaryDirectory() as folder:
            env = os.environ.copy()
            env.update(IIB_DB_PATH=str(Path(folder) / "test.db"), IIB_DB_FILE_BACKUP_MAX="0",
                       IIB_ACCESS_CONTROL="enable", IIB_CACHE_DIR=folder)
            env.pop("IIB_SECRET_KEY", None)
            env.pop("IIB_ACCESS_CONTROL_ALLOWED_PATHS", None)
            code = """
import os
from fastapi.testclient import TestClient
from app import create_app, setup_parser
assert setup_parser().parse_args([]).port == 7877
app = create_app()
with TestClient(app) as client:
    response = client.get('/infinite_image_browsing/global_setting')
    assert response.status_code == 200, response.text
    assert response.json()['launch_mode'] == 'server'
    assert response.json()['is_win'] == (os.name == 'nt')
    assert os.path.isabs(response.json()['home'])
    assert 'sd_cwd' not in response.json()
    assert client.get('/').status_code == 200
    assert client.get('/openapi.json').status_code == 200
    assert '/infinite_image_browsing/send_img_path' not in {r.path for r in app.routes}
"""
            result = subprocess.run([sys.executable, "-X", "utf8", "-c", code],
                                    env=env, capture_output=True, text=True, encoding="utf-8", timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
