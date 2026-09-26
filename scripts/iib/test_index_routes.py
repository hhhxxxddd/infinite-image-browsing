import base64
import io
import asyncio
import os
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from fastapi import FastAPI, HTTPException
from scripts.iib import api
from scripts.iib.db.datamodel import DataBase


class IndexRouteTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_patch = patch.multiple(DataBase, path=os.path.join(self.temp.name, 'test.db'), local=threading.local())
        self.db_patch.start()
        self.app = FastAPI()
        api.infinite_image_browsing_api(self.app)

    def tearDown(self):
        if hasattr(DataBase.local, 'conn'):
            DataBase.local.conn.close()
        self.db_patch.stop()
        self.temp.cleanup()

    def endpoint(self, suffix):
        return next(route.endpoint for route in self.app.routes if route.path.endswith(suffix))

    async def test_scan_and_rebuild_are_serial_and_off_event_loop(self):
        active = 0
        peak = 0
        threads = []
        main_thread = threading.get_ident()
        def work(*args, **kwargs):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            threads.append(threading.get_ident())
            try:
                time.sleep(0.03)
            finally:
                active -= 1
                if hasattr(DataBase.local, 'conn'):
                    DataBase.local.conn.close()
                    del DataBase.local.conn
        with patch.object(api, 'update_image_data', work), patch.object(api, 'rebuild_image_index', work):
            await asyncio.gather(self.endpoint('/update_image_data')(), self.endpoint('/rebuild_index')())
        self.assertEqual(peak, 1)
        self.assertEqual(len(threads), 2)
        self.assertTrue(all(thread != main_thread for thread in threads))
        self.assertFalse(DataBase._initing)

    async def test_scan_failure_releases_lock_for_retry(self):
        def fail(*args):
            if hasattr(DataBase.local, 'conn'):
                DataBase.local.conn.close()
                del DataBase.local.conn
            raise RuntimeError('test failure')
        with patch.object(api, 'update_image_data', fail):
            for _ in range(2):
                with self.assertRaises(RuntimeError):
                    await asyncio.wait_for(self.endpoint('/update_image_data')(), timeout=2)
        self.assertFalse(DataBase._initing)

    async def test_empty_folder_delete_and_nonempty_refusal(self):
        empty = os.path.join(self.temp.name, 'empty')
        occupied = os.path.join(self.temp.name, 'occupied')
        os.mkdir(empty)
        os.mkdir(occupied)
        file = os.path.join(occupied, 'keep.txt')
        with open(file, 'w') as stream:
            stream.write('keep')
        with patch.object(api, 'enable_access_control', False):
            await self.endpoint('/delete_files')(SimpleNamespace(file_paths=[empty]))
            self.assertFalse(os.path.exists(empty))
            with self.assertRaises(HTTPException):
                await self.endpoint('/delete_files')(SimpleNamespace(file_paths=[occupied]))
            self.assertTrue(os.path.isfile(file))

    async def test_composed_save_restores_record_and_authorizes_snapshot(self):
        from PIL import Image as PillowImage
        source = os.path.join(self.temp.name, 'editable.png')
        PillowImage.new('RGB', (20, 10), 'red').save(source)
        rendered = io.BytesIO()
        PillowImage.new('RGBA', (20, 10), 'blue').save(rendered, format='PNG')
        endpoint = self.endpoint('/edit_image')
        request_type = endpoint.__annotations__['req']
        doc = dict(version=2, layers=[dict(kind='image', path=source), dict(kind='text', text='retained')])
        with patch.object(api, 'enable_access_control', False):
            result = endpoint(request_type(path=source, crop=dict(x=0, y=0, width=1, height=1), width=20, height=10,
                rendered_base64=base64.b64encode(rendered.getvalue()).decode(), editor_document=doc))
            owner = result['file']['fullpath']
            record = self.endpoint('/image_edit_history')(owner)['record']
            self.assertEqual(record['document']['layers'][1]['text'], 'retained')
            asset = next(iter(record['asset_info'].values()))['edit_snapshot']
            response = self.endpoint('/image_edit_asset')(owner, asset['revision'], asset['asset'])
            self.assertEqual(response.media_type, 'image/png')
            with self.assertRaises(HTTPException):
                self.endpoint('/image_edit_asset')(source, asset['revision'], asset['asset'])
            with self.assertRaises(HTTPException):
                self.endpoint('/image_edit_asset')(owner, asset['revision'], '../invalid')

    async def test_crop_save_copy_and_overwrite_keep_original_index_identity(self):
        from PIL import Image as PillowImage
        from scripts.iib.db.datamodel import Image, Tag, ImageTag

        source = os.path.join(self.temp.name, 'original.png')
        PillowImage.new('RGB', (100, 80), 'red').save(source)
        api.add_image_data_single(source)
        conn = DataBase.get_conn()
        original = Image.get(conn, source)
        original.update_description(conn, 'keep description')
        original.update_exif(conn, 'manual prompt')
        tag = Tag.get_or_create(conn, 'kept', 'custom')
        ImageTag(original.id, tag.id).save(conn)
        conn.commit()
        endpoint = self.endpoint('/edit_image')
        request_type = endpoint.__annotations__['req']
        body = dict(path=source, crop=dict(x=0, y=0, width=1, height=1), width=50, height=40)
        with patch.object(api, 'enable_access_control', False):
            copy = endpoint(request_type(**body))['file']
            self.assertNotEqual(copy['fullpath'], source)
            with PillowImage.open(source) as image:
                self.assertEqual(image.size, (100, 80))
            rendered = io.BytesIO()
            PillowImage.new('RGBA', (50, 40), (0, 100, 255, 128)).save(rendered, format='PNG')
            result = endpoint(request_type(**body, overwrite=True,
                rendered_base64=base64.b64encode(rendered.getvalue()).decode('ascii')))['file']
        self.assertEqual(result['fullpath'], source)
        with PillowImage.open(source) as image:
            self.assertEqual(image.size, (50, 40))
            self.assertEqual(image.getpixel((0, 0)), (0, 100, 255, 128))
        saved = Image.get(conn, source)
        self.assertEqual(saved.id, original.id)
        self.assertEqual((saved.description, saved.exif), ('keep description', 'manual prompt'))
        self.assertIn(tag.id, [entry.id for entry in ImageTag.get_tags_for_image(conn, saved.id)])


if __name__ == '__main__':
    unittest.main()
