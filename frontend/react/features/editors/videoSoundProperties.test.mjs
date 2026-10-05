import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyDocument, readDocument, sliceClip } from './videoStudioModel.ts'
import {
  videoSoundEnvelope,
  setVideoSoundFades,
  patchVideoSound,
  videoAudioClip
} from './videoSoundProperties.ts'
import { editVideoClip } from './videoTimelineInteraction.ts'
import { rollVideoBoundary } from './videoPrecisionEditing.ts'

const sound = (id, start = 0, duration = 10) => ({
  id,
  start,
  duration,
  path: '/a.wav',
  name: 'a.wav',
  kind: 'audio',
  sourceIn: 20,
  sourceDuration: 100,
  rate: 1,
  gain: 1,
  trackId: 'audio-1',
  fadeIn: 4,
  fadeOut: 2,
  fadeCurve: 'smooth',
  pan: 0.5,
  gainPoints: [
    { time: 0, gain: 0.5 },
    { time: 5, gain: 2 },
    { time: 10, gain: 0.2 }
  ]
})
test('split and repeated trims preserve the original gain automation and curved fades', () => {
  const original = sound('a')
  const part = sliceClip(sliceClip(original, 1, 9), 1, 6)
  for (const time of [0, 0.25, 1, 3, 4.999])
    assert.ok(
      Math.abs(videoSoundEnvelope(part, time) - videoSoundEnvelope(original, time + 2)) < 1e-10
    )
  assert.equal(part.envelopeOffset, 2)
  assert.equal(part.envelopeDuration, 10)
  assert.equal(part.pan, 0.5)
})
test('editing visible fades rebases automation, while preserving media and links', () => {
  const original = { ...sound('a'), linkId: 'linked' }
  const part = sliceClip(original, 3, 7)
  const edited = setVideoSoundFades(part, 1, 1)
  assert.equal(edited.envelopeOffset, 0)
  assert.equal(edited.envelopeDuration, 4)
  assert.equal(edited.gainPoints[0].time, 0)
  assert.equal(edited.gainPoints.at(-1).time, 4)
  const patched = patchVideoSound(edited, { ...videoAudioClip(edited), pan: -0.5 })
  assert.equal(patched.sourceIn, 23)
  assert.equal(patched.linkId, 'linked')
  assert.equal(patched.pan, -0.5)
})
test('rate changes scale the original audio envelope in the linked sound, without losing points', () => {
  const doc = emptyDocument()
  doc.sounds = [sliceClip(sound('a'), 2, 6)]
  const result = editVideoClip(doc, 'a', 'sound', (clip) => ({ ...clip, rate: 2, duration: 2 }))
  assert.equal(result.error, '')
  const edited = result.document.sounds[0]
  assert.equal(edited.envelopeOffset, 1)
  assert.equal(edited.envelopeDuration, 5)
  for (const time of [0, 0.25, 1, 1.99])
    assert.ok(
      Math.abs(videoSoundEnvelope(edited, time) - videoSoundEnvelope(doc.sounds[0], time * 2)) <
        1e-10
    )
})
test('rolling a cut preserves absolute-time envelopes and extended source handles', () => {
  const doc = emptyDocument()
  doc.sounds = [sound('a', 0, 4), sound('b', 4, 4)]
  doc.sounds.forEach((clip) => {
    clip.gainPoints = [
      { time: 0, gain: 0.5 },
      { time: 4, gain: 2 }
    ]
  })
  const result = rollVideoBoundary(doc, 'a', 'b', 'sound', 3)
  assert.equal(result.error, '')
  assert.equal(result.document.sounds[1].envelopeOffset, -1)
  for (const time of [4, 5, 6])
    assert.ok(
      Math.abs(
        videoSoundEnvelope(result.document.sounds[1], time - 3) -
          videoSoundEnvelope(doc.sounds[1], time - 4)
      ) < 1e-10
    )
})
test('video read validation accepts shared sound controls and rejects malformed automation', () => {
  const doc = emptyDocument()
  doc.sounds = [{ ...sound('a'), gain: 3, channels: 'swap', invertPhase: true }]
  doc.masterGain = 0
  doc.processing = { bypass: true, equalizer: 'custom', eq: { low: 2, mid: 0, high: -2 } }
  assert.equal(readDocument(JSON.stringify(doc)).sounds[0].gain, 3)
  doc.sounds[0].gainPoints[1].time = 101
  assert.throws(() => readDocument(JSON.stringify(doc)))
})
