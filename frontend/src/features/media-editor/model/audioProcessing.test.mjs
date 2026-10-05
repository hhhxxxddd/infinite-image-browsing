import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createAudioClip,
  createAudioTimeline,
  clipEnvelope,
  trimClip,
  splitClip,
  setClipFades,
  setClipRate,
  readAudioTimeline,
  crossfadeClips
} from './audioTimeline.ts'
import { automationGain } from './audioProcessing.ts'

test('gain automation survives trim, split, fade edits and rate changes', () => {
  const clip = {
    ...createAudioClip('sound.wav', 'Voice', 10),
    gainPoints: [
      { time: 0, gain: 0.2 },
      { time: 5, gain: 1.2 },
      { time: 10, gain: 0.4 }
    ]
  }
  assert.equal(automationGain(clip.gainPoints, 2.5), 0.7)
  const trimmed = trimClip(clip, 2, 9)
  const [left, right] = splitClip(trimmed, 6)
  assert.equal(clipEnvelope(left, 3), clipEnvelope(clip, 5))
  assert.equal(clipEnvelope(right, 1), clipEnvelope(clip, 7))
  const fades = setClipFades(trimmed, 0, 0)
  assert.equal(clipEnvelope(fades, 4), clipEnvelope(clip, 6))
  const faster = setClipRate(trimmed, 2)
  assert.equal(clipEnvelope(faster, 2), clipEnvelope(clip, 6))
})
test('processing and curve validation reject corrupt documents without changing legacy data', () => {
  const doc = createAudioTimeline()
  doc.tracks[0].clips.push(createAudioClip('a.wav', 'a', 2))
  assert.deepEqual(readAudioTimeline(JSON.stringify(doc)), doc)
  for (const points of [
    [
      { time: 1, gain: 1 },
      { time: 1, gain: 2 }
    ],
    [{ time: 3, gain: 1 }],
    [{ time: 1, gain: -1 }]
  ]) {
    doc.tracks[0].clips[0].gainPoints = points
    assert.throws(() => readAudioTimeline(JSON.stringify(doc)))
  }
  delete doc.tracks[0].clips[0].gainPoints
  doc.processing = { denoise: 'nonsense' }
  assert.throws(() => readAudioTimeline(JSON.stringify(doc)))
})
test('crossfade overlaps two clips while retaining source range and respecting locks', () => {
  const doc = createAudioTimeline(),
    track = doc.tracks[0]
  const left = createAudioClip('a.wav', 'a', 5),
    right = createAudioClip('b.wav', 'b', 4, 5)
  track.clips = [left, right]
  const result = crossfadeClips(track, left.id, right.id, 1)
  assert.equal(result.clips[1].start, 4)
  assert.equal(result.clips[0].fadeOut, 1)
  assert.equal(result.clips[1].fadeIn, 1)
  assert.equal(result.clips[1].sourceIn, 0)
  assert.equal(crossfadeClips({ ...track, locked: true }, left.id, right.id, 1).clips[1].start, 5)
})

test('rebasing a full curve and speeding up sample-adjacent points stay valid', () => {
  const doc = createAudioTimeline()
  const clip = {
    ...createAudioClip('a.wav', 'a', 10),
    gainPoints: Array.from({ length: 128 }, (_, index) => ({
      time: 0.1 + index * 0.07,
      gain: (index % 4) / 4
    }))
  }
  doc.tracks[0].clips = [setClipFades(clip, 1, 1)]
  assert.ok(doc.tracks[0].clips[0].gainPoints.length <= 128)
  readAudioTimeline(JSON.stringify(doc))
  doc.tracks[0].clips = [
    setClipRate(
      {
        ...clip,
        gainPoints: [
          { time: 0, gain: 0 },
          { time: 1 / 48000, gain: 1 }
        ]
      },
      4
    )
  ]
  readAudioTimeline(JSON.stringify(doc))
})
