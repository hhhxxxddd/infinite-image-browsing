"""ACL regression tests for filesystem operations and ancestor navigation."""

import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.tests.support.database import isolate_database, isolate_project_storage
from omnigallery.app import create_app
from omnigallery.infrastructure import route_context
from omnigallery.infrastructure.database import Database
from omnigallery.infrastructure.route_context import RouteContext
from omnigallery.library import file_routes, organize
from omnigallery.library.folder_repository import LibraryPath
from omnigallery.search.cache_repository import TopicClusterCache
from omnigallery.search.tag_graph import mount_tag_graph_routes
from omnigallery.search.topics import routes as topic_routes


class FilePathAccessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.allowed = self.base / "album"
        self.allowed.mkdir()
        self.outside = self.base / "other"
        self.outside.mkdir()
        isolate_database(self, self.base / "test.db")
        access_control = patch.object(route_context, "enable_access_control", True)
        access_control.start()
        self.addCleanup(access_control.stop)

        self.context = RouteContext()
        self.context.mem["all_scanned_paths"] = [str(self.allowed)]
        app = FastAPI()
        file_routes.mount_routes(app, self.context)

        async def start_cluster_job(**_kwargs):
            return "unused"

        async def get_cluster_job_status(_job_id):
            return {"status": "done", "result": {"clusters": [], "noise": []}}

        organize.mount_organize_routes(
            app=app,
            api_base="/api",
            verify_secret=lambda: None,
            write_permission_required=lambda: None,
            check_path_trust=self.context.check_path_trust,
            start_cluster_job_func=start_cluster_job,
            get_cluster_job_status_func=get_cluster_job_status,
        )
        topic_routes.mount_topic_cluster_routes(
            app=app,
            api_base="/api",
            verify_secret=lambda: None,
            write_permission_required=lambda: None,
            check_path_trust=self.context.check_path_trust,
            openai_base_url="https://example.invalid/v1",
            openai_api_key="unused",
            embedding_model="unused",
            ai_model="unused",
        )
        mount_tag_graph_routes(
            app=app,
            api_base="/api",
            verify_secret=lambda: None,
            check_path_trust=self.context.check_path_trust,
            is_path_trusted=self.context.is_path_trusted,
            embedding_model="unused",
            ai_model="unused",
            openai_base_url="",
            openai_api_key="",
        )
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_flatten_rejects_ancestor_without_touching_files_then_allows_root(self):
        nested = self.allowed / "nested"
        nested.mkdir()
        original = nested / "image.png"
        original.write_bytes(b"image")

        refused = self.client.post(
            "/api/flatten_folder", json={"folder_path": str(self.base), "dry_run": False}
        )
        self.assertEqual(refused.status_code, 403, refused.text)
        self.assertEqual(original.read_bytes(), b"image")
        self.assertFalse((self.base / "image.png").exists())

        accepted = self.client.post(
            "/api/flatten_folder", json={"folder_path": str(self.allowed), "dry_run": False}
        )
        self.assertEqual(accepted.status_code, 200, accepted.text)
        self.assertEqual(accepted.json()["moved_files"], 1)
        self.assertEqual((self.allowed / "image.png").read_bytes(), b"image")

    def test_ancestor_directory_listing_hides_siblings(self):
        (self.outside / "secret.png").write_bytes(b"secret")
        response = self.client.get("/api/files", params={"folder_path": str(self.base)})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([item["name"] for item in response.json()["files"]], [self.allowed.name])
        sibling = self.client.get("/api/files", params={"folder_path": str(self.outside)})
        self.assertEqual(sibling.status_code, 403, sibling.text)

    def test_copy_rejects_media_and_sidecar_collisions_without_partial_files(self):
        destination = self.allowed / "target"
        destination.mkdir()
        source = self.allowed / "photo.png"
        source.write_bytes(b"source")
        source.with_suffix(".txt").write_bytes(b"source metadata")
        target = destination / source.name
        target.write_bytes(b"existing")
        response = self.client.post(
            "/api/copy_files", json={"file_paths": [str(source)], "dest": str(destination)}
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(target.read_bytes(), b"existing")
        self.assertFalse(target.with_suffix(".txt").exists())
        target.unlink()
        target.with_suffix(".txt").write_bytes(b"existing metadata")
        response = self.client.post(
            "/api/copy_files", json={"file_paths": [str(source)], "dest": str(destination)}
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(target.exists())
        self.assertEqual(target.with_suffix(".txt").read_bytes(), b"existing metadata")
        self.assertEqual(source.read_bytes(), b"source")

    def test_copy_continue_on_error_copies_only_nonconflicting_media(self):
        destination = self.allowed / "target"
        destination.mkdir()
        first, second = self.allowed / "first.png", self.allowed / "second.png"
        first.write_bytes(b"first")
        second.write_bytes(b"second")
        (destination / first.name).write_bytes(b"existing")
        response = self.client.post(
            "/api/copy_files",
            json={
                "file_paths": [str(first), str(second)],
                "dest": str(destination),
                "continue_on_error": True,
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()["errors"]), 1)
        self.assertEqual((destination / first.name).read_bytes(), b"existing")
        self.assertEqual((destination / second.name).read_bytes(), b"second")

    def test_flatten_detects_existing_root_media_and_sidecars_before_mutation(self):
        nested = self.allowed / "nested"
        nested.mkdir()
        source = nested / "photo.png"
        source.write_bytes(b"source")
        source.with_suffix(".txt").write_bytes(b"metadata")
        for collision in (self.allowed / "photo.png", self.allowed / "photo.txt"):
            collision.write_bytes(b"existing")
            preview = self.client.post(
                "/api/flatten_folder",
                json={
                    "folder_path": str(self.allowed),
                    "dry_run": True,
                },
            )
            self.assertFalse(preview.json()["success"])
            self.assertIn(collision.name, preview.json()["conflicts"])
            response = self.client.post(
                "/api/flatten_folder",
                json={
                    "folder_path": str(self.allowed),
                    "dry_run": False,
                },
            )
            self.assertEqual(response.status_code, 400)
            self.assertEqual(collision.read_bytes(), b"existing")
            self.assertEqual(source.read_bytes(), b"source")
            self.assertEqual(source.with_suffix(".txt").read_bytes(), b"metadata")
            collision.unlink()

    def test_flatten_detects_shared_sidecar_names_across_media_formats(self):
        for folder, suffix in (("one", ".png"), ("two", ".jpg")):
            nested = self.allowed / folder
            nested.mkdir()
            (nested / ("photo" + suffix)).write_bytes(b"image")
            (nested / "photo.txt").write_bytes(folder.encode())
        preview = self.client.post(
            "/api/flatten_folder",
            json={
                "folder_path": str(self.allowed),
                "dry_run": True,
            },
        )
        self.assertFalse(preview.json()["success"])
        self.assertEqual(preview.json()["conflicts"], ["photo.txt"])

    def test_copy_move_and_delete_validate_every_path_before_mutation(self):
        source = self.allowed / "source.png"
        source.write_bytes(b"source")
        outside_file = self.outside / "other.png"
        outside_file.write_bytes(b"other")
        external_target = self.outside / "new-folder"

        moved = self.client.post(
            "/api/move_files",
            json={
                "file_paths": [str(source)],
                "dest": str(external_target),
                "create_dest_folder": True,
            },
        )
        self.assertEqual(moved.status_code, 403, moved.text)
        self.assertFalse(external_target.exists())
        self.assertEqual(source.read_bytes(), b"source")

        copied = self.client.post(
            "/api/copy_files",
            json={"file_paths": [str(source)], "dest": str(self.outside)},
        )
        self.assertEqual(copied.status_code, 403, copied.text)
        self.assertFalse((self.outside / source.name).exists())

        mixed = self.client.post(
            "/api/copy_files",
            json={"file_paths": [str(source), str(outside_file)], "dest": str(self.allowed)},
        )
        self.assertEqual(mixed.status_code, 403, mixed.text)
        self.assertFalse((self.allowed / outside_file.name).exists())
        self.assertEqual(source.read_bytes(), b"source")

        deleted = self.client.post(
            "/api/delete_files", json={"file_paths": [str(source), str(outside_file)]}
        )
        self.assertEqual(deleted.status_code, 403, deleted.text)
        self.assertEqual(source.read_bytes(), b"source")
        self.assertEqual(outside_file.read_bytes(), b"other")

    def test_organize_rejects_ancestor_source_and_external_destination(self):
        source = self.allowed / "source.png"
        source.write_bytes(b"source")
        external_target = self.outside / "new-folder"

        ancestor = self.client.post(
            "/api/organize_files_start", json={"folder_paths": [str(self.base)]}
        )
        self.assertEqual(ancestor.status_code, 403, ancestor.text)
        external_dest = self.client.post(
            "/api/organize_files_start",
            json={"folder_paths": [str(self.allowed)], "dest_folder": str(external_target)},
        )
        self.assertEqual(external_dest.status_code, 403, external_dest.text)
        self.assertFalse(external_target.exists())
        self.assertEqual(source.read_bytes(), b"source")

        job_id = uuid.uuid4().hex
        with organize._ORGANIZE_JOBS_LOCK:
            organize._ORGANIZE_JOBS[job_id] = {
                "status": "preview_ready",
                "preview": {
                    "dest_folder": str(self.allowed),
                    "all_mappings": [
                        {
                            "cluster_id": "a",
                            "src_path": str(source),
                            "dest_path": str(external_target / source.name),
                        }
                    ],
                },
            }
        self.addCleanup(organize._ORGANIZE_JOBS.pop, job_id, None)
        confirm = self.client.post("/api/organize_files_confirm", json={"job_id": job_id})
        self.assertEqual(confirm.status_code, 403, confirm.text)
        self.assertFalse(external_target.exists())
        self.assertEqual(source.read_bytes(), b"source")

    def test_topic_routes_reject_ancestor_before_recursive_or_background_work(self):
        requests = (
            ("/api/build_media_output_embeddings", {"folder": str(self.base)}),
            ("/api/cluster_media_output_cached", {"folder_paths": [str(self.base)]}),
            ("/api/cluster_media_output_job_start", {"folder_paths": [str(self.base)]}),
            (
                "/api/search_media_output_by_prompt",
                {"query": "test", "folder_paths": [str(self.base)]},
            ),
        )
        for endpoint, payload in requests:
            with self.subTest(endpoint=endpoint):
                response = self.client.post(endpoint, json=payload)
                self.assertEqual(response.status_code, 403, response.text)

    def test_tag_graph_checks_folder_and_filters_cached_paths(self):
        denied = self.client.post("/api/cluster_tag_graph", json={"folder_paths": [str(self.base)]})
        self.assertEqual(denied.status_code, 403, denied.text)

        allowed_file = self.allowed / "visible.png"
        hidden_file = self.outside / "hidden.png"
        allowed_file.write_bytes(b"visible")
        hidden_file.write_bytes(b"hidden")
        conn = Database.get_connection()
        TopicClusterCache.upsert(
            conn,
            cache_key="acl-cache",
            folders=[str(self.allowed)],
            model="unused",
            params={},
            embeddings_count=0,
            embeddings_max_updated_at="",
            result={"clusters": [{"id": "one", "paths": [str(allowed_file), str(hidden_file)]}]},
        )
        conn.commit()
        response = self.client.post(
            "/api/cluster_tag_graph_cluster_paths",
            json={"topic_cluster_cache_key": "acl-cache", "cluster_id": "one"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["paths"], [str(allowed_file)])


class StartupPathAccessTests(unittest.TestCase):
    def test_media_api_loads_saved_roots_without_global_settings_request(self):
        isolate_project_storage(self)
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        base = Path(temporary.name)
        allowed = base / "album"
        allowed.mkdir()
        image = allowed / "image.png"
        image.write_bytes(b"image")
        sibling = base / "other"
        sibling.mkdir()
        isolate_database(self, base / "test.db")
        conn = Database.get_connection()
        LibraryPath(str(allowed), ["walk"]).save(conn)
        conn.commit()

        access_control = patch.object(route_context, "enable_access_control", True)
        access_control.start()
        self.addCleanup(access_control.stop)

        app = create_app()
        self.assertEqual(app.state.context.mem["all_scanned_paths"], [])

        with TestClient(app) as client:
            response = client.get("/api/files", params={"folder_path": str(allowed)})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertIn(image.name, [item["name"] for item in response.json()["files"]])
            forbidden = client.get("/api/files", params={"folder_path": str(sibling)})
            self.assertEqual(forbidden.status_code, 403, forbidden.text)
