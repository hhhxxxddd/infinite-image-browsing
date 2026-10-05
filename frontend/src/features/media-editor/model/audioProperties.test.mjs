import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createAudioTimeline,
  createAudioClip,
  trimClip,
  readAudioTimeline,
  clipEnvelope
} from './audioTimeline.ts'
import {
  captureClipProperties,
  captureTrackProperties,
  captureMasterProperties,
  applyAudioProperties,
  readAudioPresets,
  validAudioProperties
} from './audioProperties.ts'
test('clip settings batch apply without copying sources, identities or placement and scale the visible gain curve', () => {
  const doc = createAudioTimeline(),
    a = createAudioClip('a.wav', 'A', 10),
    b = createAudioClip('b.wav', 'B', 4, 12)
  const source = trimClip(
    {
      ...a,
      gain: 0.7,
      pan: -0.4,
      fadeIn: 1,
      fadeOut: 1,
      fadeCurve: 'equalPower',
      gainPoints: [
        { time: 0, gain: 1 },
        { time: 5, gain: 0.4 },
        { time: 10, gain: 0.8 }
      ],
      channels: 'swap',
      invertPhase: true
    },
    2,
    8
  )
  doc.tracks[0].clips = [a, b]
  const properties = captureClipProperties(source),
    next = applyAudioProperties(doc, properties, [a.id, b.id])
  assert.equal(next.tracks[0].clips[1].path, b.path)
  assert.equal(next.tracks[0].clips[1].id, b.id)
  assert.equal(next.tracks[0].clips[1].start, 12)
  assert.equal(next.tracks[0].clips[1].duration, 4)
  assert.equal(next.tracks[0].clips[1].gain, 0.7)
  assert.equal(next.tracks[0].clips[1].gainPoints[1].time, 2)
  assert.ok(
    Math.abs(clipEnvelope({ ...next.tracks[0].clips[1], fadeIn: 0, fadeOut: 0 }, 2) - 0.28) < 1e-12
  )
  assert.deepEqual(readAudioTimeline(JSON.stringify(next)), next)
  doc.tracks[0].locked = true
  assert.throws(() => applyAudioProperties(doc, properties, [a.id]), /解锁/)
  assert.equal(a.gain, 1)
  assert.equal(properties.fadeIn, 0)
  assert.equal(properties.fadeOut, 0)
})

test('copied fades contain only the visible remainder after trims and splits', () => {
  const source = createAudioClip('a.wav', 'A', 10)
  const partial = trimClip({ ...source, fadeIn: 3, fadeOut: 3 }, 2, 8)
  const properties = captureClipProperties(partial)
  assert.equal(properties.fadeIn, 1)
  assert.equal(properties.fadeOut, 1)
  const doc = createAudioTimeline()
  doc.tracks[0].clips = [createAudioClip('b.wav', 'B', 4)]
  const target = applyAudioProperties(doc, properties, [doc.tracks[0].clips[0].id]).tracks[0]
    .clips[0]
  assert.equal(target.envelopeOffset, 0)
  assert.equal(target.fadeIn, 1)
  assert.equal(target.fadeOut, 1)
})
test('track and master presets copy only matching audio processing settings', () => {
  const doc = createAudioTimeline()
  doc.tracks[0].processing = { equalizer: 'custom', eq: { low: 3, mid: 0, high: -2 }, bypass: true }
  const track = captureTrackProperties(doc.tracks[0])
  assert.equal(validAudioProperties(track), true)
  assert.equal(
    applyAudioProperties(doc, track, [doc.tracks[0].id]).tracks[0].processing.bypass,
    true
  )
  const master = captureMasterProperties({ ...doc, masterGain: 0, processing: { limiter: true } })
  assert.equal(applyAudioProperties(doc, master, []).masterGain, 0)
  assert.equal(applyAudioProperties(doc, master, []).processing.limiter, true)
})
test('persistent presets reject embedded media, duplicates, invalid curves and oversized storage', () => {
  const properties = captureClipProperties(createAudioClip('private.wav', 'Voice', 2)),
    preset = { id: 'preset', name: '声音', properties }
  assert.deepEqual(readAudioPresets(JSON.stringify([preset])), [preset])
  assert.throws(() =>
    readAudioPresets(
      JSON.stringify([{ ...preset, properties: { ...properties, path: 'private.wav' } }])
    )
  )
  assert.throws(() => readAudioPresets(JSON.stringify([preset, preset])))
  assert.throws(() => readAudioPresets('x'.repeat(256 * 1024 + 1)))
  assert.equal(validAudioProperties({ ...properties, points: [{ time: 1.00001, gain: 1 }] }), false)
  assert.equal(validAudioProperties({ ...properties, points: [null] }), false)
  assert.equal(
    validAudioProperties({ ...properties, points: [{ time: 0, gain: 1, path: 'private.wav' }] }),
    false
  )
  assert.throws(() => readAudioPresets(JSON.stringify([{ ...preset, path: 'private.wav' }])))
})
