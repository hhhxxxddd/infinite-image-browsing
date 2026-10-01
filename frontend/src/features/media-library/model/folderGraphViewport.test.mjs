import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createFolderGraphViewport,
  FOLDER_GRAPH_VIEWPORT_KEY,
  rememberFolderGraphScroll
} from './folderGraphViewport.ts'

function storage(initial = null) {
  const values = new Map([[FOLDER_GRAPH_VIEWPORT_KEY, initial]])
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  }
}

test('viewport survives a fresh session with independent overview and per-root positions', () => {
  const disk = storage()
  const first = createFolderGraphViewport(disk)
  first.set('', { left: 0, top: 420 })
  first.set('C:\\Photos\\', { left: 320, top: 0 })
  first.set('/Photos', { left: 100, top: 0 })
  const restored = createFolderGraphViewport(disk)
  assert.deepEqual(restored.get(''), { left: 0, top: 420 })
  assert.deepEqual(restored.get('c:/PHOTOS'), { left: 320, top: 0 })
  assert.deepEqual(restored.get('/Photos'), { left: 100, top: 0 })
  assert.equal(restored.get('/photos'), undefined)
})

test('corrupt positions and unavailable storage do not interrupt navigation', () => {
  const state = createFolderGraphViewport(
    storage(
      '{"version":1,"entries":[["overview",{"left":-1,"top":4}],["posix:/a",{"left":"10","top":0}]]}'
    )
  )
  assert.equal(state.get(''), undefined)
  assert.equal(state.get('/a'), undefined)
  state.set('/a', { left: Infinity, top: 0 })
  assert.equal(state.get('/a'), undefined)
  const restricted = createFolderGraphViewport({
    getItem() {
      throw Error('blocked')
    },
    setItem() {
      throw Error('quota')
    }
  })
  restricted.set('/a', { left: -10, top: 12 })
  assert.deepEqual(restricted.get('/a'), { left: 0, top: 12 })
})

test('scroll restoration waits for asynchronous graph growth and yields to user scrolling', () => {
  const oldWindow = globalThis.window
  const oldObserver = globalThis.ResizeObserver
  let resize
  let disconnected = false
  globalThis.window = new EventTarget()
  globalThis.ResizeObserver = class {
    constructor(callback) {
      resize = callback
    }
    observe() {}
    disconnect() {
      disconnected = true
    }
  }
  try {
    const disk = storage()
    const state = createFolderGraphViewport(disk)
    state.set('', { left: 0, top: 600 })
    const host = Object.assign(new EventTarget(), {
      clientWidth: 500,
      clientHeight: 400,
      scrollWidth: 500,
      scrollHeight: 400,
      scrollLeft: 0,
      scrollTop: 0
    })
    const detach = rememberFolderGraphScroll(host, host, '', state)
    host.dispatchEvent(new Event('scroll'))
    assert.deepEqual(state.get(''), { left: 0, top: 600 })
    host.scrollHeight = 1200
    resize()
    assert.equal(host.scrollTop, 600)
    host.dispatchEvent(new Event('wheel'))
    host.scrollTop = 200
    resize()
    assert.equal(host.scrollTop, 200)
    detach()
    assert.equal(disconnected, true)
    assert.deepEqual(createFolderGraphViewport(disk).get(''), { left: 0, top: 200 })

    state.set('', { left: 0, top: 900 })
    host.scrollHeight = 400
    const earlyDetach = rememberFolderGraphScroll(host, host, '', state)
    earlyDetach()
    assert.deepEqual(state.get(''), { left: 0, top: 900 })
  } finally {
    globalThis.window = oldWindow
    globalThis.ResizeObserver = oldObserver
  }
})
