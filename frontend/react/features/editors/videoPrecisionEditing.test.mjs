import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyDocument, evaluatedTransform, sourceTime, readDocument } from './videoStudioModel.ts'
import {
  slipVideoClip,
  rollVideoBoundary,
  adjacentVideoBoundaries,
  precisionPreviewRange
} from './videoPrecisionEditing.ts'

const clip = (id, start = 0, duration = 5, extra = {}) => ({
  id,
  path: `${id}.mp4`,
  name: id,
  kind: 'video',
  start,
  duration,
  sourceIn: 10,
  sourceDuration: 100,
  rate: 1,
  gain: 1,
  ...extra
})
function pair(extraLeft = {}, extraRight = {}) {
  return {
    ...emptyDocument(),
    visuals: [
      clip('left', 0, 5, { linkId: 'left-link', ...extraLeft }),
      clip('right', 5, 5, { sourceIn: 20, linkId: 'right-link', ...extraRight })
    ],
    sounds: [
      clip('left-audio', 0, 5, { linkId: 'left-link', trackId: 'audio-1', ...extraLeft }),
      clip('right-audio', 5, 5, {
        sourceIn: 20,
        linkId: 'right-link',
        trackId: 'audio-1',
        ...extraRight
      })
    ]
  }
}
const find = (doc, id) => [...doc.visuals, ...doc.sounds].find((item) => item.id === id)
const approximately = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`)

test('slip preserves timeline/effects and converts integer timeline frames through rate and reverse', () => {
  for (const reverse of [false, true]) {
    const doc = pair({
      rate: 2,
      reverse,
      fadeIn: 1,
      keyframes: [{ time: 3, x: 0.5 }],
      transform: { rotation: 20 }
    })
    const result = slipVideoClip(doc, 'left', 'visual', 15)
    assert.equal(result.error, '')
    assert.deepEqual(result.changedIds, ['left', 'left-audio'])
    for (const id of result.changedIds) {
      const before = find(doc, id),
        after = find(result.document, id)
      assert.deepEqual(after, { ...before, sourceIn: before.sourceIn + (reverse ? -1 : 1) })
      assert.equal(after.keyframes, before.keyframes)
    }
    assert.equal(find(result.document, 'right'), find(doc, 'right'))
    assert.equal(find(doc, 'left').sourceIn, 10)
  }
})

test('slip checks every associated source, locked member, freeze frame and integer offset', () => {
  const doc = pair()
  doc.sounds[0].sourceDuration = 15
  assert.equal(slipVideoClip(doc, 'left', 'visual', 1).document, doc)
  const locked = pair()
  locked.tracks[1].locked = true
  assert.match(slipVideoClip(locked, 'left', 'visual', 1).error, /锁定/)
  assert.match(slipVideoClip(pair(), 'left', 'visual', 0.5).error, /整数/)
  const frozen = pair({ freeze: true, rate: 4, sourceIn: 99.9 })
  approximately(
    find(slipVideoClip(frozen, 'left', 'visual', 1).document, 'left').sourceIn,
    99.9 + 1 / 30
  )
  assert.ok(slipVideoClip(frozen, 'left', 'visual', 3).error)
  const image = pair({ kind: 'image' })
  assert.match(slipVideoClip(image, 'left', 'visual', 1).error, /图片/)
})

test('rolling a cut keeps outer edges, linked A/V and retained source samples at the same timeline time', () => {
  for (const reverse of [false, true]) {
    for (const boundary of [4, 6]) {
      const doc = pair({ reverse, rate: 2 }, { reverse, rate: 0.5 })
      const result = rollVideoBoundary(doc, 'left', 'right', 'visual', boundary)
      assert.equal(result.error, '')
      assert.equal(result.changedIds.length, 4)
      for (const list of [result.document.visuals, result.document.sounds]) {
        assert.equal(list[0].start, 0)
        assert.equal(list[0].duration, boundary)
        assert.equal(list[1].start, boundary)
        assert.equal(list[1].start + list[1].duration, 10)
      }
      approximately(sourceTime(find(result.document, 'left'), 2), sourceTime(find(doc, 'left'), 2))
      approximately(
        sourceTime(find(result.document, 'right'), 8),
        sourceTime(find(doc, 'right'), 8)
      )
      readDocument(JSON.stringify(result.document))
    }
  }
})

test('rolling freeze/image clips keeps their source while validating all newly exposed handles', () => {
  const frozen = pair({ freeze: true, sourceIn: 99.9 }, { kind: 'image' })
  const result = rollVideoBoundary(frozen, 'left', 'right', 'visual', 6)
  assert.equal(result.error, '')
  assert.equal(find(result.document, 'left').sourceIn, 99.9)
  assert.equal(find(result.document, 'right').sourceIn, 20)
  const reverse = pair({ reverse: true, sourceIn: 0 })
  assert.ok(rollVideoBoundary(reverse, 'left', 'right', 'visual', 6).error)
  const short = pair({}, { sourceIn: 0 })
  assert.ok(rollVideoBoundary(short, 'left', 'right', 'visual', 4).error)
})

test('roll preserves fade settings and evaluates/rebases keyframes at trimmed or extended boundaries', () => {
  for (const boundary of [4, 6]) {
    const effects = {
      fadeIn: 0.5,
      fadeOut: 0.75,
      color: { brightness: 0.1, contrast: 1, saturation: 1 },
      transform: { x: 0, opacity: 0.6, rotation: 30 },
      keyframes: [
        { time: 2, x: 0.4, opacity: 0.8 },
        { time: 5, x: 0.9, opacity: 1 }
      ]
    }
    const doc = pair(effects, effects)
    const result = rollVideoBoundary(doc, 'left', 'right', 'visual', boundary)
    assert.equal(result.error, '')
    for (const id of result.changedIds) {
      const before = find(doc, id),
        after = find(result.document, id)
      assert.equal(after.fadeIn, before.fadeIn)
      assert.equal(after.fadeOut, before.fadeOut)
      assert.equal(after.transform.rotation, 30)
      assert.equal(after.color, before.color)
      assert.ok(after.keyframes.every((frame) => frame.time >= 0 && frame.time <= after.duration))
      for (const time of [
        Math.max(before.start, after.start) + 1,
        Math.min(before.start + before.duration, after.start + after.duration) - 1
      ]) {
        const a = evaluatedTransform({ ...before, fadeIn: 0, fadeOut: 0 }, time - before.start)
        const b = evaluatedTransform({ ...after, fadeIn: 0, fadeOut: 0 }, time - after.start)
        approximately(a.x, b.x)
        approximately(a.opacity, b.opacity)
      }
    }
    readDocument(JSON.stringify(result.document))
  }
})

test('roll rejects locked or mismatched associations, unrelated collisions and invalid boundary values atomically', () => {
  const locked = pair()
  locked.tracks[1].locked = true
  assert.equal(rollVideoBoundary(locked, 'left', 'right', 'visual', 6).document, locked)
  const mismatched = pair()
  mismatched.sounds[0].duration = 4
  assert.match(rollVideoBoundary(mismatched, 'left', 'right', 'visual', 6).error, /不一致/)
  const overlap = pair()
  overlap.visuals.push(clip('overlay', 5.5, 1))
  assert.match(rollVideoBoundary(overlap, 'left', 'right', 'visual', 6).error, /覆盖/)
  for (const boundary of [0, 10, -1, Infinity]) {
    const doc = pair()
    assert.equal(rollVideoBoundary(doc, 'left', 'right', 'visual', boundary).document, doc)
  }
  const sameLink = pair()
  sameLink.visuals[1].linkId = 'left-link'
  assert.match(rollVideoBoundary(sameLink, 'left', 'right', 'visual', 6).error, /同一关联组/)
  const gap = pair()
  gap.visuals[1].start = 5.1
  assert.equal(adjacentVideoBoundaries(gap, 'left', 'visual').length, 0)
})

test('frame rounding, no-op edits and bounded before/after previews never change the input document', () => {
  const doc = pair()
  assert.equal(slipVideoClip(doc, 'left', 'visual', 0).document, doc)
  assert.equal(rollVideoBoundary(doc, 'left', 'right', 'visual', 5).document, doc)
  const result = rollVideoBoundary(doc, 'left', 'right', 'visual', 5.049)
  approximately(find(result.document, 'right').start, 5 + 1 / 30)
  assert.deepEqual(
    adjacentVideoBoundaries(doc, 'left', 'visual').map((item) => item.time),
    [5]
  )
  const preview = precisionPreviewRange(result.document, 5, 'after', 99)
  assert.equal(preview.end - preview.start, 6)
  assert.equal(preview.document, result.document)
  assert.equal(doc.visuals[0].duration, 5)
})

test('keyframe capacity and long reverse limits reject the whole roll instead of discarding effects', () => {
  const doc = pair({
    keyframes: Array.from({ length: 128 }, (_, index) => ({
      time: (index + 1) / 30,
      x: index / 256
    }))
  })
  const capped = rollVideoBoundary(doc, 'left', 'right', 'visual', 6)
  assert.match(capped.error, /128/)
  assert.equal(capped.document, doc)
  assert.equal(doc.visuals[0].keyframes.length, 128)
  const long = pair({ reverse: true, duration: 30, sourceIn: 50 })
  for (const item of [long.visuals[1], long.sounds[1]]) item.start = 30
  assert.match(rollVideoBoundary(long, 'left', 'right', 'visual', 31).error, /30/)
})

test('rolls and repeated rolls retain sparse rotation and per-channel easing at every surviving time', () => {
  const effects = {
    transform: { x: -0.2, y: 0.1, rotation: -30, opacity: 0.4 },
    keyframes: [
      { time: 1, rotation: 45, easing: 'easeIn' },
      { time: 2.5, x: 0.5, opacity: 0.9, easing: 'easeOut' },
      { time: 4, y: -0.3, rotation: 150, easing: 'easeInOut' },
      { time: 5, x: -0.1, rotation: 0, easing: 'easeIn' }
    ]
  }
  for (const boundary of [4, 6]) {
    const doc = pair(effects, effects)
    const once = rollVideoBoundary(doc, 'left', 'right', 'visual', boundary)
    assert.equal(once.error, '')
    const twice = rollVideoBoundary(
      once.document,
      'left',
      'right',
      'visual',
      boundary === 4 ? 4.5 : 5.5
    )
    assert.equal(twice.error, '')
    for (const [baseline, result] of [
      [doc, once],
      [once.document, twice]
    ]) {
      readDocument(JSON.stringify(result.document))
      for (const id of result.changedIds) {
        const before = find(baseline, id),
          after = find(result.document, id)
        for (
          let t = Math.max(before.start, after.start);
          t < Math.min(before.start + before.duration, after.start + after.duration);
          t += 0.031
        ) {
          const a = evaluatedTransform(before, t - before.start),
            b = evaluatedTransform(after, t - after.start)
          for (const field of ['x', 'y', 'scale', 'rotation', 'opacity'])
            approximately(a[field], b[field])
        }
      }
    }
  }
})
