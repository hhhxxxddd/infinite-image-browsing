import assert from 'node:assert/strict'
import test from 'node:test'
import {
  collectBrowserWorkspaceState,
  mapStorage,
  WorkspaceStateStore
} from './workspaceStateStore.ts'

function transport() {
  let snapshot = { revision: 0, imported: false, entries: {} },
    fail = false
  return {
    get snapshot() {
      return structuredClone(snapshot)
    },
    set fail(value) {
      fail = value
    },
    async load() {
      return structuredClone(snapshot)
    },
    async import(entries) {
      if (fail) throw new Error('offline')
      if (!snapshot.imported) snapshot = { revision: 1, imported: true, entries }
      return structuredClone(snapshot)
    },
    async save(revision, changes) {
      if (fail) throw new Error('offline')
      if (revision !== snapshot.revision) throw new Error('conflict')
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) delete snapshot.entries[key]
        else snapshot.entries[key] = value
      }
      return { revision: ++snapshot.revision }
    },
    async remove() {
      snapshot = { revision: snapshot.revision + 1, imported: true, entries: {} }
    }
  }
}

test('migration includes work associations, canvas and scoped AI state with exact boundaries', () => {
  const storage = mapStorage(
    new Map([
      ['omnigallery:workspace-works-v2:one', 'works'],
      ['omnigallery:workbench-image-document-v2:one:doc', 'canvas'],
      ['omnigallery:ai-image-ref-v1:one:work:ai:main:ref', 'reference'],
      ['omnigallery:ai-production-prompt-v1:one:work:ai:doc', 'prompt'],
      ['omnigallery:ai-production-output-name-v1:one:work:ai', 'AI 产物名称'],
      ['omnigallery:ai-production-output-name-v1:one-other:work:ai', 'foreign name'],
      ['omnigallery:studio-comfy-prompt-v1:doc', 'canvas AI prompt'],
      ['omnigallery:workspace-works-v2:one-other', 'foreign'],
      ['ui-theme', 'dark']
    ])
  )
  const entries = collectBrowserWorkspaceState('one', storage)
  assert.equal(Object.keys(entries).length, 6)
  assert.equal(entries['omnigallery:ai-production-output-name-v1:one:work:ai'], 'AI 产物名称')
  assert.equal(entries['omnigallery:ai-production-output-name-v1:one-other:work:ai'], undefined)
  assert.equal(entries['omnigallery:studio-production-prompt-v1:one:doc'], 'canvas AI prompt')
  assert.equal(entries['ui-theme'], undefined)
  assert.equal(entries['omnigallery:workspace-works-v2:one-other'], undefined)
})

test('server state is authoritative after one import, independent of browser backup', async () => {
  const remote = transport(),
    store = new WorkspaceStateStore(remote)
  await store.ensure(() => ({ works: 'original', canvas: 'layers', ai: 'main+references' }))
  await store.transaction((storage) => storage.setItem('canvas', 'new layers'))
  const other = new WorkspaceStateStore(remote)
  await other.ensure(() => ({ canvas: 'stale browser data' }))
  assert.equal(other.storage.getItem('canvas'), 'new layers')
  assert.equal(other.storage.getItem('works'), 'original')
})

test('failed migration preserves browser data and can be retried', async () => {
  const remote = transport(),
    store = new WorkspaceStateStore(remote)
  const browser = { works: 'original' }
  remote.fail = true
  await assert.rejects(
    store.ensure(() => browser),
    /offline/
  )
  assert.deepEqual(browser, { works: 'original' })
  assert.equal(remote.snapshot.imported, false)
  remote.fail = false
  await store.ensure(() => browser)
  assert.equal(store.storage.getItem('works'), 'original')
})

test('queued saves see committed state and failure publishes no partial document or index', async () => {
  const remote = transport(),
    store = new WorkspaceStateStore(remote)
  await store.ensure(() => ({ index: 'old', doc: 'old' }))
  remote.fail = true
  await assert.rejects(
    store.transaction((storage) => {
      storage.setItem('index', 'new')
      storage.setItem('doc', 'new')
    }),
    /offline/
  )
  assert.equal(store.storage.getItem('index'), 'old')
  assert.equal(store.storage.getItem('doc'), 'old')
  assert.throws(() => store.storage.setItem('index', 'unsafe'), /事务/)
  remote.fail = false
  await Promise.all([
    store.transaction((storage) => storage.setItem('doc', 'saved')),
    store.transaction((storage) => storage.setItem('index', storage.getItem('doc')))
  ])
  assert.equal(store.storage.getItem('index'), 'saved')
  assert.equal(remote.snapshot.entries.index, 'saved')
})

test('readonly loading does not import, and deleted stores reject late autosaves', async () => {
  const remote = transport(),
    store = new WorkspaceStateStore(remote)
  await store.load(() => ({ works: 'browser' }), false)
  assert.equal(remote.snapshot.imported, false)
  await store.remove()
  await assert.rejects(
    store.transaction((storage) => storage.setItem('doc', 'late')),
    /删除/
  )
  assert.deepEqual(remote.snapshot.entries, {})
})
