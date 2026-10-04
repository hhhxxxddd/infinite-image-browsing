import assert from 'node:assert/strict'
import test from 'node:test'
import { submitImageToolRequest } from './imageToolSubmission.ts'

function storage(values = new Map()) {
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  }
}

test('lost submission responses reuse the completed task after reload for every built-in tool', async () => {
  for (const operation of ['erase', 'cutout', 'upscale']) {
    const values = new Map()
    const jobs = new Map()
    let paidSubmissions = 0
    const backend = async (id) => {
      if (!jobs.has(id)) {
        paidSubmissions++
        jobs.set(id, { id, state: 'completed' })
      }
      return jobs.get(id)
    }
    await assert.rejects(
      submitImageToolRequest(storage(values), operation, async (id) => {
        await backend(id)
        throw new TypeError('response lost')
      }),
      /response lost/
    )
    const recovered = await submitImageToolRequest(storage(values), operation, backend)
    assert.equal(recovered.state, 'completed')
    assert.equal(paidSubmissions, 1)
    assert.equal(values.size, 0)
    // Once acknowledged, another click is an intentional new generation.
    const next = await submitImageToolRequest(storage(values), operation, backend)
    assert.notEqual(next.id, recovered.id)
    assert.equal(paidSubmissions, 2)
  }
})

test('changed input has a separate identity without discarding an uncertain earlier submission', async () => {
  const saved = storage()
  let first
  await assert.rejects(
    submitImageToolRequest(saved, 'original-input', async (id) => {
      first = id
      throw new Error('offline')
    })
  )
  const changed = await submitImageToolRequest(saved, 'changed-input', async (id) => id)
  assert.notEqual(changed, first)
  const retried = await submitImageToolRequest(saved, 'original-input', async (id) => id)
  assert.equal(retried, first)
})

test('unavailable persistence prevents a paid submission from starting', async () => {
  let sent = false
  const unavailable = {
    ...storage(),
    setItem: () => {
      throw new Error('storage full')
    }
  }
  await assert.rejects(
    submitImageToolRequest(unavailable, 'input', async () => {
      sent = true
    }),
    /storage full/
  )
  assert.equal(sent, false)
})
