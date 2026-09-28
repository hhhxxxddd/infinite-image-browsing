import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createStudioDocument,
  createImageLayer,
  studioExportDocument
} from '../../image-editor/model/imageStudioModel.ts'
import { studioDocumentRevision } from '../../image-editor/model/studioPublication.ts'
import { findPublishedStudioArtifact } from './studioArtifactReuse.ts'

test('content export does not reuse AI results, JPEGs or a full-canvas composition', () => {
  const document = createStudioDocument('作品')
  document.layers.push(
    createImageLayer('image.png', { x: 20, y: 30, width: 100, height: 120 }, '图片')
  )
  const revision = studioDocumentRevision(studioExportDocument(document, true))
  const canvasRevision = studioDocumentRevision(studioExportDocument(document, false))
  assert.notEqual(revision, canvasRevision)
  const matching = {
    id: 'content-png',
    source: 'image_studio',
    format: 'png',
    document_id: document.id,
    document_revision: revision
  }
  const others = [
    { ...matching, id: 'ai', source: 'ai_image_edit' },
    { ...matching, id: 'jpeg', format: 'jpeg' },
    { ...matching, id: 'canvas', document_revision: canvasRevision },
    { ...matching, id: 'another-document', document_id: 'another' }
  ]
  assert.equal(findPublishedStudioArtifact(others, document.id, revision), undefined)
  assert.equal(findPublishedStudioArtifact([...others, matching], document.id, revision), matching)
})
