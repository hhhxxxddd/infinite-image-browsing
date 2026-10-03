import base64
import io
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from omnigallery.image_editing import history
from omnigallery.infrastructure.database import Database
from omnigallery.storage import project_files
from omnigallery.storage.layout import ApplicationStorage
from omnigallery.workspaces.artifacts import artifact_root


class ProjectStorageTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.layout = ApplicationStorage(self.root / "data")
        self.layout.prepare()
        self.addCleanup(self.layout.close)
        self.db = patch.multiple(
            Database, path=str(self.layout.root / "db/omnigallery.db"), local=threading.local()
        )
        self.db.start()
        self.addCleanup(self.db.stop)
        self.project = patch.object(
            project_files, "PROJECT_DATA_ROOT", self.layout.root / "project-data"
        )
        self.project.start()
        self.addCleanup(self.project.stop)
        self.addCleanup(self.close_database)
        Database.get_connection()

    def close_database(self):
        if hasattr(Database.local, "conn"):
            Database.local.conn.close()
            del Database.local.conn

    def test_editable_history_and_artifacts_resolve_after_application_migration(self):
        source = self.root / "source.png"
        Image.new("RGB", (20, 10), "red").save(source)
        rendered = io.BytesIO()
        Image.new("RGB", (20, 10), "blue").save(rendered, format="PNG")
        document = dict(
            version=2,
            layers=[dict(kind="image", path=str(source)), dict(kind="text", text="Retained")],
        )
        output = history.save_edit(
            str(source),
            document,
            "canvas",
            lambda _: None,
            crop=dict(x=0, y=0, width=1, height=1),
            target_width=20,
            target_height=10,
            rendered_base64=base64.b64encode(rendered.getvalue()).decode(),
        )
        before = history.latest(output)
        asset = artifact_root() / "workspace/material.png"
        asset.parent.mkdir(parents=True)
        asset.write_bytes(b"workspace")
        target = self.root / "new-data"
        self.layout.schedule(str(target))
        self.close_database()
        self.layout.close()
        restarted = ApplicationStorage(self.root / "data")
        self.addCleanup(restarted.close)
        restarted.prepare()
        self.assertEqual(restarted.root, target)
        with patch.object(project_files, "PROJECT_DATA_ROOT", target / "project-data"):
            after = history.latest(output)
            self.assertEqual(after, before)
            self.assertTrue(history.snapshot_path(after, after["source_asset"]).is_file())
            self.assertEqual(
                (artifact_root() / "workspace/material.png").read_bytes(), b"workspace"
            )
            self.assertTrue(project_files.is_project_storage_path(artifact_root()))
        self.assertTrue(asset.is_file())


if __name__ == "__main__":
    unittest.main()
