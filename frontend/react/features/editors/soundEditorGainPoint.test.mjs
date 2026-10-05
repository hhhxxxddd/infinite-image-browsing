import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addSoundEditorGainPoint,
  editSoundEditorGainPoint,
  soundEditorGainPoint
} from './soundEditorGainPoint.ts'
import { sampleTime } from '../../../src/features/media-editor/model/audioTimeline.ts'

const clip = (points = []) => ({
  id: 'trimmed',
  path: 'sound.wav',
  name: 'sound',
  start: 100,
  sourceIn: 20,
  duration: 4,
  gain: 1,
  fadeIn: 0,
  fadeOut: 0,
  envelopeOffset: 3,
  envelopeDuration: 10,
  gainPoints: points
})

test('trimmed point controls use clip-local time and preserve hidden envelope points', () => {
  const original = clip([
    { time: 1, gain: 0.5 },
    { time: 4, gain: 1 },
    { time: 9, gain: 2 }
  ])
  assert.equal(soundEditorGainPoint(original, 1), null)
  assert.equal(soundEditorGainPoint(original, 4).local, 1)
  const edited = editSoundEditorGainPoint(original, 4, { local: 2.12345, gain: 8 })
  assert.equal(edited.time, sampleTime(5.12345))
  assert.equal(edited.clip.gainPoints[1].gain, 4)
  assert.deepEqual(edited.clip.gainPoints[0], original.gainPoints[0])
  assert.deepEqual(edited.clip.gainPoints[2], original.gainPoints[2])
  assert.equal(original.gainPoints[1].time, 4)
})

test('precise input cannot cross neighbouring points or leave the trimmed range', () => {
  const original = clip([
    { time: 3, gain: 1 },
    { time: 4, gain: 1 },
    { time: 5, gain: 1 },
    { time: 7, gain: 1 }
  ])
  const first = editSoundEditorGainPoint(original, 3, { local: -100, gain: -2 })
  assert.equal(first.time, 3)
  assert.equal(first.clip.gainPoints[0].gain, 0)
  const crossed = editSoundEditorGainPoint(original, 4, { local: 100 })
  assert.ok(Math.abs(crossed.time - (5 - 1 / 48000)) < 1e-12)
  assert.ok(crossed.time > 3 && crossed.time < 5)
  const last = editSoundEditorGainPoint(original, 7, { local: 100 })
  assert.equal(last.clip, original)
  assert.equal(editSoundEditorGainPoint(original, 4, { local: NaN }), null)
})

test('adding at the playhead preserves interpolation and respects the point limit', () => {
  const original = clip([
    { time: 3, gain: 0 },
    { time: 7, gain: 2 }
  ])
  const added = addSoundEditorGainPoint(original, 2)
  assert.equal(added.time, 5)
  assert.deepEqual(added.clip.gainPoints[1], { time: 5, gain: 1 })
  assert.equal(addSoundEditorGainPoint(added.clip, 2).clip, added.clip)
  const full = clip(Array.from({ length: 128 }, (_, i) => ({ time: 3 + i / 40, gain: 1 })))
  assert.equal(addSoundEditorGainPoint(full, 3.5), null)
  assert.equal(addSoundEditorGainPoint(full, 0).clip, full)
  assert.equal(addSoundEditorGainPoint(clip(), -4).time, 3)
})
