import test from 'node:test'
import assert from 'node:assert/strict'
import { createStudioDocument, createStudioGroup, createTextLayer } from './imageStudioModel.ts'
import { createStudioVector, studioFrameOrder } from './imageStudioVectors.ts'
import {
  studioContextHits,
  studioContextSelection,
  studioContextTargets,
  studioContextLocks,
  duplicateStudioItems,
  orderStudioItems
} from './imageStudioContext.ts'

const rect = { x: 0, y: 0, width: 100, height: 100 }
const shape = (id, props = {}) => ({ ...createStudioVector('shape', 'rect', rect), id, ...props })
function fixture() {
  const group = { ...createStudioGroup('气泡'), id: 'g' }
  const inner = { ...createStudioGroup('框内组'), id: 'inner' }
  const frame = { ...createStudioVector('frame', 'ellipse', rect), id: 'f', x: 200 }
  const doc = {
    ...createStudioDocument(),
    width: 500,
    height: 500,
    groups: [group, inner],
    layers: [
      shape('bottom'),
      shape('bubble', { groupId: 'g' }),
      { ...createTextLayer(rect), id: 'text', groupId: 'g' },
      frame,
      shape('child', { frameId: 'f', groupId: 'inner', x: 180, width: 150 }),
      shape('top')
    ]
  }
  return doc
}

test('canvas right click preserves mixed selections; new objects choose their container; Alt enters a member', () => {
  const doc = fixture(),
    multi = { layerIds: ['top'], groupIds: ['g'] }
  assert.equal(studioContextSelection(doc, multi, { kind: 'layer', id: 'text' }, true), multi)
  assert.deepEqual(studioContextSelection(doc, multi, { kind: 'layer', id: 'text' }), {
    layerIds: ['text'],
    groupIds: []
  })
  assert.deepEqual(studioContextSelection(doc, multi, { kind: 'layer', id: 'text' }, true, true), {
    layerIds: ['text'],
    groupIds: []
  })
  assert.deepEqual(
    studioContextSelection(
      doc,
      { layerIds: [], groupIds: [] },
      { kind: 'layer', id: 'text' },
      true
    ),
    { layerIds: [], groupIds: ['g'] }
  )
  assert.deepEqual(studioContextSelection(doc, multi, { kind: 'layer', id: 'child' }, true), {
    layerIds: ['f'],
    groupIds: []
  })
  assert.deepEqual(studioContextSelection(doc, multi, { kind: 'layer', id: 'child' }), {
    layerIds: ['child'],
    groupIds: []
  })
  assert.deepEqual(studioContextSelection(doc, multi), { layerIds: [], groupIds: [] })
})

test('hit candidates follow render order and exclude hidden, clipped and out-of-canvas content', () => {
  const doc = fixture()
  assert.deepEqual(
    studioContextHits(doc, { x: 50, y: 50 }).map((l) => l.id),
    ['top', 'text', 'bubble', 'bottom']
  )
  doc.groups[0].visible = false
  assert.deepEqual(
    studioContextHits(doc, { x: 50, y: 50 }).map((l) => l.id),
    ['top', 'bottom']
  )
  assert.deepEqual(studioContextHits(doc, { x: 200, y: 1 }), [])
  assert.deepEqual(
    studioContextHits(doc, { x: 250, y: 50 }).map((l) => l.id),
    ['child', 'f']
  )
  assert.deepEqual(studioContextHits(doc, { x: -1, y: 1 }), [])
  const targets = studioContextTargets(doc, studioContextHits(doc, { x: 250, y: 50 }))
  assert.deepEqual(
    targets.map((t) => t.id),
    ['f', 'inner', 'child']
  )
})

test('lock resolution includes ancestors and group contents but leaves unrelated locks alone', () => {
  const doc = fixture()
  doc.layers.find((l) => l.id === 'child').locked = true
  doc.layers.find((l) => l.id === 'f').locked = true
  doc.layers.find((l) => l.id === 'top').locked = true
  doc.groups[1].locked = true
  const locks = studioContextLocks(doc, { layerIds: ['child'], groupIds: [] })
  assert.deepEqual(locks, { layerIds: ['child', 'f'], groupIds: ['inner'] })
  for (const direction of ['top', 'bottom', 'up', 'down'])
    assert.equal(orderStudioItems(doc, { layerIds: ['f'], groupIds: ['g'] }, direction), doc)
})

test('mixed duplication preserves independent groups, clipping, offsets and deep copies', () => {
  const doc = fixture(),
    original = structuredClone(doc)
  const copy = duplicateStudioItems(doc, { layerIds: ['f', 'top'], groupIds: ['g'] })
  assert.equal(copy.document.layers.length, 11)
  assert.equal(copy.document.groups.length, 4)
  assert.equal(copy.groupIds.length, 1)
  const created = copy.document.layers.slice(doc.layers.length)
  const frame = created.find((l) => l.kind === 'frame'),
    child = created.find((l) => l.name === doc.layers[4].name + ' 副本' && l.frameId)
  assert.equal(child.frameId, frame.id)
  assert.notEqual(child.groupId, 'inner')
  assert.equal(child.x, 204)
  assert.equal(created.find((l) => l.kind === 'text').groupId, copy.groupIds[0])
  created.find((l) => l.kind === 'shape').points[0].x = 99
  assert.deepEqual(doc, original)
})

test('mixed ordering moves groups and clipping frames as blocks, preserving selected order', () => {
  const doc = fixture(),
    selection = { layerIds: ['f'], groupIds: ['g'] }
  for (const direction of ['up', 'top']) {
    const result = orderStudioItems(doc, selection, direction)
    assert.deepEqual(
      result.layers.map((l) => l.id),
      ['bottom', 'top', 'bubble', 'text', 'f', 'child']
    )
    assert.deepEqual(
      studioFrameOrder(result).map((l) => l.id),
      result.layers.map((l) => l.id)
    )
  }
  for (const direction of ['down', 'bottom'])
    assert.deepEqual(
      orderStudioItems(doc, selection, direction).layers.map((l) => l.id),
      ['bubble', 'text', 'f', 'child', 'bottom', 'top']
    )
  assert.equal(orderStudioItems(doc, { layerIds: ['top'], groupIds: [] }, 'top'), doc)
  assert.deepEqual(
    doc.layers.map((l) => l.id),
    ['bottom', 'bubble', 'text', 'f', 'child', 'top']
  )
})

test('duplicating a member leaves its copy within the existing group block', () => {
  const doc = fixture()
  const result = duplicateStudioItems(doc, { layerIds: ['bubble'], groupIds: [] })
  assert.deepEqual(
    result.document.layers.map((l) => l.id),
    ['bottom', 'bubble', result.layerIds[0], 'text', 'f', 'child', 'top']
  )
  assert.equal(result.document.layers[2].groupId, 'g')
  assert.equal(result.document.groups.length, doc.groups.length)
})

test('member ordering stays in its group/frame; empty group positions survive sorting', () => {
  const doc = fixture()
  doc.layers.splice(5, 0, shape('child2', { frameId: 'f', groupId: 'inner' }))
  doc.groups.push({ ...createStudioGroup('空组'), id: 'empty', stackIndex: 0 })
  const result = orderStudioItems(doc, { layerIds: ['text', 'child2'], groupIds: [] }, 'bottom')
  assert.deepEqual(
    result.layers.map((l) => l.id),
    ['bottom', 'text', 'bubble', 'f', 'child2', 'child', 'top']
  )
  assert.equal(result.layers.find((l) => l.id === 'child2').frameId, 'f')
  const moved = orderStudioItems(result, { layerIds: [], groupIds: ['empty'] }, 'top')
  assert.equal(moved.groups.find((g) => g.id === 'empty').stackIndex, moved.layers.length)
})
