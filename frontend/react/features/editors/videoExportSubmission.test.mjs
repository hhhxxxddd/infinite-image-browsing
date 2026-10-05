import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mapStorage } from '../../../src/features/workspaces/model/workspaceStateStore.ts'
import { VideoExportSubmission, scopedVideoExportTasks } from './videoExportSubmission.ts'

const workspaceId = 'workspace-1',
  documentId = 'document-1'
const taskId = '00000000-0000-4000-8000-000000000001'
const input = () => ({
  document: { version: 1, visuals: [{ path: 'source.mp4' }] },
  revision: 'a'.repeat(64),
  name: '成片.mp4'
})
const accepted = (request) => ({
  id: request.task_id,
  workspace_id: request.workspace_id,
  document_id: request.document_id,
  document_revision: request.document_revision,
  name: request.name,
  state: 'queued',
  phase: 'queued',
  progress: 0,
  error: '',
  created_at: 10,
  updated_at: 10,
  artifact: null
})

test('confirmation of an already deleted export acknowledges the same id without creating a new task', async () => {
  const state = setup()
  state.setPost(async () => {
    throw new Error('response lost')
  })
  await assert.rejects(state.client.submit(input()), /response lost/)
  const original = state.client.pending()
  state.setPost(async (body) => ({
    ...accepted(JSON.parse(body)),
    state: 'completed',
    deleted: true
  }))
  const result = await state.client.retry()
  assert.equal(result.task.id, original.task_id)
  assert.equal(result.task.deleted, true)
  assert.equal(state.client.pending(), null)
  assert.equal(state.calls.length, 2)
  assert.equal(scopedVideoExportTasks([result.task], workspaceId, documentId).length, 0)
})

function setup() {
  const entries = new Map()
  const calls = []
  let failSave = false
  let post = async (body) => accepted(JSON.parse(body))
  const dependencies = {
    workspaceId,
    documentId,
    createId: () => taskId,
    read: () => mapStorage(entries, false),
    mutate: async (operation) => {
      const staged = new Map(entries)
      const result = operation(mapStorage(staged))
      if (failSave) throw new Error('storage offline')
      entries.clear()
      for (const item of staged) entries.set(...item)
      return result
    },
    post: async (body) => {
      calls.push(body)
      assert.ok(entries.size, 'the durable receipt must exist before a POST')
      return post(body)
    }
  }
  return {
    client: new VideoExportSubmission(dependencies),
    reopen: () => new VideoExportSubmission(dependencies),
    calls,
    entries,
    setPost: (value) => {
      post = value
    },
    setFailSave: (value) => {
      failSave = value
    }
  }
}

test('video export persists the complete frozen snapshot before POST and clears a confirmed receipt', async () => {
  const state = setup(),
    doc = input()
  const promise = state.client.submit(doc)
  doc.document.visuals[0].path = 'changed.mp4'
  const result = await promise
  assert.equal(result.task.id, taskId)
  assert.equal(JSON.parse(state.calls[0]).document.visuals[0].path, 'source.mp4')
  assert.equal(state.client.pending(), null)
})

test('selection export freezes its range and rejects a different range while pending', async () => {
  const state = setup(),
    doc = { ...input(), range: { start: 1, end: 3 } }
  state.setPost(async () => {
    throw new Error('offline')
  })
  const submission = state.client.submit(doc)
  doc.range.end = 8
  await assert.rejects(submission, /offline/)
  assert.deepEqual(JSON.parse(state.calls[0]).range, { start: 1, end: 3 })
  await assert.rejects(state.client.submit({ ...input(), range: { start: 1, end: 8 } }), /尚未确认/)
})

test('unknown submission survives reopening and retries the identical task ID and full payload', async () => {
  const state = setup()
  state.setPost(async () => {
    throw new TypeError('response lost')
  })
  await assert.rejects(state.client.submit(input()), /response lost/)
  const reopened = state.reopen()
  assert.equal(reopened.pending().task_id, taskId)
  await assert.rejects(reopened.submit({ ...input(), name: 'new export.mp4' }), /上次导出尚未确认/)
  assert.equal(state.calls.length, 1)
  state.setPost(async (body) => accepted(JSON.parse(body)))
  await reopened.retry()
  assert.equal(state.calls[1], state.calls[0])
  assert.equal(reopened.pending(), null)
})

test('a failed durable save never starts video rendering', async () => {
  const state = setup()
  state.setFailSave(true)
  await assert.rejects(state.client.submit(input()), /storage offline/)
  assert.equal(state.calls.length, 0)
})

test('authentication, validation, and other HTTP failures after a lost response preserve the original task', async () => {
  for (const status of [400, 401, 403, 404, 409, 413, 422, 429, 503, 507]) {
    const state = setup()
    state.setPost(async () => {
      throw new TypeError('response lost after acceptance')
    })
    await assert.rejects(state.client.submit(input()), /response lost/)
    const original = state.calls[0]
    state.setPost(async () => {
      throw Object.assign(new Error(`HTTP ${status}`), { status })
    })
    await assert.rejects(state.reopen().retry(), { message: `HTTP ${status}` })
    assert.equal(state.client.pending().task_id, taskId, `HTTP ${status} cannot prove non-creation`)
    assert.equal(state.calls[1], original)
    state.setPost(async (body) => accepted(JSON.parse(body)))
    await state.reopen().retry()
    assert.equal(state.calls[2], original)
    assert.equal(state.client.pending(), null)
  }
})

test('only an explicit post-deduplication notCreated marker releases a rejected submission', async () => {
  for (const notCreated of [true, false, undefined, 'true']) {
    const state = setup()
    state.setPost(async () => {
      throw Object.assign(new Error('queue full'), { status: 429, notCreated })
    })
    await assert.rejects(state.client.submit(input()), /queue full/)
    assert.equal(state.client.pending() === null, notCreated === true)
  }
})

test('accepted export stays successful when cleanup fails and can safely confirm the same task later', async () => {
  const state = setup()
  state.setPost(async (body) => {
    state.setFailSave(true)
    return accepted(JSON.parse(body))
  })
  const result = await state.client.submit(input())
  assert.equal(result.task.state, 'queued')
  assert.match(result.warning, /已确认/)
  assert.equal(state.client.pending().task_id, taskId)
  state.setFailSave(false)
  state.setPost(async (body) => accepted(JSON.parse(body)))
  await state.client.retry()
  assert.equal(state.calls[1], state.calls[0])
})

test('refresh acknowledges only the task corresponding to the saved receipt', async () => {
  const state = setup()
  state.setPost(async () => {
    throw new TypeError('offline')
  })
  await assert.rejects(state.client.submit(input()))
  const result = accepted(state.client.pending())
  await assert.rejects(
    state.client.acknowledge({ ...result, document_revision: 'b'.repeat(64) }),
    /任务内容不一致/
  )
  assert.ok(state.client.pending())
  await state.client.acknowledge(result)
  assert.equal(state.client.pending(), null)
})

test('video export polling isolates workspace and production identities and sorts newest first', () => {
  const base = accepted({
    ...input(),
    task_id: taskId,
    workspace_id: workspaceId,
    document_id: documentId,
    document_revision: 'a'.repeat(64)
  })
  const scoped = scopedVideoExportTasks(
    [
      base,
      { ...base, id: 'wrong-workspace', workspace_id: 'other' },
      { ...base, id: 'wrong-file', document_id: 'other' },
      { ...base, id: 'new', created_at: 20 }
    ],
    workspaceId,
    documentId
  )
  assert.deepEqual(
    scoped.map((task) => task.id),
    ['new', taskId]
  )
})
