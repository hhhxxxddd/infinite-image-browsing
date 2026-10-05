import assert from 'node:assert/strict'
import test from 'node:test'
import {
  emptyDocument,
  readDocument,
  sourceTime,
  previewSourceTime,
  evaluatedTransform,
  moveClips,
  splitClips,
  removeClips,
  closeGaps,
  copyClips,
  pasteClips,
  addClips,
  trackAudible,
  sliceClip
} from './videoStudioModel.ts'
const clip = (id, start = 0, duration = 4, extra = {}) => ({
  id,
  path: '/video.mp4',
  name: 'video.mp4',
  kind: 'video',
  start,
  duration,
  sourceIn: 2,
  sourceDuration: 60,
  rate: 1,
  gain: 1,
  ...extra
})
const pair = () => ({
  ...emptyDocument(),
  visuals: [clip('v', 2, 4, { trackId: 'video-1', linkId: 'av' })],
  sounds: [clip('a', 2, 4, { trackId: 'audio-1', linkId: 'av' })]
})
test('legacy v1 migrates tracks without discarding original clips or effects', () => {
  const doc = pair()
  delete doc.tracks
  const next = readDocument(JSON.stringify(doc))
  assert.equal(next.tracks.length, 2)
  assert.deepEqual(next.visuals, doc.visuals)
  assert.throws(
    () => readDocument(JSON.stringify({ ...doc, visuals: [{ ...doc.visuals[0], rate: NaN }] })),
    /保留/
  )
})
test('oversized saved subtitles enter recovery without changing or truncating original text', () => {
  const doc = {
    ...emptyDocument(),
    captions: [{ id: 'cue', text: '字'.repeat(5000), start: 0, duration: 1 }]
  }
  assert.equal(readDocument(JSON.stringify(doc)).captions[0].text.length, 5000)
  doc.captions[0].text += '保留'
  const raw = JSON.stringify(doc)
  assert.throws(() => readDocument(raw), /原始数据已保留/)
  assert.equal(JSON.parse(raw).captions[0].text, '字'.repeat(5000) + '保留')
})
test('linked movement preserves sync and clamps the whole selection, locked member blocks it', () => {
  const doc = pair()
  doc.visuals.push(clip('v2', 8, 2))
  const next = moveClips(doc, ['v', 'v2'], -4)
  assert.deepEqual(
    next.visuals.map((c) => c.start),
    [0, 6]
  )
  assert.equal(next.sounds[0].start, 0)
  doc.tracks[1].locked = true
  assert.equal(moveClips(doc, ['v'], 2), doc)
})
test('mixed video and caption movement clamps the whole group and respects linked track locks', () => {
  const doc = {
    ...pair(),
    captions: [
      { id: 'front', text: 'front', start: 1, duration: 1 },
      { id: 'tail', text: 'tail', start: 10, duration: 3 },
      { id: 'other', text: 'other', start: 25, duration: 1 }
    ]
  }
  const ids = ['v', 'front', 'tail']
  const moved = moveClips(doc, ids, 3)
  assert.equal(moved.visuals[0].start, 5)
  assert.equal(moved.sounds[0].start, 5)
  assert.deepEqual(
    moved.captions.map((cue) => cue.start),
    [4, 13, 25]
  )
  assert.equal(moved.captions[2], doc.captions[2])

  const left = moveClips(doc, ids, -100)
  assert.equal(left.visuals[0].start, 1)
  assert.equal(left.sounds[0].start, 1)
  assert.deepEqual(
    left.captions.map((cue) => cue.start),
    [0, 9, 25]
  )
  const right = moveClips(doc, ids, 30000)
  assert.equal(right.visuals[0].start, 21589)
  assert.equal(right.sounds[0].start, 21589)
  assert.deepEqual(
    right.captions.map((cue) => cue.start),
    [21588, 21597, 25]
  )
  assert.equal(right.captions[1].start + right.captions[1].duration, 21600)

  const captionOnly = moveClips(doc, ['tail'], -100)
  assert.equal(captionOnly.captions[1].start, 0)
  assert.equal(captionOnly.visuals[0], doc.visuals[0])
  assert.equal(captionOnly.sounds[0], doc.sounds[0])
  assert.equal(captionOnly.captions[0], doc.captions[0])
  doc.tracks[1].locked = true
  assert.equal(moveClips(doc, ids, 3), doc)
})
test('split produces two independent linked pairs and exact reverse source intervals', () => {
  const doc = pair()
  const next = splitClips(doc, ['v'], 4)
  assert.equal(next.visuals.length, 2)
  assert.equal(next.sounds.length, 2)
  assert.equal(next.visuals[1].linkId, next.sounds[1].linkId)
  assert.notEqual(next.visuals[0].linkId, next.visuals[1].linkId)
  const reverse = clip('r', 0, 10, { sourceIn: 5, rate: 2, reverse: true })
  const left = sliceClip(reverse, 0, 3),
    right = sliceClip(reverse, 3, 10, 'right')
  assert.equal(left.sourceIn, 19)
  assert.equal(right.sourceIn, 5)
  assert.equal(sourceTime(left, 0), 25)
  assert.equal(sourceTime(right, 3), 19)
})
test('split preserves document identity when no selected item can be split', () => {
  const doc = pair()
  assert.equal(splitClips(doc, [], 4), doc)
  assert.equal(splitClips(doc, ['missing'], 4), doc)
  for (const time of [0, 2, 6, 10, NaN]) assert.equal(splitClips(doc, ['v'], time), doc)
})
test('copy/paste generates fresh ids and a fresh shared link without changing clipboard', () => {
  const doc = pair(),
    copy = copyClips(doc, ['v']),
    next = pasteClips(doc, copy, 10)
  assert.equal(next.visuals[1].start, 10)
  assert.equal(next.sounds[1].start, 10)
  assert.equal(next.visuals[1].linkId, next.sounds[1].linkId)
  assert.notEqual(next.visuals[1].linkId, 'av')
  assert.equal(copy.visuals[0].id, 'v')
})
test('overwrite retains both original outside fragments; insert splits and shifts all tracks', () => {
  const doc = {
    ...pair(),
    visuals: [clip('v', 0, 10, { trackId: 'video-1' })],
    sounds: [clip('a', 0, 10, { trackId: 'audio-1' })]
  }
  const incoming = { visuals: [clip('new', 3, 2, { trackId: 'video-1' })], sounds: [] }
  const over = addClips(doc, incoming, 'overwrite')
  assert.deepEqual(
    over.visuals.map((c) => [c.start, c.duration, c.sourceIn]),
    [
      [0, 3, 2],
      [5, 5, 7],
      [3, 2, 2]
    ]
  )
  assert.equal(over.sounds.length, 1)
  const insert = addClips(doc, incoming, 'insert')
  assert.deepEqual(
    insert.sounds.map((c) => [c.start, c.duration]),
    [
      [0, 3],
      [5, 7]
    ]
  )
})
test('ripple preserves overlapping content and closes genuine empty intervals', () => {
  const doc = pair()
  doc.visuals.push(clip('tail', 10, 3))
  const next = removeClips(doc, ['v'], true)
  assert.equal(next.sounds.length, 0)
  assert.equal(next.visuals[0].start, 6)
  const overlay = pair()
  const continuous = closeGaps(overlay)
  assert.equal(closeGaps(continuous), continuous)
  overlay.visuals.push(clip('overlay', 3, 2))
  assert.equal(removeClips(overlay, ['v'], true).visuals[0].start, 3)
  assert.equal(closeGaps(doc).visuals[1].start, 4)
})
test('keyframes interpolate separate channels; fade and track solo determine preview output', () => {
  const c = clip('v', 0, 4, {
    transform: { x: 0, opacity: 1 },
    keyframes: [
      { time: 2, x: 1 },
      { time: 4, opacity: 0 }
    ],
    fadeIn: 1,
    fadeOut: 1
  })
  assert.equal(evaluatedTransform(c, 1).x, 0.5)
  assert.equal(evaluatedTransform(c, 2).opacity, 0.5)
  const doc = pair()
  doc.tracks.push({ id: 'a2', kind: 'audio', name: '2', solo: true })
  assert.equal(trackAudible(doc, doc.sounds[0]), false)
  assert.equal(trackAudible(doc, { ...doc.sounds[0], trackId: 'a2' }), true)
})

test('splitting across an animation segment retains interpolated endpoints', () => {
  const c = clip('v', 0, 10, { keyframes: [{ time: 10, x: 1 }] })
  const part = sliceClip(c, 2, 4)
  assert.equal(evaluatedTransform(part, 0).x, 0.2)
  assert.ok(Math.abs(evaluatedTransform(part, 1).x - 0.3) < 1e-8)
  assert.equal(evaluatedTransform(part, 2).x, 0.4)
})

test('preview reverse follows output-frame sampling while freeze follows source frames', () => {
  const reverse = clip('r', 0, 4, { sourceIn: 2, rate: 2, reverse: true })
  assert.equal(previewSourceTime(reverse, 0, 10, 60), 9.8)
  assert.equal(previewSourceTime(reverse, 1, 10, 60), 7.8)
  assert.equal(previewSourceTime({ ...reverse, freeze: true, sourceIn: 2.01 }, 0, 10, 60), 2)
  assert.throws(() => readDocument(JSON.stringify({ ...emptyDocument(), fps: 29.97 })), /保留/)
  assert.throws(() => readDocument(JSON.stringify({ ...emptyDocument(), width: 7680 })), /保留/)
  const doc = { ...emptyDocument(), visuals: [clip('v', 0, 2, { keyframes: [{ time: 3, x: 0 }] })] }
  assert.throws(() => readDocument(JSON.stringify(doc)), /保留/)
})

test('mixed and caption-only selections retain relative timing through copy, paste, split and cut', () => {
  const doc = {
    ...pair(),
    captions: [{ id: 'cue', text: 'subtitle', start: 3, duration: 2, style: { color: '#ffffff' } }]
  }
  const copy = copyClips(doc, ['v', 'cue'])
  const next = pasteClips(doc, copy, 10)
  assert.equal(next.captions[1].start, 11)
  assert.notEqual(next.captions[1].id, 'cue')
  assert.deepEqual(next.captions[1].style, doc.captions[0].style)
  const captionOnly = copyClips(doc, ['cue'])
  assert.equal(pasteClips(doc, captionOnly, 20).captions[1].start, 20)
  assert.equal(pasteClips(doc, captionOnly, 21600), doc)
  const split = splitClips(doc, ['v', 'cue'], 4)
  assert.deepEqual(
    split.captions.map(({ start, duration }) => [start, duration]),
    [
      [3, 1],
      [4, 1]
    ]
  )
  assert.equal(removeClips(doc, ['cue']).captions.length, 0)
  doc.tracks[1].locked = true
  assert.equal(removeClips(doc, ['v', 'cue']), doc)
  assert.equal(pasteClips(doc, copy, 10), doc)
  assert.equal(copy.captions[0].id, 'cue')
})
