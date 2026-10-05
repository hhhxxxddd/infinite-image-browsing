import assert from 'node:assert/strict'
import test from 'node:test'
import {
  aiProductionSnapshotWrites,
  initialAIProductionInputPath,
  readAIProductionSnapshot
} from './aiProductionSnapshot.ts'
import {
  savedAIEditDocument,
  savedAIReferenceDocument,
  savedAIReferencePaths
} from './aiEditInput.ts'
import {
  createStudioDocument,
  createImageLayer,
  createGuideLayer,
  createPaintLayer
} from '../../../src/features/image-editor/model/imageStudioModel.ts'
import {
  appendEditorVersion,
  documentFromEditorVersion,
  readEditorVersions
} from './editorVersionModel.ts'

function canvas(path) {
  const document = createStudioDocument(path)
  document.width = 300
  document.height = 450
  document.layers = [createImageLayer(path, { x: -25, y: 5, width: 500, height: 450 })]
  document.layers[0].crop = { x: 0.1, y: 0.2, width: 0.8, height: 0.7 }
  const guide = createGuideLayer({ x: 20, y: 30, width: 60, height: 70 }, 'arrow')
  guide.prompt = '修改箭头位置'
  const paint = createPaintLayer(300, 450)
  paint.strokes = [
    {
      mode: 'paint',
      size: 20,
      points: [
        { x: 0.2, y: 0.3 },
        { x: 0.5, y: 0.6 }
      ]
    }
  ]
  document.layers.push(guide, paint)
  return document
}
function snapshot() {
  return {
    version: 1,
    purpose: 'image_edit',
    inputPath: 'main.png',
    document: canvas('main.png'),
    references: [{ path: 'ref.png', document: canvas('ref.png') }],
    choice: {
      mode: 'workflow',
      model: 'vertexai/gemini-3.1-flash-image',
      workflowId: 'workflow-1',
      aspectRatio: 'auto',
      imageSize: '2K'
    },
    parameters: { steps: 30, seed: 123, quality: true, description: '自定义' },
    useMask: false,
    prompt: '重绘背景',
    negative: '模糊',
    outputName: '加工结果'
  }
}
test('AI versions preserve real input edits, references, annotations and workflow settings without aliasing', () => {
  const current = snapshot()
  const history = appendEditorVersion(readEditorVersions(null), {
    id: 'ai-one',
    name: '第一次',
    kind: 'ai-image',
    createdAt: '2026-10-05T00:00:00.000Z',
    document: current
  })
  current.document.layers[1].prompt = '之后的修改'
  current.references[0].document.width = 900
  const restored = documentFromEditorVersion(
    history.entries[0],
    'ai-image',
    readAIProductionSnapshot
  )
  assert.equal(restored.document.layers[1].prompt, '修改箭头位置')
  assert.equal(restored.document.layers[0].x, -25)
  assert.deepEqual(restored.document.layers[0].crop, { x: 0.1, y: 0.2, width: 0.8, height: 0.7 })
  assert.equal(restored.document.layers[2].strokes[0].points.length, 2)
  assert.equal(restored.references[0].document.width, 300)
  assert.equal(restored.prompt, '重绘背景')
  assert.equal(restored.negative, '模糊')
  assert.equal(restored.choice.workflowId, 'workflow-1')
  assert.equal(restored.parameters.seed, 123)
  assert.equal(restored.useMask, false)
})
test('AI version rejects lost inputs, duplicate references and malformed parameters before writes', () => {
  const original = snapshot()
  for (const change of [
    (next) => {
      next.document = null
    },
    (next) => {
      next.document.width = null
    },
    (next) => {
      next.document.layers[0].rotation = 'wrong'
    },
    (next) => {
      next.document.layers.push({ kind: 'unknown' })
    },
    (next) => {
      next.document.layers[0].path = 'wrong.png'
    },
    (next) => {
      next.references.push(next.references[0])
    },
    (next) => {
      next.references[0].document = null
    },
    (next) => {
      next.parameters.seed = null
    },
    (next) => {
      next.document.layers[2].strokes[0].points.push({ x: null, y: 0.2 })
    },
    (next) => {
      next.document.groups.push({ id: 'damaged group' })
    },
    (next) => {
      next.choice.annotationRules = { rect: 'lost annotation placeholder' }
    }
  ]) {
    const next = structuredClone(original)
    change(next)
    assert.throws(
      () => aiProductionSnapshotWrites('workspace:work:draft', 'draft', next),
      /未恢复任何内容/
    )
  }
  assert.equal(original.document.layers.length, 3)
})
test('restored AI settings target the canvas document ID and never rewrite task or artifact state', () => {
  const saved = snapshot()
  const writes = aiProductionSnapshotWrites('workspace:work:draft', 'draft', saved)
  assert.equal(
    writes.get(`omnigallery:ai-production-prompt-v1:workspace:work:draft:${saved.document.id}`),
    saved.prompt
  )
  assert.equal(
    writes.get('omnigallery:ai-production-active-purpose-v1:workspace:work:draft'),
    'image_edit'
  )
  assert.deepEqual(
    JSON.parse(writes.get('omnigallery:ai-image-refs-v1:workspace:work:draft:main.png')),
    ['ref.png']
  )
  assert.deepEqual(
    JSON.parse(writes.get('omnigallery:ai-production-parameters-v1:workspace:work:draft')).values,
    saved.parameters
  )
  assert.equal(
    [...writes.keys()].some((key) => key.includes('task') || key.includes('artifact')),
    false
  )
})
test('generation versions restore prompts and choices without requiring an input image', () => {
  const saved = {
    ...snapshot(),
    purpose: 'image_generation',
    inputPath: '',
    document: null,
    references: []
  }
  const writes = aiProductionSnapshotWrites('workspace:work:draft', 'draft', saved)
  assert.equal(
    writes.get('omnigallery:ai-production-generation-prompt-v1:workspace:work:draft'),
    saved.prompt
  )
  assert.equal(
    [...writes.keys()].some((key) => key.includes('ai-image-edit-v1')),
    false
  )
  assert.equal(readAIProductionSnapshot(JSON.stringify(saved)).document, null)
})

test('restoring an empty input survives reload without falling back to a former input or the first asset', () => {
  const saved = {
    ...snapshot(),
    purpose: 'image_generation',
    inputPath: '',
    document: null,
    references: []
  }
  const current = new Map([['omnigallery:ai-image-edit-asset-v1:scope', 'old.png']])
  for (const [key, value] of aiProductionSnapshotWrites('scope', 'draft', saved))
    if (value === null) current.delete(key)
    else current.set(key, value)
  const stored = current.get('omnigallery:ai-image-edit-asset-v1:scope') ?? null
  assert.equal(initialAIProductionInputPath(stored, undefined, 'first-asset.png'), '')
  assert.equal(initialAIProductionInputPath(null, undefined, 'first-asset.png'), 'first-asset.png')
  assert.equal(
    initialAIProductionInputPath(stored, 'fixed-source.png', 'first-asset.png'),
    'fixed-source.png'
  )
})

test('generation snapshots with uninitialized canvases remove stale edits and reload the same reference state', () => {
  const current = new Map()
  const apply = (writes) => {
    for (const [key, value] of writes)
      if (value === null) current.delete(key)
      else current.set(key, value)
  }
  apply(aiProductionSnapshotWrites('scope', 'draft', snapshot()))
  const generated = {
    ...snapshot(),
    purpose: 'image_generation',
    document: null,
    references: [{ path: 'ref.png', document: null }]
  }
  apply(aiProductionSnapshotWrites('scope', 'draft', generated))
  const storage = { getItem: (key) => current.get(key) ?? null }
  assert.equal(savedAIEditDocument(storage, 'scope', 'main.png'), null)
  assert.equal(savedAIReferenceDocument(storage, 'scope', 'main.png', 'ref.png'), null)
  assert.deepEqual(savedAIReferencePaths(storage, 'scope', 'main.png'), ['ref.png'])
})
