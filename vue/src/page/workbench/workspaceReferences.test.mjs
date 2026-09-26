import assert from 'node:assert/strict'
import test from 'node:test'
import { reconcileWorkspaceReferences, remapWorkspaceDrafts, removeWorkspaceAIDrafts, removeWorkspaceAssetDrafts } from './workspaceReferences.ts'

class MemoryStorage {
  data = new Map()
  get length() { return this.data.size }
  key(index) { return [...this.data.keys()][index] ?? null }
  getItem(key) { return this.data.get(key) ?? null }
  setItem(key, value) { this.data.set(key, String(value)) }
  removeItem(key) { this.data.delete(key) }
}

test('deleting a workspace clears AI drafts without affecting a similarly named workspace', () => {
  const storage = new MemoryStorage()
  const prefixes = ['iib-ai-image-edit-v1:', 'iib-ai-image-edit-asset-v1:', 'iib-ai-image-edit-recent-v1:',
    'iib-ai-image-refs-v1:', 'iib-ai-image-ref-v1:']
  for (const prefix of prefixes) {
    storage.setItem(`${prefix}workspace`, 'remove')
    storage.setItem(`${prefix}workspace:main:ref`, 'remove')
    storage.setItem(`${prefix}workspace-2:main:ref`, 'keep')
  }
  storage.setItem('iib-workbench-image-document-v2:workspace:composition', 'keep')
  removeWorkspaceAIDrafts(storage, 'workspace')
  assert.equal(storage.length, prefixes.length + 1)
  assert.ok([...storage.data.values()].every(value => value === 'keep'))
})
const oldPath = 'C:\\images\\old.png'
const newPath = 'C:\\images\\new.png'
const docKey = path => `iib-ai-image-edit-v1:workspace:${encodeURIComponent(path)}`
const workspace = path => [{ id: 'workspace', assets: [{ id: 13, path, name: 'old.png' }], outputs: [{ id: 13, path, name: 'old.png' }] }]

test('renamed media recovers references, annotations, main image, references and recent order', () => {
  const storage = new MemoryStorage()
  const doc = { layers: [{ path: oldPath, name: 'old.png' }, { path: oldPath, name: 'Custom' }], caption: oldPath, annotations: [1, 2] }
  storage.setItem(docKey(oldPath), JSON.stringify(doc))
  storage.setItem('iib-workbench-image-document-v2:workspace:doc', JSON.stringify(doc))
  storage.setItem('iib-ai-image-edit-asset-v1:workspace', oldPath)
  storage.setItem('iib-ai-image-edit-recent-v1:workspace', JSON.stringify([oldPath, '/other.png']))
  storage.setItem(`iib-ai-image-refs-v1:workspace:${encodeURIComponent(oldPath)}`, JSON.stringify([oldPath]))
  storage.setItem(`iib-ai-image-ref-v1:workspace:${encodeURIComponent(oldPath)}:${encodeURIComponent(oldPath)}`, JSON.stringify(doc))
  const result = reconcileWorkspaceReferences(workspace(oldPath), [{ id: 13, path: newPath }], storage)
  assert.equal(result[0].assets[0].path, newPath)
  assert.equal(result[0].outputs[0].name, 'new.png')
  assert.equal(storage.getItem(docKey(oldPath)), null)
  const saved = JSON.parse(storage.getItem(docKey(newPath)))
  assert.deepEqual(saved.layers, [{ path: newPath, name: 'new.png' }, { path: newPath, name: 'Custom' }])
  assert.equal(saved.caption, oldPath)
  assert.deepEqual(saved.annotations, [1, 2])
  assert.equal(JSON.parse(storage.getItem('iib-workbench-image-document-v2:workspace:doc')).layers[0].path, newPath)
  assert.equal(storage.getItem('iib-ai-image-edit-asset-v1:workspace'), newPath)
  assert.deepEqual(JSON.parse(storage.getItem('iib-ai-image-edit-recent-v1:workspace')), [newPath, '/other.png'])
  assert.deepEqual(JSON.parse(storage.getItem(`iib-ai-image-refs-v1:workspace:${encodeURIComponent(newPath)}`)), [newPath])
  assert.ok(storage.getItem(`iib-ai-image-ref-v1:workspace:${encodeURIComponent(newPath)}:${encodeURIComponent(newPath)}`))
})

test('cached ID follows repeated renames when server records already contain the new path', () => {
  const storage = new MemoryStorage()
  reconcileWorkspaceReferences(workspace(oldPath), [{ id: 13, path: oldPath }], storage)
  storage.setItem(docKey(oldPath), JSON.stringify({ layers: [{ path: oldPath }] }))
  reconcileWorkspaceReferences(workspace(newPath), [{ id: 13, path: newPath }], storage)
  const finalPath = 'C:\\images\\final.png'
  reconcileWorkspaceReferences(workspace(finalPath), [{ id: 13, path: finalPath }], storage)
  assert.equal(JSON.parse(storage.getItem(docKey(finalPath))).layers[0].path, finalPath)
})

test('missing media, malformed drafts and newer destination drafts are preserved', () => {
  const storage = new MemoryStorage()
  storage.setItem(docKey(oldPath), '{broken')
  storage.setItem(docKey(newPath), '{"newer":true}')
  remapWorkspaceDrafts(storage, new Map([[oldPath, newPath]]))
  assert.equal(storage.getItem(docKey(oldPath)), '{broken')
  storage.setItem(docKey(oldPath), '{"old":true}')
  remapWorkspaceDrafts(storage, new Map([[oldPath, newPath]]))
  assert.equal(storage.getItem(docKey(newPath)), '{"newer":true}')
  assert.deepEqual(reconcileWorkspaceReferences(workspace(oldPath), [], storage), workspace(oldPath))
})


test('deleting an artifact removes its AI drafts and references but preserves other edits', () => {
  const storage = new MemoryStorage()
  const encoded = encodeURIComponent(oldPath)
  const removed = [docKey(oldPath), `iib-ai-image-refs-v1:workspace:${encoded}`,
    `iib-ai-image-ref-v1:workspace:${encoded}:other`, `iib-ai-image-ref-v1:workspace:other:${encoded}`]
  for (const key of removed) storage.setItem(key, '{}')
  const lastKey = 'iib-ai-image-edit-asset-v1:workspace'
  storage.setItem(lastKey, oldPath)
  const lists = ['iib-ai-image-refs-v1:workspace:other', 'iib-ai-image-edit-recent-v1:workspace']
  for (const key of lists) storage.setItem(key, JSON.stringify([oldPath, '/keep.png']))
  const untouched = [`iib-ai-image-ref-v1:another:${encoded}:other`, docKey('/keep.png'),
    'iib-workbench-image-document-v2:workspace:composition']
  for (const key of untouched) storage.setItem(key, 'preserved')
  storage.setItem('iib-ai-image-refs-v1:workspace:broken', 'invalid json')
  removeWorkspaceAssetDrafts(storage, 'workspace', oldPath)
  for (const key of [...removed, lastKey]) assert.equal(storage.getItem(key), null)
  for (const key of lists) assert.deepEqual(JSON.parse(storage.getItem(key)), ['/keep.png'])
  for (const key of untouched) assert.equal(storage.getItem(key), 'preserved')
})
