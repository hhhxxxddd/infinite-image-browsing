import assert from 'node:assert/strict'
import test from 'node:test'
import { createStudioDocument } from '../../image-editor/public/document.ts'
import {
  createWorkspaceDraftRepository,
  clearWorkspaceImageDrafts,
  workspaceImageDocumentKey,
  workspaceImageIndexKey
} from './workspaceDraftRepository.ts'

function memoryStorage() {
  const data = new Map()
  return {
    data,
    get length() {
      return data.size
    },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key)
  }
}
function indexFor(...docs) {
  return {
    version: 2,
    activeId: docs.at(-1).id,
    docs: docs.map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
  }
}

test('workspace draft roundtrip retains layers, active selection and multiple documents', () => {
  const storage = memoryStorage()
  const repository = createWorkspaceDraftRepository('workspace', storage)
  const first = createStudioDocument('First')
  const second = createStudioDocument('Second')
  repository.save(first, indexFor(first))
  repository.save(second, indexFor(first, second))
  assert.deepEqual(repository.loadDocument(first.id), first)
  assert.deepEqual(repository.loadDocument(second.id), second)
  assert.deepEqual(repository.loadIndex(), indexFor(first, second))
  repository.remove(first.id)
  assert.equal(repository.loadDocument(first.id), undefined)
  assert.deepEqual(repository.loadDocument(second.id), second)
})

test('a pending save keeps its original workspace binding after another workspace opens', () => {
  const storage = memoryStorage()
  const original = createWorkspaceDraftRepository('work', storage)
  const current = createWorkspaceDraftRepository('work-2', storage)
  const document = createStudioDocument('Original')
  const newDocument = { ...document, name: 'New workspace' }
  current.save(newDocument, indexFor(newDocument))
  original.save(document, indexFor(document))
  assert.equal(original.loadDocument(document.id).name, 'Original')
  assert.equal(current.loadDocument(document.id).name, 'New workspace')
  assert.equal(storage.length, 4)
})

test('missing, malformed and mismatched drafts never replace a valid indexed document', () => {
  const storage = memoryStorage()
  const repository = createWorkspaceDraftRepository('workspace', storage)
  const valid = createStudioDocument('Valid')
  const broken = { ...valid, id: 'broken' }
  repository.save(valid, indexFor(valid, broken))
  storage.setItem(workspaceImageDocumentKey('workspace', 'broken'), '{invalid')
  assert.equal(repository.loadDocument('broken'), undefined)
  assert.equal(repository.loadDocument('missing'), undefined)
  storage.setItem(workspaceImageDocumentKey('workspace', 'broken'), JSON.stringify(valid))
  assert.equal(repository.loadDocument('broken'), undefined)
  assert.deepEqual(repository.loadDocument(valid.id), valid)
})

test('storage failures propagate to the editor without claiming a draft was saved', () => {
  const storage = memoryStorage()
  const document = createStudioDocument()
  const repository = createWorkspaceDraftRepository('workspace', {
    ...storage,
    setItem() {
      throw new Error('Storage full')
    }
  })
  assert.throws(() => repository.save(document, indexFor(document)), /Storage full/)
  assert.equal(storage.getItem(workspaceImageIndexKey('workspace')), null)
  assert.equal(repository.loadDocument(document.id), undefined)
})

test('workspace cleanup removes indexed and orphan drafts without touching other workspaces', () => {
  const storage = memoryStorage()
  const document = createStudioDocument()
  createWorkspaceDraftRepository('work', storage).save(document, indexFor(document))
  createWorkspaceDraftRepository('work-2', storage).save(document, indexFor(document))
  storage.setItem(workspaceImageDocumentKey('work', 'orphan'), '{}')
  storage.setItem('unrelated', 'keep')
  clearWorkspaceImageDrafts('work', storage)
  assert.equal(storage.getItem(workspaceImageIndexKey('work')), null)
  assert.equal(storage.getItem(workspaceImageDocumentKey('work', 'orphan')), null)
  assert.equal(
    createWorkspaceDraftRepository('work-2', storage).loadDocument(document.id).id,
    document.id
  )
  assert.equal(storage.getItem('unrelated'), 'keep')
})

test('renaming updates both document and index while retaining content and active selection', () => {
  const storage = memoryStorage()
  const repository = createWorkspaceDraftRepository('work', storage)
  const first = createStudioDocument('First')
  const second = createStudioDocument('Second')
  repository.save(first, indexFor(first))
  repository.save(second, indexFor(first, second))
  repository.rename(first.id, '  Renamed  ')
  const updated = repository.loadDocument(first.id)
  assert.deepEqual(updated, { ...first, name: 'Renamed', updatedAt: updated.updatedAt })
  assert.equal(repository.loadIndex().docs[0].name, 'Renamed')
  assert.equal(repository.loadIndex().activeId, second.id)
  assert.throws(() => repository.rename(first.id, '  '), /作品名称/)
})

test('deleting a work updates the active index and leaves the last deletion empty', () => {
  const storage = memoryStorage()
  const repository = createWorkspaceDraftRepository('work', storage)
  const first = createStudioDocument('First')
  const second = createStudioDocument('Second')
  repository.save(first, indexFor(first))
  repository.save(second, indexFor(first, second))
  storage.setItem('source-media', 'keep')
  repository.deleteEntry(second.id)
  assert.equal(repository.loadDocument(second.id), undefined)
  assert.deepEqual(repository.loadIndex(), indexFor(first))
  repository.deleteEntry(first.id)
  assert.equal(repository.loadDocument(first.id), undefined)
  assert.equal(repository.loadIndex()?.docs.length ?? 0, 0)
  assert.equal(storage.getItem('source-media'), 'keep')
})

test('failed index writes do not leave a renamed document or delete content', () => {
  const storage = memoryStorage()
  const document = createStudioDocument('Original')
  createWorkspaceDraftRepository('work', storage).save(document, indexFor(document))
  const repository = createWorkspaceDraftRepository('work', {
    ...storage,
    setItem(key, value) {
      if (key === workspaceImageIndexKey('work')) throw new Error('Storage full')
      storage.setItem(key, value)
    }
  })
  assert.throws(() => repository.rename(document.id, 'Changed'), /Storage full/)
  assert.deepEqual(repository.loadDocument(document.id), document)
  assert.throws(() => repository.deleteEntry(document.id), /Storage full/)
  assert.deepEqual(repository.loadDocument(document.id), document)
  assert.deepEqual(repository.loadIndex(), indexFor(document))
})
