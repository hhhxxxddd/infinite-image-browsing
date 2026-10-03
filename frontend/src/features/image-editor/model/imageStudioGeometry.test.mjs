import assert from 'node:assert/strict'
import test from 'node:test'
import {
  studioCenteredCrop,
  studioFrameContainsPoint,
  studioFramePoint,
  studioFrameWorldPoint,
  studioPointerRotation,
  studioResizeDimensions,
  studioMoveCrop,
  studioResizeCrop,
  studioCropDimensions,
  studioAlignFrame
} from './imageStudioGeometry.ts'
import { resizeStudioFrame, createImageLayer, cropStudioImage } from './imageStudioModel.ts'

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`)

test('canvas alignment uses rotated visible bounds and preserves the other axis', () => {
  const frame = { x: 90, y: 110, width: 200, height: 80, rotation: 90 }
  const canvas = { width: 1000, height: 800 }
  for (const [alignment, expected] of [
    ['left', { x: -60, y: 110 }],
    ['center', { x: 400, y: 110 }],
    ['right', { x: 860, y: 110 }],
    ['top', { x: 90, y: 60 }],
    ['middle', { x: 90, y: 360 }],
    ['bottom', { x: 90, y: 660 }]
  ]) {
    const actual = studioAlignFrame(frame, canvas, alignment)
    near(actual.x, expected.x)
    near(actual.y, expected.y)
  }
  assert.deepEqual(frame, { x: 90, y: 110, width: 200, height: 80, rotation: 90 })
})

test('large preset dimensions remain proportional when reaching the output size limit', () => {
  assert.deepEqual(studioResizeDimensions(16000, (16000 * 16) / 9), { width: 9216, height: 16384 })
  assert.deepEqual(studioResizeDimensions(160, 90), { width: 160, height: 90 })
})

test('selection hit testing follows the rotated frame rather than its old axis-aligned bounds', () => {
  const frame = { x: 100, y: 200, width: 200, height: 80, rotation: 90 }
  const inside = studioFrameWorldPoint(frame, { x: 195, y: 40 })
  assert.equal(studioFrameContainsPoint(frame, inside), true)
  assert.equal(studioFrameContainsPoint(frame, { x: 101, y: 201 }), false)
  const local = studioFramePoint(frame, inside)
  near(local.x, 195)
  near(local.y, 40)
})

test('rotation across the angle wrap stays continuous and Shift snaps to fifteen degrees', () => {
  const frame = { x: 0, y: 0, width: 100, height: 100, rotation: 20 }
  const point = (angle) => ({
    x: 50 + 100 * Math.cos((angle * Math.PI) / 180),
    y: 50 + 100 * Math.sin((angle * Math.PI) / 180)
  })
  assert.equal(studioPointerRotation(frame, point(179), point(-179), false), 22)
  assert.equal(studioPointerRotation(frame, point(0), point(24), true), 45)
})

test('all edge handles keep the opposite rotated edge stationary', () => {
  const frame = { x: 100, y: 200, width: 200, height: 80, rotation: 30 }
  for (const [handle, anchor] of [
    ['e', { x: 0, y: 40 }],
    ['w', { x: 200, y: 40 }],
    ['n', { x: 100, y: 80 }],
    ['s', { x: 100, y: 0 }]
  ]) {
    const result = { ...resizeStudioFrame(frame, handle, 25, 30, false), rotation: frame.rotation }
    const opposite = {
      x: anchor.x === frame.width ? result.width : anchor.x === 0 ? 0 : result.width / 2,
      y: anchor.y === frame.height ? result.height : anchor.y === 0 ? 0 : result.height / 2
    }
    const before = studioFrameWorldPoint(frame, anchor),
      after = studioFrameWorldPoint(result, opposite)
    near(before.x, after.x)
    near(before.y, after.y)
  }
})

test('stretched image crops map to source pixels and keep the rotated selection center', () => {
  const layer = {
    ...createImageLayer('/a.png', { x: 100, y: 200, width: 300, height: 100 }),
    fit: 'stretch',
    rotation: 90
  }
  const result = cropStudioImage(layer, { x: 0.25, y: 0.2, width: 0.5, height: 0.4 }, 100, 100)
  assert.deepEqual(result.crop, { x: 0.25, y: 0.2, width: 0.5, height: 0.4 })
  const expected = studioFrameWorldPoint(layer, { x: 150, y: 40 })
  near(result.x + result.width / 2, expected.x)
  near(result.y + result.height / 2, expected.y)
})

test('mirrored crops select the displayed pixels and preserve their rotated world position', () => {
  for (const fit of ['cover', 'contain', 'stretch']) {
    for (const [flipX, flipY] of [
      [true, false],
      [false, true],
      [true, true]
    ]) {
      const layer = {
        ...createImageLayer('/a.png', { x: 100, y: 200, width: 400, height: 200 }),
        fit,
        flipX,
        flipY,
        rotation: 37,
        zoom: 2,
        focusX: 0.25,
        focusY: 0.75,
        crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }
      }
      const selection = { x: 0.1, y: 0.1, width: 0.2, height: 0.3 }
      const result = cropStudioImage(layer, selection, 800, 400)
      near(result.crop.x, 0.1 + 0.8 * (flipX ? 0.475 : 0.175))
      near(result.crop.y, 0.1 + 0.8 * (flipY ? 0.675 : 0.425))
      near(result.crop.width, 0.08)
      near(result.crop.height, 0.12)
      const center = studioFrameWorldPoint(layer, { x: 80, y: 50 })
      near(result.x + result.width / 2, center.x)
      near(result.y + result.height / 2, center.y)
      assert.deepEqual([result.flipX, result.flipY, result.rotation], [flipX, flipY, 37])
      assert.deepEqual([result.zoom, result.focusX, result.focusY], [1, 0.5, 0.5])
      // A second crop is still relative to the displayed, mirrored content.
      const second = cropStudioImage(result, { x: 0, y: 0, width: 0.5, height: 0.5 }, 800, 400)
      near(second.crop.x, result.crop.x + (flipX ? result.crop.width / 2 : 0))
      near(second.crop.y, result.crop.y + (flipY ? result.crop.height / 2 : 0))
    }
  }
})

test('mirrored crop fallback uses source orientation without mirroring the frame placement', () => {
  const layer = {
    ...createImageLayer('/missing.png', { x: 0, y: 0, width: 100, height: 100 }),
    flipX: true,
    flipY: true
  }
  const result = cropStudioImage(layer, { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }, 0, 0)
  near(result.crop.x, 0.6)
  near(result.crop.y, 0.4)
  near(result.x, 10)
  near(result.y, 20)
})

test('moving a crop keeps its size and clamps it inside the image without changing the layer', () => {
  const layer = { x: 70, y: 90, width: 240, height: 120, rotation: 37 }
  const before = structuredClone(layer)
  const crop = { x: 30, y: 20, width: 100, height: 60 }
  assert.deepEqual(studioMoveCrop(layer, crop, 900, -900), { x: 140, y: 0, width: 100, height: 60 })
  const start = studioFrameWorldPoint(layer, { x: 50, y: 40 })
  const end = studioFrameWorldPoint(layer, { x: 75, y: 55 })
  const a = studioFramePoint(layer, start),
    b = studioFramePoint(layer, end)
  const result = studioMoveCrop(layer, crop, b.x - a.x, b.y - a.y)
  near(result.x, 55)
  near(result.y, 35)
  assert.deepEqual(layer, before)
})

test('all crop handles respect image bounds, minimum size and the selected aspect ratio', () => {
  const bounds = { width: 240, height: 120 }
  for (const ratio of [0, 1, 2 / 3, 3 / 4, 9 / 16, 3 / 2, 4 / 3, 16 / 9, 21 / 9]) {
    const centered = studioCenteredCrop(100, 70, ratio)
    const crop = { ...centered, x: centered.x + 50, y: centered.y + 20 }
    for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
      for (const [dx, dy] of [
        [-900, -700],
        [700, -900],
        [-900, 700],
        [900, 900],
        [12, 9]
      ]) {
        const result = studioResizeCrop(bounds, crop, handle, dx, dy, ratio)
        assert.ok(result.width >= 1 - 1e-7 && result.height >= 1 - 1e-7)
        assert.ok(result.x >= -1e-7 && result.y >= -1e-7)
        assert.ok(result.x + result.width <= bounds.width + 1e-7)
        assert.ok(result.y + result.height <= bounds.height + 1e-7)
        if (ratio) near(result.width / result.height, ratio)
        const anchor = (frame) => ({
          x:
            frame.x +
            (handle.includes('w') ? frame.width : handle.includes('e') ? 0 : frame.width / 2),
          y:
            frame.y +
            (handle.includes('n') ? frame.height : handle.includes('s') ? 0 : frame.height / 2)
        })
        const before = anchor(crop),
          after = anchor(result)
        near(before.x, after.x)
        near(before.y, after.y)
      }
    }
  }
})

test('numeric crop dimensions preserve the center and clamp independent dimensions to the layer', () => {
  const bounds = { width: 200, height: 300 }
  const original = { x: 20, y: 30, width: 160, height: 240 }
  assert.deepEqual(studioCropDimensions(bounds, original, 'width', 100, 0), {
    x: 50,
    y: 30,
    width: 100,
    height: 240
  })
  assert.deepEqual(studioCropDimensions(bounds, original, 'width', 900, 0), {
    x: 0,
    y: 30,
    width: 200,
    height: 240
  })
  assert.deepEqual(studioCropDimensions(bounds, original, 'height', 900, 0), {
    x: 20,
    y: 0,
    width: 160,
    height: 300
  })
  assert.equal(studioCropDimensions(bounds, original, 'height', -10, 0).height, 1)
  assert.equal(studioCropDimensions(bounds, original, 'width', NaN, 0), original)
})

test('numeric sizes keep preset ratios when either input reaches the image boundary', () => {
  const bounds = { width: 200, height: 300 }
  for (const ratio of [1, 2 / 3, 3 / 4, 9 / 16, 3 / 2, 4 / 3, 16 / 9, 21 / 9]) {
    const original = studioCenteredCrop(bounds.width, bounds.height, ratio)
    for (const axis of ['width', 'height']) {
      for (const value of [-10, 1, 65, 9999]) {
        const crop = studioCropDimensions(bounds, original, axis, value, ratio)
        near(crop.width / crop.height, ratio)
        assert.ok(crop.x >= -1e-7 && crop.y >= -1e-7)
        assert.ok(crop.width >= 1 - 1e-7 && crop.height >= 1 - 1e-7)
        assert.ok(crop.x + crop.width <= bounds.width + 1e-7)
        assert.ok(crop.y + crop.height <= bounds.height + 1e-7)
      }
    }
  }
})
