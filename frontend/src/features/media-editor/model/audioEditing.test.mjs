import test from 'node:test'
import assert from 'node:assert/strict'
import { createAudioClip, createAudioTrack } from './audioTimeline.ts'
import {
  moveAudioSelection,
  removeAudioSelection,
  copyAudioSelection,
  pasteAudioSelection,
  splitAudioSelection
} from './audioEditing.ts'
const make = () => {
  const track = createAudioTrack('A')
  const a = createAudioClip('a', 'a', 2, 1)
  const b = createAudioClip('b', 'b', 2, 6)
  track.clips = [a, b]
  return {
    doc: {
      version: 1,
      masterGain: 1,
      tracks: [track],
      textTracks: [
        {
          id: 't',
          name: 'text',
          visible: true,
          locked: false,
          cues: [{ id: 'cue', text: 'hello', start: 1, duration: 2 }]
        }
      ],
      groups: [[a.id, 'cue']]
    },
    a,
    b
  }
}
test('moving linked sound and text preserves offsets and clamps whole group', () => {
  const { doc, a } = make()
  const moved = moveAudioSelection(doc, [a.id], -10)
  assert.equal(moved.tracks[0].clips[0].start, 0)
  assert.equal(moved.textTracks[0].cues[0].start, 0)
  doc.textTracks[0].locked = true
  assert.equal(moveAudioSelection(doc, [a.id], 5), doc)
})
test('copy and paste have new identities while preserving links', () => {
  const { doc, a } = make()
  const clip = copyAudioSelection(doc, [a.id])
  const pasted = pasteAudioSelection(doc, clip, 10)
  assert.equal(pasted.ids.length, 2)
  assert.equal(pasted.document.tracks[0].clips.at(-1).start, 10)
  assert.deepEqual(pasted.document.groups.at(-1), pasted.ids)
  assert.equal(doc.tracks[0].clips.length, 2)
})
test('ripple deletion keeps unrelated overlapping content and closes only vacant spans', () => {
  const { doc, a, b } = make()
  const removed = removeAudioSelection(doc, [a.id], true)
  assert.equal(removed.tracks[0].clips.find((x) => x.id === b.id).start, 4)
  assert.equal(removed.textTracks[0].cues.length, 0)
})
test('split selected linked entries together', () => {
  const { doc, a } = make()
  const split = splitAudioSelection(doc, [a.id], 2)
  assert.equal(split.tracks[0].clips.length, 3)
  assert.equal(split.textTracks[0].cues.length, 2)
  assert.equal(split.groups.length, 2)
  assert.equal(split.groups[0].length, 2)
  assert.equal(split.groups[1].length, 2)
  const moved = moveAudioSelection(split, [split.tracks[0].clips[1].id], 5)
  assert.equal(moved.tracks[0].clips[0].start, 1)
  assert.equal(moved.textTracks[0].cues[1].start, 7)
})

test('splitting a different group preserves untouched cross-time links', () => {
  const { doc, a, b } = make()
  doc.groups = [[a.id, b.id]]
  const third = createAudioClip('c', 'c', 10, 0)
  doc.tracks[0].clips.push(third)
  const next = splitAudioSelection(doc, [third.id], 5)
  assert.deepEqual(next.groups, doc.groups)
})
test('single selection cannot split past the per-track capacity', () => {
  const { doc } = make()
  doc.groups = []
  doc.tracks[0].clips = Array.from({ length: 256 }, (_, i) => createAudioClip('a', 'a', 2, i * 2))
  assert.throws(() => splitAudioSelection(doc, [doc.tracks[0].clips[0].id], 1), /片段过多/)
  assert.equal(doc.tracks[0].clips.length, 256)
})
