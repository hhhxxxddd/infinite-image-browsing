"""Exercise the separated embedding, clustering, and job services together."""

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from backend.tests.support.database import isolate_database, isolate_project_storage
from omnigallery.infrastructure.database import Database
from omnigallery.library.media_repository import Media
from omnigallery.search.topics import embedding_requests, jobs, titles, vectors
from omnigallery.search.topics.cluster_service import ClusteringService
from omnigallery.search.topics.configuration import TopicSearchConfig
from omnigallery.search.topics.embedding_service import EmbeddingService
from omnigallery.search.topics.job_service import ClusterJobService
from omnigallery.search.topics.schemas import ClusterMediaOutputRequest


class TopicServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        isolate_project_storage(self)
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        isolate_database(self, self.root / "test.db")
        self.config = TopicSearchConfig(
            "https://example.invalid/v1", "test", "embedding-test", "title-test"
        )
        self.embedding = EmbeddingService(self.config)
        self.clustering = ClusteringService(self.config)
        self.job = ClusterJobService(self.config, self.embedding, self.clustering)
        connection = Database.get_connection()
        self.media_paths = []
        for index in range(2):
            path = self.root / f"{index}.png"
            path.touch()
            Media(str(path), exif=f"orange cat portrait {index}").save(connection)
            self.media_paths.append(str(path))
        connection.commit()

    async def test_embedding_cache_and_cluster_titles_survive_service_boundaries(self):
        response = AsyncMock(return_value=[[1.0, 0.0], [0.999, 0.01]])
        args = dict(
            folder=str(self.root),
            model="embedding-test",
            force=False,
            batch_size=64,
            max_chars=4000,
        )
        with patch.object(embedding_requests, "_call_embeddings", response):
            first = await self.embedding.build_folder(**args)
            second = await self.embedding.build_folder(**args)
        self.assertEqual(first["updated"], 2)
        self.assertEqual(second["updated"], 0)
        response.assert_awaited_once()
        request = ClusterMediaOutputRequest(folder_paths=[str(self.root)], lang="zhHans")
        with patch.object(
            titles, "_call_chat_title", AsyncMock(return_value={"title": "猫", "keywords": ["猫"]})
        ) as title:
            result = await self.clustering.cluster(request, [str(self.root)])
            again = await self.clustering.cluster(request, [str(self.root)])
        self.assertEqual(result["count"], 2)
        self.assertEqual(result["clusters"][0]["title"], "猫")
        self.assertEqual(set(result["clusters"][0]["paths"]), set(self.media_paths))
        self.assertEqual(again["clusters"], result["clusters"])
        title.assert_awaited_once()
        self.assertEqual(title.call_args.kwargs["output_lang"], "Chinese (Simplified)")

    async def test_job_coordinates_services_and_reports_done(self):
        request = ClusterMediaOutputRequest(folder_paths=[str(self.root)])
        job_id = self.root.name
        with (
            patch.object(
                embedding_requests,
                "_call_embeddings",
                AsyncMock(return_value=[[1.0, 0.0], [1.0, 0.0]]),
            ),
            patch.object(
                titles,
                "_call_chat_title",
                AsyncMock(return_value={"title": "Cats", "keywords": ["cat"]}),
            ),
        ):
            await self.job.run(job_id, request)
        state = jobs.get_cluster_job_status(job_id)
        self.assertEqual(state["status"], "done", state)
        self.assertEqual(state["result"]["clusters"][0]["size"], 2)

    async def test_large_collection_clusters_exactly_without_optional_hnsw(self):
        connection = Database.get_connection()
        # Cross the ANN threshold with 65 orthogonal topics and a duplicate of the first.
        for index in range(2, 66):
            path = self.root / f"{index}.png"
            path.touch()
            Media(str(path), exif=f"test topic {index}").save(connection)
        connection.commit()
        embeddings = [[float(axis == index) for axis in range(65)] for index in range(65)]
        embeddings.append(embeddings[0].copy())
        with patch.object(
            embedding_requests, "_call_embeddings", AsyncMock(return_value=embeddings)
        ):
            await self.embedding.build_folder(
                folder=str(self.root),
                model="embedding-test",
                force=False,
                batch_size=128,
                max_chars=4000,
            )
        request = ClusterMediaOutputRequest(
            folder_paths=[str(self.root)],
            min_cluster_size=1,
            threshold=0.9,
        )
        with (
            patch.dict(sys.modules, {"hnswlib": None}),
            patch.object(vectors, "_VECTOR_DEPS_READY", False),
            patch.object(vectors, "_hnswlib", None),
            patch.object(vectors, "_np", None),
            patch.object(vectors, "_build_hnsw_index") as build_index,
            patch.object(
                titles,
                "_call_chat_title",
                AsyncMock(return_value={"title": "Topic", "keywords": []}),
            ),
        ):
            result = await self.clustering.cluster(request, [str(self.root)])
            self.assertFalse(vectors._has_hnsw_index())
        build_index.assert_not_called()
        self.assertEqual(result["count"], 66)
        self.assertEqual(len(result["clusters"]), 65)
        self.assertEqual(result["clusters"][0]["size"], 2)
        self.assertEqual(result["noise"], [])
