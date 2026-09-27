import assert from 'node:assert/strict'
import test from 'node:test'
import { makeAsyncFunctionSingle } from './singleFlight.ts'

test('concurrent calls share the first invocation and preserve its receiver and arguments', async () => {
  let calls = 0
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const target = {
    prefix: 'first',
    run: makeAsyncFunctionSingle(async function (value) {
      calls++
      await gate
      return `${this.prefix}:${value}`
    })
  }
  const first = target.run(1)
  const second = target.run(2)
  assert.equal(first, second)
  release()
  assert.equal(await second, 'first:1')
  assert.equal(calls, 1)
  assert.equal(await target.run(3), 'first:3')
  assert.equal(calls, 2)
})

test('a rejected invocation does not keep the next attempt stuck', async () => {
  let calls = 0
  const run = makeAsyncFunctionSingle(async () => {
    if (++calls === 1) throw new Error('temporary failure')
    return 'recovered'
  })
  await assert.rejects(run(), /temporary failure/)
  assert.equal(await run(), 'recovered')
})
