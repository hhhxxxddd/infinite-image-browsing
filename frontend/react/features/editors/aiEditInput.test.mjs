import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createImageLayer,
  createStudioDocument
} from '../../../src/features/image-editor/model/imageStudioModel.ts'
import {
  savedAIEditDocument,
  savedAIReferenceDocument,
  savedAIReferencePaths
} from './aiEditInput.ts'

test('restores the existing AI main canvas and reference document', () => {
  const mainPath = 'workspace-artifact:main'
  const referencePath = 'workspace-artifact:reference'
  const suffix = 'workspace:work:draft'
  const main = createStudioDocument('edited')
  const layer = createImageLayer(mainPath, { x: 0, y: 0, width: 500, height: 500 })
  layer.crop = { x: 0.1, y: 0.2, width: 0.6, height: 0.7 }
  main.layers.push(layer)
  const reference = createStudioDocument('reference')
  reference.layers.push(createImageLayer(referencePath, { x: 0, y: 0, width: 500, height: 500 }))
  const entries = new Map([
    [
      `omnigallery:ai-image-edit-v1:${suffix}:${encodeURIComponent(mainPath)}`,
      JSON.stringify(main)
    ],
    [
      `omnigallery:ai-image-refs-v1:${suffix}:${encodeURIComponent(mainPath)}`,
      JSON.stringify([referencePath])
    ],
    [
      `omnigallery:ai-image-ref-v1:${suffix}:${encodeURIComponent(mainPath)}:${encodeURIComponent(referencePath)}`,
      JSON.stringify(reference)
    ]
  ])
  const storage = { getItem: (key) => entries.get(key) ?? null }
  assert.deepEqual(savedAIEditDocument(storage, suffix, mainPath), main)
  assert.deepEqual(savedAIReferencePaths(storage, suffix, mainPath), [referencePath])
  assert.deepEqual(savedAIReferenceDocument(storage, suffix, mainPath, referencePath), reference)
})

test('a corrupt saved AI document is reported instead of silently using the raw source', () => {
  const path = 'workspace-artifact:main'
  const suffix = 'workspace:work:draft'
  const storage = {
    getItem: (key) =>
      key === `omnigallery:ai-image-edit-v1:${suffix}:${encodeURIComponent(path)}`
        ? '{"version":1}'
        : null
  }
  assert.throws(() => savedAIEditDocument(storage, suffix, path), /无法读取/)
})
