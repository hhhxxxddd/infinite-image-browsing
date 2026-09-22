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


if __name__ == '__main__':
    unittest.main()
