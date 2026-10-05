import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyDocument, moveClips, readDocument, sliceClip } from './videoStudioModel.ts'
import { editVideoClip } from './videoTimelineInteraction.ts'
import {
  linkSelectedVideoClips,
  synchronizeVideoPair,
  unlinkVideoClips,
  videoLinkMembers
} from './videoLinks.ts'

const clip = (id, extra = {}) => ({
  id,
  path: `/${id}.mp4`,
  name: id,
  kind: 'video',
  start: 10,
  duration: 10,
  sourceIn: 20,
  sourceDuration: 120,
  rate: 1,
  gain: 1,
  ...extra
})
const pair = (visual = {}, sound = {}) => ({
  ...emptyDocument(),
  visuals: [clip('v', { linkId: 'pair', ...visual })],
  sounds: [
    clip('s', { kind: 'audio', start: 12, sourceIn: 40, duration: 8, linkId: 'pair', ...sound })
  ]
})
const timings = (c) => [c.start, c.sourceIn, c.duration, c.rate]
const valid = (result) => {
  assert.equal(result.error, '')
  assert.doesNotThrow(() => readDocument(JSON.stringify(result.document)))
  return result.document
}

test('manual linking merges complete groups without touching sources, timing or unrelated clips', () => {
  const doc = pair()
  doc.visuals.push(clip('v2', { start: 35, linkId: 'other' }), clip('unrelated'))
  doc.sounds.push(clip('s2', { kind: 'audio', start: 39, linkId: 'other' }))
  const before = structuredClone(doc)
  const result = linkSelectedVideoClips(doc, ['v', 's2', 'missing'], { createId: () => 'merged' })
  const next = valid(result)
  assert.deepEqual(result.memberIds, ['v', 'v2', 's', 's2'])
  assert.equal(next.visuals[2], doc.visuals[2])
  for (const lane of ['visuals', 'sounds'])
    for (let i = 0; i < next[lane].length; i++) {
      const original = before[lane][i]
      assert.deepEqual(next[lane][i], {
        ...original,
        ...(original.id === 'unrelated' ? {} : { linkId: 'merged' })
      })
    }
  assert.deepEqual(doc, before)
  assert.equal(
    linkSelectedVideoClips(next, ['v'], {
      createId: () => {
        throw Error('already linked')
      }
    }).document,
    next
  )
  const moved = moveClips(next, ['v2'], 3)
  assert.deepEqual(
    moved.visuals.map((c) => c.start),
    [13, 38, 10]
  )
  assert.deepEqual(
    moved.sounds.map((c) => c.start),
    [15, 42]
  )
})

test('unlinked picture and audio can be linked, while one lane and ID collisions reject atomically', () => {
  const doc = pair({ linkId: undefined }, { linkId: undefined })
  const next = valid(linkSelectedVideoClips(doc, ['v', 's'], { createId: () => 'new' }))
  assert.deepEqual(timings(next.visuals[0]), timings(doc.visuals[0]))
  assert.deepEqual(timings(next.sounds[0]), timings(doc.sounds[0]))
  assert.match(linkSelectedVideoClips(doc, ['v']).error, /同时选择/)
  doc.visuals.push(clip('v2', { linkId: 'existing' }))
  assert.equal(
    linkSelectedVideoClips(doc, ['v', 's'], { createId: () => 'existing' }).document,
    doc
  )
})

test('readonly and hidden locked group members block link, unlink and sync without partial changes', () => {
  const doc = pair()
  doc.tracks.push({ id: 'locked', kind: 'audio', name: 'locked', gain: 1, locked: true })
  doc.sounds.push(clip('hidden', { kind: 'audio', trackId: 'locked', linkId: 'pair' }))
  assert.equal(videoLinkMembers(doc, ['v']).length, 3)
  for (const result of [
    linkSelectedVideoClips(doc, ['v', 's']),
    unlinkVideoClips(doc, ['v']),
    synchronizeVideoPair(doc, 'v', 's', { move: 'sound', offsetSeconds: 0 })
  ]) {
    assert.equal(result.document, doc)
    assert.match(result.error, /锁定/)
  }
  doc.tracks.pop()
  doc.sounds.pop()
  for (const result of [
    linkSelectedVideoClips(doc, ['v', 's'], { readonly: true }),
    unlinkVideoClips(doc, ['v'], true),
    synchronizeVideoPair(doc, 'v', 's', { move: 'visual', offsetSeconds: 0, readonly: true })
  ]) {
    assert.equal(result.document, doc)
    assert.match(result.error, /只读/)
  }
})

test('unlinking detaches every member of the selected group and preserves unrelated groups', () => {
  const doc = pair()
  doc.sounds.push(
    clip('extra', { kind: 'audio', linkId: 'pair' }),
    clip('other', { linkId: 'other' })
  )
  const next = valid(unlinkVideoClips(doc, ['v']))
  assert.deepEqual(
    next.sounds.map((c) => c.linkId),
    [undefined, undefined, 'other']
  )
  assert.equal(next.visuals[0].linkId, undefined)
  assert.deepEqual(timings(next.sounds[0]), timings(doc.sounds[0]))
  assert.equal(next.sounds[2], doc.sounds[2])
})

test('aligning starts explicitly moves only the selected side, including its same-side linked members', () => {
  const doc = pair()
  doc.sounds.push(clip('s2', { kind: 'audio', linkId: 'pair', start: 18 }))
  doc.visuals.push(clip('v2', { linkId: 'pair', start: 14 }))
  const sounds = valid(synchronizeVideoPair(doc, 'v', 's', { move: 'sound', offsetSeconds: 0 }))
  assert.deepEqual(
    sounds.visuals.map((c) => c.start),
    [10, 14]
  )
  assert.deepEqual(
    sounds.sounds.map((c) => c.start),
    [10, 16]
  )
  const pictures = valid(synchronizeVideoPair(doc, 'v', 's', { move: 'visual', offsetSeconds: 0 }))
  assert.deepEqual(
    pictures.visuals.map((c) => c.start),
    [12, 16]
  )
  assert.deepEqual(
    pictures.sounds.map((c) => c.start),
    [12, 18]
  )
  for (const next of [sounds, pictures])
    for (const lane of ['visuals', 'sounds']) {
      next[lane].forEach((c, i) =>
        assert.deepEqual({ ...c, start: doc[lane][i].start }, doc[lane][i])
      )
    }
})

test('offsets support either sign, snap to frames, and do not implicitly link unlinked anchors', () => {
  const doc = pair({ linkId: undefined }, { linkId: undefined })
  const early = valid(synchronizeVideoPair(doc, 'v', 's', { move: 'sound', offsetSeconds: -1.02 }))
  assert.equal(early.sounds[0].start, 8.966667)
  assert.equal(early.sounds[0].linkId, undefined)
  assert.equal(early.visuals[0], doc.visuals[0])
  const late = valid(synchronizeVideoPair(doc, 'v', 's', { move: 'visual', offsetSeconds: 3 }))
  assert.equal(late.visuals[0].start, 9)
  assert.equal(late.sounds[0], doc.sounds[0])
  assert.deepEqual(
    synchronizeVideoPair(doc, 'v', 's', { move: 'sound', offsetSeconds: 2 }).changedIds,
    []
  )
})

test('sync rejects unknown anchors, nonfinite offsets, negative starts and every member beyond 6 hours', () => {
  const doc = pair()
  doc.sounds.push(clip('s2', { kind: 'audio', start: 21585, linkId: 'pair' }))
  for (const result of [
    synchronizeVideoPair(doc, 'missing', 's', { move: 'sound', offsetSeconds: 0 }),
    synchronizeVideoPair(doc, 'v', 's', { move: 'sound', offsetSeconds: NaN }),
    synchronizeVideoPair(doc, 'v', 's', { move: 'sound', offsetSeconds: -11 }),
    synchronizeVideoPair(doc, 'v', 's', { move: 'sound', offsetSeconds: 8 })
  ]) {
    assert.equal(result.document, doc)
    assert.ok(result.error)
  }
})

test('linked numeric and drag moves preserve deliberately different timeline and source offsets', () => {
  const doc = pair()
  const next = valid(editVideoClip(doc, 'v', 'visual', (c) => ({ ...c, start: 15 })))
  assert.deepEqual(timings(next.visuals[0]), [15, 20, 10, 1])
  assert.deepEqual(timings(next.sounds[0]), [17, 40, 8, 1])
  assert.deepEqual(timings(moveClips(doc, ['v'], 5).sounds[0]), timings(next.sounds[0]))
})

test('left/right trims retain offsets and distinct source rates instead of setting identical clips', () => {
  const doc = pair({}, { rate: 2 })
  const left = valid(editVideoClip(doc, 'v', 'visual', (c) => sliceClip(c, 2, c.duration)))
  assert.deepEqual(timings(left.visuals[0]), [12, 22, 8, 1])
  assert.deepEqual(timings(left.sounds[0]), [14, 44, 6, 2])
  const right = valid(editVideoClip(doc, 'v', 'visual', (c) => ({ ...c, duration: 8 })))
  assert.deepEqual(timings(right.sounds[0]), [12, 40, 6, 2])
  const slip = valid(editVideoClip(doc, 'v', 'visual', (c) => ({ ...c, sourceIn: 21 })))
  assert.deepEqual(timings(slip.sounds[0]), [12, 42, 8, 2])
})

test('relative rate changes retain timeline offset, source handles and partner duration ratio', () => {
  const doc = pair({}, { rate: 0.5, duration: 12, fadeIn: 2 })
  const next = valid(
    editVideoClip(doc, 'v', 'visual', (c) => ({ ...c, rate: 2, duration: c.duration / 2 }))
  )
  assert.deepEqual(timings(next.visuals[0]), [10, 20, 5, 2])
  assert.deepEqual(timings(next.sounds[0]), [12, 40, 6, 1])
  assert.equal(next.sounds[0].fadeIn, 1)
  const restored = valid(
    editVideoClip(next, 'v', 'visual', (c) => ({ ...c, rate: 1, duration: c.duration * 2 }))
  )
  assert.deepEqual(timings(restored.sounds[0]), timings(doc.sounds[0]))
})

test('reverse and mixed-direction left/right trims use playback-leading source edges', () => {
  const doc = pair({ reverse: true }, { reverse: true, rate: 2 })
  const left = valid(editVideoClip(doc, 'v', 'visual', (c) => sliceClip(c, 2, c.duration)))
  assert.deepEqual(timings(left.sounds[0]), [14, 40, 6, 2])
  const right = valid(editVideoClip(doc, 'v', 'visual', (c) => sliceClip(c, 0, 8)))
  assert.deepEqual(timings(right.sounds[0]), [12, 44, 6, 2])
  doc.sounds[0].reverse = false
  const mixed = valid(editVideoClip(doc, 'v', 'visual', (c) => sliceClip(c, 2, c.duration)))
  assert.deepEqual(timings(mixed.sounds[0]), [14, 44, 6, 2])
})

test('reverse toggles and frozen clips preserve each member source window', () => {
  const doc = pair()
  const reversed = valid(editVideoClip(doc, 'v', 'visual', (c) => ({ ...c, reverse: true })))
  assert.deepEqual(timings(reversed.sounds[0]), timings(doc.sounds[0]))
  assert.equal(reversed.sounds[0].reverse, true)
  const frozen = pair({ freeze: true }, { freeze: true })
  const trimmed = valid(editVideoClip(frozen, 'v', 'visual', (c) => sliceClip(c, 2, 8)))
  assert.deepEqual(timings(trimmed.sounds[0]), [14, 40, 4, 1])
  const slipped = valid(editVideoClip(frozen, 'v', 'visual', (c) => ({ ...c, sourceIn: 23 })))
  assert.deepEqual(timings(slipped.sounds[0]), [12, 43, 8, 1])
})

test('relative timing cannot move any member negative, empty it or exceed its source/rate bounds', () => {
  const doc = pair()
  const cases = [
    [pair({ start: 10 }, { start: 2 }), (c) => ({ ...c, start: 5 })],
    [doc, (c) => ({ ...c, duration: 1 })],
    [pair({}, { sourceIn: 119, duration: 1 }), (c) => ({ ...c, duration: 11 })],
    [pair({}, { rate: 4 }), (c) => ({ ...c, rate: 2, duration: 5 })],
    [pair({}, { sourceIn: 0 }), (c) => ({ ...c, sourceIn: 19 })]
  ]
  for (const [source, transform] of cases) {
    const result = editVideoClip(source, 'v', 'visual', transform)
    assert.equal(result.document, source)
    assert.ok(result.error)
  }
})

test('already-valid subframe source clips can move without an unrelated duration rejection', () => {
  const doc = pair({ duration: 0.01 }, { duration: 0.01 })
  const next = valid(editVideoClip(doc, 'v', 'visual', (c) => ({ ...c, start: 11 })))
  assert.deepEqual(timings(next.sounds[0]), [13, 40, 0.01, 1])
})
