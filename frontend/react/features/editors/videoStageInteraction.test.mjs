import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyDocument, evaluatedTransform } from './videoStudioModel.ts'
import {
  stageAlignTransform,
  stageBounds,
  stageCanEdit,
  stageCaptionRects,
  stageClipGeometry,
  stageCropImageRect,
  stageCropRect,
  stageEditCrop,
  stageGestureResult,
  stageGestureCanContinue,
  stageHitClip,
  stageHitRect,
  stageLocalToWorld,
  stageMoveCaption,
  stageMoveTransform,
  stagePatchTransform,
  stageResizeTransform,
  stageRotateTransform,
  stageSourcePoint,
  stageToolsRect,
  stageViewportPoint,
  stageWorldToLocal
} from './videoStageInteraction.ts'

test('compact toolbar docks away from rotation and corner handles on a full canvas', () => {
  for (const width of [280, 600, 1100]) {
    const viewport = { width, height: 300 }
    const handles = [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: 0, y: 300 },
      { x: width, y: 300 },
      { x: width / 2, y: 10 }
    ]
    const rect = stageToolsRect(viewport, handles, { width: 230, height: 34 })
    for (const p of handles)
      assert.ok(
        p.x < rect.x - 10 ||
          p.x > rect.x + rect.width + 10 ||
          p.y < rect.y - 10 ||
          p.y > rect.y + rect.height + 10
      )
    assert.ok(rect.x >= 0 && rect.x + rect.width <= width)
  }
})

const doc = { ...emptyDocument(), width: 1000, height: 500 }
const clip = (transform = {}, extra = {}) => ({
  id: 'v',
  kind: 'video',
  path: '/v.mp4',
  name: 'v',
  start: 2,
  duration: 10,
  sourceIn: 0,
  sourceDuration: 30,
  rate: 1,
  gain: 1,
  transform,
  ...extra
})
const source = { width: 1000, height: 500 }
const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 0.00001, `${actual} != ${expected}`)
const closePoint = (actual, expected) => {
  close(actual.x, expected.x)
  close(actual.y, expected.y)
}

test('held canvas edits are cancelled on seek, selection, visibility or edit permission changes', () => {
  const original = { id: 'v', time: 1.5 }
  const current = { selectedId: 'v', time: 1.5, visible: true, editable: true }
  assert.equal(stageGestureCanContinue(original, current), true)
  for (const patch of [
    { selectedId: 'other' },
    { time: 1.5 + 1 / 30 },
    { visible: false },
    { editable: false }
  ])
    assert.equal(stageGestureCanContinue(original, { ...current, ...patch }), false)
})

test('contain hit testing leaves real margins transparent and cover maps clipped source correctly', () => {
  const square = { width: 500, height: 500 }
  const contained = stageClipGeometry(doc, clip({ fit: 'contain' }), 2, square)
  assert.equal(stageHitClip(contained, { x: 100, y: 250 }), false)
  assert.equal(stageHitClip(contained, { x: 250, y: 250 }), true)
  closePoint(stageSourcePoint(contained, { x: 250, y: 250 }), { x: 0, y: 250 })
  const cover = stageClipGeometry(doc, clip({ fit: 'cover' }), 2, square)
  closePoint(stageSourcePoint(cover, { x: 0, y: 0 }), { x: 0, y: 125 })
  closePoint(stageSourcePoint(cover, { x: 1000, y: 500 }), { x: 500, y: 375 })
  assert.equal(stageHitClip(cover, { x: 1001, y: 250 }), false)
})

test('rotation, offset, scale and both flips invert exactly for source pixel and local clip', () => {
  const g = stageClipGeometry(
    doc,
    clip({
      x: 0.12,
      y: -0.18,
      rotation: 73,
      scale: 0.47,
      flipX: true,
      flipY: true,
      crop: { x: 0.1, y: 0.2, width: 0.6, height: 0.7 },
      fit: 'stretch'
    }),
    2,
    source
  )
  const local = { x: 127, y: -63 },
    world = stageLocalToWorld(g, local)
  closePoint(stageWorldToLocal(g, world), local)
  closePoint(stageSourcePoint(g, world), {
    x: 1000 * (0.1 + (127 / 1000 + 0.5) * 0.6),
    y: 500 * (0.2 + (-63 / 500 + 0.5) * 0.7)
  })
  assert.equal(stageHitClip(g, stageLocalToWorld(g, { x: 510, y: 0 })), false)
})

test('pixel alpha and envelope opacity allow clicks through transparent top layers', () => {
  const g = stageClipGeometry(doc, clip(), 3, source)
  assert.equal(
    stageHitClip(g, { x: 500, y: 250 }, () => 0),
    false
  )
  assert.equal(
    stageHitClip(g, { x: 500, y: 250 }, () => 1),
    true
  )
  assert.equal(
    stageHitClip(stageClipGeometry(doc, clip({ opacity: 0 }), 3, source), { x: 500, y: 250 }),
    false
  )
  assert.equal(
    stageHitClip(stageClipGeometry(doc, clip({}, { fadeIn: 2 }), 2, source), { x: 500, y: 250 }),
    false
  )
})

test('viewport letterboxing uses canvas coordinates without selecting outside rendered content', () => {
  const viewport = { x: 100, y: 20, width: 600, height: 600 }
  closePoint(stageViewportPoint(viewport, doc, { x: 400, y: 320 }), { x: 500, y: 250 })
  assert.ok(stageViewportPoint(viewport, doc, { x: 400, y: 30 }).y < 0)
  closePoint(stageViewportPoint(viewport, doc, { x: 100, y: 170 }), { x: 0, y: 0 })
})

test('opposite resize corner stays fixed on a rotated and flipped object and keeps proportions', () => {
  for (const corner of [0, 1, 2, 3]) {
    const original = clip({ rotation: 25, flipX: true, scale: 0.5 })
    const g = stageClipGeometry(doc, original, 3, source)
    const anchor = g.corners[(corner + 2) % 4],
      moving = g.corners[corner]
    const target = {
      x: anchor.x + (moving.x - anchor.x) * 1.4,
      y: anchor.y + (moving.y - anchor.y) * 1.4
    }
    const patch = stageResizeTransform(g, corner, target)
    const resized = stageClipGeometry(doc, stagePatchTransform(original, 3, patch), 3, source)
    closePoint(resized.corners[(corner + 2) % 4], anchor)
    closePoint(resized.corners[corner], target)
    close(resized.transform.scale, 0.7)
  }
})

test('center resize and scale limits do not change center or create invalid objects', () => {
  const original = clip({ x: 0.1, y: 0.2, scale: 1 }),
    g = stageClipGeometry(doc, original, 3, source)
  const patch = stageResizeTransform(g, 2, { x: 100000, y: 100000 }, true)
  assert.equal(patch.scale, 4)
  close(patch.x, 0.1)
  close(patch.y, 0.2)
  assert.equal(stageResizeTransform(g, 2, g.center, true).scale, 0.05)
})

test('rotation crossing the atan2 seam rotates by a small angle and optionally snaps to fifteen degrees', () => {
  const g = stageClipGeometry(doc, clip({ scale: 0.4 }), 3, source)
  const ray = (degrees) => ({
    x: g.center.x + Math.cos((degrees * Math.PI) / 180) * 100,
    y: g.center.y + Math.sin((degrees * Math.PI) / 180) * 100
  })
  close(stageRotateTransform(g, ray(179), ray(-179)).rotation, 2)
  assert.equal(stageRotateTransform(g, ray(0), ray(22), true).rotation, 15)
})

test('moving snaps edges and centers within a display threshold and can bypass snapping', () => {
  const g = stageClipGeometry(doc, clip({ scale: 0.4, x: -0.2 }), 3, source)
  const snapped = stageMoveTransform(g, { x: 196, y: 0 }, 6)
  close(snapped.patch.x, 0)
  assert.ok(snapped.guides.some((guide) => guide.axis === 'x' && guide.position === 500))
  close(stageMoveTransform(g, { x: 196, y: 0 }, 0).patch.x, -0.004)
})

test('edge alignment uses transformed bounds including rotation', () => {
  const original = clip({ scale: 0.4, rotation: 35 }),
    g = stageClipGeometry(doc, original, 3, source)
  for (const [alignment, axis, edge] of [
    ['left', 'x', 0],
    ['right', 'x', 1000],
    ['top', 'y', 0],
    ['bottom', 'y', 500]
  ]) {
    const aligned = stageClipGeometry(
      doc,
      stagePatchTransform(original, 3, stageAlignTransform(g, alignment)),
      3,
      source
    )
    const bounds = stageBounds(aligned.corners)
    close(bounds[axis] + (edge ? bounds[axis === 'x' ? 'width' : 'height'] : 0), edge)
  }
})

test('animated drag inserts/updates current-time keys without mutating captured state or moving the wrong time', () => {
  const original = clip({}, { keyframes: [{ time: 5, x: 0.5, scale: 2 }] })
  const next = stagePatchTransform(original, 4, { x: -0.2, y: 0.1, scale: 0.8, rotation: 32 })
  assert.deepEqual(original.keyframes, [{ time: 5, x: 0.5, scale: 2 }])
  const evaluated = evaluatedTransform(next, 2)
  close(evaluated.x, -0.2)
  close(evaluated.y, 0.1)
  close(evaluated.scale, 0.8)
  close(evaluated.rotation, 32)
  const again = stagePatchTransform(next, 4, { x: 0.2 })
  assert.equal(again.keyframes.length, 2)
  close(evaluatedTransform(again, 2).x, 0.2)
})

test('locked, readonly and playing states all forbid direct visual edits but unrelated audio locks do not', () => {
  const c = clip(),
    d = { ...doc, visuals: [c] }
  assert.equal(stageCanEdit(d, c), true)
  d.tracks[1].locked = true
  assert.equal(stageCanEdit(d, c), true)
  assert.equal(stageCanEdit(d, c, true), false)
  assert.equal(stageCanEdit(d, c, false, true), false)
  d.tracks[0].locked = true
  assert.equal(stageCanEdit(d, c), false)
  d.tracks[0].locked = false
  d.tracks[1].locked = false
})

test('caption hit areas follow per-line alignment and dragging stays inside valid normalized bounds', () => {
  const cue = {
    id: 'c',
    text: '12345\n12',
    start: 0,
    duration: 10,
    style: { x: 0.5, y: 0.8, fontSize: 30, align: 'right' }
  }
  const rects = stageCaptionRects(doc, cue, (text) => text.length * 20)
  close(rects[0].x, 396)
  close(rects[1].x, 456)
  assert.equal(stageHitRect(rects[0], { x: 400, y: 380 }), true)
  assert.equal(stageHitRect(rects[1], { x: 400, y: 420 }), false)
  const moved = stageMoveCaption(doc, cue, { x: -10000, y: 10000 })
  assert.equal(moved.style.x, 0)
  assert.equal(moved.style.y, 1)
  assert.equal(cue.style.x, 0.5)
})

test('crop handles map to uncropped source ratios and cannot escape source or invert the rectangle', () => {
  const image = stageCropImageRect(doc, { width: 400, height: 800 })
  assert.deepEqual(image, { x: 375, y: 0, width: 250, height: 500 })
  const crop = { x: 0.1, y: 0.2, width: 0.5, height: 0.6 }
  assert.deepEqual(stageCropRect(image, crop), { x: 400, y: 100, width: 125, height: 300 })
  const moved = stageEditCrop(image, crop, { x: 10000, y: -10000 })
  assert.equal(moved.x, 0.5)
  assert.equal(moved.y, 0)
  const resized = stageEditCrop(image, crop, { x: 10000, y: 10000 }, 0)
  close(resized.width, 0.01)
  close(resized.height, 0.01)
  close(resized.x + resized.width, 0.6)
  close(resized.y + resized.height, 0.8)
})

test('cancel returns the exact captured object while a successful end preserves the last drag result', () => {
  const original = clip(),
    next = stagePatchTransform(original, 3, { x: 0.25 })
  assert.equal(stageGestureResult(original, next, true), original)
  assert.equal(stageGestureResult(original, next, false), next)
})
