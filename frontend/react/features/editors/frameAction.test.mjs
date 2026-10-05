import assert from 'node:assert/strict'
import test from 'node:test'
import { createFrameAction } from './frameAction.ts'

function harness() {
  let id = 0
  const frames = new Map()
  const queue = createFrameAction(
    (callback) => {
      frames.set(++id, callback)
      return id
    },
    (id) => frames.delete(id)
  )
  return { queue, frames, tick: () => [...frames.values()].forEach((callback) => callback()) }
}

test('high-rate input runs only the latest update per frame and release applies its final position', () => {
  const { queue, frames, tick } = harness()
  const applied = []
  for (let position = 0; position < 100; position++) queue.schedule(() => applied.push(position))
  assert.equal(frames.size, 1)
  tick()
  assert.deepEqual(applied, [99])
  queue.schedule(() => applied.push(100))
  queue.flush(() => applied.push(101))
  tick()
  assert.deepEqual(applied, [99, 101])
  assert.equal(frames.size, 0)
})

test('cancel and teardown discard stale input; a subsequent gesture starts cleanly', () => {
  const { queue, frames, tick } = harness()
  const applied = []
  queue.schedule(() => applied.push('cancelled'))
  queue.cancel()
  assert.equal(frames.size, 0)
  tick()
  queue.schedule(() => applied.push('next'))
  queue.flush()
  tick()
  assert.deepEqual(applied, ['next'])
})
