import assert from 'node:assert/strict'
import test from 'node:test'
import {
  emptyDocument,
  evaluatedTransform,
  readDocument,
  setVideoTransition,
  sliceClip,
  videoEase
} from './videoStudioModel.ts'
import {
  copyVideoKeyframesToTime,
  moveVideoKeyframes,
  patchVideoKeyframes,
  upsertVideoKeyframe
} from './videoAnimationEditing.ts'
import { videoCaptionLines, wrapVideoCaption } from './videoCaptionLayout.ts'
const clip = (id = 'a', extra = {}) => ({
  id,
  path: '/v.mp4',
  name: id,
  kind: 'video',
  start: 0,
  duration: 4,
  sourceIn: 0,
  sourceDuration: 60,
  rate: 1,
  gain: 1,
  ...extra
})
const close = (a, b) => assert.ok(Math.abs(a - b) < 0.00001, `${a} != ${b}`)

test('all four easing modes and rotation evaluate their actual incoming curve', () => {
  for (const easing of ['linear', 'easeIn', 'easeOut', 'easeInOut']) {
    const c = clip('a', { keyframes: [{ time: 4, x: 1, rotation: 180, easing }] })
    close(evaluatedTransform(c, 1).x, videoEase(0.25, easing))
    close(evaluatedTransform(c, 1).rotation, videoEase(0.25, easing) * 180)
    close(evaluatedTransform(c, 4).rotation, 180)
  }
})
test('split and repeated trims preserve sparse differently eased channels at every retained instant', () => {
  const c = clip('a', {
    transform: { x: -0.3, rotation: -60 },
    keyframes: [
      { time: 1, y: 0.3, easing: 'easeIn' },
      { time: 2, x: 0.5, scale: 1.6, easing: 'easeOut' },
      { time: 4, rotation: 120, x: -0.2, opacity: 0.3, easing: 'easeInOut' }
    ]
  })
  const trimmed = sliceClip(c, 0.4, 3.6),
    again = sliceClip(trimmed, 0.3, 2.6)
  for (let i = 0; i <= 40; i++) {
    const time = (again.duration * i) / 40
    const before = evaluatedTransform(c, time + 0.7),
      after = evaluatedTransform(again, time)
    for (const field of ['x', 'y', 'scale', 'rotation', 'opacity'])
      close(after[field], before[field])
  }
  assert.doesNotThrow(() => readDocument(JSON.stringify({ ...emptyDocument(), visuals: [again] })))
})
test('recording takes current animated bare values and supports a subset of fields', () => {
  const c = clip('a', {
    fadeIn: 2,
    keyframes: [{ time: 4, x: 1, rotation: 180, opacity: 0.5, easing: 'easeIn' }]
  })
  const result = upsertVideoKeyframe(c, 2, ['x', 'rotation', 'opacity'])
  const key = result.clip.keyframes.find((f) => f.time === 2)
  close(key.x, 0.25)
  close(key.rotation, 45)
  close(key.opacity, 0.875)
  assert.equal(key.y, undefined)
  assert.deepEqual(result.times, [2])
  assert.equal(c.keyframes.length, 1)
})
test('moving and copying a selected keyframe group preserves spacing, curves and capacity atomically', () => {
  const c = clip('a', {
    keyframes: [
      { time: 0.5, rotation: 20, easing: 'easeIn' },
      { time: 1, rotation: 45 },
      { time: 3, x: 0.1 }
    ]
  })
  const moved = moveVideoKeyframes(c, [0.5, 1], 0.21, 30)
  assert.deepEqual(moved.times, [0.7, 1.2])
  assert.equal(moved.clip.keyframes[0].easing, 'easeIn')
  assert.match(moveVideoKeyframes(c, [0.5, 1], 2).error, /已有/)
  const copied = copyVideoKeyframesToTime(c, [0.5, 1], 1.5)
  assert.deepEqual(copied.times, [1.5, 2])
  assert.equal(copied.clip.keyframes.length, 5)
  assert.match(copyVideoKeyframesToTime(c, [0.5, 1], 3.8).error, /超出/)
  const dense = clip('a', {
    keyframes: Array.from({ length: 128 }, (_, i) => ({ time: i / 40, x: 0 }))
  })
  assert.match(upsertVideoKeyframe(dense, 3.5).error, /128/)
})
test('bulk values/easing affect selected keys only and clear obsolete retained curve ranges', () => {
  const c = clip('a', {
    keyframes: [
      { time: 1, x: 0.2, curves: { x: { easing: 'easeOut', start: 0.2, end: 0.8 } } },
      { time: 2, x: 0.4 }
    ]
  })
  const result = patchVideoKeyframes(c, [1], { rotation: 60, easing: 'easeIn' })
  assert.equal(result.clip.keyframes[0].rotation, 60)
  assert.equal(result.clip.keyframes[0].curves, undefined)
  assert.equal(result.clip.keyframes[1], c.keyframes[1])
  assert.match(patchVideoKeyframes(c, [1], { rotation: 400 }).error, /范围/)
})
test('transition adjusts actual overlap and linked audio; duration/curve edits and removal preserve sync', () => {
  const before = clip('a', { linkId: 'before' }),
    after = clip('b', { start: 4, linkId: 'after' })
  const doc = {
    ...emptyDocument(),
    visuals: [before, after],
    sounds: [
      clip('sa', { kind: 'audio', linkId: 'before' }),
      clip('sb', { kind: 'audio', start: 4, linkId: 'after' })
    ]
  }
  const result = setVideoTransition(doc, 'b', 1, 'easeIn')
  assert.equal(result.error, undefined)
  assert.equal(result.document.visuals[1].start, 3)
  assert.equal(result.document.sounds[1].start, 3)
  assert.equal(result.document.visuals[1].fadeIn, undefined)
  close(evaluatedTransform(result.document.visuals[1], 0.5).opacity, 0.25)
  const changed = setVideoTransition(result.document, 'b', 0.5, 'easeOut')
  assert.equal(changed.document.visuals[1].start, 3.5)
  const removed = setVideoTransition(changed.document, 'b', 0)
  assert.equal(removed.document.visuals[1].start, 4)
  assert.equal(removed.document.sounds[1].start, 4)
  assert.equal(removed.document.visuals[1].transitionIn, undefined)
  const locked = structuredClone(doc)
  locked.tracks[1].locked = true
  assert.equal(setVideoTransition(locked, 'b', 1).document, locked)
  assert.match(setVideoTransition(locked, 'b', 1).error, /锁定/)
  const sameGroup = structuredClone(doc)
  sameGroup.visuals[1].linkId = 'before'
  assert.equal(setVideoTransition(sameGroup, 'b', 1).document, sameGroup)
  assert.match(setVideoTransition(sameGroup, 'b', 1).error, /同一关联/)
  const gap = structuredClone(doc)
  gap.visuals[1].start = 5
  assert.equal(setVideoTransition(gap, 'b', 0).document, gap)
})
test('trimming a transition preserves original progression without applying the transition twice', () => {
  const c = clip('b', {
    start: 3,
    transitionIn: { previousId: 'a', duration: 1, easing: 'easeInOut' }
  })
  const cut = sliceClip(c, 0.25, 0.75)
  close(evaluatedTransform(cut, 0).opacity, evaluatedTransform(c, 0.25).opacity)
  close(evaluatedTransform(cut, 0.3).opacity, evaluatedTransform(c, 0.55).opacity)
  assert.equal(cut.transitionIn.offset, 0.25)
})
test('caption wrapping keeps explicit lines, words and wide characters while disabled wrapping preserves the source', () => {
  assert.deepEqual(
    wrapVideoCaption('hello world\n你好世界', 50, (text) => text.length * 10),
    ['hello', 'world', '你好世界']
  )
  assert.deepEqual(
    wrapVideoCaption('abcdefghij', 30, (text) => text.length * 10),
    ['abc', 'def', 'ghi', 'j']
  )
  const cue = {
    id: 'c',
    start: 0,
    duration: 1,
    text: '一二三四五六七八九十',
    style: { maxWidth: 0.5 }
  }
  assert.deepEqual(
    videoCaptionLines(cue, 100, (text) => text.length * 10),
    ['一二三四五', '六七八九十']
  )
  assert.deepEqual(
    videoCaptionLines({ ...cue, style: { wrap: false } }, 100, (text) => text.length * 10),
    [cue.text]
  )
})
