import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createStudioDocument,
  createImageLayer,
  readStudioDocument,
  studioLayerLocked,
  studioLayerVisible,
  scaleStudioDocument,
  studioLayerRows,
  createStudioGroup,
  dropStudioItem
} from './imageStudioModel.ts'
import {
  createStudioVector,
  changeStudioLayer,
  studioHitLayer,
  assignStudioFrame,
  removeStudioLayers,
  addStudioBubble
} from './imageStudioVectors.ts'
import { duplicateStudioSelection } from './imageStudioSelection.ts'

function fixture() {
  const doc = { ...createStudioDocument('漫画'), width: 600, height: 800 }
  const frame = createStudioVector('frame', 'polygon', { x: 40, y: 60, width: 200, height: 300 })
  frame.points = [
    { x: 0.3, y: 0 },
    { x: 1, y: 0 },
    { x: 0.7, y: 1 },
    { x: 0, y: 1 }
  ]
  const image = {
    ...createImageLayer('photo.jpg', { x: 0, y: 0, width: 400, height: 500 }),
    frameId: frame.id
  }
  doc.layers = [frame, image]
  return { doc, frame, image }
}
test('frame geometry survives loading; clipping and container selection agree', () => {
  const { doc, frame, image } = fixture()
  assert.deepEqual(readStudioDocument(doc).layers, doc.layers)
  assert.equal(studioHitLayer(doc, { x: 42, y: 62 }), undefined)
  assert.equal(studioHitLayer(doc, { x: 150, y: 150 }).id, frame.id)
  assert.equal(studioHitLayer(doc, { x: 150, y: 150 }, true).id, image.id)
  assert.deepEqual(
    studioLayerRows(doc).map((r) => r.layer.id),
    [frame.id, image.id]
  )
  assert.equal(readStudioDocument({ ...doc, layers: [image] }).layers[0].frameId, undefined)
})
test('translation carries hidden content, rotation rotates children, resizing only clips', () => {
  const { doc, frame, image } = fixture()
  const moved = changeStudioLayer(doc, frame.id, { x: frame.x + 20, y: frame.y - 10 })
  assert.equal(moved.layers[1].x, image.x + 20)
  assert.equal(moved.layers[1].y, image.y - 10)
  const resized = changeStudioLayer(doc, frame.id, { width: 100, x: 140 })
  assert.deepEqual(resized.layers[1], image)
  const turned = changeStudioLayer(doc, frame.id, { rotation: 90 })
  assert.equal(turned.layers[1].rotation, 90)
  assert.equal(Math.round(turned.layers[1].x), -100)
  const hidden = changeStudioLayer(doc, frame.id, { visible: false, locked: true })
  assert.equal(studioLayerVisible(hidden, image), false)
  assert.equal(studioLayerLocked(hidden, image), true)
})
test('duplicate remaps frame membership and deleting container removes only its content', () => {
  const { doc, frame, image } = fixture()
  const copy = duplicateStudioSelection(doc, [frame.id])
  const frames = copy.document.layers.filter((l) => l.kind === 'frame')
  assert.equal(frames.length, 2)
  const clone = frames.find((f) => f.id !== frame.id)
  assert.equal(copy.document.layers.filter((l) => l.frameId === clone.id).length, 1)
  assert.equal(copy.document.layers.find((l) => l.id === image.id).frameId, frame.id)
  assert.equal(removeStudioLayers(copy.document, [frame.id]).layers.length, 2)
  assert.equal(assignStudioFrame(doc, [frame.id], frame.id), doc)
})
test('bubble remains editable grouped vectors and text; assignment keeps the group together', () => {
  const { doc, frame } = fixture()
  const added = addStudioBubble(doc, 'speech')
  const members = added.document.layers.filter((l) => l.groupId === added.groupId)
  assert.deepEqual(
    members.map((l) => l.kind),
    ['shape', 'text']
  )
  const assigned = assignStudioFrame(added.document, [members[0].id], frame.id)
  assert.ok(
    assigned.layers.filter((l) => l.groupId === added.groupId).every((l) => l.frameId === frame.id)
  )
  const scaled = scaleStudioDocument(assigned, 1200, 1600)
  assert.equal(scaled.layers[0].strokeWidth, frame.strokeWidth * 2)
})

import { captureTextTemplate, insertTextTemplate } from './imageTextTemplates.ts'
test('a bubble saves as a global text template without inheriting its page frame', () => {
  const { doc, frame } = fixture()
  const added = addStudioBubble(doc, 'thought', frame.id)
  const saved = captureTextTemplate(added.document, { groupId: added.groupId })
  assert.equal(saved.layers.length, 2)
  assert.ok(saved.layers.every((l) => !l.frameId))
  const applied = insertTextTemplate(doc, {
    type: 'text',
    payload_type: 'image-group-v1',
    name: '思考',
    document: saved
  })
  assert.ok(applied.document.layers.some((l) => l.kind === 'shape' && l.shape === 'thought'))
  assert.notEqual(applied.groupId, added.groupId)
})

test('empty groups remain reorderable alongside frames, and nested bubble groups duplicate independently', () => {
  const { doc, frame } = fixture()
  const empty = createStudioGroup('空组')
  doc.groups.push({ ...empty, stackIndex: 0 })
  assert.equal(studioLayerRows(doc).at(-1).group.id, empty.id)
  const moved = dropStudioItem(doc, { kind: 'group', id: empty.id }, { kind: 'top' })
  assert.equal(studioLayerRows(moved)[0].group.id, empty.id)
  const added = addStudioBubble(doc, 'speech', frame.id)
  const copy = duplicateStudioSelection(added.document, [frame.id])
  const newFrame = copy.document.layers.find((l) => l.kind === 'frame' && l.id !== frame.id)
  const bubble = copy.document.layers.find((l) => l.kind === 'shape' && l.frameId === newFrame.id)
  assert.notEqual(bubble.groupId, added.groupId)
  assert.ok(copy.document.groups.some((g) => g.id === bubble.groupId))
  assert.equal(copy.document.layers.filter((l) => l.groupId === bubble.groupId).length, 2)
})

test('a group containing a frame with text captures its children and remaps the saved clip', () => {
  const { doc, frame } = fixture()
  const added = addStudioBubble(doc, 'speech', frame.id)
  const parent = createStudioGroup('带框文字')
  added.document.groups.push(parent)
  added.document.layers[0].groupId = parent.id
  const saved = captureTextTemplate(added.document, { groupId: parent.id })
  assert.equal(saved.layers.length, 4)
  const inserted = insertTextTemplate(doc, {
    type: 'text',
    payload_type: 'image-group-v1',
    name: '带框文字',
    document: saved
  })
  const newFrame = inserted.document.layers.find((l) => l.kind === 'frame' && l.id !== frame.id)
  assert.equal(inserted.document.layers.filter((l) => l.frameId === newFrame.id).length, 3)
  assert.equal(new Set(inserted.document.layers.map((l) => l.id)).size, 6)
})
