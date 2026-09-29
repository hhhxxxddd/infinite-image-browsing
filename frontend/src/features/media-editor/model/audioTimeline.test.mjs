import test from 'node:test'
import assert from 'node:assert/strict'
import {
  audibleTracks,
  audioTimelineKey,
  clipEnvelope,
  createAudioClip,
  createAudioTimeline,
  createAudioTrack,
  readAudioTimeline,
  setClipFades,
  splitClip,
  timelineDuration,
  trimClip
} from './audioTimeline.ts'

test('trim and split keep source samples and the original fade envelope', () => {
  const original = setClipFades(createAudioClip('/sound.wav', 'Sound', 10, 2), 4, 3)
  const [left, right] = splitClip(original, 3)
  assert.equal(left.duration, 1)
  assert.equal(right.sourceIn, 1)
  assert.equal(right.duration, 9)
  assert.notEqual(left.id, right.id)
  for (const time of [0, 0.5, 2, 7, 9])
    assert.equal(clipEnvelope(right, time), clipEnvelope(original, time + 1))
  const trim = trimClip(original, 2, 8)
  assert.equal(trim.start, 4)
  assert.equal(trim.sourceIn, 2)
  assert.equal(trim.duration, 6)
  assert.equal(clipEnvelope(trim, 0.5), clipEnvelope(original, 2.5))
  assert.equal(splitClip(original, 2), undefined)
  assert.equal(splitClip(original, 12), undefined)
})
test('timeline roundtrip retains track order, gain, mute, solo and locks', () => {
  const doc = createAudioTimeline()
  doc.tracks[0].clips.push(createAudioClip('/sound.wav', 'Sound', 10, 4))
  const other = createAudioTrack('Music')
  other.solo = true
  other.locked = true
  other.gain = 0.5
  doc.tracks.push(other)
  assert.deepEqual(readAudioTimeline(JSON.stringify(doc)), doc)
  assert.deepEqual(audibleTracks(doc), [other])
  other.muted = true
  assert.deepEqual(audibleTracks(doc), [])
  assert.equal(timelineDuration(doc), 14)
  assert.notEqual(audioTimelineKey('workspace', 'one'), audioTimelineKey('workspace', 'two'))
})
test('damaged documents and invalid timing never silently overwrite saved data', () => {
  assert.throws(() => readAudioTimeline('{broken'))
  assert.throws(() => readAudioTimeline(JSON.stringify({ version: 2, tracks: [] })))
  const doc = createAudioTimeline()
  const clip = createAudioClip('/sound.wav', 'Sound', 10)
  doc.tracks[0].clips.push(clip)
  clip.sourceIn = 86400
  assert.throws(() => readAudioTimeline(JSON.stringify(doc)))
  clip.sourceIn = 0
  clip.envelopeDuration = 2
  assert.throws(() => readAudioTimeline(JSON.stringify(doc)))
})
