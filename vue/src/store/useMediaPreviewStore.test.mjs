import test from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import { useMediaPreviewStore } from './useMediaPreviewStore.ts'

globalThis.window = { innerWidth: 1280 }
const item = (id, type = 'image') => ({ id, type, url: `/media/${id}` })
function viewer() {
  setActivePinia(createPinia())
  return useMediaPreviewStore()
}
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test('opens the requested media and retains its identity immediately on close', async () => {
  const store = viewer()
  store.openPreview([item('a'), item('b', 'video'), item('c', 'audio')], 1)
  assert.equal(store.currentItem.type, 'video')
  await store.next()
  store.closeView()
  assert.equal(store.lastActiveId, 'c')
  assert.equal(store.visible, false)
  assert.deepEqual(store.mediaList, [])
})

test('loads past the current page and stops when the source is exhausted', async () => {
  const store = viewer()
  let more = true
  let calls = 0
  store.openPreview([item('a')], 0, {
    hasMore: () => more,
    loadMore: async () => { calls++; more = false; return [item('a'), item('b')] }
  })
  assert.equal(store.hasNext, true)
  await store.next()
  assert.equal(store.currentItem.id, 'b')
  assert.equal(store.hasNext, false)
  await store.next()
  assert.equal(calls, 1)
  store.prev()
  assert.equal(store.currentItem.id, 'a')
})

test('coalesces pending page loads without moving the current image', async () => {
  const store = viewer()
  const page = deferred()
  let calls = 0
  store.openPreview([item('a')], 0, { loadMore: () => { calls++; return page.promise } })
  const first = store.loadNextPage()
  const second = store.loadNextPage()
  assert.equal(store.loadingMore, true)
  page.resolve([item('a'), item('b')])
  await Promise.all([first, second])
  assert.equal(calls, 1)
  assert.equal(store.currentItem.id, 'a')
  assert.equal(store.loadingMore, false)
})

test('ignores an old page response after closing and reopening another list', async () => {
  const store = viewer()
  const page = deferred()
  store.openPreview([item('old')], 0, { loadMore: () => page.promise })
  const next = store.next()
  store.closeView()
  store.openPreview([item('new')])
  page.resolve([item('old'), item('stale')])
  await next
  assert.equal(store.currentItem.id, 'new')
  assert.equal(store.loadingMore, false)
  assert.equal(store.visible, true)
})

test('keeps the current image after a network failure and permits retry', async () => {
  const store = viewer()
  let attempts = 0
  store.openPreview([item('a')], 0, {
    loadMore: async () => {
      if (++attempts === 1) throw new Error('offline')
      return [item('a'), item('b')]
    }
  })
  await assert.rejects(store.next(), /offline/)
  assert.equal(store.currentItem.id, 'a')
  assert.equal(store.loadingMore, false)
  await store.next()
  assert.equal(store.currentItem.id, 'b')
})

test('does not mistake a page with no matching media for the end of the source', async () => {
  const store = viewer()
  let calls = 0
  store.openPreview([item('a')], 0, {
    hasMore: () => calls < 2,
    loadMore: async () => ++calls === 1 ? [item('a')] : [item('a'), item('b')]
  })
  await store.next()
  assert.equal(store.hasNext, true)
  await store.next()
  assert.equal(store.currentItem.id, 'b')
  assert.equal(store.hasNext, false)
})

test('deleting the active item selects its successor, then predecessor, and closes the empty viewer', () => {
  const store = viewer()
  store.openPreview([item('a'), item('b'), item('c')], 1)
  store.removeMedia('b')
  assert.equal(store.currentItem.id, 'c')
  store.removeMedia('c')
  assert.equal(store.currentItem.id, 'a')
  store.removeMedia('a')
  assert.equal(store.visible, false)
})
test('deleting a previous item preserves the active image', () => {
  const store = viewer()
  store.openPreview([item('a'), item('b'), item('c')], 2)
  store.removeMedia('a')
  assert.equal(store.currentItem.id, 'c')
  assert.equal(store.currentIndex, 1)
})
test('a pending page cannot resurrect a deleted image', async () => {
  const store = viewer()
  const page = deferred()
  store.openPreview([item('a'), item('b')], 0, { loadMore: () => page.promise })
  const pending = store.loadNextPage()
  store.removeMedia('a')
  page.resolve([item('a'), item('b'), item('c')])
  await pending
  assert.deepEqual(store.mediaList.map(item => item.id), ['b', 'c'])
  assert.equal(store.currentItem.id, 'b')
})
