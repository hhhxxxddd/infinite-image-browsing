import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyDocument } from './videoStudioModel.ts'
import { videoRelinkSources, relinkVideoSources } from './videoSources.ts'
const clip = {
  id: 'v',
  path: 'old.mp4',
  name: 'old',
  kind: 'video',
  start: 2,
  sourceIn: 7,
  duration: 4,
  sourceDuration: 20,
  rate: 2,
  gain: 1,
  trackId: 'video-1',
  linkId: 'pair',
  transform: { rotation: 40 }
}
test('relink groups every use of a source, preserves linked instructions and requires both streams', () => {
  const doc = {
    ...emptyDocument(),
    visuals: [clip],
    sounds: [{ ...clip, id: 's', trackId: 'audio-1' }]
  }
  const sources = videoRelinkSources(doc)
  assert.equal(sources.length, 1)
  assert.equal(sources[0].clips.length, 2)
  assert.equal(sources[0].clips[0].requiresVideo, true)
  assert.equal(sources[0].clips[1].requiresAudio, true)
  const next = relinkVideoSources(doc, {
    source: sources[0],
    replacement: { path: 'new.mp4', name: 'new', kind: 'video' },
    sourceDuration: 30
  })
  assert.equal(next.visuals[0].path, 'new.mp4')
  assert.equal(next.sounds[0].path, 'new.mp4')
  for (const field of ['start', 'sourceIn', 'duration', 'rate', 'linkId', 'transform'])
    assert.deepEqual(next.visuals[0][field], clip[field])
  assert.equal(next.visuals[0].sourceDuration, 30)
  assert.equal(doc.visuals[0].path, 'old.mp4')
})
test('a locked reference prevents a partial relink on its unlocked linked counterpart', () => {
  const doc = {
    ...emptyDocument(),
    visuals: [clip],
    sounds: [{ ...clip, id: 's', trackId: 'audio-1' }]
  }
  doc.tracks[1].locked = true
  assert.throws(
    () =>
      relinkVideoSources(doc, {
        source: videoRelinkSources(doc)[0],
        replacement: { path: 'new.mp4', name: 'new', kind: 'video' },
        sourceDuration: 30
      }),
    /锁定/
  )
  assert.equal(doc.visuals[0].path, 'old.mp4')
})
