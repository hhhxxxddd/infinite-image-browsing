import base64
import io
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from scripts.iib.similarity import image_features, similarity_score, search_images, mount_similarity_routes


def sample_image():
    image = Image.new('RGB', (320, 240), '#e8ca91')
    draw = ImageDraw.Draw(image)
    draw.rectangle((15, 40, 155, 170), fill='#24456b')
    draw.ellipse((180, 65, 290, 210), fill='#43855b')
    return image


class SimilarityTests(unittest.TestCase):
    def test_resize_and_compression_rank_above_unrelated_image(self):
        original = io.BytesIO()
        sample_image().save(original, format='PNG')
        reference = image_features(io.BytesIO(original.getvalue()))
        compressed = io.BytesIO()
        sample_image().resize((160, 120)).save(compressed, format='JPEG', quality=65)
        unrelated = io.BytesIO()
        Image.new('RGB', (320, 240), '#cc22bb').save(unrelated, format='PNG')
        self.assertEqual(similarity_score(reference, reference), 100)
        near = similarity_score(reference, image_features(io.BytesIO(compressed.getvalue())))
        far = similarity_score(reference, image_features(io.BytesIO(unrelated.getvalue())))
        self.assertGreater(near, 85)
        self.assertGreater(near, far + 15)

    def test_cache_invalidates_and_missing_or_invalid_files_are_skipped(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'photo.png'
            sample_image().save(path)
            reference = image_features(path)
            cache = str(Path(folder) / 'cache.sqlite3')
            broken = Path(folder) / 'broken.png'
            broken.write_text('invalid')
            paths = [str(path), str(broken), str(Path(folder) / 'missing.png'), str(Path(folder) / 'video.mp4')]
            first = search_images(reference, paths, cache)
            self.assertEqual(first['files'][0]['similarity'], 100)
            self.assertEqual(first['skipped'], 2)
            self.assertEqual(first['cached'], 0)
            self.assertEqual(search_images(reference, paths, cache)['cached'], 1)
            previous = path.stat().st_mtime_ns
            Image.new('RGB', (320, 240), '#cc22bb').save(path)
            os.utime(path, ns=(previous + 1000000, previous + 1000000))
            updated = search_images(reference, [str(path)], cache, minimum=0)
            self.assertEqual(updated['cached'], 0)
            self.assertLess(updated['files'][0]['similarity'], 85)
            self.assertFalse(search_images(reference, [str(path)], cache, excluded_path=str(path.resolve()))['files'])

    def test_cache_handles_multiple_batches(self):
        with tempfile.TemporaryDirectory() as folder:
            sample = Path(folder) / 'sample.png'
            sample_image().save(sample)
            reference = image_features(sample)
            paths = []
            for index in range(270):
                path = Path(folder) / f'{index:03}.png'
                path.write_bytes(sample.read_bytes())
                paths.append(str(path))
            cache = str(Path(folder) / 'cache.sqlite3')
            with patch('scripts.iib.similarity.image_features', return_value=reference):
                first = search_images(reference, paths, cache, minimum=0, limit=2)
            self.assertEqual((first['checked'], first['cached'], first['matched'], len(first['files'])), (270, 0, 270, 2))
            self.assertEqual([Path(file['fullpath']).name for file in first['files']], ['000.png', '001.png'])
            with patch('scripts.iib.similarity.image_features', side_effect=AssertionError('Cache miss')):
                second = search_images(reference, paths, cache, minimum=0, limit=2)
            self.assertEqual((second['checked'], second['cached'], len(second['files'])), (270, 270, 2))

    def test_api_auth_validation_ranking_and_no_network(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            image_path = root / 'query.png'
            copy_path = root / 'copy.jpg'
            sample_image().save(image_path)
            sample_image().save(copy_path, quality=80)
            conn = sqlite3.connect(':memory:', check_same_thread=False)
            conn.execute('CREATE TABLE image (path TEXT)')
            conn.executemany('INSERT INTO image VALUES (?)', [(str(image_path),), (str(copy_path),)])
            app = FastAPI()

            def auth(request: Request):
                if request.headers.get('x-test-key') != 'local':
                    raise HTTPException(401)

            mount_similarity_routes(app, '/db', auth, lambda path: str(Path(path).resolve()).startswith(str(root) + os.sep))
            encoded = base64.b64encode(image_path.read_bytes()).decode()
            try:
                with patch('scripts.iib.similarity.DataBase.get_conn', return_value=conn), \
                     patch('scripts.iib.similarity.get_cache_dir', return_value=str(root)), \
                     patch('requests.sessions.Session.request', side_effect=AssertionError('Search must be offline')), \
                     TestClient(app) as client:
                    self.assertEqual(client.post('/db/similar_images', json={'image_base64': encoded}).status_code, 401)
                    client.headers['x-test-key'] = 'local'
                    response = client.post('/db/similar_images', json={'image_base64': encoded, 'minimum': 0, 'limit': 1})
                    self.assertEqual(response.status_code, 200, response.text)
                    result = response.json()
                    self.assertEqual(result['matched'], 2)
                    self.assertEqual(len(result['files']), 1)
                    self.assertEqual(result['files'][0]['similarity'], 100)
                    self.assertIn(result['files'][0]['fullpath'], [str(image_path), str(copy_path)])
                    by_path = client.post('/db/similar_images', json={'path': str(image_path), 'minimum': 0})
                    self.assertEqual(by_path.status_code, 200, by_path.text)
                    self.assertEqual(by_path.json()['files'][0]['fullpath'], str(copy_path))
                    self.assertEqual(client.post('/db/similar_images', json={'path': str(root.parent / 'outside.png')}).status_code, 403)
                    self.assertEqual(client.post('/db/similar_images', json={'image_base64': '???'}).status_code, 400)
                    self.assertEqual(client.post('/db/similar_images', json={'image_base64': base64.b64encode(b'not an image').decode()}).status_code, 400)
                    self.assertEqual(client.post('/db/similar_images', json={'image_base64': encoded, 'minimum': 101}).status_code, 422)
                    self.assertEqual(client.post('/db/similar_images', json={}).status_code, 400)
            finally:
                conn.close()


if __name__ == '__main__':
    unittest.main()
