import test from 'node:test'
import assert from 'node:assert/strict'
import {
  sourceRelinkCompatible,
  sourceRelinkError,
  sourceRelinkSelection,
  applySourceRelink
} from './sourceRelink.ts'

const source = {
  path: 'missing.mp4',
  name: 'missing.mp4',
  kind: 'video',
  clips: [
    { id: 'picture', sourceIn: 10, duration: 4, rate: 2, requiresVideo: true },
    { id: 'sound', sourceIn: 10, duration: 4, rate: 2, requiresAudio: true }
  ]
}
const replacement = { path: 'restored.mp4', name: 'restored.mp4', kind: 'video' }
const metadata = {
  duration: 18,
  hasAudio: true,
  hasVideo: true,
  width: 1920,
  height: 1080,
  fps: 30,
  fingerprint: 'v1'
}

test('all references including playback rates must fit the replacement without trimming', () => {
  assert.equal(sourceRelinkError(source, replacement, metadata), '')
  assert.match(sourceRelinkError(source, replacement, { ...metadata, duration: 17.9 }), /过短/)
  assert.throws(() => sourceRelinkSelection(source, replacement, { ...metadata, duration: 17.9 }))
  assert.match(sourceRelinkError(source, replacement, { ...metadata, hasAudio: false }), /声音/)
  assert.match(sourceRelinkError(source, replacement, { ...metadata, duration: NaN }), /未知/)
})

test('freeze requires a real frame at sourceIn but not the full held duration in the source', () => {
  const held = {
    ...source,
    clips: [{ id: 'held', sourceIn: 17, duration: 300, freeze: true, requiresVideo: true }]
  }
  assert.equal(sourceRelinkError(held, replacement, metadata), '')
  assert.match(sourceRelinkError(held, replacement, { ...metadata, duration: 17 }), /过短/)
})

test('picture references never become audio, while sound-only references can use audio or video', () => {
  const audio = { ...replacement, kind: 'audio' }
  assert.equal(sourceRelinkCompatible(source, audio), false)
  const sounds = {
    ...source,
    clips: [{ id: 's', sourceIn: 1, duration: 2, requiresAudio: true, requiresVideo: false }]
  }
  assert.equal(sourceRelinkCompatible(sounds, audio), true)
  assert.equal(sourceRelinkCompatible(sounds, replacement), true)
  assert.equal(
    sourceRelinkCompatible({ ...sounds, kind: 'audio' }, { ...replacement, kind: 'image' }),
    false
  )
})

test('relink preserves timing, transforms, envelopes, gains and unrelated clips', () => {
  const selection = sourceRelinkSelection(source, replacement, metadata)
  const clip = {
    id: 'picture',
    kind: 'video',
    path: source.path,
    name: source.name,
    sourceDuration: 40,
    start: 80,
    sourceIn: 10,
    duration: 4,
    rate: 2,
    gain: 0.7,
    fadeIn: 1,
    envelopeOffset: 3,
    transform: { rotation: 20 },
    keyframes: [{ time: 1, x: 0.2 }]
  }
  const updated = applySourceRelink(clip, selection)
  assert.deepEqual(updated, {
    ...clip,
    path: replacement.path,
    name: replacement.name,
    sourceDuration: 18
  })
  assert.equal(updated.transform, clip.transform)
  assert.equal(updated.keyframes, clip.keyframes)
  const unrelated = { ...clip, path: 'other.mp4' }
  assert.equal(applySourceRelink(unrelated, selection), unrelated)
  assert.equal(clip.path, source.path)
})

test('audio sourceKind follows replacement and image hold duration stays unchanged', () => {
  const sound = {
    path: source.path,
    name: 'voice',
    sourceIn: 10,
    duration: 4,
    gainPoints: [{ time: 0, gain: 1 }]
  }
  const updated = applySourceRelink(sound, sourceRelinkSelection(source, replacement, metadata))
  assert.equal(updated.sourceKind, 'video')
  assert.equal(updated.gainPoints, sound.gainPoints)
  const imageSource = {
    ...source,
    kind: 'image',
    clips: [{ id: 'image', sourceIn: 0, duration: 5 }]
  }
  const imageAsset = { ...replacement, kind: 'image' }
  const held = { path: source.path, name: 'image', kind: 'image', sourceDuration: 5, duration: 5 }
  assert.equal(
    applySourceRelink(
      held,
      sourceRelinkSelection(imageSource, imageAsset, { ...metadata, duration: 0 })
    ).sourceDuration,
    5
  )
})
