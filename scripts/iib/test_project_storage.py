import base64
import io
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image
from scripts.iib import project_storage as storage, image_edit_history as history
from scripts.iib.db.datamodel import DataBase
from scripts.iib.workspace_artifacts import artifact_root


class ProjectStorageTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.db = patch.multiple(DataBase, path=str(self.root / 'test.db'), local=threading.local())
        self.db.start()
        DataBase.get_conn()

    def tearDown(self):
        if hasattr(DataBase.local, 'conn'):
            DataBase.local.conn.close()
        self.db.stop()
        self.temp.cleanup()

    def test_packaged_default_uses_executable_directory(self):
        with patch.object(storage, 'is_exe_ver', True), patch.object(storage.sys, 'executable', str(self.root / 'app' / 'gallery.exe')):
            self.assertEqual(storage.default_root(), self.root / 'app' / 'iib-project-data')

    def test_legacy_kept_until_explicit_migration_and_both_stores_move(self):
        legacy = self.root / 'iib-workspace-artifacts'
        legacy.mkdir()
        (legacy / 'material.png').write_bytes(b'workspace bytes')
        edit = self.root / 'iib-edit-history'
        edit.mkdir()
        (edit / 'record.json').write_text('{"retained":true}')
        self.assertTrue(storage.storage_settings()['legacy'])
        self.assertEqual(artifact_root(), legacy)
        result = storage.migrate_storage('')
        target = storage.default_root()
        self.assertEqual(result['files'], 2)
        self.assertEqual(artifact_root(), target / 'iib-workspace-artifacts')
        self.assertEqual((artifact_root() / 'material.png').read_bytes(), b'workspace bytes')
        self.assertEqual((history.history_root() / 'record.json').read_text(), '{"retained":true}')
        self.assertTrue(legacy.exists())
        self.assertTrue(storage.is_project_storage_path(str(legacy)))
        self.assertTrue(storage.is_project_storage_path(str(artifact_root())))
        self.assertFalse(storage.is_project_storage_path(str(self.root / 'ordinary-media')))

    def test_editable_record_still_resolves_after_migration(self):
        source = self.root / 'source.png'
        Image.new('RGB', (20, 10), 'red').save(source)
        rendered = io.BytesIO()
        Image.new('RGB', (20, 10), 'blue').save(rendered, format='PNG')
        doc = dict(version=2, layers=[dict(kind='image', path=str(source)), dict(kind='text', text='Retained')])
        output = history.save_edit(str(source), doc, 'canvas', lambda _: None,
            crop=dict(x=0, y=0, width=1, height=1), target_width=20, target_height=10,
            rendered_base64=base64.b64encode(rendered.getvalue()).decode())
        record = history.latest(output)
        storage.migrate_storage(str(self.root / 'other-disk'))
        restored = history.latest(output)
        self.assertEqual(restored, record)
        self.assertTrue(history.snapshot_path(restored, restored['source_asset']).is_file())
        self.assertEqual(storage.storage_settings()['directory'], str(self.root / 'other-disk'))

    def test_copy_failure_keeps_active_directory_and_removes_partial_destination(self):
        original = artifact_root()
        original.mkdir(parents=True)
        (original / 'material.png').write_bytes(b'keep')
        destination = self.root / 'target'
        with patch.object(storage.shutil, 'copytree', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                storage.migrate_storage(str(destination))
        self.assertEqual(artifact_root(), original)
        self.assertEqual((original / 'material.png').read_bytes(), b'keep')
        self.assertEqual(list(destination.iterdir()), [])

    def test_verification_failure_and_existing_target_are_not_overwritten(self):
        origin = artifact_root()
        origin.mkdir(parents=True)
        (origin / 'material.png').write_bytes(b'keep')
        destination = self.root / 'target'
        with patch.object(storage, '_digest', side_effect=[b'a', b'b']):
            with self.assertRaises(OSError):
                storage.migrate_storage(str(destination))
        self.assertEqual(artifact_root(), origin)
        occupied = destination / 'iib-workspace-artifacts'
        occupied.mkdir()
        (occupied / 'user-file').write_text('untouched')
        with self.assertRaises(ValueError):
            storage.migrate_storage(str(destination))
        self.assertEqual((occupied / 'user-file').read_text(), 'untouched')

    def test_setting_failure_rolls_back_only_newly_copied_directories(self):
        origin = artifact_root()
        origin.mkdir(parents=True)
        (origin / 'material.png').write_bytes(b'keep')
        destination = self.root / 'target'
        with patch.object(storage.GlobalSetting, 'save_setting', side_effect=OSError('database full')):
            with self.assertRaises(OSError):
                storage.migrate_storage(str(destination))
        self.assertEqual(artifact_root(), origin)
        self.assertEqual(list(destination.iterdir()), [])

    def test_relative_and_nested_managed_paths_rejected(self):
        for invalid in ('relative/path', str(artifact_root() / 'nested')):
            with self.assertRaises(ValueError):
                storage.migrate_storage(invalid)


if __name__ == '__main__':
    unittest.main()
