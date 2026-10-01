import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequestCoalescer } from './requestCoalescer.ts'

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('concurrent readers share one request; settled reads are fresh', async () => {
  const reads = createRequestCoalescer()
  const response = deferred()
  let count = 0
  const request = () => {
    count++
    return response.promise
  }
  const first = reads.read('audio:a', request)
  const second = reads.read('audio:a', request)
  assert.equal(first, second)
  response.resolve('metadata')
  assert.deepEqual(await Promise.all([first, second]), ['metadata', 'metadata'])
  assert.equal(count, 1)
  assert.equal(await reads.read('audio:a', async () => 'new metadata'), 'new metadata')
})

test('a failed read can be retried', async () => {
  const reads = createRequestCoalescer()
  await assert.rejects(
    reads.read('a', async () => {
      throw new Error('offline')
    }),
    /offline/
  )
  assert.equal(await reads.read('a', async () => 'online'), 'online')
})

test('writes invalidate pending reads without letting their completion evict the new read', async () => {
  const reads = createRequestCoalescer()
  const old = deferred()
  const fresh = deferred()
  const beforeWrite = reads.read('a', () => old.promise)
  reads.forget('a')
  const afterWrite = reads.read('a', () => fresh.promise)
  old.resolve('old')
  assert.equal(await beforeWrite, 'old')
  assert.equal(
    reads.read('a', async () => 'unexpected'),
    afterWrite
  )
  fresh.resolve('new')
  assert.equal(await afterWrite, 'new')
})
