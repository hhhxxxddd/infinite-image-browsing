import base64
import copy
import io
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from backend.tests.support.database import isolate_project_storage
from omnigallery.image_editing import history as history
from omnigallery.infrastructure.database import Database
from omnigallery.library.indexing import update_image_data
from omnigallery.library.media_types import is_valid_media_path


class ImageEditHistoryTest(unittest.TestCase):
    def setUp(self):
        isolate_project_storage(self)
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.db = patch.multiple(Database, path=str(self.root / "test.db"), local=threading.local())
        self.db.start()
        self.source = self.root / "original.png"
        Image.new("RGB", (80, 60), "red").save(self.source)
        self.original = self.source.read_bytes()
        self.doc = dict(
            version=2,
            width=100,
            height=90,
            background="transparent",
            groups=[dict(id="group", name="Group")],
            layers=[
                dict(
                    id="photo",
                    kind="image",
                    name="photo",
                    path=str(self.source),
                    x=12,
                    y=8,
                    width=80,
                    height=60,
                    crop=dict(x=0.1, y=0.2, width=0.8, height=0.7),
                    rotation=12,
                    visible=False,
                    locked=True,
                ),
                dict(id="text", kind="text", text="Editable text", groupId="group", x=20, y=30),
            ],
        )

    def tearDown(self):
        if hasattr(Database.local, "conn"):
            Database.local.conn.close()
        self.db.stop()
        self.temp.cleanup()

    def save(
        self, path=None, document=None, overwrite=False, parent=None, color="blue", copy_name=None
    ):
        output = io.BytesIO()
        Image.new("RGBA", (40, 30), color).save(output, format="PNG")
        return history.save_edit(
            str(path or self.source),
            document or self.doc,
            "content",
            lambda path: None,
            parent if parent is not None else history.digest_file(path or self.source),
            crop=dict(x=0, y=0, width=1, height=1),
            target_width=40,
            target_height=30,
            overwrite=overwrite,
            rendered_base64=base64.b64encode(output.getvalue()).decode(),
            copy_name=copy_name,
        )

    def test_named_copy_keeps_original_revision_available_for_overwrite(self):
        self.save(overwrite=True)
        original_record = history.latest(self.source)
        original_bytes = self.source.read_bytes()
        output = Path(
            self.save(parent=original_record["output_hash"], copy_name="original_副本.png")
        )
        copy_bytes = output.read_bytes()
        copy_record = history.latest(output)
        self.assertEqual(self.source.read_bytes(), original_bytes)
        self.assertEqual(history.latest(self.source), original_record)
        self.assertNotEqual(copy_record["id"], original_record["id"])
        with self.assertRaisesRegex(ValueError, "同名文件已存在"):
            self.save(parent=original_record["output_hash"], copy_name=output.name)
        self.assertEqual(len(list((history.history_root() / "records").glob("*.json"))), 2)
        self.save(overwrite=True, parent=original_record["output_hash"], color="green")
        with Image.open(self.source) as image:
            self.assertEqual(image.getpixel((0, 0)), (0, 128, 0, 255))
        self.assertEqual(history.latest(self.source)["id"], original_record["id"])
        self.assertEqual(output.read_bytes(), copy_bytes)
        self.assertEqual(history.latest(output), copy_record)

    def test_copy_restores_document_after_sources_removed_and_file_renamed(self):
        output = Path(self.save())
        self.assertEqual(self.source.read_bytes(), self.original)
        record = history.latest(output)
        self.assertEqual(record["document"]["groups"], self.doc["groups"])
        restored = record["document"]["layers"]
        self.assertEqual(restored[1], self.doc["layers"][1])
        self.assertEqual(restored[0]["crop"], self.doc["layers"][0]["crop"])
        self.assertFalse(restored[0]["visible"])
        self.source.unlink()
        renamed = output.with_name("renamed.png")
        output.rename(renamed)
        self.assertEqual(history.latest(renamed)["id"], record["id"])
        snapshot = history.snapshot_path(record, restored[0]["path"].removeprefix("snapshot:"))
        self.assertEqual(snapshot.read_bytes(), self.original)
        asset = history.public_record(record, str(renamed))["asset_info"][
            "snapshot:" + record["source_asset"]
        ]
        self.assertEqual((asset["width"], asset["height"]), (80, 60))
        self.assertFalse(is_valid_media_path(str(snapshot)))

    def test_identical_bmp_copies_have_independent_editable_records_after_rename(self):
        first = Path(self.save(copy_name="one.bmp"))
        first_record = history.latest(first)
        changed = copy.deepcopy(self.doc)
        changed["layers"][1]["text"] = "other document"
        second = Path(self.save(document=changed, copy_name="two.bmp"))
        self.assertNotEqual(first.read_bytes(), second.read_bytes())
        self.assertEqual(history.latest(first), first_record)
        self.assertNotEqual(history.latest(second)["id"], first_record["id"])
        renamed = first.with_name("renamed.bmp")
        first.rename(renamed)
        self.assertEqual(history.latest(renamed), first_record)
        with Image.open(renamed) as media:
            self.assertEqual(media.size, (40, 30))
            self.assertEqual(media.convert("RGB").getpixel((0, 0)), (0, 0, 255))

    def test_stale_original_and_saved_versions_cannot_overwrite_current_edit(self):
        initial_version = history.digest_file(self.source)
        self.save(overwrite=True, parent=initial_version)
        first = history.latest(self.source)
        self.save(document=first["document"], overwrite=True, parent=first["output_hash"])
        current = history.latest(self.source)
        self.assertNotEqual(first["output_hash"], current["output_hash"])
        before = self.source.read_bytes()
        for stale in (initial_version, first["output_hash"], first["id"]):
            with self.subTest(stale=stale), self.assertRaisesRegex(ValueError, "重新打开"):
                self.save(overwrite=True, parent=stale, color="green")
            self.assertEqual(self.source.read_bytes(), before)
            self.assertEqual(history.latest(self.source), current)

    def test_external_changes_to_an_unedited_original_reject_a_stale_save(self):
        initial_version = history.digest_file(self.source)
        Image.new("RGB", (80, 60), "green").save(self.source)
        before = self.source.read_bytes()
        with self.assertRaisesRegex(ValueError, "重新打开"):
            self.save(overwrite=True, parent=initial_version)
        self.assertEqual(self.source.read_bytes(), before)
        self.assertIsNone(history.latest(self.source))

    def test_original_changed_during_snapshot_preparation_is_not_overwritten(self):
        version = history.digest_file(self.source)
        prepare = history.prepare

        def prepare_then_modify(*args, **kwargs):
            record = prepare(*args, **kwargs)
            Image.new("RGB", (80, 60), "green").save(self.source)
            return record

        with (
            patch.object(history, "prepare", side_effect=prepare_then_modify),
            self.assertRaisesRegex(ValueError, "重新打开"),
        ):
            self.save(overwrite=True, parent=version)
        with Image.open(self.source) as media:
            self.assertEqual(media.getpixel((0, 0)), (0, 128, 0))
        self.assertIsNone(history.latest(self.source))

    def test_repeated_overwrite_updates_one_record_and_reuses_original(self):
        self.save(overwrite=True)
        first = history.latest(self.source)
        for index in range(3):
            doc = copy.deepcopy(first["document"])
            doc["layers"][1]["text"] = str(index)
            self.save(document=doc, overwrite=True, parent=history.digest_file(self.source))
        current = history.latest(self.source)
        self.assertEqual(current["id"], first["id"])
        self.assertEqual(current["document"]["layers"][1]["text"], "2")
        self.assertEqual(len(list((history.history_root() / "records").glob("*.json"))), 1)
        self.assertEqual(len(list((history.history_root() / "outputs").glob("*.json"))), 1)
        self.assertEqual(len(list((history.history_root() / "assets").glob("*.blob"))), 1)
        self.assertEqual(
            history.snapshot_path(current, current["source_asset"]).read_bytes(), self.original
        )

    def test_copy_has_independent_record_and_shared_snapshots_survive_cleanup(self):
        self.save(overwrite=True)
        first = history.latest(self.source)
        output = self.save(document=first["document"], parent=first["output_hash"])
        second = history.latest(output)
        self.assertNotEqual(first["id"], second["id"])
        doc = copy.deepcopy(first["document"])
        doc["layers"] = [doc["layers"][1]]
        self.save(document=doc, overwrite=True, parent=first["output_hash"])
        self.assertEqual(len(list((history.history_root() / "records").glob("*.json"))), 2)
        self.assertEqual(history.latest(output)["document"], second["document"])
        self.assertTrue(history.snapshot_path(second, second["source_asset"]).exists())

    def test_removed_material_snapshot_is_collected(self):
        extra = self.root / "extra.png"
        Image.new("RGB", (10, 10), "green").save(extra)
        doc = copy.deepcopy(self.doc)
        doc["layers"].append(dict(kind="image", path=str(extra)))
        self.save(document=doc, overwrite=True)
        record = history.latest(self.source)
        self.assertEqual(len(list((history.history_root() / "assets").glob("*.blob"))), 2)
        doc = record["document"]
        doc["layers"].pop()
        self.save(document=doc, overwrite=True, parent=record["output_hash"])
        self.assertEqual(len(list((history.history_root() / "assets").glob("*.blob"))), 1)

    def test_record_write_failure_preserves_file_and_previous_record(self):
        self.save(overwrite=True)
        before = self.source.read_bytes()
        record = history.latest(self.source)
        with patch.object(history, "_json", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                self.save(
                    document=record["document"],
                    overwrite=True,
                    parent=record["output_hash"],
                    color="green",
                )
        self.assertEqual(self.source.read_bytes(), before)
        self.assertEqual(history.latest(self.source), record)

    def test_image_publish_failure_rolls_back_record(self):
        self.save(overwrite=True)
        before = self.source.read_bytes()
        record = history.latest(self.source)
        real_replace = history.os.replace

        def replace(src, dst):
            if Path(dst).resolve() == self.source.resolve():
                raise OSError("file busy")
            return real_replace(src, dst)

        with patch("os.replace", replace):
            with self.assertRaises(OSError):
                self.save(
                    document=record["document"],
                    overwrite=True,
                    parent=record["output_hash"],
                    color="green",
                )
        self.assertEqual(self.source.read_bytes(), before)
        self.assertEqual(history.latest(self.source), record)

    def test_scan_skips_storage_even_when_it_contains_image_extension(self):
        self.save()
        Image.new("RGB", (8, 8), "red").save(history.history_root() / "accidental.png")
        update_image_data([str(self.root)])
        paths = [row[0] for row in Database.get_connection().execute("SELECT path FROM media")]
        self.assertTrue(paths)
        self.assertFalse(any(history.is_history_path(path) for path in paths))

    def test_unrelated_snapshot_is_rejected_and_sources_require_permission(self):
        doc = copy.deepcopy(self.doc)
        doc["layers"][0]["path"] = "snapshot:" + "a" * 64
        with self.assertRaises(ValueError):
            self.save(document=doc)
        with self.assertRaises(PermissionError):
            history.prepare(
                str(self.source),
                self.doc,
                "content",
                lambda _: (_ for _ in ()).throw(PermissionError()),
            )


if __name__ == "__main__":
    unittest.main()
