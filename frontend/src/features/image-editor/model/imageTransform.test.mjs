import test from 'node:test'
import assert from 'node:assert/strict'
import {
  transformRatio,
  fitTransformSize,
  changeTransformSize,
  centeredTransformCrop,
  draggedTransformCrop
} from './imageTransform.ts'

test('original ratio, presets, and free cropping use the same geometry', () => {
  const original = { width: 670, height: 1000 }
  assert.equal(transformRatio('original', original), 0.67)
  assert.equal(transformRatio('16:9', original), 16 / 9)
  assert.equal(transformRatio('free', original), undefined)
  const crop = centeredTransformCrop(original, 1)
  assert.deepEqual(crop, { x: 0, y: 165, width: 670, height: 670 })
  assert.deepEqual(centeredTransformCrop(original), { x: 0, y: 0, ...original })
})

test('locked width and height changes preserve ratio and the shared size limit', () => {
  assert.deepEqual(changeTransformSize({ width: 1200, height: 800 }, 'width', 600, true), {
    width: 600,
    height: 400
  })
  assert.deepEqual(changeTransformSize({ width: 1200, height: 800 }, 'height', 400, true), {
    width: 600,
    height: 400
  })
  assert.deepEqual(changeTransformSize({ width: 1200, height: 800 }, 'height', 400, false), {
    width: 1200,
    height: 400
  })
  assert.deepEqual(fitTransformSize(16384, 9 / 16), { width: 9216, height: 16384 })
  assert.deepEqual(changeTransformSize({ width: 600, height: 400 }, 'width', NaN, true), {
    width: 600,
    height: 400
  })
})

test('aspect constrained drags work in every direction and stop at canvas boundaries', () => {
  for (const end of [
    { x: 900, y: 900 },
    { x: 0, y: 900 },
    { x: 900, y: 0 },
    { x: 0, y: 0 }
  ]) {
    const crop = draggedTransformCrop({ x: 200, y: 100 }, end, { width: 670, height: 670 }, 16 / 9)
    assert.ok(Math.abs(crop.width / crop.height - 16 / 9) < 1e-10)
    assert.ok(crop.x >= 0 && crop.y >= 0)
    assert.ok(crop.x + crop.width <= 670 && crop.y + crop.height <= 670)
  }
})
