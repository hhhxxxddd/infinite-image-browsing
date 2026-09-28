import sqlite3
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np

from omnigallery.library.media_repository import Media
from omnigallery.search.embedding_repository import MediaVisualEmbedding
from omnigallery.search.visual_ranking import rank_visual_media


class VisualRankingTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.addCleanup(self.conn.close)
        Media.create_table(self.conn)
        MediaVisualEmbedding.create_table(self.conn)
        for media_id in range(1, 601):
            self.conn.execute(
                "INSERT INTO media(id,path,size,date,width,height) VALUES(?,?,2,'2026-01-01',4,4)",
                (media_id, f"/images/{media_id}.png"),
            )
            vector = np.array([media_id % 12 / 12, 0], dtype="<f4")
            self.conn.execute(
                "INSERT INTO media_qwen_visual_embedding VALUES(?, 'model', 1, 2, 2, ?)",
                (media_id, vector.tobytes()),
            )
        self.conn.commit()

    def rank(self, **kwargs):
        with patch(
            "omnigallery.search.visual_ranking.os.stat",
            return_value=SimpleNamespace(st_mtime_ns=1, st_size=2),
        ):
            return rank_visual_media(
                self.conn,
                ["q.model_key = ?"],
                ["model"],
                np.array([1, 0], dtype="<f4"),
                5,
                lambda p: True,
                **kwargs,
            )

    def test_ranks_across_batches_with_stable_ties(self):
        ranked, checked, skipped, matched = self.rank()
        self.assertEqual([item[1] for item in ranked], [599, 587, 575, 563, 551])
        self.assertEqual((checked, skipped, matched), (600, 0, 600))
        self.assertEqual(ranked[0][2].to_file_info()["width"], 4)

    def test_threshold_stale_vectors_malformed_vectors_and_nonfinite_values(self):
        self.conn.execute("UPDATE media_qwen_visual_embedding SET mtime_ns=0 WHERE media_id=599")
        self.conn.execute("UPDATE media_qwen_visual_embedding SET vec=x'00' WHERE media_id=587")
        self.conn.execute(
            "UPDATE media_qwen_visual_embedding SET vec=? WHERE media_id=575",
            (np.array([np.nan, 0], dtype="<f4").tobytes(),),
        )
        ranked, checked, skipped, matched = self.rank(minimum=90)
        self.assertEqual([item[1] for item in ranked], [563, 551, 539, 527, 515])
        self.assertEqual((checked, skipped, matched), (597, 3, 47))

    def test_cloud_only_candidates_are_filtered_per_batch(self):
        with patch(
            "omnigallery.search.visual_ranking.online_only_paths",
            side_effect=lambda paths, settings: {p for p in paths if p.endswith("/599.png")},
        ) as cloud:
            ranked, checked, _, _ = self.rank(sync_settings={})
        self.assertGreater(cloud.call_count, 1)
        self.assertEqual(checked, 599)
        self.assertEqual(ranked[0][1], 587)
