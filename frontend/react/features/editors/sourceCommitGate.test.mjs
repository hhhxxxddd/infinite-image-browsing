import test from 'node:test'
import assert from 'node:assert/strict'
import { createSourceCommitGate } from './sourceCommitGate.ts'

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

test('metadata preflight is cancellable without starting the parent commit', async () => {
  const gate = createSourceCommitGate()
  const metadata = deferred()
  let live = true,
    commits = 0
  const checking = metadata.promise.then(async () => {
    if (!live) return
    await gate.run(
      () => commits++,
      () => {}
    )
  })
  assert.equal(
    gate.requestClose(() => {
      live = false
    }),
    true
  )
  metadata.resolve()
  await checking
  assert.equal(commits, 0)
})

test('all close attempts are refused synchronously until the parent async commit completes', async () => {
  const gate = createSourceCommitGate()
  const pending = deferred()
  const states = []
  let closes = 0
  const submitting = gate.run(
    () => pending.promise,
    (value) => states.push(value)
  )
  for (const entry of ['cancel', 'escape', 'overlay', 'close-button']) {
    assert.equal(
      gate.requestClose(() => closes++),
      false,
      entry
    )
  }
  assert.equal(gate.committing, true)
  await assert.rejects(
    gate.run(
      () => assert.fail('duplicate mutation'),
      () => {}
    ),
    /正在提交/
  )
  pending.resolve('done')
  assert.equal(await submitting, 'done')
  assert.equal(
    gate.requestClose(() => closes++),
    true
  )
  assert.equal(closes, 1)
  assert.deepEqual(states, [true, false])
})

test('failed or synchronously throwing commits release the close gate and can be retried', async () => {
  const gate = createSourceCommitGate()
  const pending = deferred()
  const submitting = gate.run(
    () => pending.promise,
    () => {}
  )
  pending.reject(new Error('metadata changed'))
  await assert.rejects(submitting, /metadata changed/)
  assert.equal(
    gate.requestClose(() => {}),
    true
  )
  await assert.rejects(
    gate.run(
      () => {
        throw new Error('read only')
      },
      () => {}
    ),
    /read only/
  )
  assert.equal(gate.committing, false)
  assert.equal(
    await gate.run(
      () => 'retried',
      () => {}
    ),
    'retried'
  )
})
