import test from 'node:test'
import assert from 'node:assert/strict'
import { readEditorSnapshot } from './editorSnapshot.ts'
import { emptyDocument } from './videoStudioModel.ts'
import {
  createAudioTimeline,
  createAudioClip
} from '../../../src/features/media-editor/model/audioTimeline.ts'

test('video snapshot preserves track ownership, hidden content and caption timing without mutating it', () => {
  const doc = emptyDocument()
  doc.tracks.push({ id: 'upper', kind: 'video', name: '上层', hidden: true })
  doc.visuals.push({
    id: 'a',
    name: '封面',
    path: '/a.png',
    kind: 'image',
    start: 2,
    sourceIn: 0,
    duration: 6,
    sourceDuration: 6,
    rate: 1,
    gain: 1,
    trackId: 'upper'
  })
  doc.captions.push({ id: 'caption', text: '尾字幕', start: 8, duration: 2 })
  doc.markers.push({ id: 'm', name: '检查', time: 30 })
  const before = JSON.stringify(doc)
  const view = readEditorSnapshot('video', doc)
  assert.equal(view.duration, 10)
  assert.equal(view.lanes.find((lane) => lane.id === 'upper').disabled, true)
  assert.equal(view.lanes[0].items.length, 0)
  assert.equal(view.lanes.find((lane) => lane.id === 'upper').items[0].start, 2)
  assert.equal(view.lanes.at(-1).items[0].label, '尾字幕')
  assert.equal(JSON.stringify(doc), before)
})
test('audio snapshot uses exact trimmed timeline spans and keeps muted tracks visible', () => {
  const doc = createAudioTimeline()
  doc.tracks[0].muted = true
  const clip = createAudioClip('/source.wav', '段落', 2.25, 4)
  clip.sourceIn = 12
  doc.tracks[0].clips.push(clip)
  const view = readEditorSnapshot('audio', doc)
  assert.equal(view.duration, 6.25)
  assert.equal(view.lanes[0].disabled, true)
  assert.equal(view.lanes[0].items[0].duration, 2.25)
  assert.equal(view.document.tracks[0].clips[0].sourceIn, 12)
})
test('invalid snapshot cannot silently become a preview of an empty production', () => {
  assert.throws(() => readEditorSnapshot('video', { version: 1, width: -1 }))
  assert.throws(() => readEditorSnapshot('audio', { version: 1, tracks: 'broken' }))
})
