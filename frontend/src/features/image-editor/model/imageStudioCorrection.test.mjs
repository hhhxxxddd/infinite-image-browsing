import assert from 'node:assert/strict'
import test from 'node:test'
import { readImageCorrection, correctionSourcePoint } from './imageStudioCorrection.ts'
import {
  createImageLayer,
  createStudioDocument,
  readStudioDocument,
  cropStudioImage
} from './imageStudioModel.ts'

test('correction defaults preserve old documents and sanitize nonfinite or excessive input', () => {
  assert.deepEqual(readImageCorrection(null), {
    horizontal: 0,
    vertical: 0,
    center: 0,
    rotation: 0
  })
  assert.deepEqual(
    readImageCorrection({ horizontal: NaN, vertical: -200, center: Infinity, rotation: 270 }),
    {
      horizontal: 0,
      vertical: -100,
      center: 0,
      rotation: 180
    }
  )
  const doc = createStudioDocument()
  const layer = createImageLayer('image.jpg', { x: 0, y: 0, width: 200, height: 100 })
  doc.layers = [layer]
  assert.equal(readStudioDocument(doc).layers[0].correction, undefined)
  layer.correction = { horizontal: 25, vertical: -40, center: -35, rotation: 95 }
  assert.deepEqual(
    readStudioDocument(JSON.parse(JSON.stringify(doc))).layers[0].correction,
    layer.correction
  )
  // Existing documents with three correction controls get a neutral center.
  delete layer.correction.center
  assert.equal(readStudioDocument(doc).layers[0].correction.center, 0)
  assert.deepEqual(
    cropStudioImage(layer, { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, 200, 100).correction,
    layer.correction
  )
})

test('inverse perspective fixes center, leaves neutral coordinates unchanged, and shifts opposite edges differently', () => {
  const neutral = readImageCorrection(null)
  for (const [x, y] of [
    [0, 0],
    [1, 1],
    [0.5, 0.5],
    [0.2, 0.8]
  ]) {
    const point = correctionSourcePoint(x, y, 2, neutral)
    assert.ok(Math.abs(point.x - x) < 1e-10 && Math.abs(point.y - y) < 1e-10)
  }
  const vertical = { ...neutral, vertical: 50 }
  assert.deepEqual(correctionSourcePoint(0.5, 0.5, 2, vertical), { x: 0.5, y: 0.5, valid: true })
  assert.ok(
    correctionSourcePoint(0.9, 0.1, 2, vertical).x > correctionSourcePoint(0.9, 0.9, 2, vertical).x
  )
  const rotated = correctionSourcePoint(0.75, 0.5, 2, { ...neutral, rotation: 45 })
  assert.ok(rotated.x < 0.75 && rotated.y < 0.5)
})

test('rotation fills a fixed frame, preserves aspect, and supports quarter and half turns', () => {
  const neutral = readImageCorrection(null)
  const quarter = correctionSourcePoint(1, 0.5, 2, { ...neutral, rotation: 90 })
  assert.ok(Math.abs(quarter.x - 0.5) < 1e-10 && Math.abs(quarter.y) < 1e-10)
  const half = correctionSourcePoint(0.1, 0.3, 1.5, { ...neutral, rotation: 180 })
  assert.ok(Math.abs(half.x - 0.9) < 1e-10 && Math.abs(half.y - 0.7) < 1e-10)
})

test('center correction bends straight lines in opposite directions without moving the center', () => {
  for (const center of [-100, 100]) {
    const correction = { ...readImageCorrection(null), center }
    assert.deepEqual(correctionSourcePoint(0.5, 0.5, 1.5, correction), {
      x: 0.5,
      y: 0.5,
      valid: true
    })
    const middle = correctionSourcePoint(0.8, 0.5, 1.5, correction)
    const edge = correctionSourcePoint(0.8, 0.1, 1.5, correction)
    assert.equal(edge.x < middle.x, center > 0)
  }
})

test('combined corrections keep the complete viewport inside the source, including extreme aspect ratios', () => {
  for (const aspect of [0.05, 2 / 3, 1, 1.5, 20])
    for (const rotation of [-180, -95, -45, 0, 30, 90, 180])
      for (const center of [-100, 0, 100])
        for (const horizontal of [-100, 0, 100])
          for (const vertical of [-100, 0, 100])
            for (let x = 0; x <= 10; x++)
              for (let y = 0; y <= 10; y++) {
                const p = correctionSourcePoint(x / 10, y / 10, aspect, {
                  horizontal,
                  vertical,
                  center,
                  rotation
                })
                assert.ok(p.valid && Number.isFinite(p.x) && Number.isFinite(p.y))
                assert.ok(p.x >= -1e-10 && p.y >= -1e-10 && p.x <= 1 + 1e-10 && p.y <= 1 + 1e-10)
              }
})
