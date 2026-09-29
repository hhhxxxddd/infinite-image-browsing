import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createStudioDocument,
  createImageLayer,
  createGuideLayer,
  createPaintLayer
} from '../../image-editor/model/imageStudioModel.ts'
import { cropAIInputDocument } from './aiImageTransform.ts'

test('AI crop preserves source and composition while changing the actual input dimensions', () => {
  const doc = createStudioDocument()
  doc.width = 800
  doc.height = 600
  const image = createImageLayer('/original.jpg', { x: 0, y: 0, width: 800, height: 600 })
  image.fit = 'contain'
  image.zoom = 1.5
  const guide = createGuideLayer({ x: 150, y: 100, width: 100, height: 80 }, 'rect')
  doc.layers = [image, guide]
  const result = cropAIInputDocument(
    doc,
    { x: 100, y: 50, width: 400, height: 300 },
    { width: 800, height: 600 }
  )
  assert.equal(result.width, 800)
  assert.equal(result.height, 600)
  assert.equal(result.layers[0].path, '/original.jpg')
  assert.deepEqual(result.layers[0].crop, image.crop)
  assert.equal(result.layers[0].zoom, 1.5)
  assert.equal(result.layers[0].fit, 'contain')
  assert.deepEqual([result.layers[0].x, result.layers[0].y], [-200, -100])
  assert.deepEqual(
    [result.layers[1].x, result.layers[1].y, result.layers[1].width, result.layers[1].height],
    [100, 100, 200, 160]
  )
  assert.equal(doc.layers[0].x, 0)
  assert.equal(doc.layers[1].x, 150)
})

test('repeated crops keep paint aligned and can be restored from a single pre-adjustment snapshot', () => {
  const doc = createStudioDocument()
  doc.width = doc.height = 800
  const paint = createPaintLayer(800, 800)
  paint.strokes = [{ points: [{ x: 0.5, y: 0.5 }], size: 20, mode: 'paint' }]
  doc.layers = [paint]
  const snapshot = JSON.stringify(doc)
  const first = cropAIInputDocument(
    doc,
    { x: 100, y: 100, width: 600, height: 600 },
    { width: 600, height: 600 }
  )
  const second = cropAIInputDocument(
    first,
    { x: 100, y: 100, width: 400, height: 400 },
    { width: 800, height: 800 }
  )
  const layer = second.layers[0]
  assert.equal(layer.x + layer.strokes[0].points[0].x * layer.width, 400)
  assert.equal(layer.y + layer.strokes[0].points[0].y * layer.height, 400)
  assert.equal(layer.strokes[0].size, 40)
  assert.equal(JSON.stringify(doc), snapshot)
})
