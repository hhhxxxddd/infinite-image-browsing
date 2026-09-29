import test from 'node:test'
import assert from 'node:assert/strict'
import { createAudioClip, createAudioTimeline } from './audioTimeline.ts'
import { createTextTrack, createTextCue } from './textTimeline.ts'
import { snapSpanStart, snapTime, timelineSnapPoints } from './audioSnap.ts'

test('audio, captions, playhead and markers share anchors; dragged items never snap to themselves', () => {
  const doc = createAudioTimeline()
  const clip = createAudioClip('/sound', 'Sound', 3, 2)
  doc.tracks[0].clips.push(clip)
  const text = createTextTrack()
  text.cues.push(createTextCue('Caption', 7, 2))
  doc.textTracks = [text]
  doc.markers = [{ id: 'mark', name: 'Chorus', time: 12 }]
  assert.deepEqual(timelineSnapPoints(doc, 10), [0, 2, 5, 7, 9, 10, 12])
  assert.deepEqual(timelineSnapPoints(doc, 10, clip.id), [0, 7, 9, 10, 12])
  assert.equal(snapSpanStart(4.08, 3, [0, 7], 0.1).time, 4)
  assert.equal(snapSpanStart(6.96, 3, [0, 7], 0.1).time, 7)
})
test('pixel tolerance stays consistent with zoom, Shift bypass and legal trim boundaries', () => {
  for (const zoom of [4, 20, 240]) {
    assert.equal(snapTime(10 + 7 / zoom, [10], 8 / zoom).time, 10)
    assert.equal(snapTime(10 + 9 / zoom, [10], 8 / zoom).anchor, undefined)
  }
  assert.equal(snapTime(10.03, [10], -1).time, 10.03)
  assert.equal(snapTime(2.03, [2], 0.1, 2.01, 5).anchor, undefined)
  assert.equal(snapSpanStart(-1, 3, [2], 0.1).time, 0)
  assert.equal(snapSpanStart(86400, 3, [86400], 0.1).time, 86397)
})
