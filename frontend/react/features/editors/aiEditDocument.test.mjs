import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createImageLayer,
  createStudioDocument
} from '../../../src/features/image-editor/model/imageStudioModel.ts'
import {
  appendAIGuide,
  appendAIStroke,
  cropAIEditDocument,
  updateAIGuide,
  updateAIImageContent
} from './aiEditDocument.ts'

test('paint, mask and eraser are kept as editable layers', () => {
  const original = createStudioDocument('AI edit')
  original.width = 200
  original.height = 300
  original.layers.push(createImageLayer('source', { x: 0, y: 0, width: 200, height: 300 }))
  const painted = appendAIStroke(
    original,
    'paint',
    [
      { x: 20, y: 30 },
      { x: 60, y: 90 }
    ],
    16,
    '#ef4444'
  )
  const masked = appendAIStroke(painted, 'mask', [{ x: 80, y: 90 }], 24, '#ef4444')
  const erased = appendAIStroke(masked, 'erase', [{ x: 50, y: 60 }], 12, '#ef4444')
  assert.equal(original.layers.length, 1)
  assert.equal(erased.layers.find((layer) => layer.kind === 'paint')?.strokes.length, 2)
  assert.equal(erased.layers.find((layer) => layer.kind === 'mask')?.strokes[0]?.mode, 'paint')
  assert.deepEqual(erased.layers.find((layer) => layer.kind === 'paint')?.strokes[0]?.points[0], {
    x: 0.1,
    y: 0.1
  })
})

test('cropping translates the image and annotation layers together', () => {
  const original = createStudioDocument('AI edit')
  original.width = 400
  original.height = 300
  original.layers.push(createImageLayer('source', { x: 0, y: 0, width: 400, height: 300 }))
  const painted = appendAIStroke(original, 'paint', [{ x: 120, y: 80 }], 20, '#ef4444')
  const cropped = cropAIEditDocument(painted, { x: 100, y: 50, width: 200, height: 150 })
  assert.equal(cropped.width, 200)
  assert.equal(cropped.height, 150)
  assert.equal(cropped.layers[0].x, -100)
  assert.equal(cropped.layers.find((layer) => layer.kind === 'paint')?.x, -100)
})

test('guide prompts and image framing remain editable without flattening the source', () => {
  const original = createStudioDocument('AI edit')
  original.width = 400
  original.height = 300
  original.layers.push(createImageLayer('source', { x: 0, y: 0, width: 400, height: 300 }))
  const guided = appendAIGuide(
    original,
    'arrow',
    { x: 250, y: 30 },
    { x: 50, y: 180 },
    '#ff0000',
    5
  )
  assert.ok(guided)
  const prompted = updateAIGuide(guided.document, guided.id, { prompt: '移除这里' })
  const zoomed = updateAIImageContent(prompted, 'source', { zoom: 1.5, focusX: 0.3 })
  const guide = zoomed.layers.find((layer) => layer.kind === 'guide')
  const image = zoomed.layers.find((layer) => layer.kind === 'image')
  assert.equal(guide?.shape, 'arrow')
  assert.equal(guide?.flipX, true)
  assert.equal(guide?.prompt, '移除这里')
  assert.equal(image?.zoom, 1.5)
  assert.equal(image?.focusX, 0.3)
  assert.equal(original.layers.length, 1)
})
