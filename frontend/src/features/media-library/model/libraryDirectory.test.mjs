import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LIBRARY_DIRECTORY_STORAGE_KEY,
  scannedDirectoryRoots,
  isLibraryDirectory,
  libraryDirectoryBreadcrumbs,
  readLibraryDirectory,
  rememberLibraryDirectory
} from './libraryDirectory.ts'

function memoryStorage(initial = null) {
  const values = new Map(initial === null ? [] : [[LIBRARY_DIRECTORY_STORAGE_KEY, initial]])
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  }
}

test('the picker only exposes scanned roots and folds nested registrations', () => {
  const folders = [
    { path: '/photos', types: ['scanned', 'walk'], alias: '照片' },
    { path: '/photos/2026', types: ['scanned'] },
    { path: '/video', types: ['scanned-fixed'] },
    { path: '/browse-only', types: ['walk'] },
    { path: '/cli', types: ['cli_access_only'] }
  ]
  assert.deepEqual(scannedDirectoryRoots(folders), [folders[0], folders[2]])
})

test('a selected directory must belong to a scanned root without escaping via parent paths', () => {
  const roots = [{ path: '/photos' }]
  assert.equal(isLibraryDirectory('/photos', roots), true)
  assert.equal(isLibraryDirectory('/photos/a/deep', roots), true)
  assert.equal(isLibraryDirectory('/photos-other', roots), false)
  assert.equal(isLibraryDirectory('/photos/../outside', roots), false)
  assert.equal(isLibraryDirectory('/outside', roots), false)
  assert.equal(isLibraryDirectory('', roots), false)
})

test('the last directory restores across dialog and application sessions', () => {
  const storage = memoryStorage()
  const roots = [{ path: 'E:\\媒体' }]
  assert.equal(readLibraryDirectory(storage, roots, true), '')
  rememberLibraryDirectory(storage, 'E:\\媒体\\作品\\海报')
  const reopened = memoryStorage(storage.getItem(LIBRARY_DIRECTORY_STORAGE_KEY))
  assert.equal(readLibraryDirectory(reopened, [{ path: 'e:/媒体/' }], true), 'E:\\媒体\\作品\\海报')
  assert.equal(readLibraryDirectory(reopened, [], true), '')
  assert.equal(readLibraryDirectory(reopened, [{ path: 'E:\\媒体库' }], true), '')
})

test('breadcrumb navigation stays within the selected root and preserves aliases', () => {
  assert.deepEqual(
    libraryDirectoryBreadcrumbs(
      [{ path: 'E:\\媒体', alias: '测试文件' }],
      'e:/媒体/图片/风景',
      true
    ),
    [
      { path: 'E:\\媒体', name: '测试文件' },
      { path: 'E:\\媒体\\图片', name: '图片' },
      { path: 'E:\\媒体\\图片\\风景', name: '风景' }
    ]
  )
  assert.deepEqual(libraryDirectoryBreadcrumbs([{ path: '/media', alias: '素材' }], '/media'), [
    { path: '/media', name: '素材' }
  ])
  assert.deepEqual(libraryDirectoryBreadcrumbs([{ path: '/media' }], '/elsewhere'), [])
})

test('POSIX roots and UNC shares support navigation and keep case rules', () => {
  assert.equal(isLibraryDirectory('/Photos', [{ path: '/photos' }]), false)
  assert.equal(
    isLibraryDirectory('\\\\SERVER\\Share\\子目录', [{ path: '//server/share' }], true),
    true
  )
  assert.deepEqual(libraryDirectoryBreadcrumbs([{ path: '/', alias: '根目录' }], '/media/images'), [
    { path: '/', name: '根目录' },
    { path: '/media', name: 'media' },
    { path: '/media/images', name: 'images' }
  ])
})

test('malformed preferences and restricted storage fall back without blocking saves', () => {
  for (const value of [
    '{bad',
    'null',
    '[]',
    '{"version":2,"directory":"/media"}',
    '{"version":1,"directory":123}',
    '{"version":1,"directory":"/media/../other"}'
  ])
    assert.equal(readLibraryDirectory(memoryStorage(value), [{ path: '/media' }]), '')
  const disabled = {
    getItem() {
      throw new Error('disabled')
    },
    setItem() {
      throw new Error('quota')
    }
  }
  assert.equal(readLibraryDirectory(disabled, [{ path: '/media' }]), '')
  assert.doesNotThrow(() => rememberLibraryDirectory(disabled, '/media'))
})
