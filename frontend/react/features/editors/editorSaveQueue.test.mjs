import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EditorSaveQueue } from './editorSaveQueue.ts'

test('a concurrent flush waits for and saves the newest revision', async () => {
  let release
  const firstWrite = new Promise((resolve) => {
    release = resolve
  })
  const written = []
  const queue = new EditorSaveQueue({ value: 0 }, async (snapshot) => {
    if (snapshot.value === 1) await firstWrite
    written.push(snapshot.value)
  })
  queue.update({ value: 1 })
  const first = queue.flush()
  await Promise.resolve()
  await Promise.resolve()
  queue.update({ value: 2 })
  const second = queue.flush()
  release()
  await Promise.all([first, second])
  assert.deepEqual(written, [1, 2])
  assert.equal(queue.dirty, false)
})

test('failed save stays dirty and can be retried without losing the draft', async () => {
  let fail = true
  const written = []
  const queue = new EditorSaveQueue({ value: 0 }, async (snapshot) => {
    if (fail) throw new Error('offline')
    written.push(snapshot.value)
  })
  queue.update({ value: 3 })
  await assert.rejects(queue.flush(), /offline/)
  assert.equal(queue.dirty, true)
  fail = false
  await queue.flush()
  assert.deepEqual(written, [3])
  assert.equal(queue.dirty, false)
})
