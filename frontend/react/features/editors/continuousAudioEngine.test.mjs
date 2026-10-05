import test from 'node:test'
import assert from 'node:assert/strict'
import { ContinuousAudioEngine, prepareAudioPreview } from './continuousAudioEngine.ts'

function setup(load) {
  const starts = [],
    errors = [],
    states = [],
    sources = [],
    gains = [],
    times = [],
    meters = []
  const context = {
    currentTime: 0,
    destination: {},
    resume: async () => {},
    close: async () => {},
    createGain: () => {
      const calls = []
      const gain = {
        value: 1,
        cancelScheduledValues(time) {
          calls.push(['cancel', time])
        },
        setValueAtTime(value, time) {
          this.value = value
          calls.push(['set', value, time])
        },
        linearRampToValueAtTime(value, time) {
          this.value = value
          calls.push(['ramp', value, time])
        },
        setTargetAtTime(value, time, constant) {
          this.value = value
          calls.push(['target', value, time, constant])
        }
      }
      const bus = { gain, calls, connect() {}, disconnect() {} }
      gains.push(bus)
      return bus
    },
    createBufferSource: () => {
      const source = {
        connect() {},
        disconnect() {},
        stop(when) {
          this.stopped = true
          this.stopTime = when
        },
        start(when, offset, duration) {
          starts.push({ when, offset, duration, source: this })
        }
      }
      sources.push(source)
      return source
    }
  }
  const engine = new ContinuousAudioEngine(context, load, {
    time(time) {
      times.push(time)
    },
    state: (...state) => states.push(state),
    levels(...level) {
      meters.push(level)
    },
    ended() {},
    error: (error) => errors.push(error)
  })
  return { engine, context, starts, errors, states, sources, gains, times, meters }
}
test('two prefetched chunks share an exact audio clock boundary and stop clears sources', async () => {
  const calls = []
  const state = setup(async (_, start, duration) => {
    calls.push({ start, duration })
    return { buffer: { duration } }
  })
  await state.engine.play({ document: { tracks: [] }, start: 0, end: 30 })
  assert.equal(calls.length, 2)
  assert.equal(state.starts[1].when, state.starts[0].when + 12)
  state.engine.stop()
  assert.ok(state.sources.every((source) => source.stopped))
})
test('stopped in-flight previews never schedule late audio', async () => {
  let complete
  const state = setup(
    () =>
      new Promise((resolve) => {
        complete = resolve
      })
  )
  const promise = state.engine.play({ document: { tracks: [] }, start: 0, end: 12 })
  await Promise.resolve()
  state.engine.stop()
  complete({ buffer: { duration: 12 } })
  await promise
  assert.equal(state.starts.length, 0)
  assert.equal(state.errors.length, 0)
})
test('incomplete render reports failure rather than silently advancing the timeline', async () => {
  const state = setup(async () => ({ buffer: { duration: 1 } }))
  await state.engine.play({ document: { tracks: [] }, start: 0, end: 12 })
  assert.equal(state.errors.length, 1)
  assert.equal(state.starts.length, 0)
})

const document = (gain = 1, processing) => ({
  version: 1,
  tracks: [],
  masterGain: gain,
  processing
})
const turn = () => new Promise((resolve) => setImmediate(resolve))

test('live master gain including zero restores without new render or playback interruption', async () => {
  const calls = []
  const state = setup(async (doc, start, duration) => {
    calls.push({ doc, start, duration })
    return { buffer: { duration }, levels: Array(240).fill([1.5, 0.5]) }
  })
  try {
    await state.engine.play({
      document: document(0),
      start: 4.5,
      end: 7.25,
      loop: { start: 4.5, end: 7.25 }
    })
    const count = calls.length,
      states = state.states.length
    state.context.currentTime = 0.5
    for (const gain of [1, 0.99, 0, 0.6])
      await state.engine.update({
        document: document(gain),
        end: 7.25,
        loop: { start: 4.5, end: 7.25 }
      })
    assert.equal(calls.length, count)
    assert.ok(calls.every((call) => call.doc.masterGain === 1))
    assert.equal(state.gains[0].gain.value, 0.6)
    assert.ok(state.sources.every((source) => !source.stopped))
    assert.ok(state.states.slice(states).every(([playing]) => playing))
    await new Promise((resolve) => setTimeout(resolve, 45))
    assert.deepEqual(state.meters.at(-1), [0.8999999999999999, 0.3])
  } finally {
    state.engine.stop()
  }
})

test('mastering keeps gain inside DSP and a new snapshot crossfades on the same clock boundary', async () => {
  const calls = []
  const state = setup(async (doc, start, duration) => {
    calls.push({ doc, start, duration })
    return { buffer: { duration } }
  })
  try {
    await state.engine.play({ document: document(1, { compressor: 'voice' }), start: 0, end: 30 })
    const oldCount = state.sources.length
    state.context.currentTime = 2
    await state.engine.update({ document: document(0.99, { compressor: 'voice' }), end: 30 })
    assert.equal(calls[2].doc.masterGain, 0.99)
    const replacement = state.starts[oldCount]
    assert.equal(replacement.when, 2.025)
    assert.ok(Math.abs(replacement.offset - 0.025) < 1e-9)
    const oldRamp = state.gains[0].calls.find((entry) => entry[0] === 'ramp')
    const newRamp = state.gains[1].calls.find((entry) => entry[0] === 'ramp')
    assert.equal(oldRamp[2], newRamp[2])
    assert.equal(oldRamp[2], replacement.when + 0.025)
    assert.equal(state.sources[0].stopTime, newRamp[2])
    assert.ok(
      state.gains[0].calls.some((entry) => entry[0] === 'set' && entry[2] === replacement.when)
    )
    assert.ok(state.times.at(-1) >= 2)
  } finally {
    state.engine.stop()
  }
})

test('superseded renders cannot replace the latest document, even if responses arrive out of order', async () => {
  const pending = []
  const state = setup(async (doc, start, duration, signal) => {
    if (!doc.processing) return { buffer: { duration } }
    return new Promise((resolve) => pending.push({ resolve, doc, duration, signal }))
  })
  try {
    await state.engine.play({ document: document(), start: 0, end: 12 })
    state.context.currentTime = 2
    const first = state.engine.update({ document: document(1, { equalizer: 'warm' }), end: 12 })
    const second = state.engine.update({ document: document(1, { equalizer: 'bright' }), end: 12 })
    assert.equal(pending[0].signal.aborted, true)
    pending[1].resolve({ buffer: { duration: pending[1].duration } })
    await second
    const count = state.starts.length
    pending[0].resolve({ buffer: { duration: pending[0].duration } })
    await first
    assert.equal(state.starts.length, count)
    assert.equal(state.errors.length, 0)
    assert.equal(state.gains.at(-1).gain.value, 1)
  } finally {
    state.engine.stop()
  }
})

test('undo to current snapshot cancels replacement and resumes an aborted prefetch', async () => {
  const delayed = []
  const state = setup(async (doc, start, duration, signal) => {
    if (start >= 12 || doc.processing)
      return new Promise((resolve) => delayed.push({ resolve, duration, signal }))
    return { buffer: { duration } }
  })
  try {
    const playing = state.engine.play({ document: document(), start: 0, end: 30 })
    await turn()
    const replacing = state.engine.update({ document: document(1, { equalizer: 'warm' }), end: 30 })
    await state.engine.update({ document: document(), end: 30 })
    assert.equal(delayed[0].signal.aborted, true)
    assert.equal(delayed[1].signal.aborted, true)
    delayed[0].resolve({ buffer: { duration: delayed[0].duration } })
    delayed[1].resolve({ buffer: { duration: delayed[1].duration } })
    await Promise.all([playing, replacing])
    await new Promise((resolve) => setTimeout(resolve, 45))
    assert.equal(delayed.length, 3)
    assert.equal(delayed[2].signal.aborted, false)
    delayed[2].resolve({ buffer: { duration: delayed[2].duration } })
    await turn()
    assert.equal(state.starts.length, 2)
    assert.equal(state.errors.length, 0)
  } finally {
    state.engine.stop()
  }
})

test('rendering across a loop wrap replaces at the actual current position without losing the loop', async () => {
  let finish
  const state = setup(async (doc, start, duration) => {
    if (doc.processing)
      return new Promise((resolve) => {
        finish = () => resolve({ buffer: { duration } })
      })
    return { buffer: { duration } }
  })
  try {
    await state.engine.play({
      document: document(),
      start: 4.5,
      end: 7.25,
      loop: { start: 4.5, end: 7.25 }
    })
    state.context.currentTime = 2.7
    const count = state.starts.length
    const update = state.engine.update({
      document: document(1, { limiter: true }),
      end: 7.25,
      loop: { start: 4.5, end: 7.25 }
    })
    state.context.currentTime = 3.2
    finish()
    await update
    assert.ok(Math.abs(state.starts[count].offset - 0.45) < 1e-8)
    assert.ok(state.times.at(-1) >= 4.5 && state.times.at(-1) < 7.25)
    assert.equal(state.errors.length, 0)
  } finally {
    state.engine.stop()
  }
})

test('pause during replacement aborts all work and late audio never resumes', async () => {
  let finish, signal
  const state = setup(async (doc, start, duration, controllerSignal) => {
    if (doc.processing)
      return new Promise((resolve) => {
        signal = controllerSignal
        finish = () => resolve({ buffer: { duration } })
      })
    return { buffer: { duration } }
  })
  await state.engine.play({ document: document(), start: 0, end: 12 })
  const updating = state.engine.update({ document: document(1, { limiter: true }), end: 12 })
  const count = state.starts.length
  state.engine.stop()
  finish()
  await updating
  assert.equal(signal.aborted, true)
  assert.equal(state.starts.length, count)
  assert.deepEqual(state.states.at(-1), [false, false])
})

test('gain changes while a track render is pending use the newest gain when it becomes audible', async () => {
  let finish
  let renders = 0
  const state = setup(async (doc, start, duration) => {
    if (doc.tracks.length) {
      renders++
      return new Promise((resolve) => {
        finish = () => resolve({ buffer: { duration } })
      })
    }
    return { buffer: { duration } }
  })
  try {
    await state.engine.play({ document: document(), start: 0, end: 12 })
    const changed = { ...document(), tracks: [{ id: 'track', gain: 0.5, clips: [] }] }
    const pending = state.engine.update({ document: changed, end: 12 })
    await state.engine.update({ document: { ...changed, masterGain: 0.4 }, end: 12 })
    finish()
    await pending
    assert.equal(renders, 1)
    assert.equal(state.gains.at(-1).gain.value, 0.4)
    assert.equal(state.errors.length, 0)
  } finally {
    state.engine.stop()
  }
})

test('shortening the document past the current position stops at its new end', async () => {
  const state = setup(async (_, start, duration) => ({ buffer: { duration } }))
  await state.engine.play({ document: document(), start: 0, end: 30 })
  state.context.currentTime = 20
  await state.engine.update({ document: document(), end: 4 })
  assert.equal(state.times.at(-1), 4)
  assert.deepEqual(state.states.at(-1), [false, false])
})

test('only bypassed master processing permits live gain', () => {
  assert.equal(prepareAudioPreview(document(0)).gain, 0)
  for (const processing of [
    { compressor: 'gentle' },
    { normalize: 'music' },
    { limiter: true },
    { equalizer: 'warm' },
    { deess: true },
    { denoise: 'light' }
  ]) {
    const prepared = prepareAudioPreview(document(0.4, processing))
    assert.equal(prepared.gain, 1)
    assert.equal(prepared.document.masterGain, 0.4)
  }
})
