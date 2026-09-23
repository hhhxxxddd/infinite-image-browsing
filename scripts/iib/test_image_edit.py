import tempfile
import unittest
import sqlite3
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from PIL import Image, PngImagePlugin

from scripts.iib.image_edit import edit_image_copy
from scripts.iib.db.datamodel import DataBase, Image as DbImage, ImageTag, ImageAiNote, Tag
from scripts.iib.db.update_image_data import inherit_edited_image_data


class ImageEditTest(unittest.TestCase):
    def test_crop_resize_and_unique_copy_preserve_original(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "sample.png"
            with Image.new("RGB", (100, 80), "red") as image:
                image.paste("blue", (50, 0, 100, 80))
                image.save(source)
            crop = {"x": .5, "y": 0, "width": .5, "height": 1}
            first = Path(edit_image_copy(str(source), crop, 20, 10))
            second = Path(edit_image_copy(str(source), crop, 20, 10))

            self.assertEqual(first.name, "sample_edited.png")
            self.assertEqual(second.name, "sample_edited_2.png")
            with Image.open(first) as edited:
                self.assertEqual(edited.size, (20, 10))
                self.assertEqual(edited.getpixel((10, 5)), (0, 0, 255))
            with Image.open(source) as original:
                self.assertEqual(original.size, (100, 80))

    def test_rejects_crop_outside_image_and_oversized_output(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "sample.jpg"
            Image.new("RGB", (12, 12)).save(source)
            with self.assertRaisesRegex(ValueError, "裁剪区域"):
                edit_image_copy(str(source), {"x": .8, "y": 0, "width": .4, "height": 1}, 10, 10)
            with self.assertRaisesRegex(ValueError, "输出尺寸"):
                edit_image_copy(str(source), {"x": 0, "y": 0, "width": 1, "height": 1}, 16384, 16384)

    def test_embedded_generation_text_and_exif_survive(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "generated.png"
            metadata = PngImagePlugin.PngInfo()
            metadata.add_text("parameters", "a mountain\nSteps: 24, Seed: 17")
            metadata.add_text("workflow", '{"nodes": []}')
            Image.new("RGB", (100, 80)).save(source, pnginfo=metadata)
            edited = edit_image_copy(str(source), {"x": 0, "y": 0, "width": 1, "height": 1}, 50, 40)
            with Image.open(edited) as image:
                self.assertEqual(image.size, (50, 40))
                self.assertEqual(image.info["parameters"], "a mountain\nSteps: 24, Seed: 17")
                self.assertEqual(image.info["workflow"], '{"nodes": []}')

    def test_exif_and_generation_sidecar_survive(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "generated.jpg"
            exif = Image.Exif()
            exif[270] = "source description"
            Image.new("RGB", (100, 80)).save(source, exif=exif)
            source.with_suffix(".txt").write_text("original prompt", encoding="utf-8")
            edited = Path(edit_image_copy(str(source), {"x": 0, "y": 0, "width": 1, "height": 1}, 50, 40))
            with Image.open(edited) as image:
                self.assertEqual(image.getexif()[270], "source description")
                self.assertEqual(image.getexif()[256], 50)
                self.assertEqual(image.size, (50, 40))
            self.assertEqual(edited.with_suffix(".txt").read_text(encoding="utf-8"), "original prompt")

    def test_database_annotations_and_tags_survive_with_new_size(self):
        with closing(sqlite3.connect(":memory:")) as conn:
            ImageTag.create_table(conn)
            Tag.create_table(conn)
            DbImage.create_table(conn)
            ImageAiNote.create_table(conn)
            source = DbImage("source.png", "original generation", 123, "today", description="reference", width=100, height=80)
            edited = DbImage("source_edited.png", "parsed generation", 42, "now", width=50, height=40)
            source.save(conn)
            edited.save(conn)
            custom = Tag.get_or_create(conn, "风景", "custom")
            old_size = Tag.get_or_create(conn, "100 × 80", "size")
            for image in (source, edited):
                ImageTag(image.id, old_size.id).save(conn)
            ImageTag(source.id, custom.id).save(conn)
            conn.execute("INSERT INTO image_ai_note(image_id, inferred_prompt) VALUES (?, ?)", (source.id, "saved prompt"))
            with patch.object(DataBase, "get_conn", return_value=conn):
                inherit_edited_image_data(source.path, edited.path, 50, 40)
            result = DbImage.get(conn, edited.path)
            self.assertEqual((result.width, result.height), (50, 40))
            self.assertEqual(result.exif, "original generation")
            self.assertEqual(result.description, "reference")
            self.assertTrue(result.exif_edited)
            self.assertEqual(conn.execute("SELECT inferred_prompt FROM image_ai_note WHERE image_id = ?", (result.id,)).fetchone()[0], "saved prompt")
            tags = {(tag.name, tag.type) for tag in ImageTag.get_tags_for_image(conn, result.id)}
            self.assertIn(("风景", "custom"), tags)
            self.assertIn(("50 × 40", "size"), tags)
            self.assertNotIn(("100 × 80", "size"), tags)


if __name__ == "__main__":
    unittest.main()
