import sqlite3
import tempfile
import unittest
from pathlib import Path

from scripts.iib.db.datamodel import Image


class PickMediaTests(unittest.TestCase):
    def test_mixed_batch_includes_available_media_types_and_excludes_seen_paths(self):
        with tempfile.TemporaryDirectory() as folder:
            conn = sqlite3.connect(':memory:')
            try:
                Image.create_table(conn)
                for index in range(30):
                    path = Path(folder) / f'image-{index}.jpg'
                    path.touch()
                    Image(str(path)).save(conn)
                for name in ('video-1.mp4', 'video-2.webm', 'audio-1.mp3', 'audio-2.wav'):
                    path = Path(folder) / name
                    path.touch()
                    Image(str(path)).save(conn)
                conn.commit()

                first = Image.pick_random_media(conn, 12)
                self.assertEqual(len(first), 12)
                self.assertTrue(any(item.path.endswith('.jpg') for item in first))
                self.assertTrue(any(item.path.endswith(('.mp4', '.webm')) for item in first))
                self.assertTrue(any(item.path.endswith(('.mp3', '.wav')) for item in first))
                second = Image.pick_random_media(conn, 12, exclude_paths=[item.path for item in first])
                self.assertEqual(len(second), 12)
                self.assertFalse({item.path for item in first} & {item.path for item in second})
                self.assertEqual(len(Image.pick_random_media(conn, 10, 'audio')), 2)
            finally:
                conn.close()


if __name__ == '__main__':
    unittest.main()
