import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fitAIEditCanvasWidth } from './aiCanvasFit.ts'

test('AI edit fit honors the height left above the material bar', () => {
  const width = fitAIEditCanvasWidth(702, 702, 700, 298)
  assert.equal(width, 298)
  assert.ok((width / 702) * 702 <= 298)
})

test('AI edit fit keeps natural size on a roomy stage', () => {
  assert.equal(fitAIEditCanvasWidth(702, 702, 900, 800), 702)
})
