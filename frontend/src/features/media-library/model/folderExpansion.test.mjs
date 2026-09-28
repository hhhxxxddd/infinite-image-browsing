import assert from 'node:assert/strict'
import test from 'node:test'
import { computed } from 'vue'
import { createFolderExpansion, FOLDER_EXPANSION_STORAGE_KEY } from './folderExpansion.ts'

function memoryStorage(initial = null) {
  const values = new Map(initial === null ? [] : [[FOLDER_EXPANSION_STORAGE_KEY, initial]])
  return {
    writes: 0,
    getItem(key) {
      return values.get(key) ?? null
    },
    setItem(key, value) {
      this.writes++
      values.set(key, value)
    }
  }
}

test('a fresh session restores both expanded and collapsed branches, including Windows roots', () => {
  const storage = memoryStorage()
  const first = createFolderExpansion(storage)
  assert.equal(first.get('E:\\媒体'), undefined)
  assert.equal(storage.writes, 0)
  first.set('E:\\媒体\\', false, true)
  first.set('E:\\媒体\\旅行', true, true)
  first.set('E:\\媒体\\旅行\\海边', false, true)
  const restored = createFolderExpansion(storage)
  assert.equal(restored.get('e:/媒体', true), false)
  assert.equal(restored.get('e:/媒体/旅行', true), true)
  assert.equal(restored.get('e:/媒体/旅行/海边/', true), false)
  assert.equal(restored.get('e:/媒体/新目录', true), undefined)
  restored.set('E:\\媒体', true, true)
  assert.equal(restored.get('E:\\媒体\\旅行', true), true)
})

test('collapsing a parent preserves its descendant choices when reopened', () => {
  const storage = memoryStorage()
  const state = createFolderExpansion(storage)
  state.set('/library', true)
  state.set('/library/a', true)
  state.set('/library/a/deep', false)
  state.set('/library', false)
  const restored = createFolderExpansion(storage)
  assert.equal(restored.get('/library'), false)
  restored.set('/library', true)
  assert.equal(restored.get('/library/a'), true)
  assert.equal(restored.get('/library/a/deep'), false)
})

test('external deletion removes only missing child subtrees after a successful listing', () => {
  const state = createFolderExpansion(memoryStorage())
  state.set('/library', true)
  state.set('/library/a', false)
  state.set('/library/a/deep', true)
  state.set('/library/ab', true)
  state.set('/library/ab/not-yet-loaded', false)
  state.set('/another/root', true)
  state.reconcileChildren('/library', ['/library/ab'])
  assert.equal(state.get('/library'), true)
  assert.equal(state.get('/library/a'), undefined)
  assert.equal(state.get('/library/a/deep'), undefined)
  assert.equal(state.get('/library/ab'), true)
  assert.equal(state.get('/library/ab/not-yet-loaded'), false)
  assert.equal(state.get('/another/root'), true)
})

test('explicit deletion clears the entire subtree, without prefix collisions', () => {
  const storage = memoryStorage()
  const state = createFolderExpansion(storage)
  state.set('C:\\Photos\\A', true, true)
  state.set('C:\\Photos\\A\\Child', false, true)
  state.set('C:\\Photos\\Album', true, true)
  state.forget('c:/PHOTOS/a/', true)
  const restored = createFolderExpansion(storage)
  assert.equal(restored.get('C:\\Photos\\A', true), undefined)
  assert.equal(restored.get('C:\\Photos\\A\\Child', true), undefined)
  assert.equal(restored.get('C:\\Photos\\Album', true), true)
  // Recreating the same path later receives the default state, not the deleted choice.
  assert.equal(restored.get('c:/photos/a', true), undefined)
})

test('renaming or moving remaps every saved descendant while keeping other branches', () => {
  const storage = memoryStorage()
  const state = createFolderExpansion(storage)
  state.set('C:\\Photos\\Old', false, true)
  state.set('C:\\Photos\\Old\\Deep', true, true)
  state.set('C:\\Photos\\Older', true, true)
  state.remap('c:/photos/OLD', 'D:\\素材\\New', true)
  const restored = createFolderExpansion(storage)
  assert.equal(restored.get('C:\\Photos\\Old', true), undefined)
  assert.equal(restored.get('D:\\素材\\New', true), false)
  assert.equal(restored.get('D:\\素材\\New\\Deep', true), true)
  assert.equal(restored.get('C:\\Photos\\Older', true), true)
})

test('root removal retains descendants still covered by another registered root', () => {
  const state = createFolderExpansion(memoryStorage())
  state.set('/library', false)
  state.set('/library/keep', true)
  state.set('/library/keep/deep', false)
  state.set('/library/remove', true)
  state.set('/other', true)
  state.set('C:\\WindowsLibrary', false, true)
  state.retainRoots(['/library/keep', '/other'])
  assert.equal(state.get('/library'), undefined)
  assert.equal(state.get('/library/remove'), undefined)
  assert.equal(state.get('/library/keep/deep'), false)
  assert.equal(state.get('/other'), true)
  assert.equal(state.get('C:\\WindowsLibrary', true), false)
  state.retainRoots([])
  assert.equal(state.get('/other'), undefined)
  assert.equal(state.get('C:\\WindowsLibrary', true), false)
})

test('case-sensitive POSIX paths and Windows UNC paths keep their identity', () => {
  const state = createFolderExpansion(memoryStorage())
  state.set('/Photos/A', true)
  state.set('/Photos/a', false)
  assert.equal(state.get('/Photos/A'), true)
  assert.equal(state.get('/Photos/a'), false)
  state.set('\\\\Server\\Share\\A', true, true)
  assert.equal(state.get('//server/share/a/', true), true)
  state.reconcileChildren('//SERVER/share', ['\\\\server\\share\\A'], true)
  assert.equal(state.get('//server/share/a', true), true)
  state.set('/a', true)
  state.reconcileChildren('/', ['/a', '/Photos'])
  assert.equal(state.get('/a'), true)
  assert.equal(state.get('/Photos/A'), true)
})

test('invalid or unavailable storage never prevents directory browsing', () => {
  for (const initial of ['{broken', 'null', '[]', '{"version":2,"entries":[]}']) {
    const state = createFolderExpansion(memoryStorage(initial))
    assert.equal(state.get('/a'), undefined)
    state.set('/a', false)
    assert.equal(state.get('/a'), false)
  }
  const state = createFolderExpansion({
    getItem() {
      throw new Error('storage disabled')
    },
    setItem() {
      throw new Error('quota exceeded')
    }
  })
  state.set('/a', true)
  state.set('/a/child', false)
  state.remap('/a', '/b')
  assert.equal(state.get('/b/child'), false)
  state.forget('/b')
  assert.equal(state.get('/b'), undefined)
})

test('unrelated refreshes do not write storage and shared views react to toggles', () => {
  const storage = memoryStorage()
  const state = createFolderExpansion(storage)
  const view = computed(() => state.get('/a') ?? true)
  assert.equal(view.value, true)
  state.set('/a', false)
  assert.equal(view.value, false)
  const writes = storage.writes
  state.set('/a', false)
  state.reconcileChildren('/a', [])
  state.retainRoots(['/a'])
  assert.equal(storage.writes, writes)
  state.forget('/a')
  assert.equal(view.value, true)
})
