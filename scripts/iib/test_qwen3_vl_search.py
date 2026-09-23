"""Verify the separate Qwen index and rerank ordering without loading model weights."""

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from fastapi import FastAPI
from PIL import Image as PilImage

from scripts.iib import qwen3_vl_search as search
from scripts.iib.db.datamodel import DataBase, Image
from scripts.iib.similarity import SimilarityRequest


class Qwen3VLSearchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.old_db_path = DataBase.path
        DataBase.path = str(Path(self.temp.name) / "test.db")
        self.addCleanup(self.restore_db)
        self.folder = Path(self.temp.name) / "library"
        self.folder.mkdir()
        self.paths = [self.folder / "red.png", self.folder / "blue.png"]
        for path in self.paths:
            PilImage.new("RGB", (4, 4), "red" if path == self.paths[0] else "blue").save(path)
            Image(str(path), size=path.stat().st_size).save(DataBase.get_conn())
        DataBase.get_conn().commit()
        search._set_job(running=True, processed=0, total=0, failed=0, error="")

    def restore_db(self):
        if hasattr(DataBase.local, "conn"):
            DataBase.local.conn.close()
            del DataBase.local.conn
        DataBase.path = self.old_db_path

    def test_index_is_incremental_and_rerank_changes_order(self):
        vectors = {
            str(self.paths[0]): np.array([1, 0], dtype="<f4"),
            str(self.paths[1]): np.array([0, 1], dtype="<f4"),
        }
        trusted = lambda path: path.startswith(str(self.folder))
        with patch.object(search, "model_key", return_value="test-model"), \
             patch.object(search, "readiness", return_value=("ready", "")), \
             patch.object(search._embedding, "_load"), \
             patch.object(search._embedding, "vector", side_effect=lambda value, image: vectors[value] if image else np.array([0.9, 0.1], dtype="<f4")) as encode, \
             patch.object(search._reranker, "rerank", return_value=[0.1, 0.9]):
            search._run_index(trusted)
            self.assertEqual(encode.call_count, 2)
            self.assertEqual(search._job["failed"], 0)
            self.assertFalse(search._job["running"])
            search._run_index(trusted)
            self.assertEqual(encode.call_count, 2)

            app = FastAPI()
            search.mount_qwen3_vl_routes(app, "/db", lambda: None, lambda: None, trusted)
            endpoint = next(route.endpoint for route in app.routes if route.path == "/db/qwen3-vl/search")
            plain = endpoint(search.SearchRequest(query="color", folder_path=str(self.folder)))
            self.assertEqual([item["fullpath"] for item in plain["files"]], list(map(str, self.paths)))
            self.assertEqual(plain["checked"], 2)
            reranked = endpoint(search.SearchRequest(query="color", rerank=True, folder_path=str(self.folder)))
            self.assertEqual([item["fullpath"] for item in reranked["files"]], list(map(str, reversed(self.paths))))
            self.assertGreater(reranked["files"][0]["rerank_score"], reranked["files"][1]["rerank_score"])

            similar = search.search_similar_images(
                SimilarityRequest(path=str(self.paths[0]), method="qwen", minimum=0),
                str(self.paths[0]), trusted, str(self.paths[0]),
            )
            self.assertEqual([item["fullpath"] for item in similar["files"]], [str(self.paths[1])])
            self.assertEqual(similar["files"][0]["similarity"], 0)
            self.assertEqual(similar["method"], "qwen")
            self.assertEqual((similar["checked"], similar["matched"]), (1, 1))

            os.utime(self.paths[1], ns=(self.paths[1].stat().st_atime_ns, self.paths[1].stat().st_mtime_ns + 1_000_000_000))
            fresh = endpoint(search.SearchRequest(query="color"))
            self.assertEqual([item["fullpath"] for item in fresh["files"]], [str(self.paths[0])])
            self.assertEqual(search.search_similar_images(
                SimilarityRequest(path=str(self.paths[0]), method="qwen", minimum=0),
                str(self.paths[0]), trusted, str(self.paths[0]),
            )["skipped"], 1)
            Image.remove(DataBase.get_conn(), Image.get(DataBase.get_conn(), str(self.paths[0])).id)
            self.assertEqual(DataBase.get_conn().execute("SELECT COUNT(*) FROM image_qwen_visual_embedding").fetchone()[0], 1)

    def test_sharded_8b_weights_and_model_identity(self):
        folder = Path(self.temp.name) / "Qwen3-VL-Embedding-8B"
        folder.mkdir()
        (folder / "model.safetensors.index.json").write_text(json.dumps({
            "weight_map": {"layer.a": "model-00001-of-00002.safetensors",
                           "layer.b": "model-00002-of-00002.safetensors"},
        }))
        first = folder / "model-00001-of-00002.safetensors"
        second = folder / "model-00002-of-00002.safetensors"
        first.touch()
        with patch.object(search, "model_path", return_value=folder):
            self.assertEqual(search.weight_files(folder), [])
            second.touch()
            self.assertEqual(search.weight_files(folder), [first, second])
            self.assertEqual(search.model_id("embedding"), "Qwen/Qwen3-VL-Embedding-8B")
            self.assertIn("Qwen3-VL-Embedding-8B", search.model_key("embedding"))


if __name__ == "__main__":
    unittest.main()
