import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createProductionDraft,
  createWorkspaceWork,
  createWorkspaceWorksRepository
} from '../../../src/features/workspaces/model/workspaceWorks.ts'
import { editorNotesLimit, saveEditorNotes } from './editorNotesModel.ts'
import { EditorSaveQueue } from './editorSaveQueue.ts'

function fixture() {
  const values = new Map()
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  }
  const scope = { workspaceId: 'workspace', workId: 'work', draftId: 'draft' }
  const work = createWorkspaceWork('作品', scope.workId)
  work.brief = '业务目标'
  work.drafts = [
    { ...createProductionDraft('audio', '声音制作', scope.draftId), brief: '初稿' },
    { ...createProductionDraft('video', '视频制作', 'sibling'), brief: '其他笔记' }
  ]
  const repository = createWorkspaceWorksRepository(scope.workspaceId, storage)
  repository.save({ version: 2, activeId: scope.workId, works: [work] })
  return { storage, values, scope, repository }
}

test('a stale editor cannot overwrite notes saved by another window', async () => {
  const { storage, scope, repository } = fixture()
  let expected = '初稿'
  const staleQueue = new EditorSaveQueue(expected, async (value) => {
    saveEditorNotes(storage, scope, expected, value)
    expected = value
  })
  staleQueue.update('第二个窗口的修改')
  saveEditorNotes(storage, scope, '初稿', '第一个窗口已保存')
  await assert.rejects(staleQueue.flush(), /其他窗口修改/)
  assert.equal(staleQueue.dirty, true)
  assert.equal(repository.load().works[0].drafts[0].brief, '第一个窗口已保存')
})

test('edits made while a note save is pending are flushed after the saved revision', async () => {
  const { storage, scope, repository } = fixture()
  let expected = '初稿'
  let release
  const blocked = new Promise((resolve) => {
    release = resolve
  })
  const written = []
  const queue = new EditorSaveQueue(expected, async (value) => {
    if (!written.length) await blocked
    saveEditorNotes(storage, scope, expected, value)
    expected = value
    written.push(value)
  })
  queue.update('第一次编辑')
  const first = queue.flush()
  await Promise.resolve()
  queue.update('保存期间继续编辑')
  const second = queue.flush()
  release()
  await Promise.all([first, second])
  assert.deepEqual(written, ['第一次编辑', '保存期间继续编辑'])
  assert.equal(repository.load().works[0].drafts[0].brief, '保存期间继续编辑')
  assert.equal(queue.dirty, false)
})

test('saving notes preserves current work metadata and sibling production files', () => {
  const { storage, scope, repository } = fixture()
  const changed = repository.load()
  changed.works[0].name = '另一个窗口修改的作品名'
  changed.works[0].drafts[0].name = '已经重命名的制作文件'
  repository.save(changed)
  saveEditorNotes(storage, scope, '初稿', '新笔记')
  const work = repository.load().works[0]
  assert.equal(work.name, changed.works[0].name)
  assert.equal(work.brief, '业务目标')
  assert.equal(work.drafts[0].name, changed.works[0].drafts[0].name)
  assert.equal(work.drafts[0].brief, '新笔记')
  assert.deepEqual(work.drafts[1], changed.works[0].drafts[1])
})

test('retrying an already applied save is safe after a response is lost', () => {
  const { storage, scope, repository } = fixture()
  saveEditorNotes(storage, scope, '初稿', '提交内容')
  saveEditorNotes(storage, scope, '初稿', '提交内容')
  assert.equal(repository.load().works[0].drafts[0].brief, '提交内容')
})

test('deleted or moved production files cannot receive a delayed note save', () => {
  const { storage, values, scope, repository } = fixture()
  const changed = repository.load()
  const target = changed.works[0].drafts.shift()
  const other = createWorkspaceWork('另一作品', 'other')
  other.drafts = [target]
  changed.works.push(other)
  repository.save(changed)
  const before = [...values.entries()]
  assert.throws(() => saveEditorNotes(storage, scope, '初稿', '过期修改'), /删除或已移出/)
  assert.deepEqual([...values.entries()], before)
})

test('oversized notes are rejected instead of being silently truncated on reopen', () => {
  const { storage, values, scope, repository } = fixture()
  const before = [...values.entries()]
  assert.throws(
    () => saveEditorNotes(storage, scope, '初稿', '字'.repeat(editorNotesLimit + 1)),
    /最多支持 5000 字/
  )
  assert.deepEqual([...values.entries()], before)
  const largest = '字'.repeat(editorNotesLimit)
  saveEditorNotes(storage, scope, '初稿', largest)
  assert.equal(repository.load().works[0].drafts[0].brief, largest)
})
