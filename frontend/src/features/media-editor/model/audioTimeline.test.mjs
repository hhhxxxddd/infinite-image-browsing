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
  setClipRate,
  clipRate,
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

test('speed keeps the selected source range and scales fades through trimming and splitting', () => {
  const original = setClipFades(createAudioClip('/voice.wav', 'Voice', 12, 2), 4, 3)
  const trimmed = trimClip(original, 2, 10)
  const fast = setClipRate(trimmed, 2)
  assert.equal(fast.start, trimmed.start)
  assert.equal(fast.sourceIn, 2)
  assert.equal(fast.duration * clipRate(fast), trimmed.duration)
  for (const time of [0, 1, 2, 3])
    assert.equal(clipEnvelope(fast, time), clipEnvelope(trimmed, time * 2))
  const parts = splitClip(fast, fast.start + 1)
  assert.equal(parts[1].sourceIn, 4)
  assert.equal(parts[1].duration, 3)
  const doc = createAudioTimeline()
  doc.tracks[0].clips = parts
  doc.markers = [{ id: 'mark-1', name: 'Chorus', time: 9.5 }]
  assert.deepEqual(readAudioTimeline(JSON.stringify(doc)), doc)
  assert.throws(() => setClipRate(original, 0))
  assert.throws(() => setClipRate(original, Infinity))
  assert.throws(() => setClipRate(createAudioClip('/long.wav', 'Long', 86400), 0.25))
  const shortest = setClipRate(createAudioClip('/tiny.wav', 'Tiny', 1 / 48000), 4)
  const tinyDoc = createAudioTimeline()
  tinyDoc.tracks[0].clips = [shortest]
  assert.deepEqual(readAudioTimeline(JSON.stringify(tinyDoc)), tinyDoc)
  doc.tracks[0].clips[0].rate = 4.1
  assert.throws(() => readAudioTimeline(JSON.stringify(doc)))
})

test('legacy speed defaults remain unchanged and damaged marker or pitch settings are rejected', () => {
  const doc = createAudioTimeline()
  doc.tracks[0].clips.push(createAudioClip('/voice.wav', 'Voice', 2))
  assert.equal(clipRate(doc.tracks[0].clips[0]), 1)
  assert.deepEqual(readAudioTimeline(JSON.stringify(doc)), doc)
  doc.markers = [{ id: doc.tracks[0].id, name: 'Duplicate', time: 0 }]
  assert.throws(() => readAudioTimeline(JSON.stringify(doc)))
  doc.markers = [{ id: 'mark', name: 'Bad', time: 86401 }]
  assert.throws(() => readAudioTimeline(JSON.stringify(doc)))
  delete doc.markers
  doc.tracks[0].clips[0].preservePitch = 'yes'
  assert.throws(() => readAudioTimeline(JSON.stringify(doc)))
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

test('video sound retains its source through trimming, splitting and reopening; old audio remains readable', () => {
  const doc = createAudioTimeline()
  const video = createAudioClip('/interview.mp4', 'Interview', 10, 0, 'video')
  const trimmed = trimClip(video, 1, 8)
  const parts = splitClip(trimmed, 3)
  doc.tracks[0].clips = parts
  const reopened = readAudioTimeline(JSON.stringify(doc))
  for (const clip of reopened.tracks[0].clips) {
    assert.equal(clip.path, '/interview.mp4')
    assert.equal(clip.sourceKind, 'video')
  }
  assert.equal(reopened.tracks[0].clips[1].sourceIn, 3)
  const legacy = createAudioClip('/old.wav', 'Old audio', 2)
  delete legacy.sourceKind
  doc.tracks[0].clips = [legacy]
  assert.deepEqual(readAudioTimeline(JSON.stringify(doc)), doc)
  legacy.sourceKind = 'image'
  assert.throws(() => readAudioTimeline(JSON.stringify(doc)))
})
