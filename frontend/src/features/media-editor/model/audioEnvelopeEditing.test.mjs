import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createAudioClip,
  clipEnvelope,
  trimClip,
  splitClip,
  readAudioTimeline,
  createAudioTimeline,
  visibleClipFades,
  setClipFades
} from './audioTimeline.ts'
import {
  gainPointAt,
  insertGainPoint,
  moveGainPoint,
  seamAuditionRange
} from './audioEnvelopeEditing.ts'
import { fadeGain, validAudioProcessing } from './audioProcessing.ts'

test('direct gain editing preserves a trimmed envelope and orders points on sample boundaries', () => {
  const clip = trimClip(
    {
      ...createAudioClip('tone.wav', 'Tone', 10),
      gainPoints: [
        { time: 0, gain: 1 },
        { time: 5, gain: 2 },
        { time: 10, gain: 1 }
      ]
    },
    2,
    8
  )
  assert.deepEqual(gainPointAt(clip, 2.1234567, 9), { time: 4.123458333333334, gain: 4 })
  const points = insertGainPoint(clip, 1, 1.5)
  assert.deepEqual(
    points.map((p) => p.time),
    [0, 3, 5, 10]
  )
  const moved = moveGainPoint({ ...clip, gainPoints: points }, 1, 8, -3)
  assert.equal(moved[1].time, 5 - 1 / 48000)
  assert.equal(moved[1].gain, 0)
  assert.equal(points[1].time, 3)
  const doc = createAudioTimeline()
  doc.tracks[0].clips = [{ ...clip, gainPoints: moved }]
  assert.deepEqual(readAudioTimeline(JSON.stringify(doc)), doc)
})
test('all fade curves retain the same envelope through split and trim', () => {
  for (const fadeCurve of ['linear', 'smooth', 'equalPower']) {
    const clip = { ...createAudioClip('tone.wav', 'Tone', 8), fadeIn: 3, fadeOut: 3, fadeCurve }
    const [a, b] = splitClip(clip, 2)
    for (const local of [0.25, 1.5])
      assert.equal(clipEnvelope(b, local), clipEnvelope(clip, local + 2))
    assert.equal(clipEnvelope(trimClip(a, 0.5, 2), 0.5), clipEnvelope(clip, 1))
    assert.equal(fadeGain(0, fadeCurve), 0)
    assert.equal(fadeGain(1, fadeCurve), 1)
  }
  assert.equal(fadeGain(0.5, 'smooth'), 0.5)
  assert.ok(fadeGain(0.5, 'equalPower') > 0.7)
})

test('extending outside envelope anchors cannot enable absent fades', () => {
  const original = createAudioClip('tone.wav', 'Tone', 2)
  for (const envelopeOffset of [0, -0.5]) {
    const extended = { ...original, duration: 2.5, envelopeOffset }
    const fades = visibleClipFades(extended)
    assert.deepEqual(fades, { fadeIn: 0, fadeOut: 0 })
    const rebased = setClipFades(extended, fades.fadeIn, fades.fadeOut)
    for (const local of [0, 0.25, 1, 2, 2.5]) {
      assert.equal(clipEnvelope(extended, local), 1)
      assert.equal(clipEnvelope(rebased, local), 1)
    }
  }
  assert.deepEqual(
    visibleClipFades({ ...original, duration: 2.5, envelopeOffset: -0.5, fadeIn: 0.5 }),
    { fadeIn: 1, fadeOut: 0 }
  )
  assert.deepEqual(visibleClipFades({ ...original, duration: 2.5, fadeOut: 0.5 }), {
    fadeIn: 0,
    fadeOut: 1
  })
})
test('seam audition windows clamp to content bounds', () => {
  const clip = createAudioClip('tone.wav', 'Tone', 4, 1)
  assert.deepEqual(seamAuditionRange(clip, 'start', 5), { start: 0, end: 2.5 })
  assert.deepEqual(seamAuditionRange(clip, 'end', 5), { start: 3.5, end: 5 })
})
test('manual DSP settings reject unknown or unsafe parameters', () => {
  assert.equal(
    validAudioProcessing({
      bypass: true,
      equalizer: 'custom',
      eq: { low: 2, mid: -3, high: 0 },
      compressor: 'custom',
      compression: { thresholdDb: -18, ratio: 2, attack: 15, release: 180, makeupDb: 0 }
    }),
    true
  )
  for (const processing of [
    { eq: { low: 13, mid: 0, high: 0 } },
    { eq: { low: 0, mid: 0, high: 0, extra: 0 } },
    { compression: { thresholdDb: -18, ratio: 2, attack: 0, release: 180, makeupDb: 0 } },
    { bypass: 'true' }
  ])
    assert.equal(validAudioProcessing(processing), false)
})
