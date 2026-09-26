import base64
import io
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from PIL import Image, PngImagePlugin

from scripts.iib.db.datamodel import (
    DataBase,
    ImageAiNote,
    ImageQwenVisualEmbedding,
    ImageTag,
    ImageVisualEmbedding,
    Tag,
)
from scripts.iib.db.datamodel import Image as DbImage
from scripts.iib.db.update_image_data import (
    inherit_edited_image_data,
    refresh_overwritten_image_data,
)
from scripts.iib.image_edit import edit_image_copy


class ImageEditTest(unittest.TestCase):
    def test_composed_image_copy_and_overwrite_preserve_metadata(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "original.png"
            metadata = PngImagePlugin.PngInfo()
            metadata.add_text("parameters", "original prompt")
            Image.new("RGB", (100, 80), "red").save(source, pnginfo=metadata)
            original_bytes = source.read_bytes()
            rendered = io.BytesIO()
            Image.new("RGBA", (25, 40), (0, 100, 255, 128)).save(rendered, format="PNG")
            payload = base64.b64encode(rendered.getvalue()).decode("ascii")
            for overwrite in (False, True):
                result = edit_image_copy(str(source), {"x": 0, "y": 0, "width": 1, "height": 1}, 25, 40,
                                         overwrite=overwrite, rendered_base64=payload)
                with Image.open(result) as image:
                    self.assertEqual(image.size, (25, 40))
                    self.assertEqual(image.getpixel((0, 0)), (0, 100, 255, 128))
                    self.assertEqual(image.text["parameters"], "original prompt")
                if not overwrite:
                    self.assertNotEqual(Path(result), source)
                    self.assertEqual(source.read_bytes(), original_bytes)

    def test_composed_jpeg_copy_preserves_alpha_in_png_and_overwrite_flattens_white(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "original.jpg"
            Image.new("RGB", (10, 10), "red").save(source)
            rendered = io.BytesIO()
            Image.new("RGBA", (10, 10), (0, 0, 0, 0)).save(rendered, format="PNG")
            payload = base64.b64encode(rendered.getvalue()).decode("ascii")
            crop = {"x": 0, "y": 0, "width": 1, "height": 1}
            copy = edit_image_copy(str(source), crop, 10, 10, rendered_base64=payload)
            self.assertEqual(Path(copy).suffix, ".png")
            with Image.open(copy) as image:
                self.assertEqual(image.getpixel((0, 0))[3], 0)
            edit_image_copy(str(source), crop, 10, 10, overwrite=True, rendered_base64=payload)
            with Image.open(source) as image:
                self.assertEqual(image.format, "JPEG")
                self.assertEqual(image.getpixel((0, 0)), (255, 255, 255))

    def test_invalid_composition_never_replaces_source(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "original.png"
            Image.new("RGB", (100, 80)).save(source)
            original_bytes = source.read_bytes()
            rendered = io.BytesIO()
            Image.new("RGB", (2, 2)).save(rendered, format="PNG")
            for payload in ("not base64!", base64.b64encode(rendered.getvalue()).decode("ascii")):
                with self.assertRaises(ValueError):
                    edit_image_copy(str(source), {"x": 0, "y": 0, "width": 1, "height": 1}, 25, 40,
                                    overwrite=True, rendered_base64=payload)
                self.assertEqual(source.read_bytes(), original_bytes)
                self.assertEqual(list(Path(folder).iterdir()), [source])

    def test_overwrite_preserves_format_and_sidecar(self):
        with tempfile.TemporaryDirectory() as folder:
            for suffix, format_name in [(".png", "PNG"), (".jpg", "JPEG"), (".webp", "WEBP"), (".bmp", "BMP"), (".tiff", "TIFF")]:
                with self.subTest(format=format_name):
                    source = Path(folder) / f"sample{suffix}"
                    Image.new("RGB", (100, 80), "red").save(source)
                    source.with_suffix(".txt").write_text("keep prompt", encoding="utf-8")
                    result = edit_image_copy(str(source), {"x": 0, "y": 0, "width": .5, "height": 1}, 25, 40, overwrite=True)
                    self.assertEqual(Path(result), source)
                    with Image.open(source) as image:
                        self.assertEqual((image.size, image.format), ((25, 40), format_name))
                    self.assertEqual(source.with_suffix(".txt").read_text(encoding="utf-8"), "keep prompt")
                    self.assertFalse(list(Path(folder).glob("*.tmp")))

    def test_failed_overwrite_keeps_original_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "sample.png"
            Image.new("RGB", (100, 80)).save(source)
            original = source.read_bytes()
            for target in ("PIL.Image.Image.save", "scripts.iib.image_edit.os.replace"):
                with self.subTest(target=target), patch(target, side_effect=OSError("write failed")), self.assertRaises(OSError):
                    edit_image_copy(str(source), {"x": 0, "y": 0, "width": 1, "height": 1}, 50, 40, overwrite=True)
                self.assertEqual(source.read_bytes(), original)
                self.assertEqual(list(Path(folder).iterdir()), [source])

    def test_overwrite_keeps_database_id_and_annotations(self):
        with tempfile.TemporaryDirectory() as folder, closing(sqlite3.connect(":memory:")) as conn:
            for table in (DbImage, Tag, ImageTag, ImageAiNote, ImageVisualEmbedding, ImageQwenVisualEmbedding):
                table.create_table(conn)
            path = Path(folder) / "sample.png"
            Image.new("RGB", (50, 40)).save(path)
            original = DbImage(str(path), "manual generation", 123, "old", description="saved description", width=100, height=80)
            original.save(conn)
            custom = Tag.get_or_create(conn, "风景", "custom")
            size = Tag.get_or_create(conn, "100 × 80", "size")
            for tag in (custom, size):
                ImageTag(original.id, tag.id).save(conn)
            conn.execute("INSERT INTO image_ai_note VALUES (?, ?)", (original.id, "saved prompt"))
            with patch.object(DataBase, "get_conn", return_value=conn):
                refresh_overwritten_image_data(str(path), 50, 40)
            result = DbImage.get(conn, str(path))
            self.assertEqual(result.id, original.id)
            self.assertEqual((result.width, result.height, result.size), (50, 40, path.stat().st_size))
            self.assertEqual((result.description, result.exif), ("saved description", "manual generation"))
            self.assertEqual(conn.execute("SELECT inferred_prompt FROM image_ai_note").fetchone()[0], "saved prompt")
            self.assertEqual({tag.name for tag in ImageTag.get_tags_for_image(conn, original.id)}, {"风景", "50 × 40"})

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
