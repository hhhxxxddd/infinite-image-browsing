import test from 'node:test'
import assert from 'node:assert/strict'
import { createImageLayer, createStudioDocument, createStudioGroup } from './imageStudioModel.ts'
import { processingChangeAllowed } from './imageStudioProcessing.ts'

function fixture() {
  const doc = createStudioDocument()
  doc.groups = [createStudioGroup('组')]
  doc.layers = [
    createImageLayer('/processing.png', { x: 10, y: 20, width: 200, height: 100 }),
    createImageLayer('/other.png')
  ]
  doc.layers[0].groupId = doc.groups[0].id
  return doc
}

test('processing permits position only and leaves other layers editable', () => {
  const doc = fixture(),
    id = doc.layers[0].id
  const change = (patch) => ({ ...doc, layers: [{ ...doc.layers[0], ...patch }, doc.layers[1]] })
  assert.equal(processingChangeAllowed(doc, change({ x: 40, y: 50 }), [id]), true)
  for (const patch of [
    { width: 300 },
    { rotation: 10 },
    { opacity: 0.5 },
    { path: '/new.png' },
    { visible: false },
    { locked: true },
    { name: 'new' },
    { groupId: undefined },
    { frameId: 'f' }
  ]) {
    assert.equal(processingChangeAllowed(doc, change(patch), [id]), false, JSON.stringify(patch))
    assert.equal(processingChangeAllowed(doc, change(patch), []), true)
  }
  assert.equal(processingChangeAllowed(doc, { ...doc, layers: [doc.layers[1]] }, [id]), false)
  assert.equal(
    processingChangeAllowed(
      doc,
      { ...doc, layers: [doc.layers[0], { ...doc.layers[1], width: 123 }] },
      [id]
    ),
    true
  )
})

test('processing protects containing group and frame from indirect edits', () => {
  const doc = fixture(),
    id = doc.layers[0].id
  const frame = { id: 'frame', kind: 'frame', x: 0, y: 0, width: 250, height: 150 }
  doc.layers.push(frame)
  doc.layers[0].frameId = frame.id
  assert.equal(processingChangeAllowed(doc, { ...doc, groups: [] }, [id]), false)
  assert.equal(
    processingChangeAllowed(doc, { ...doc, groups: [{ ...doc.groups[0], visible: false }] }, [id]),
    false
  )
  assert.equal(
    processingChangeAllowed(doc, { ...doc, groups: [{ ...doc.groups[0], collapsed: true }] }, [id]),
    true
  )
  assert.equal(
    processingChangeAllowed(
      doc,
      { ...doc, layers: doc.layers.map((l) => (l.id === 'frame' ? { ...l, width: 400 } : l)) },
      [id]
    ),
    false
  )
  assert.equal(
    processingChangeAllowed(
      doc,
      { ...doc, layers: doc.layers.map((l) => ({ ...l, x: l.x + 10, y: l.y + 15 })) },
      [id]
    ),
    true
  )
})
