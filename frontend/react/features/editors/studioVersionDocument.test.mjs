import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createStudioDocument,
  createStudioGroup,
  createImageLayer,
  createTextLayer,
  createPaintLayer
} from '../../../src/features/image-editor/model/imageStudioModel.ts'
import { readStudioVersionDocument } from './studioVersionDocument.ts'
import { createStudioVector } from '../../../src/features/image-editor/model/imageStudioVectors.ts'

function document() {
  const value = createStudioDocument('图片制作')
  const group = createStudioGroup('画面')
  const image = createImageLayer('editor-asset:processed.png', {
    x: -50,
    y: 20,
    width: 500,
    height: 300
  })
  image.groupId = group.id
  const text = createTextLayer({ x: 20, y: 30, width: 300, height: 50 }, '标题')
  const paint = createPaintLayer(500, 300)
  paint.strokes = [{ mode: 'paint', size: 20, points: [{ x: 0.3, y: 0.6 }] }]
  value.groups = [group]
  value.layers = [image, text, paint]
  return value
}

test('valid image versions keep groups, processed assets, outside-canvas geometry and painted content', () => {
  const original = document()
  const restored = readStudioVersionDocument(original, original.id)
  assert.equal(restored.layers[0].path, 'editor-asset:processed.png')
  assert.equal(restored.layers[0].x, -50)
  assert.equal(restored.layers[0].groupId, original.groups[0].id)
  assert.deepEqual(restored.layers[2].strokes, original.layers[2].strokes)
  assert.notEqual(restored.layers[0], original.layers[0])
})

test('legacy missing optional fields and future unknown optional fields stay compatible', () => {
  const original = document()
  delete original.layers[0].groupId
  delete original.groups
  delete original.layers[0].crop
  delete original.layers[1].italic
  original.futureOption = { enabled: true }
  original.layers[1].futureOption = 'available later'
  const restored = readStudioVersionDocument(original)
  assert.deepEqual(restored.groups, [])
  assert.deepEqual(restored.layers[0].crop, { x: 0, y: 0, width: 1, height: 1 })
  assert.equal(restored.layers[1].text, '标题')
})

test('frame clipping, vector geometry, corrections and text effects remain restorable', () => {
  const original = document()
  const frame = createStudioVector('frame', 'polygon', { x: 10, y: 20, width: 800, height: 500 })
  original.layers[0].frameId = frame.id
  original.layers[0].correction = { horizontal: 20, vertical: -10, center: 3, rotation: 4 }
  original.layers[1].effects = { fill: { mode: 'gradient', endColor: '#ff6600', angle: 60 } }
  original.layers.unshift(frame)
  const restored = readStudioVersionDocument(original)
  assert.equal(restored.layers[1].frameId, frame.id)
  assert.deepEqual(restored.layers[0].points, frame.points)
  assert.deepEqual(restored.layers[1].correction, original.layers[1].correction)
  assert.equal(restored.layers[2].effects.fill.mode, 'gradient')
})

test('damaged versions reject layer and group repair instead of making partial content recoverable', () => {
  const original = document()
  for (const change of [
    (next) => {
      next.layers.push(structuredClone(next.layers[0]))
    },
    (next) => {
      next.layers[0].id = 'not a valid id'
    },
    (next) => {
      next.layers[0].width = null
    },
    (next) => {
      next.layers[0].rotation = 'broken'
    },
    (next) => {
      next.layers[0].groupId = 'missing'
    },
    (next) => {
      next.layers[0].frameId = 'missing'
    },
    (next) => {
      next.layers[0].crop.x = 'broken'
    },
    (next) => {
      next.layers[0].correction = { rotation: null }
    },
    (next) => {
      next.layers[1].color = null
    },
    (next) => {
      next.background = 'broken'
    },
    (next) => {
      next.layers[1].effects = { shadow: { blur: null } }
    },
    (next) => {
      next.groups.push(structuredClone(next.groups[0]))
    },
    (next) => {
      next.groups[0].id = null
    },
    (next) => {
      next.layers[2].strokes[0].points.push({ x: 'broken', y: 0.2 })
    },
    (next) => {
      next.layers[2].strokes[0].mode = 'broken'
    },
    (next) => {
      next.layers[2].strokes[0].size = null
    },
    (next) => {
      next.layers[2].strokes[0].points = []
    },
    (next) => {
      next.layers.push({ kind: 'future-damaged', id: 'unknown' })
    }
  ]) {
    const changed = structuredClone(original)
    change(changed)
    const raw = JSON.stringify(changed)
    assert.throws(() => readStudioVersionDocument(changed), /未恢复任何内容/)
    assert.equal(JSON.stringify(changed), raw, 'failed validation must not change the snapshot')
  }
  assert.equal(original.layers.length, 3)
  assert.throws(() => readStudioVersionDocument(original, 'another-draft'), /未恢复任何内容/)
})

test('versions cannot silently lose paint beyond loader stroke or point capacity', () => {
  const strokes = document()
  strokes.layers[2].strokes = Array.from({ length: 201 }, () =>
    structuredClone(strokes.layers[2].strokes[0])
  )
  assert.throws(() => readStudioVersionDocument(strokes), /未恢复任何内容/)
  const points = document()
  points.layers[2].strokes[0].points = Array.from({ length: 501 }, () => ({ x: 0.1, y: 0.2 }))
  assert.throws(() => readStudioVersionDocument(points), /未恢复任何内容/)
})
