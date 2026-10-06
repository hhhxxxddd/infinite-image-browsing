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
  resizeAudioClip,
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

test('edge resizing restores trimmed source samples, fades and automation after reopening', () => {
  const original = {
    ...setClipFades(createAudioClip('/voice.wav', 'Voice', 12, 5), 3, 2),
    gainPoints: [
      { time: 2, gain: 0.5 },
      { time: 8, gain: 1.5 }
    ]
  }
  const doc = createAudioTimeline()
  doc.tracks[0].clips = [trimClip(original, 2, 10)]
  const trimmed = readAudioTimeline(JSON.stringify(doc)).tracks[0].clips[0]
  const left = resizeAudioClip(trimmed, 'left', original.start, 12)
  const restored = resizeAudioClip(left, 'right', original.start + original.duration, 12)
  assert.deepEqual(restored, original)
  const shortened = resizeAudioClip(restored, 'right', 9, 12)
  assert.equal(shortened.duration, 4)
  assert.deepEqual(resizeAudioClip(shortened, 'right', 17, 12), original)
})

test('edge extension respects source limits at each playback rate', () => {
  for (const rate of [0.25, 1, 2, 4]) {
    const clip = {
      ...createAudioClip('/voice.wav', 'Voice', 4 / rate, 8),
      sourceIn: 2,
      rate
    }
    const extended = resizeAudioClip(clip, 'right', 100, 10)
    assert.equal(extended.sourceIn + extended.duration * rate, 10)
    assert.equal(extended.start, clip.start)
    const both = resizeAudioClip(extended, 'left', -100, 10)
    assert.equal(both.sourceIn, 0)
    assert.equal(both.start, 8 - 2 / rate)
    assert.equal(both.duration * rate, 10)
    assert.equal(both.start + both.duration, extended.start + extended.duration)
    const doc = createAudioTimeline()
    doc.tracks[0].clips = [both]
    assert.deepEqual(readAudioTimeline(JSON.stringify(doc)), doc)
  }
})

test('newly revealed audio keeps existing gain points at the same timeline and source positions', () => {
  const clip = {
    ...createAudioClip('/voice.wav', 'Voice', 4, 10),
    sourceIn: 5,
    gainPoints: [
      { time: 1, gain: 0.5 },
      { time: 3, gain: 1.5 }
    ]
  }
  const extended = resizeAudioClip(clip, 'left', 7, 20)
  assert.equal(extended.envelopeOffset, 0)
  assert.equal(extended.envelopeDuration, 7)
  for (let index = 0; index < clip.gainPoints.length; index++) {
    const original = clip.gainPoints[index]
    const shifted = extended.gainPoints[index]
    assert.equal(
      extended.start + shifted.time - extended.envelopeOffset,
      clip.start + original.time
    )
    assert.equal(
      extended.sourceIn + shifted.time - extended.envelopeOffset,
      clip.sourceIn + original.time
    )
  }
  for (const time of [0, 1, 2, 3])
    assert.equal(clipEnvelope(extended, time + 3), clipEnvelope(clip, time))
  const doc = createAudioTimeline()
  doc.tracks[0].clips = [extended]
  assert.deepEqual(readAudioTimeline(JSON.stringify(doc)), doc)
  assert.deepEqual(clip.gainPoints, [
    { time: 1, gain: 0.5 },
    { time: 3, gain: 1.5 }
  ])
})

test('edge resizing preserves the other edge and enforces sampling and 24-hour bounds', () => {
  const clip = { ...createAudioClip('/voice.wav', 'Voice', 4, 2), sourceIn: 10 }
  const left = resizeAudioClip(clip, 'left', -100, 20)
  assert.equal(left.start, 0)
  assert.equal(left.sourceIn, 8)
  assert.equal(left.start + left.duration, 6)
  const shortest = resizeAudioClip(clip, 'left', 100, 20)
  assert.equal(shortest.duration, 1 / 48000)
  assert.ok(Math.abs(shortest.start + shortest.duration - 6) < 1 / 48000)
  const final = createAudioClip('/long.wav', 'Long', 2, 86398)
  assert.equal(resizeAudioClip(final, 'right', 100000, 86400).duration, 2)
  const fast = { ...createAudioClip('/long.wav', 'Long', 1), sourceIn: 86398, rate: 2 }
  assert.equal(resizeAudioClip(fast, 'right', 100000, 100000).duration, 1)
  const doc = createAudioTimeline()
  doc.tracks[0].clips = [shortest, final, fast]
  assert.deepEqual(readAudioTimeline(JSON.stringify(doc)), doc)
})

test('without source metadata resizing cannot reveal unknown audio past the existing end', () => {
  const clip = trimClip(createAudioClip('/voice.wav', 'Voice', 10, 2), 2, 8)
  assert.equal(resizeAudioClip(clip, 'right', 100), clip)
  const left = resizeAudioClip(clip, 'left', 2)
  assert.equal(left.sourceIn, 0)
  assert.equal(left.start + left.duration, clip.start + clip.duration)
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
