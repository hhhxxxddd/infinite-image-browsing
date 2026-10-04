import { readStudioTextEffects } from './imageStudioTextEffects.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createStudioDocument,
  createImageLayer,
  createStudioGroup,
  createTextLayer,
  readStudioDocument
} from './imageStudioModel.ts'
import { createStudioVector } from './imageStudioVectors.ts'
import { prepareStudioMerge, applyStudioMerge } from './imageStudioMerge.ts'
import {
  managedImageAssetFile,
  managedImageAssetRoute
} from '../../../shared/lib/managedImageAssets.ts'

const path = 'editor-asset:' + 'a'.repeat(64)
function fixture() {
  const doc = createStudioDocument()
  doc.width = 100
  doc.height = 100
  doc.layers = [
    createImageLayer('/a.png', { x: -10, y: 10, width: 20, height: 30 }),
    createImageLayer('/unselected.png', { x: 0, y: 0, width: 500, height: 500 }),
    createImageLayer('/b.png', { x: 40, y: 20, width: 20, height: 20 })
  ]
  return doc
}
test('noncontiguous selection keeps native off-canvas bounds and replaces only selected layers at global top', () => {
  const doc = fixture(),
    original = structuredClone(doc),
    ids = [doc.layers[0].id, doc.layers[2].id]
  const plan = prepareStudioMerge(doc, ids, [], 'transparent')
  assert.deepEqual(plan.bounds, { x: -10, y: 10, width: 70, height: 30 })
  assert.equal(plan.document.background, 'transparent')
  assert.equal(plan.document.layers[0].x, 0)
  const result = applyStudioMerge(doc, ids, [], path, plan.bounds, false)
  assert.equal(result.document.layers.length, 2)
  assert.equal(result.document.layers[0], doc.layers[1])
  const layer = result.document.layers.at(-1)
  assert.equal(layer.id, result.layerId)
  assert.equal(layer.opacity, 1)
  assert.equal(layer.rotation, 0)
  assert.equal(layer.frameId, undefined)
  assert.equal(layer.groupId, undefined)
  assert.equal(layer.x, -10)
  assert.equal(readStudioDocument(result.document).layers.at(-1).path, path)
  assert.deepEqual(doc, original)
})
test('white background and keeping originals leave editable members and groups intact', () => {
  const doc = fixture(),
    group = createStudioGroup('group')
  doc.groups = [group]
  doc.layers[0].groupId = group.id
  doc.layers[2].groupId = group.id
  const plan = prepareStudioMerge(doc, [], [group.id], 'white')
  assert.equal(plan.document.background, '#ffffff')
  const keep = applyStudioMerge(doc, [], [group.id], path, plan.bounds, true)
  assert.deepEqual(keep.document.layers.slice(0, -1), doc.layers)
  assert.deepEqual(keep.document.groups, doc.groups)
  const replace = applyStudioMerge(doc, [], [group.id], path, plan.bounds, false)
  assert.deepEqual(replace.document.groups, [])
})
test('selected frame expands children; partial children keep clipping context without selecting frame fill', () => {
  const doc = fixture()
  const frame = createStudioVector('frame', 'ellipse', { x: 0, y: 0, width: 20, height: 20 })
  frame.strokeWidth = 4
  doc.layers.unshift(frame)
  doc.layers[1].frameId = frame.id
  const part = prepareStudioMerge(doc, [doc.layers[1].id], [], 'transparent')
  assert.deepEqual(part.ids, [doc.layers[1].id])
  assert.ok(part.document.layers.some((l) => l.id === frame.id))
  assert.deepEqual(part.bounds, { x: 0, y: 10, width: 10, height: 10 })
  const whole = prepareStudioMerge(doc, [frame.id], [], 'transparent')
  assert.equal(whole.ids.length, 2)
  assert.deepEqual(whole.bounds, { x: -2, y: -2, width: 24, height: 24 })
  const result = applyStudioMerge(doc, [frame.id], [], path, whole.bounds, false)
  assert.ok(result.document.layers.every((l) => !l.frameId))
  frame.opacity = 0
  assert.throws(() => prepareStudioMerge(doc, [doc.layers[1].id], [], 'white'), /可见/)
})
test('hidden members do not enlarge bounds; rotated text effects are included; locked, empty and oversized fail', () => {
  const doc = fixture(),
    text = createTextLayer({ x: 0, y: 0, width: 40, height: 20 }, '合成')
  text.rotation = 90
  text.effects = readStudioTextEffects({ stroke: { enabled: true, width: 10, color: '#ffffff' } })
  doc.layers = [text]
  const plan = prepareStudioMerge(doc, [text.id], [], 'transparent')
  assert.ok(plan.bounds.width > 20 && plan.bounds.height > 40)
  text.visible = false
  assert.throws(() => prepareStudioMerge(doc, [text.id], [], 'transparent'), /可见/)
  text.visible = true
  text.locked = true
  assert.throws(() => prepareStudioMerge(doc, [text.id], [], 'transparent'), /解锁/)
  text.locked = false
  text.width = 20000
  assert.throws(() => prepareStudioMerge(doc, [text.id], [], 'transparent'), /范围过大/)
})
test('thought bubble tails at both extremes remain inside the composite bounds', () => {
  const doc = createStudioDocument()
  const bubble = createStudioVector('shape', 'thought', { x: 100, y: 100, width: 200, height: 100 })
  bubble.strokeWidth = 0
  doc.layers = [bubble]
  bubble.tail.x = 0
  assert.equal(prepareStudioMerge(doc, [bubble.id], [], 'transparent').bounds.x, 95)
  bubble.tail.x = 1
  const bounds = prepareStudioMerge(doc, [bubble.id], [], 'transparent').bounds
  assert.equal(bounds.x + bounds.width, 309)
})

test('generated assets use opaque authenticated-route-compatible metadata, never filesystem URLs', () => {
  assert.equal(managedImageAssetRoute(path), '/image-editor-assets/' + 'a'.repeat(64))
  assert.equal(managedImageAssetFile(path).fullpath, path)
  assert.equal(managedImageAssetRoute('editor-asset:../secret'), undefined)
  assert.equal(managedImageAssetFile('editor-asset:nope'), undefined)
  assert.equal(
    managedImageAssetRoute('template-asset:' + 'b'.repeat(64)),
    '/template-assets/' + 'b'.repeat(64)
  )
})
