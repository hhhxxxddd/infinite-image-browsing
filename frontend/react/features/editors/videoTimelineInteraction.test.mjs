import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyDocument, moveClips, readDocument, sliceClip } from './videoStudioModel.ts'
import { videoSoundEnvelope } from './videoSoundProperties.ts'
import {
  commitVideoTimingInput,
  editVideoClip,
  fitVideoTimeline,
  snapVideoTime,
  videoClipGeometry,
  videoContentScrollLimit,
  videoFrameTime,
  videoSpaceControlsPlayback,
  videoSnapPoints,
  videoTimingLockReason
} from './videoTimelineInteraction.ts'
import { clampTimelinePosition, normalizeTimelineRange } from './timelineTime.ts'

const clip = (id, extra = {}) => ({
  id,
  path: '/movie.mp4',
  name: 'movie',
  kind: 'video',
  start: 0,
  duration: 4,
  sourceIn: 0,
  sourceDuration: 60,
  rate: 1,
  gain: 1,
  ...extra
})
const pair = () => ({
  ...emptyDocument(),
  visuals: [clip('v', { linkId: 'pair' })],
  sounds: [clip('a', { linkId: 'pair' })]
})

test('extreme slowdown retains the original trimmed automation and long fade after saving', () => {
  const source = clip('a', {
    kind: 'audio',
    rate: 4,
    duration: 40,
    sourceDuration: 200,
    fadeIn: 30,
    fadeOut: 10,
    fadeCurve: 'smooth',
    gainPoints: [
      { time: 0, gain: 0.5 },
      { time: 40, gain: 1 }
    ]
  })
  const trimmed = sliceClip(source, 2, 12)
  const doc = { ...emptyDocument(), sounds: [trimmed] }
  const result = editVideoClip(doc, 'a', 'sound', (c) => ({
    ...c,
    rate: 0.25,
    duration: c.duration * 16
  }))
  assert.equal(result.error, '')
  const saved = readDocument(JSON.stringify(result.document)).sounds[0]
  assert.equal(saved.fadeIn, 480)
  assert.equal(saved.envelopeOffset, 32)
  for (const stamp of [0, 1, 4, 9.99])
    assert.ok(
      Math.abs(videoSoundEnvelope(saved, stamp * 16) - videoSoundEnvelope(trimmed, stamp)) < 1e-8
    )
})

test('precise entry bypasses drag snapping, commits linked clips and displays accepted frame time', () => {
  let doc = pair()
  const apply = (value) => {
    const result = editVideoClip(doc, 'v', 'visual', (c) => ({
      ...c,
      start: videoFrameTime(value, doc.fps)
    }))
    doc = result.document
    return result.clip.start
  }
  assert.equal(commitVideoTimingInput('0.2', 0, apply), 0.2)
  assert.deepEqual([doc.visuals[0].start, doc.sounds[0].start], [0.2, 0.2])
  assert.equal(commitVideoTimingInput('0.21', 0.2, apply), 0.2)
  assert.equal(commitVideoTimingInput('0.22', 0.2, apply), 0.233333)
  assert.equal(commitVideoTimingInput('', 0.233333, apply), 0.233333)
})

test('unchanged non-frame metadata and cancelled drafts do not mutate timing on blur', () => {
  const apply = () => {
    throw new Error('unchanged/cancelled input must not edit the clip')
  }
  assert.equal(commitVideoTimingInput(24.0065, 24.0065, apply), 24.0065)
  assert.equal(commitVideoTimingInput('24.0065', 24.0065, apply), 24.0065)
  assert.equal(commitVideoTimingInput('10', 24.0065, apply, true), 24.0065)
  const doc = pair()
  const unchanged = editVideoClip(doc, 'v', 'visual', (c) => ({ ...c, gain: c.gain }))
  assert.equal(unchanged.document, doc, 'a repeated property value must not create an undo entry')
  assert.equal(unchanged.clip, doc.visuals[0])
})

test('linked default-track locks explain rejection and preserve accepted values and visual edit freedom', () => {
  const doc = pair()
  doc.tracks[1].locked = true
  assert.match(videoTimingLockReason(doc, doc.visuals[0], 'visual'), /声音 1.*锁定/)
  const displayed = commitVideoTimingInput('2', 0, (value) => {
    const result = editVideoClip(doc, 'v', 'visual', (c) => ({ ...c, start: value }))
    assert.equal(result.document, doc)
    assert.match(result.error, /关联轨道/)
    return result.clip.start
  })
  assert.equal(displayed, 0)
  const visual = editVideoClip(doc, 'v', 'visual', (c) => ({ ...c, transform: { opacity: 0.5 } }))
  assert.equal(visual.document.visuals[0].transform.opacity, 0.5)
  assert.equal(visual.document.sounds[0], doc.sounds[0])
})

test('rejected source bounds and own-track locks return true previous values', () => {
  const doc = pair()
  const result = editVideoClip(doc, 'v', 'visual', (c) => ({ ...c, duration: 100 }))
  assert.match(result.error, /超出/)
  assert.equal(result.clip.duration, 4)
  assert.equal(result.document, doc)
  doc.tracks[0].locked = true
  assert.equal(editVideoClip(doc, 'v', 'visual', (c) => ({ ...c, gain: 0.5 })).document, doc)
})

test('linked duration changes also trim both members fades and keyframes', () => {
  const doc = pair()
  doc.sounds[0].fadeOut = 3
  doc.sounds[0].keyframes = [{ time: 3, opacity: 0 }]
  const result = editVideoClip(doc, 'v', 'visual', (c) => ({ ...c, duration: 1 }))
  assert.equal(result.document.sounds[0].duration, 1)
  assert.equal(result.document.sounds[0].fadeOut, 1)
  assert.deepEqual(result.document.sounds[0].keyframes, [])
})

test('drag snapping follows 8 screen pixels and excludes the whole linked selection', () => {
  const doc = pair()
  doc.visuals[0].start = doc.sounds[0].start = 10
  const base = {
    enabled: true,
    exceptIds: ['v'],
    playhead: 100,
    pixelsPerSecond: 100,
    points: videoSnapPoints(doc, 100, ['v'])
  }
  assert.equal(snapVideoTime(10.033333, doc, base), 10.033333)
  doc.markers = [{ id: 'm', name: 'M', time: 10.1 }]
  base.points = videoSnapPoints(doc, 100, ['v'])
  assert.equal(snapVideoTime(10.033333, doc, base), 10.1)
  assert.equal(snapVideoTime(10.033333, doc, { ...base, pixelsPerSecond: 1000 }), 10.033333)
  const snapped = snapVideoTime(5.133333, doc, { ...base, offsets: [0, 5] })
  assert.equal(snapped, 5.1)
  const moved = moveClips(doc, ['v'], snapped - doc.visuals[0].start)
  assert.equal(moved.visuals[0].start, moved.sounds[0].start)
})

test('short clip bodies keep exact time width and do not cover their adjacent clip', () => {
  const first = videoClipGeometry(0.2, 23.93)
  const nextLeft = 0.2 * 23.93
  assert.equal(first.width, nextLeft)
  assert.equal(first.compact, true)
  assert.equal(videoClipGeometry(4, 23.93).compact, false)
  assert.ok(videoClipGeometry(1 / 30, 0.03125).width < 1)
})

test('fit uses content and selection duration with modest padding rather than the editable 30 seconds', () => {
  const fit = fitVideoTimeline(0, 4, 844)
  assert.ok(4 * fit.zoom > 600)
  assert.ok(4 * fit.zoom < 718)
  assert.equal(fit.left, 0)
  const selection = fitVideoTimeline(50, 50.2, 844)
  assert.ok(0.2 * selection.zoom > 600)
  assert.ok(selection.left < 50 * selection.zoom)
  assert.ok(selection.left + 718 > 50.2 * selection.zoom)
})

test('shortened content clamps existing playhead/range/scroll without imposing new zoom', () => {
  assert.equal(clampTimelinePosition(926.736, 24.0065), 24.0065)
  assert.equal(normalizeTimelineRange({ start: 900, end: 926 }, 24.0065), null)
  assert.deepEqual(normalizeTimelineRange({ start: 4.5, end: 926 }, 24.0065), {
    start: 4.5,
    end: 24.0065
  })
  assert.equal(videoContentScrollLimit(24.0065, 0.5, 844), 0)
  assert.ok(videoContentScrollLimit(24.0065, 100, 844) < 2400)
})

test('Space plays from focused clips but leaves buttons, inputs, sliders and text editing alone', () => {
  assert.equal(
    videoSpaceControlsPlayback({ typing: false, timelineItem: true, interactive: true }),
    true
  )
  assert.equal(
    videoSpaceControlsPlayback({ typing: false, timelineItem: false, interactive: false }),
    true
  )
  assert.equal(
    videoSpaceControlsPlayback({ typing: false, timelineItem: false, interactive: true }),
    false
  )
  assert.equal(
    videoSpaceControlsPlayback({ typing: true, timelineItem: true, interactive: true }),
    false
  )
})

test('video alignment includes caption edges and temporary bypass still keeps frame precision', () => {
  const doc = {
    ...emptyDocument(),
    captions: [{ id: 'cue', text: 'caption', start: 10.1, duration: 2 }]
  }
  const options = { enabled: true, playhead: 100, pixelsPerSecond: 100 }
  assert.equal(snapVideoTime(10.034, doc, options), 10.1)
  assert.equal(snapVideoTime(10.034, doc, { ...options, enabled: false }), 10.033333)
  assert.equal(snapVideoTime(10.034, doc, { ...options, exceptIds: ['cue'] }), 10.033333)
})
