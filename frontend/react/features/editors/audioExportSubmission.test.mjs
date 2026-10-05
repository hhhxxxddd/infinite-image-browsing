import test from 'node:test'
import assert from 'node:assert/strict'
import { mapStorage } from '../../../src/features/workspaces/model/workspaceStateStore.ts'
import { AudioExportSubmission, pendingAudioExportKey } from './audioExportSubmission.ts'

test('audio retry preserves all render options and original UUID after unknown/401 responses', async () => {
  const entries = new Map(),
    calls = []
  const input = {
    document: { version: 1, tracks: [], masterGain: 1 },
    revision: 'a'.repeat(64),
    name: 'mix',
    start: 3,
    duration: 42,
    format: 'mp3'
  }
  let failure = new Error('network')
  const options = {
    workspaceId: 'work',
    documentId: 'doc',
    read: () => mapStorage(entries, false),
    mutate: async (operation) => operation(mapStorage(entries)),
    createId: () => '00000000-0000-4000-8000-000000000001',
    post: async (body) => {
      calls.push(body)
      if (failure) throw failure
      const request = JSON.parse(body)
      return { id: request.task_id, ...request }
    }
  }
  const client = new AudioExportSubmission(options)
  await assert.rejects(client.submit(input))
  assert.ok(entries.has(pendingAudioExportKey('work', 'doc')))
  assert.deepEqual(
    Object.keys(JSON.parse(calls[0])).sort(),
    [
      'document',
      'document_id',
      'document_revision',
      'duration',
      'format',
      'name',
      'start',
      'task_id',
      'workspace_id'
    ].sort()
  )
  assert.equal(JSON.parse(calls[0]).duration, 42)
  assert.deepEqual(JSON.parse(calls[0]).document, input.document)
  failure = Object.assign(new Error('auth'), { status: 401 })
  const reopened = new AudioExportSubmission(options)
  await assert.rejects(reopened.retry())
  assert.equal(calls[0], calls[1])
  failure = null
  await reopened.retry()
  assert.equal(calls[0], calls[2])
  assert.equal(entries.size, 0)
})

test('invalid local audio export inputs never reserve an id or write a pending receipt', async () => {
  const entries = new Map()
  let posts = 0,
    ids = 0
  const client = new AudioExportSubmission({
    workspaceId: 'w',
    documentId: 'd',
    read: () => mapStorage(entries, false),
    mutate: async (operation) => operation(mapStorage(entries)),
    createId: () => {
      ids++
      return '00000000-0000-4000-8000-000000000001'
    },
    post: async () => {
      posts++
      throw new Error('should not post')
    }
  })
  const valid = {
    document: { version: 1, tracks: [], masterGain: 1 },
    revision: 'a'.repeat(64),
    name: 'audio',
    start: 0,
    duration: 2,
    format: 'wav'
  }
  for (const patch of [
    { name: 'x'.repeat(121) },
    { name: ' ' },
    { duration: 0 },
    { start: -1 },
    { start: 86400 },
    { format: 'flac' },
    { document: { version: 1, tracks: [] } }
  ])
    await assert.rejects(client.submit({ ...valid, ...patch }))
  assert.equal(entries.size, 0)
  assert.equal(posts, 0)
  assert.equal(ids, 0)
})
