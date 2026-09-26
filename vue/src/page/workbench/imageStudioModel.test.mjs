import assert from 'node:assert/strict'
import test from 'node:test'
import { createImageDraft } from './imageCreationModel.ts'
import { applyStudioTemplate, clearStudioWorkspace, cropStudioImage, createImageLayer, createStudioDocument,
  createGuideLayer, createMaskLayer, createPaintLayer, createStudioGroup, createTextLayer, migrateImageDraft,
  dropStudioItem, moveStudioLayerToGroup, moveStudioLayersToGroup, readStudioDocument, readStudioIndex, reorderStudioGroup, reorderStudioLayer,
  scaleStudioDocument, studioDocumentKey, studioEditableMaskLayers, studioGroupBounds, studioIndexKey, legacyStudioKey,
  studioMaskContainsPoint, studioMaskPaintBounds, studioMaskPoint,
  updateCrop, studioContentBounds, studioExportDocument, resizeStudioFrame, resizeStudioCanvas } from './imageStudioModel.ts'

test('canvas resizing preserves layer content and center-relative layout, including hidden and locked layers', () => {
  const doc = createStudioDocument()
  doc.width = 6400; doc.height = 4000
  const image = createImageLayer('/original.jpg', { x: 0, y: 0, width: 6400, height: 4000 })
  image.rotation = 20; image.fit = 'contain'; image.zoom = 1.5; image.locked = true
  const text = createTextLayer({ x: 3200, y: 1800, width: 300, height: 100 }, 'Keep typography')
  text.visible = false
  const mask = createMaskLayer(doc.width, doc.height)
  mask.strokes = [{ mode: 'paint', size: 24, points: [{ x: .2, y: .3 }] }]
  doc.layers = [image, text, mask]
  const original = structuredClone(doc)
  const small = resizeStudioCanvas(doc, 1080, 1080)
  assert.deepEqual(doc, original)
  small.layers.forEach((layer, index) => {
    assert.equal(layer.x - small.width / 2, doc.layers[index].x - doc.width / 2)
    assert.equal(layer.y - small.height / 2, doc.layers[index].y - doc.height / 2)
    assert.deepEqual({ ...layer, x: doc.layers[index].x, y: doc.layers[index].y }, doc.layers[index])
  })
  // Reopening a tiny canvas must keep oversized and off-canvas content intact.
  const reopened = readStudioDocument(JSON.parse(JSON.stringify(small)))
  assert.deepEqual(reopened.layers, small.layers)
  const expanded = resizeStudioCanvas(reopened, 6400, 4000)
  assert.deepEqual(expanded.layers, doc.layers)
  assert.deepEqual(resizeStudioCanvas(doc, doc.width, doc.height), doc)
})

test('corner resize scales the whole frame and preserves the opposite corner', () => {
  const frame = { x: 100, y: 200, width: 800, height: 400, rotation: 0 }
  assert.deepEqual(resizeStudioFrame(frame, 'se', -400, -200, true), { x: 100, y: 200, width: 400, height: 200 })
  assert.deepEqual(resizeStudioFrame(frame, 'nw', 400, 200, true), { x: 500, y: 400, width: 400, height: 200 })
  assert.deepEqual(resizeStudioFrame(frame, 'ne', 200, -50, false), { x: 100, y: 150, width: 1000, height: 450 })
})

test('rotated resize keeps its opposite corner stationary and clamps oversized output', () => {
  const frame = { x: 100, y: 200, width: 800, height: 400, rotation: 90 }
  const resized = resizeStudioFrame(frame, 'se', -100, 200, true)
  assert.deepEqual([resized.width, resized.height], [1000, 500])
  const corner = f => ({ x: f.x + f.width / 2 + f.height / 2, y: f.y + f.height / 2 - f.width / 2 })
  assert.deepEqual(corner(resized), corner(frame))
  const large = resizeStudioFrame(frame, 'se', -100000, 200000, true)
  assert.equal(large.width, 16384)
  assert.equal(large.height, 8192)
})

test('content export trims outer canvas margins, preserves gaps and leaves the draft unchanged', () => {
  const doc = createStudioDocument()
  doc.width = 1000; doc.height = 800
  doc.layers = [createImageLayer('/a.png', { x: 100, y: 80, width: 200, height: 100 }),
    createImageLayer('/b.png', { x: 500, y: 300, width: 150, height: 200 })]
  const before = JSON.stringify(doc)
  assert.deepEqual(studioContentBounds(doc), { x: 100, y: 80, width: 550, height: 420 })
  const output = studioExportDocument(doc, true)
  assert.deepEqual([output.width, output.height], [550, 420])
  assert.deepEqual(output.layers.map(l => [l.x, l.y]), [[0, 0], [400, 220]])
  assert.equal(output.background, doc.background)
  assert.equal(JSON.stringify(doc), before)
  assert.deepEqual(studioExportDocument(doc, false), doc)
})

test('content bounds account for rotation and exclude hidden, transparent and off-canvas layers', () => {
  const doc = createStudioDocument()
  doc.width = 1000; doc.height = 800
  const rotated = createImageLayer('/a.png', { x: 100, y: 100, width: 200, height: 100 })
  rotated.rotation = 90
  const hidden = createImageLayer('/hidden.png', { x: 0, y: 0, width: 1000, height: 800 })
  hidden.groupId = 'hidden'
  doc.groups = [{ id: 'hidden', name: '', visible: false, locked: false, collapsed: false }]
  const transparent = { ...hidden, id: 'transparent', groupId: undefined, opacity: 0 }
  const outside = createImageLayer('/outside.png', { x: 1100, y: 0, width: 50, height: 50 })
  doc.layers = [rotated, hidden, transparent, outside]
  assert.deepEqual(studioContentBounds(doc), { x: 150, y: 50, width: 100, height: 200 })
  rotated.x = -150
  assert.deepEqual(studioContentBounds(doc), null)
})

test('content export rejects empty documents and clips partial layers to the visible canvas', () => {
  const doc = createStudioDocument()
  doc.layers = []
  assert.throws(() => studioExportDocument(doc, true), /没有可保存的内容/)
  doc.layers = [createImageLayer('/a.png', { x: -20, y: -30, width: 100, height: 90 })]
  assert.deepEqual(studioContentBounds(doc), { x: 0, y: 0, width: 80, height: 60 })
})

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

test('locked group bounds enclose visible rotated members and masks start gray', () => {
  const doc = createStudioDocument()
  const group = createStudioGroup('整组')
  group.locked = true
  doc.groups.push(group)
  const image = createImageLayer('/one.png', { x: 10, y: 20, width: 100, height: 50 })
  image.groupId = group.id
  const text = createTextLayer({ x: 200, y: 100, width: 40, height: 20 })
  text.groupId = group.id
  text.rotation = 90
  const hidden = createImageLayer('/hidden.png', { x: 500, y: 500, width: 100, height: 100 })
  hidden.groupId = group.id
  hidden.visible = false
  const mask = createMaskLayer(1080, 1080)
  mask.groupId = group.id
  doc.layers = [image, text, hidden, mask]
  assert.equal(mask.color, '#808080')
  assert.equal(createPaintLayer(1080, 1080).color, '#ef4444')
  assert.deepEqual(studioGroupBounds(doc, group.id), { x: 10, y: 20, width: 220, height: 110 })
})

test('visible AI annotations survive draft reload while colored paint stays outside the mask channel', () => {
  const doc = createStudioDocument()
  const arrow = createGuideLayer({ x: 120, y: 140, width: 200, height: 80 }, 'arrow')
  arrow.flipX = true
  arrow.color = '#0088ff'
  arrow.prompt = '把箭头指向的袖口换成蓝色'
  const paint = createPaintLayer(doc.width, doc.height)
  paint.strokes.push({ points: [{ x: .3, y: .4 }, { x: .5, y: .6 }], size: 42, mode: 'paint' })
  const mask = createMaskLayer(doc.width, doc.height)
  mask.strokes.push({ points: [{ x: .1, y: .2 }], size: 32, mode: 'paint' })
  doc.layers = [arrow, paint, mask]
  const restored = readStudioDocument(JSON.parse(JSON.stringify(doc)))
  assert.equal(restored.layers[0].shape, 'arrow')
  assert.equal(restored.layers[0].flipX, true)
  assert.equal(restored.layers[0].prompt, arrow.prompt)
  assert.equal(restored.layers[1].kind, 'paint')
  assert.equal(studioMaskContainsPoint(restored.layers[1], { x: 432, y: 540 }), true)
  assert.equal(studioEditableMaskLayers(restored).length, 1)
  assert.equal(studioEditableMaskLayers(restored)[0].id, mask.id)
})

test('mask strokes use local coordinates when the mask is moved or rotated', () => {
  const mask = createMaskLayer(100, 50)
  mask.x = 100; mask.y = 100; mask.rotation = 90
  assert.deepEqual(studioMaskPoint(mask, { x: 150, y: 150 }), { x: .75, y: .5 })
  assert.equal(studioMaskPoint(mask, { x: 190, y: 125 }), null)
})

test('painted masks can be picked on canvas without selecting empty or erased areas', () => {
  const mask = createMaskLayer(100, 100)
  mask.x = 50
  mask.strokes.push({ mode: 'paint', size: 20, points: [{ x: .2, y: .5 }, { x: .8, y: .5 }] })
  assert.equal(studioMaskContainsPoint(mask, { x: 100, y: 50 }), true)
  assert.equal(studioMaskContainsPoint(mask, { x: 100, y: 80 }), false)
  assert.deepEqual(studioMaskPaintBounds(mask), { x: 4, y: 34, width: 92, height: 32 })
  mask.strokes.push({ mode: 'erase', size: 24, points: [{ x: .5, y: .5 }] })
  assert.equal(studioMaskContainsPoint(mask, { x: 100, y: 50 }), false)
  assert.equal(studioMaskContainsPoint(mask, { x: 72, y: 50 }), true)
})

test('selection bounds shrink after erasing and disappear when no painted pixels remain', () => {
  const mask = createMaskLayer(100, 100)
  mask.strokes.push({ mode: 'paint', size: 20, points: [{ x: .2, y: .5 }, { x: .8, y: .5 }] })
  const original = studioMaskPaintBounds(mask)
  mask.strokes.push({ mode: 'erase', size: 26, points: [{ x: .6, y: .5 }, { x: .8, y: .5 }] })
  const shortened = studioMaskPaintBounds(mask)
  assert.ok(shortened)
  assert.ok(shortened.x + shortened.width < original.x + original.width - 20)
  mask.strokes.push({ mode: 'erase', size: 200, points: [{ x: .5, y: .5 }] })
  assert.equal(studioMaskPaintBounds(mask), null)
  mask.strokes.push({ mode: 'paint', size: 12, points: [{ x: .9, y: .5 }] })
  assert.ok(studioMaskPaintBounds(mask).x > 70)
})

test('paint strokes can be erased without affecting mask channel and old default names are shortened', () => {
  const doc = createStudioDocument()
  const paint = createPaintLayer(100, 100)
  paint.name = '彩色涂抹 2'
  paint.strokes = [{ mode: 'paint', size: 20, points: [{ x: .5, y: .5 }] },
    { mode: 'erase', size: 30, points: [{ x: .5, y: .5 }] }]
  const mask = createMaskLayer(100, 100)
  mask.name = '编辑遮罩 3'
  mask.strokes = [{ mode: 'paint', size: 20, points: [{ x: .5, y: .5 }] }]
  const custom = createPaintLayer(100, 100)
  custom.name = '衣服颜色标注'
  doc.layers = [paint, mask, custom]
  const saved = readStudioDocument(JSON.parse(JSON.stringify(doc)))
  assert.deepEqual(saved.layers.map(layer => layer.name), ['涂抹 2', '遮罩 3', '衣服颜色标注'])
  assert.equal(studioMaskContainsPoint(saved.layers[0], { x: 50, y: 50 }), false)
  assert.equal(studioMaskContainsPoint(saved.layers[1], { x: 50, y: 50 }), true)
})

test('eraser targets only visible unlocked masks, including group state', () => {
  const doc = createStudioDocument()
  const group = createStudioGroup('hidden')
  doc.groups = [group]
  const free = createMaskLayer(100, 100)
  const grouped = createMaskLayer(100, 100)
  grouped.groupId = group.id
  const locked = createMaskLayer(100, 100)
  locked.locked = true
  doc.layers = [free, grouped, locked]
  assert.deepEqual(studioEditableMaskLayers(doc).map(layer => layer.id), [free.id, grouped.id])
  group.visible = false
  assert.deepEqual(studioEditableMaskLayers(doc).map(layer => layer.id), [free.id])
  group.visible = true
  group.locked = true
  assert.deepEqual(studioEditableMaskLayers(doc).map(layer => layer.id), [free.id])
})

test('saved text layers keep a selected installed font', () => {
  const doc = createStudioDocument()
  const text = createTextLayer({ x: 10, y: 20, width: 180, height: 70 }, '标题')
  text.font = 'KaiTi'
  doc.layers = [text]
  assert.equal(readStudioDocument(JSON.parse(JSON.stringify(doc))).layers[0].font, 'KaiTi')
})

test('groups remain contiguous while moving layers and preserve hidden state in saved drafts', () => {
  const doc = createStudioDocument()
  const group = createStudioGroup('合成组')
  doc.groups = [group]
  const layers = ['A', 'B', 'C', 'D'].map(name => createTextLayer({ x: 0, y: 0, width: 80, height: 80 }, name))
  doc.layers = layers
  let grouped = moveStudioLayerToGroup(doc, layers[0].id, group.id)
  grouped = moveStudioLayerToGroup(grouped, layers[2].id, group.id)
  grouped = moveStudioLayerToGroup(grouped, layers[1].id, group.id)
  assert.deepEqual(grouped.layers.map(layer => layer.groupId ?? ''), [group.id, group.id, group.id, ''])
  const movedOut = moveStudioLayerToGroup(grouped, layers[2].id)
  assert.deepEqual(movedOut.layers.filter(layer => layer.groupId === group.id).map(layer => layer.text), ['A', 'B'])
  assert.equal(movedOut.layers.findIndex(layer => layer.id === layers[2].id),
    movedOut.layers.findIndex(layer => layer.id === layers[1].id) + 1)
  movedOut.groups[0].visible = false
  const saved = readStudioDocument(JSON.parse(JSON.stringify(movedOut)))
  assert.equal(saved.groups[0].visible, false)
  assert.equal(saved.layers.find(layer => layer.id === layers[0].id).groupId, group.id)
  assert.equal(doc.layers.every(layer => !layer.groupId), true)
})

test('grouping nonadjacent layers from different groups keeps their order and removes old memberships', () => {
  const doc = createStudioDocument()
  const oldGroup = createStudioGroup('old'), newGroup = createStudioGroup('new')
  doc.groups = [oldGroup, newGroup]
  const layers = ['A', 'B', 'C', 'D'].map(name => {
    const layer = createTextLayer({ x: 0, y: 0, width: 80, height: 80 }, name)
    layer.name = name
    return layer
  })
  layers[1].groupId = oldGroup.id
  doc.layers = layers
  const grouped = moveStudioLayersToGroup(doc, [layers[3].id, layers[1].id], newGroup.id)
  assert.deepEqual(grouped.layers.map(layer => layer.name), ['A', 'C', 'B', 'D'])
  assert.deepEqual(grouped.layers.map(layer => layer.groupId ?? ''), ['', '', newGroup.id, newGroup.id])
  assert.equal(doc.layers[1].groupId, oldGroup.id)
})

test('dragging a group moves its layers as one stack block and keeps their internal order', () => {
  const doc = createStudioDocument()
  const first = createStudioGroup('first'), second = createStudioGroup('second')
  doc.groups = [first, second]
  const [base, a, b, middle, c, d, top] = ['base', 'a', 'b', 'middle', 'c', 'd', 'top']
    .map(name => { const layer = createTextLayer({ x: 0, y: 0, width: 80, height: 80 }, name); layer.name = name; return layer })
  a.groupId = first.id; b.groupId = first.id
  c.groupId = second.id; d.groupId = second.id
  doc.layers = [base, a, b, middle, c, d, top]
  const aboveSecond = reorderStudioGroup(doc, first.id, { kind: 'group', id: second.id })
  assert.deepEqual(aboveSecond.layers.map(layer => layer.name), ['base', 'middle', 'c', 'd', 'a', 'b', 'top'])
  const aboveMember = reorderStudioGroup(aboveSecond, second.id, { kind: 'layer', id: b.id })
  assert.deepEqual(aboveMember.layers.map(layer => layer.name), ['base', 'middle', 'a', 'b', 'c', 'd', 'top'])
  const bottomed = reorderStudioGroup(aboveMember, first.id, { kind: 'bottom' })
  assert.deepEqual(bottomed.layers.map(layer => layer.name), ['a', 'b', 'base', 'middle', 'c', 'd', 'top'])
  assert.deepEqual(doc.layers.map(layer => layer.name), ['base', 'a', 'b', 'middle', 'c', 'd', 'top'])
})

test('layer drops reorder upward and downward inside the same group using visible edges', () => {
  const doc = createStudioDocument(), group = createStudioGroup('group')
  doc.groups = [group]
  doc.layers = ['A', 'B', 'C'].map(id => ({ ...createTextLayer({ x: 0, y: 0, width: 80, height: 80 }), id, groupId: group.id }))
  const up = dropStudioItem(doc, { kind: 'layer', id: 'A' }, { kind: 'layer', id: 'C', position: 'before' })
  assert.deepEqual(up.layers.map(layer => layer.id), ['B', 'C', 'A'])
  const down = dropStudioItem(up, { kind: 'layer', id: 'A' }, { kind: 'layer', id: 'B', position: 'after' })
  assert.deepEqual(down.layers.map(layer => layer.id), ['A', 'B', 'C'])
  assert.ok(down.layers.every(layer => layer.groupId === group.id))
  assert.deepEqual(doc.layers.map(layer => layer.id), ['A', 'B', 'C'])
})

test('groups drop both above and below other groups as intact blocks', () => {
  const doc = createStudioDocument()
  doc.groups = ['first', 'second'].map(id => ({ ...createStudioGroup(id), id }))
  doc.layers = ['A', 'B', 'C', 'D'].map((id, index) => ({ ...createTextLayer({ x: 0, y: 0, width: 80, height: 80 }), id, groupId: index < 2 ? 'first' : 'second' }))
  const up = dropStudioItem(doc, { kind: 'group', id: 'first' }, { kind: 'group', id: 'second', position: 'before' })
  assert.deepEqual(up.layers.map(layer => layer.id), ['C', 'D', 'A', 'B'])
  const down = dropStudioItem(up, { kind: 'group', id: 'first' }, { kind: 'group', id: 'second', position: 'after' })
  assert.deepEqual(down.layers.map(layer => layer.id), ['A', 'B', 'C', 'D'])
  const pastChild = dropStudioItem(up, { kind: 'group', id: 'first' }, { kind: 'layer', id: 'D', position: 'after' })
  assert.deepEqual(pastChild.layers.map(layer => layer.id), ['A', 'B', 'C', 'D'])
})

test('a layer can leave its own group above, below, or at either list boundary', () => {
  const doc = createStudioDocument(), group = createStudioGroup('group')
  doc.groups = [group]
  doc.layers = ['A', 'B', 'C'].map(id => ({ ...createTextLayer({ x: 0, y: 0, width: 80, height: 80 }), id, groupId: group.id }))
  for (const target of [{ kind: 'group', id: group.id, position: 'before' }, { kind: 'group', id: group.id, position: 'after' }, { kind: 'top' }, { kind: 'bottom' }]) {
    const moved = dropStudioItem(doc, { kind: 'layer', id: 'B' }, target)
    assert.equal(moved.layers.find(layer => layer.id === 'B').groupId, undefined)
    assert.deepEqual(moved.layers.filter(layer => layer.groupId).map(layer => layer.id), ['A', 'C'])
    assert.equal(moved.layers[target.kind === 'top' || target.position === 'before' ? 2 : 0].id, 'B')
  }
  const inside = dropStudioItem(doc, { kind: 'layer', id: 'B' }, { kind: 'group', id: group.id, position: 'inside' })
  assert.equal(inside.layers.at(-1).groupId, group.id)
  group.locked = true
  assert.deepEqual(dropStudioItem(doc, { kind: 'layer', id: 'B' }, { kind: 'bottom' }), doc)
})

test('guide and editable mask strokes survive save and canvas scaling', () => {
  const doc = createStudioDocument()
  const guide = createGuideLayer({ x: 100, y: 200, width: 300, height: 120 })
  guide.prompt = 'edit this region'
  const mask = createMaskLayer(doc.width, doc.height)
  mask.strokes = [{ mode: 'paint', size: 24, points: [{ x: .2, y: .3 }, { x: .3, y: .4 }] },
    { mode: 'erase', size: 12, points: [{ x: .25, y: .35 }] }]
  doc.layers = [guide, mask]
  const saved = readStudioDocument(JSON.parse(JSON.stringify(doc)))
  assert.equal(saved.layers[0].prompt, 'edit this region')
  assert.deepEqual(saved.layers[1].strokes, mask.strokes)
  const scaled = scaleStudioDocument(saved, 2160, 1080)
  assert.equal(scaled.layers[0].x, 200)
  assert.equal(scaled.layers[1].strokes[0].size, 24 * Math.sqrt(2))
  assert.deepEqual(scaled.layers[1].strokes[0].points, mask.strokes[0].points)
})

test('media editor history preserves original large and tiny image dimensions and transparency', () => {
  for (const [width, height] of [[6400, 4000], [12, 8]]) {
    const doc = createStudioDocument('source')
    Object.assign(doc, { width, height, background: 'transparent', backgroundView: 'checkerboard' })
    doc.layers = [createImageLayer('/original.png', { x: 0, y: 0, width, height })]
    const restored = readStudioDocument(JSON.parse(JSON.stringify(doc)))
    assert.equal(restored.width, width)
    assert.equal(restored.height, height)
    assert.equal(restored.background, 'transparent')
    assert.equal(restored.backgroundView, 'checkerboard')
    assert.equal(restored.layers[0].width, width)
    assert.equal(restored.layers[0].height, height)
  }
})
