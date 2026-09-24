import assert from 'node:assert/strict'
import test from 'node:test'
import { createImageDraft } from './imageCreationModel.ts'
import { applyStudioTemplate, clearStudioWorkspace, cropStudioImage, createImageLayer, createStudioDocument,
  createTextLayer, migrateImageDraft, readStudioDocument, readStudioIndex, reorderStudioLayer,
  scaleStudioDocument, studioDocumentKey, studioIndexKey, legacyStudioKey, updateCrop } from './imageStudioModel.ts'

test('legacy single canvas migrates cells, hidden pictures and caption without deleting the source', () => {
  const old = createImageDraft()
  old.layout = 'grid-four'
  old.slots[0].path = '/one.jpg'
  old.slots[6].path = '/hidden.png'
  old.caption = '旧标题'
  const doc = migrateImageDraft(old)
  assert.equal(doc.layers.length, 6)
  assert.equal(doc.layers[0].kind, 'image')
  assert.equal(doc.layers[0].path, '/one.jpg')
  assert.equal(doc.layers[4].path, '/hidden.png')
  assert.equal(doc.layers[4].visible, false)
  assert.equal(doc.layers.at(-1).kind, 'text')
  assert.equal(doc.layers.at(-1).text, '旧标题')
  assert.equal(readStudioDocument(JSON.parse(JSON.stringify(doc))).layers.length, 6)
})

test('template rearranges visible pictures, adds empty cells, and leaves text and extras in place', () => {
  const doc = createStudioDocument()
  const first = createImageLayer('/a.png', { x: 8, y: 8, width: 80, height: 80 })
  const hidden = createImageLayer('/b.png', { x: 25, y: 40, width: 80, height: 80 })
  hidden.visible = false
  const text = createTextLayer({ x: 90, y: 70, width: 200, height: 100 }, 'caption')
  doc.layers = [first, hidden, text]
  const next = applyStudioTemplate(doc, 'grid-four')
  assert.equal(next.layers.length, 6)
  assert.equal(next.layers.find(layer => layer.id === text.id).x, 90)
  assert.equal(next.layers.find(layer => layer.id === hidden.id).x, 25)
  assert.notEqual(next.layers.find(layer => layer.id === first.id).x, 8)
  assert.equal(doc.layers.length, 3)
  assert.equal(JSON.parse(JSON.stringify(doc)).layers.length, 3)
})

test('crop keeps relative source coordinates and canvas resize scales frames and text', () => {
  assert.deepEqual(updateCrop({ x: .2, y: .1, width: .6, height: .8 },
    { x: .25, y: .5, width: .5, height: .25 }), { x: .35, y: .5, width: .3, height: .2 })
  const doc = createStudioDocument()
  const text = createTextLayer({ x: 100, y: 200, width: 400, height: 80 })
  doc.layers = [text]
  const next = scaleStudioDocument(doc, 2160, 1080)
  assert.equal(next.layers[0].x, 200)
  assert.equal(next.layers[0].y, 200)
  assert.equal(next.layers[0].fontSize, text.fontSize * 2)
})

test('crop of a zoomed and panned image maps to original pixels and preserves the chosen frame', () => {
  const image = createImageLayer('/source.jpg', { x: 100, y: 150, width: 400, height: 200 })
  image.zoom = 2
  image.focusX = .25
  image.focusY = .5
  const result = cropStudioImage(image, { x: .25, y: .25, width: .5, height: .5 }, 800, 400)
  assert.deepEqual(result.crop, { x: .25, y: .375, width: .25, height: .25 })
  assert.deepEqual([result.x, result.y, result.width, result.height], [200, 200, 200, 100])
  assert.equal(result.zoom, 1)
  assert.deepEqual(image.crop, { x: 0, y: 0, width: 1, height: 1 })
})

test('reorder preserves layer identity and workspace cleanup removes only its drafts', () => {
  const doc = createStudioDocument()
  const a = createTextLayer({ x: 0, y: 0, width: 50, height: 50 }, 'A')
  const b = createTextLayer({ x: 0, y: 0, width: 50, height: 50 }, 'B')
  doc.layers = [a, b]
  const moved = reorderStudioLayer(doc, a.id, b.id)
  assert.deepEqual(moved.layers.map(layer => layer.id), [b.id, a.id])
  const values = new Map()
  const storage = { getItem: key => values.get(key) ?? null, removeItem: key => values.delete(key),
    key: index => [...values.keys()][index] ?? null, get length() { return values.size } }
  const workspace = 'test-ws'
  values.set(studioIndexKey(workspace), JSON.stringify({ version: 2, activeId: doc.id,
    docs: [{ id: doc.id, name: doc.name, updatedAt: doc.updatedAt }] }))
  values.set(studioDocumentKey(workspace, doc.id), JSON.stringify(doc))
  values.set(studioDocumentKey(workspace, 'orphan'), '{}')
  values.set(legacyStudioKey(workspace), JSON.stringify(createImageDraft()))
  values.set('unrelated', 'keep')
  assert.equal(readStudioIndex(JSON.parse(values.get(studioIndexKey(workspace)))).activeId, doc.id)
  clearStudioWorkspace(workspace, storage)
  assert.deepEqual([...values.keys()], ['unrelated'])
})
