import assert from 'node:assert/strict'
import test from 'node:test'
import { createStudioDocument, createImageLayer, readStudioDocument } from './imageStudioModel.ts'
import { studioDocumentRevision } from './studioPublication.ts'

test('published revision survives autosave, roundtrip and key order changes', () => {
  const doc = createStudioDocument('作品')
  doc.layers.push(createImageLayer('test.png', { x: 0, y: 0, width: 100, height: 100 }, '图片'))
  const revision = studioDocumentRevision(doc)
  assert.equal(
    studioDocumentRevision(readStudioDocument(JSON.parse(JSON.stringify(doc)))),
    revision
  )
  assert.equal(studioDocumentRevision({ ...doc, updatedAt: 'later' }), revision)
  assert.equal(studioDocumentRevision(Object.fromEntries(Object.entries(doc).reverse())), revision)
  const changed = structuredClone(doc)
  changed.layers[0].x += 1
  assert.notEqual(studioDocumentRevision(changed), revision)
  assert.notEqual(studioDocumentRevision({ ...doc, name: '新作品' }), revision)
})
