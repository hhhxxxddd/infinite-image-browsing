import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createStudioDocument,
  createStudioGroup,
  createImageLayer,
  createTextLayer
} from './imageStudioModel.ts'
import { duplicateStudioSelection, orderStudioSelection } from './imageStudioSelection.ts'

function composition() {
  const doc = createStudioDocument()
  const group = createStudioGroup('素材')
  doc.groups = [group]
  doc.layers = [
    createImageLayer('/photo.jpg', { x: 10, y: 20, width: 400, height: 300 }),
    createTextLayer({ x: 100, y: 80, width: 200, height: 60 }),
    createTextLayer({ x: 200, y: 120, width: 200, height: 60 })
  ]
  doc.layers[0].groupId = group.id
  doc.layers[1].groupId = group.id
  doc.layers[1].effects = { stroke: { enabled: true, width: 8, color: '#ffffff' } }
  return doc
}

test('duplicating a mixed multi-selection copies every selected layer without sharing effects or changing membership', () => {
  const doc = composition()
  const original = structuredClone(doc)
  const copy = duplicateStudioSelection(doc, [doc.layers[2].id, doc.layers[0].id, doc.layers[1].id])
  assert.equal(copy.document.layers.length, 6)
  assert.equal(copy.layerIds.length, 3)
  for (const [index, layer] of doc.layers.entries()) {
    const duplicate = copy.document.layers[index * 2 + 1]
    assert.equal(copy.document.layers[index * 2], layer)
    assert.notEqual(duplicate.id, layer.id)
    assert.equal(duplicate.groupId, layer.groupId)
    assert.equal(duplicate.x - layer.x, 24)
    assert.equal(duplicate.y - layer.y, 24)
  }
  copy.document.layers[3].effects.stroke.width = 20
  assert.deepEqual(doc, original)
})

test('duplicating a group creates the group and all members immediately, including hidden and locked members', () => {
  const doc = composition()
  doc.layers[0].visible = false
  doc.layers[1].locked = true
  const original = structuredClone(doc)
  const copy = duplicateStudioSelection(doc, [], doc.groups[0].id)
  assert.equal(copy.document.groups.length, 2)
  assert.equal(copy.document.layers.length, 5)
  assert.equal(copy.document.groups[1].name, '素材 副本')
  assert.notEqual(copy.groupId, doc.groups[0].id)
  assert.deepEqual(
    copy.document.layers.slice(3).map((layer) => layer.groupId),
    [copy.groupId, copy.groupId]
  )
  assert.equal(copy.document.layers[3].visible, false)
  assert.equal(copy.document.layers[4].locked, true)
  assert.deepEqual(doc, original)
})

test('empty group duplication stays at the top and a stale layer selection is a no-op', () => {
  const doc = composition()
  const empty = { ...createStudioGroup('空组'), stackIndex: 0 }
  doc.groups.push(empty)
  const copy = duplicateStudioSelection(doc, [], empty.id)
  assert.equal(copy.document.layers.length, doc.layers.length)
  assert.equal(copy.document.groups.at(-1).stackIndex, doc.layers.length)
  assert.equal(duplicateStudioSelection(doc, ['missing']).document, doc)
})

test('ordering multiple layers keeps their relative order and membership and respects layer and group locks', () => {
  const doc = composition()
  const [first, middle, last] = doc.layers
  first.groupId = undefined
  middle.groupId = undefined
  const top = orderStudioSelection(doc, [middle.id, first.id], 'top')
  assert.deepEqual(
    top.layers.map((layer) => layer.id),
    [last.id, first.id, middle.id]
  )
  assert.equal(top.layers[1].groupId, first.groupId)
  const bottom = orderStudioSelection(top, [middle.id, first.id], 'bottom')
  assert.deepEqual(bottom.layers, doc.layers)
  assert.equal(orderStudioSelection(doc, [first.id], 'bottom'), doc)
  middle.locked = true
  assert.equal(orderStudioSelection(doc, [first.id, middle.id], 'top'), doc)
  middle.locked = false
  first.groupId = doc.groups[0].id
  doc.groups[0].locked = true
  assert.equal(orderStudioSelection(doc, [first.id], 'top'), doc)
})

test('ordering one group member never splits the group or changes the order of root layers', () => {
  const doc = composition()
  const [first, middle, last] = doc.layers
  const top = orderStudioSelection(doc, [first.id], 'top')
  assert.deepEqual(
    top.layers.map((layer) => layer.id),
    [middle.id, first.id, last.id]
  )
  const bottom = orderStudioSelection(top, [first.id], 'bottom')
  assert.deepEqual(bottom.layers, doc.layers)
})
