import assert from 'node:assert/strict'
import test from 'node:test'
import { ImageToolReceipts } from './imageToolReceipts.ts'
import { EditorSaveQueue } from './editorSaveQueue.ts'

test('failed saves keep results recoverable; successful retry acknowledges only captured results', async () => {
  const receipts = new ImageToolReceipts()
  let fail = true
  let release
  const wait = new Promise((resolve) => {
    release = resolve
  })
  const queue = new EditorSaveQueue({ result: '' }, async () => {
    await wait
    if (fail) throw new Error('offline')
  })
  receipts.handled.add('first')
  queue.update({ result: 'first' })
  const saved = receipts.captureSave()
  const saving = queue.flush().then(saved)
  receipts.handled.add('later')
  release()
  await assert.rejects(saving, /offline/)
  assert.deepEqual([...receipts.durable], [])
  assert.equal(queue.dirty, true)
  fail = false
  await queue.flush().then(saved)
  assert.deepEqual([...receipts.durable], ['first'])
  assert.equal(receipts.handled.has('later'), true)
})

test('saving an intentional undo records the session decision; unsaved processing does not survive reload', () => {
  const receipts = new ImageToolReceipts()
  receipts.handled.add('undone')
  assert.deepEqual([...receipts.durable], [])
  receipts.captureSave()()
  const reloaded = new ImageToolReceipts()
  for (const id of receipts.durable) reloaded.handled.add(id)
  assert.equal(reloaded.handled.has('undone'), true)
  receipts.handled.add('unsaved')
  assert.equal(reloaded.handled.has('unsaved'), false)
})
