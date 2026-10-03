import assert from 'node:assert/strict'
import test from 'node:test'
import { createStudioDocument } from '../../image-editor/public/document.ts'
import { createPersistentImageDraftRepository } from './persistentImageDraftRepository.ts'
import {
  createWorkspaceWork,
  createProductionDraft,
  assertProductionDraftExists,
  createWorkspaceWorksRepository,
  createWorkImageDraftRepository
} from './workspaceWorks.ts'
import { mapStorage } from './workspaceStateStore.ts'
import { createWorkspaceDraftRepository } from './workspaceDraftRepository.ts'
import { EditorSaveQueue } from '../../../../react/features/editors/editorSaveQueue.ts'

test('failed initial SQLite save can be retried, while another session deletion cannot be resurrected', async () => {
  let entries = new Map(),
    fail = true
  const storage = () => mapStorage(entries)
  const work = createWorkspaceWork('短剧', 'work')
  createWorkspaceWorksRepository('workspace', storage()).save({
    version: 2,
    activeId: work.id,
    works: [work]
  })
  const session = createPersistentImageDraftRepository(
    'workspace',
    work.id,
    storage,
    async (operation) => {
      const staged = new Map(entries)
      operation(mapStorage(staged))
      if (fail) throw new Error('disk error')
      entries = staged
    }
  )
  session.loadIndex()
  const doc = createStudioDocument('画布'),
    index = {
      version: 2,
      activeId: doc.id,
      docs: [{ id: doc.id, name: doc.name, updatedAt: doc.updatedAt }]
    }
  await assert.rejects(session.save(doc, index), /disk error/)
  fail = false
  await session.save(doc, index)
  assert.equal(session.loadDocument(doc.id).name, '画布')
  createWorkImageDraftRepository('workspace', work.id, storage()).remove(doc.id)
  await assert.rejects(session.save(doc, index), /修改|删除/)
  assert.equal(
    createWorkspaceWorksRepository('workspace', storage()).load().works[0].drafts.length,
    0
  )
})

test('an open canvas cannot silently overwrite edits committed by another window', async () => {
  const storage = mapStorage(new Map()),
    doc = createStudioDocument('画布')
  const work = createWorkspaceWork('短剧', 'work')
  createWorkspaceWorksRepository('workspace', storage).save({
    version: 2,
    activeId: work.id,
    works: [work]
  })
  const index = {
    version: 2,
    activeId: doc.id,
    docs: [{ id: doc.id, name: doc.name, updatedAt: doc.updatedAt }]
  }
  createWorkImageDraftRepository('workspace', work.id, storage).save(doc, index)
  const session = createPersistentImageDraftRepository(
    'workspace',
    work.id,
    () => storage,
    async (operation) => operation(storage)
  )
  const original = session.loadDocument(doc.id)
  createWorkImageDraftRepository('workspace', work.id, storage).save({ ...doc, width: 640 }, index)
  await assert.rejects(session.save({ ...original, width: 800 }, index), /其他窗口/)
  assert.equal(session.loadDocument(doc.id).width, 640)
})

test('saving notes with the same document name does not invalidate an open canvas', async () => {
  const storage = mapStorage(new Map()),
    doc = createStudioDocument('画布')
  const work = createWorkspaceWork('作品', 'work')
  createWorkspaceWorksRepository('workspace', storage).save({
    version: 2,
    activeId: work.id,
    works: [work]
  })
  const index = {
    version: 2,
    activeId: doc.id,
    docs: [{ id: doc.id, name: doc.name, updatedAt: doc.updatedAt }]
  }
  createWorkImageDraftRepository('workspace', work.id, storage).save(doc, index)
  const session = createPersistentImageDraftRepository(
    'workspace',
    work.id,
    () => storage,
    async (operation) => operation(storage)
  )
  const original = session.loadDocument(doc.id)
  createWorkspaceDraftRepository('workspace', storage).rename(doc.id, doc.name)
  await session.save({ ...original, width: 640 }, index)
  assert.equal(session.loadDocument(doc.id).width, 640)
})

test('a delayed AI save cannot recreate state for a deleted production file', () => {
  const storage = mapStorage(new Map()),
    repository = createWorkspaceWorksRepository('workspace', storage)
  const work = createWorkspaceWork('作品', 'work'),
    draft = createProductionDraft('ai', 'AI 制作', 'ai')
  work.drafts.push(draft)
  repository.save({ version: 2, activeId: work.id, works: [work] })
  assert.doesNotThrow(() => assertProductionDraftExists(storage, 'workspace', draft.id))
  repository.save({ version: 2, activeId: work.id, works: [{ ...work, drafts: [] }] })
  assert.throws(() => assertProductionDraftExists(storage, 'workspace', draft.id), /制作文件已删除/)
})

test('editor autosave retains conflict protection while reading a fresh index on every write', async () => {
  const storage = mapStorage(new Map())
  const work = createWorkspaceWork('Work', 'work')
  const document = createStudioDocument('Canvas')
  createWorkspaceWorksRepository('workspace', storage).save({
    version: 2,
    activeId: work.id,
    works: [work]
  })
  const initial = createWorkImageDraftRepository('workspace', work.id, storage)
  initial.save(document, { version: 2, activeId: document.id, docs: [] })
  const repository = createPersistentImageDraftRepository(
    'workspace',
    work.id,
    () => storage,
    async (operation) => operation(storage)
  )
  const open = repository.loadDocument(document.id)
  const saver = new EditorSaveQueue(open, async (snapshot) => {
    await repository.save(snapshot, repository.loadIndex())
  })
  initial.save({ ...document, width: 640 }, initial.loadIndex())
  saver.update({ ...open, width: 800 })
  await assert.rejects(saver.flush(), /其他窗口/)
  assert.equal(saver.dirty, true)
  assert.equal(initial.loadDocument(document.id).width, 640)
  initial.remove(document.id)
  await assert.rejects(saver.flush(), /修改|删除/)
  assert.equal(initial.loadDocument(document.id), undefined)
})
