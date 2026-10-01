import assert from 'node:assert/strict'
import test from 'node:test'

import { DirectoryWalker } from './directoryWalk.ts'

const file = (fullpath, type = 'file', created_time = '') => ({
  fullpath,
  type,
  name: fullpath.split(/[\\/]/).pop(),
  created_time,
  date: created_time,
  bytes: 1
})
const isMedia = (entry) => /\.(jpg|mp3|mp4)$/i.test(entry.name)

test('default filtering keeps unindexed supported media and traverses directories with helper files', async () => {
  const folders = {
    '/media': [
      file('/media/children', 'dir'),
      file('/media/photo.JPE'),
      file('/media/README.md'),
      file('/media/workflow.json'),
      file('/media/vector.svg'),
      file('/media/photo.heic'),
      file('/media/song.opus')
    ],
    '/media/children': [
      file('/media/children/song.FLAC'),
      file('/media/children/clip.MP4'),
      file('/media/children/song.lrc'),
      file('/media/children/clip.srt'),
      file('/media/children/notes.txt')
    ]
  }
  const walker = new DirectoryWalker('/media', {
    sort: 'name-asc',
    read: async (path) => ({ files: folders[path] })
  })

  const first = await walker.loadNext()
  assert.deepEqual(
    first.files.map((entry) => entry.name),
    ['photo.JPE']
  )
  assert.equal(first.nextDirectoryPath, '/media/children')
  const last = await walker.loadNext()
  assert.deepEqual(
    last.files.map((entry) => entry.name),
    ['clip.MP4', 'song.FLAC', 'photo.JPE']
  )
  assert.equal(last.hasNext, false)
  assert.ok(last.files.every((entry) => entry.id === undefined))
})

test('walks real directory pages depth-first with legacy sort and only media files', async () => {
  const root = 'C:\\Media'
  const reads = []
  const folders = {
    [root]: [
      file('C:\\Media\\B', 'dir', '2024-01-01'),
      file('C:\\Media\\root.jpg', 'file', '2024-01-02'),
      file('C:\\Media\\A', 'dir', '2024-02-01'),
      file('C:\\Media\\notes.txt')
    ],
    'C:\\Media\\A': [file('C:\\Media\\A\\nested', 'dir'), file('C:\\Media\\A\\song.mp3')],
    'C:\\Media\\A\\nested': [file('C:\\Media\\A\\nested\\clip.mp4')],
    'C:\\Media\\B': [file('C:\\Media\\B\\other.jpg')]
  }
  const walker = new DirectoryWalker(root, {
    isMedia,
    read: async (path) => {
      reads.push(path)
      return { files: folders[path] }
    }
  })

  const first = await walker.loadNext()
  assert.deepEqual(
    first.files.map((entry) => entry.name),
    ['root.jpg']
  )
  assert.equal(first.nextDirectoryPath, 'C:\\Media\\A')
  assert.equal(first.pendingDirectories, 2)
  await walker.loadNext()
  assert.deepEqual(
    walker.snapshot().files.map((entry) => entry.name),
    ['song.mp3', 'root.jpg']
  )
  await walker.loadNext()
  await walker.loadNext()
  assert.deepEqual(
    walker.snapshot().files.map((entry) => entry.name),
    ['clip.mp4', 'song.mp3', 'other.jpg', 'root.jpg']
  )
  assert.equal(walker.snapshot().hasNext, false)
  assert.deepEqual(reads, [root, 'C:\\Media\\A', 'C:\\Media\\A\\nested', 'C:\\Media\\B'])
})

test('failed or untrusted child page leaves the cursor available for retry', async () => {
  let attempt = 0
  const walker = new DirectoryWalker('/media', {
    isMedia,
    read: async () => {
      attempt += 1
      if (attempt === 1) throw new Error('permission denied')
      if (attempt === 2) return { files: [file('/media2/escape.jpg')] }
      return { files: [file('/media/good.jpg')] }
    }
  })
  await assert.rejects(walker.loadNext(), /permission denied/)
  assert.equal(walker.snapshot().nextDirectoryPath, '/media')
  await assert.rejects(walker.loadNext(), /当前目录之外/)
  assert.equal(walker.snapshot().nextDirectoryPath, '/media')
  assert.deepEqual(
    (await walker.loadNext()).files.map((entry) => entry.name),
    ['good.jpg']
  )
})

test('single-flight loads and reset ignore an old in-flight directory response', async () => {
  let release
  const oldResponse = new Promise((resolve) => {
    release = resolve
  })
  const walker = new DirectoryWalker('/old', {
    isMedia,
    read: (path) =>
      path === '/old' ? oldResponse : Promise.resolve({ files: [file('/new/current.jpg')] })
  })
  const first = walker.loadNext()
  assert.equal(walker.loadNext(), first)
  walker.reset('/new')
  const current = await walker.loadNext()
  assert.deepEqual(
    current.files.map((entry) => entry.name),
    ['current.jpg']
  )
  release({ files: [file('/old/stale.jpg')] })
  await first
  assert.deepEqual(
    walker.snapshot().files.map((entry) => entry.name),
    ['current.jpg']
  )
})
