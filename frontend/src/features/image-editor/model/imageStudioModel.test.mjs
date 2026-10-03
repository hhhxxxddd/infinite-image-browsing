import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyStudioTemplate,
  cropStudioImage,
  createImageLayer,
  createStudioDocument,
  createGuideLayer,
  createMaskLayer,
  createPaintLayer,
  createStudioGroup,
  createTextLayer,
  dropStudioItem,
  moveStudioGroup,
  moveStudioLayerToGroup,
  moveStudioLayersToGroup,
  readStudioDocument,
  reorderStudioGroup,
  reorderStudioLayer,
  scaleStudioDocument,
  studioEditableMaskLayers,
  studioGroupBounds,
  studioLayerRows,
  studioMaskContainsPoint,
  studioMaskPaintBounds,
  studioMaskPoint,
  updateCrop,
  studioContentBounds,
  studioExportDocument,
  resizeStudioFrame,
  resizeStudioCanvas
} from './imageStudioModel.ts'

test('reopening a large composition retains every layer and group', () => {
  const doc = createStudioDocument()
  doc.groups = Array.from({ length: 60 }, (_, index) => createStudioGroup(`group-${index}`))
  doc.layers = Array.from({ length: 120 }, (_, index) => ({
    ...createTextLayer({ x: index, y: index, width: 80, height: 30 }),
    groupId: doc.groups[index % doc.groups.length].id
  }))
  const restored = readStudioDocument(JSON.parse(JSON.stringify(doc)))
  assert.equal(restored.layers.length, 120)
  assert.equal(restored.groups.length, 60)
  assert.deepEqual(
    restored.layers.map((layer) => [layer.id, layer.groupId]),
    doc.layers.map((layer) => [layer.id, layer.groupId])
  )
})

test('pixel crops smaller than two percent keep their exact area after applying and reopening', () => {
  const layer = createImageLayer('/image.png', { x: 0, y: 0, width: 1000, height: 1000 })
  const first = cropStudioImage(layer, { x: 0.4, y: 0.4, width: 0.01, height: 0.01 }, 1000, 1000)
  assert.equal(first.width, 10)
  assert.equal(first.height, 10)
  assert.equal(first.crop.width * 1000, 10)
  const second = cropStudioImage(first, { x: 0.5, y: 0.5, width: 0.1, height: 0.1 }, 1000, 1000)
  assert.equal(second.width, 1)
  assert.equal(second.height, 1)
  assert.equal(second.crop.width * 1000, 1)
  const doc = createStudioDocument()
  doc.layers = [second]
  assert.deepEqual(readStudioDocument(JSON.parse(JSON.stringify(doc))).layers[0].crop, second.crop)
})

test('image mirroring survives document reopening and older documents default to unmirrored', () => {
  const doc = createStudioDocument()
  const layer = createImageLayer('/photo.jpg', { x: 10, y: 20, width: 300, height: 200 })
  layer.flipX = true
  layer.flipY = true
  doc.layers = [layer]
  assert.deepEqual(readStudioDocument(JSON.parse(JSON.stringify(doc))).layers, doc.layers)
  assert.equal(scaleStudioDocument(doc, 2160, 2160).layers[0].flipX, true)
  delete layer.flipX
  delete layer.flipY
  const reopened = readStudioDocument(doc).layers[0]
  assert.equal(reopened.flipX, false)
  assert.equal(reopened.flipY, false)
  layer.flipX = 'true'
  layer.flipY = 1
  assert.equal(readStudioDocument(doc).layers[0].flipX, false)
  assert.equal(readStudioDocument(doc).layers[0].flipY, false)
})

test('text formatting survives document reopening, with compatible defaults and matching font-size limits', () => {
  const doc = createStudioDocument()
  const layer = {
    ...createTextLayer({ x: 10, y: 20, width: 300, height: 100 }, 'Text'),
    fontSize: 600,
    italic: true,
    underline: true,
    strike: true,
    lineHeight: 1.6,
    letterSpacing: 5,
    flipX: true,
    flipY: true
  }
  doc.layers = [layer]
  assert.deepEqual(readStudioDocument(JSON.parse(JSON.stringify(doc))).layers, doc.layers)
  const scaled = scaleStudioDocument(doc, doc.width * 2, doc.height * 2)
  assert.equal(scaled.layers[0].letterSpacing, 10)
  assert.equal(scaled.layers[0].lineHeight, 1.6)
  for (const key of [
    'italic',
    'underline',
    'strike',
    'lineHeight',
    'letterSpacing',
    'flipX',
    'flipY'
  ])
    delete layer[key]
  layer.fontSize = 8
  const reopened = readStudioDocument(doc).layers[0]
  assert.equal(reopened.fontSize, 8)
  assert.equal(reopened.italic, false)
  assert.equal(reopened.lineHeight, 1.24)
  assert.equal(reopened.letterSpacing, 0)
  assert.equal(reopened.flipX, false)
  layer.fontSize = 5000
  layer.lineHeight = 8
  layer.letterSpacing = -100
  const clamped = readStudioDocument(doc).layers[0]
  assert.equal(clamped.fontSize, 1000)
  assert.equal(clamped.lineHeight, 3)
  assert.equal(clamped.letterSpacing, -20)
})

test('canvas resizing preserves layer content and center-relative layout, including hidden and locked layers', () => {
  const doc = createStudioDocument()
  doc.width = 6400
  doc.height = 4000
  const image = createImageLayer('/original.jpg', { x: 0, y: 0, width: 6400, height: 4000 })
  image.rotation = 20
  image.fit = 'contain'
  image.zoom = 1.5
  image.locked = true
  const text = createTextLayer({ x: 3200, y: 1800, width: 300, height: 100 }, 'Keep typography')
  text.visible = false
  const mask = createMaskLayer(doc.width, doc.height)
  mask.strokes = [{ mode: 'paint', size: 24, points: [{ x: 0.2, y: 0.3 }] }]
  doc.layers = [image, text, mask]
  const original = structuredClone(doc)
  const small = resizeStudioCanvas(doc, 1080, 1080)
  assert.deepEqual(doc, original)
  small.layers.forEach((layer, index) => {
    assert.equal(layer.x - small.width / 2, doc.layers[index].x - doc.width / 2)
    assert.equal(layer.y - small.height / 2, doc.layers[index].y - doc.height / 2)
    assert.deepEqual(
      { ...layer, x: doc.layers[index].x, y: doc.layers[index].y },
      doc.layers[index]
    )
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
  assert.deepEqual(resizeStudioFrame(frame, 'se', -400, -200, true), {
    x: 100,
    y: 200,
    width: 400,
    height: 200
  })
  assert.deepEqual(resizeStudioFrame(frame, 'nw', 400, 200, true), {
    x: 500,
    y: 400,
    width: 400,
    height: 200
  })
  assert.deepEqual(resizeStudioFrame(frame, 'ne', 200, -50, false), {
    x: 100,
    y: 150,
    width: 1000,
    height: 450
  })
})

test('rotated resize keeps its opposite corner stationary and clamps oversized output', () => {
  const frame = { x: 100, y: 200, width: 800, height: 400, rotation: 90 }
  const resized = resizeStudioFrame(frame, 'se', -100, 200, true)
  assert.deepEqual([resized.width, resized.height], [1000, 500])
  const corner = (f) => ({
    x: f.x + f.width / 2 + f.height / 2,
    y: f.y + f.height / 2 - f.width / 2
  })
  assert.deepEqual(corner(resized), corner(frame))
  const large = resizeStudioFrame(frame, 'se', -100000, 200000, true)
  assert.equal(large.width, 16384)
  assert.equal(large.height, 8192)
})

test('content export trims outer canvas margins, preserves gaps and leaves the draft unchanged', () => {
  const doc = createStudioDocument()
  doc.width = 1000
  doc.height = 800
  doc.layers = [
    createImageLayer('/a.png', { x: 100, y: 80, width: 200, height: 100 }),
    createImageLayer('/b.png', { x: 500, y: 300, width: 150, height: 200 })
  ]
  const before = JSON.stringify(doc)
  assert.deepEqual(studioContentBounds(doc), { x: 100, y: 80, width: 550, height: 420 })
  const output = studioExportDocument(doc, true)
  assert.deepEqual([output.width, output.height], [550, 420])
  assert.deepEqual(
    output.layers.map((l) => [l.x, l.y]),
    [
      [0, 0],
      [400, 220]
    ]
  )
  assert.equal(output.background, doc.background)
  assert.equal(JSON.stringify(doc), before)
  assert.deepEqual(studioExportDocument(doc, false), doc)
})

test('content bounds account for rotation and exclude hidden, transparent and off-canvas layers', () => {
  const doc = createStudioDocument()
  doc.width = 1000
  doc.height = 800
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

test('template rearranges visible pictures, adds empty cells, and leaves text and extras in place', () => {
  const doc = createStudioDocument()
  const first = createImageLayer('/a.png', { x: 8, y: 8, width: 80, height: 80 })
  const hidden = createImageLayer('/b.png', { x: 25, y: 40, width: 80, height: 80 })
  hidden.visible = false
  const text = createTextLayer({ x: 90, y: 70, width: 200, height: 100 }, 'caption')
  doc.layers = [first, hidden, text]
  const next = applyStudioTemplate(doc, 'grid-four')
  assert.equal(next.layers.length, 6)
  assert.equal(next.layers.find((layer) => layer.id === text.id).x, 90)
  assert.equal(next.layers.find((layer) => layer.id === hidden.id).x, 25)
  assert.notEqual(next.layers.find((layer) => layer.id === first.id).x, 8)
  assert.equal(doc.layers.length, 3)
  assert.equal(JSON.parse(JSON.stringify(doc)).layers.length, 3)
})

test('crop keeps relative source coordinates and canvas resize scales frames and text', () => {
  assert.deepEqual(
    updateCrop(
      { x: 0.2, y: 0.1, width: 0.6, height: 0.8 },
      { x: 0.25, y: 0.5, width: 0.5, height: 0.25 }
    ),
    { x: 0.35, y: 0.5, width: 0.3, height: 0.2 }
  )
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
  image.focusX = 0.25
  image.focusY = 0.5
  const result = cropStudioImage(image, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, 800, 400)
  assert.deepEqual(result.crop, { x: 0.25, y: 0.375, width: 0.25, height: 0.25 })
  assert.deepEqual([result.x, result.y, result.width, result.height], [200, 200, 200, 100])
  assert.equal(result.zoom, 1)
  assert.deepEqual(image.crop, { x: 0, y: 0, width: 1, height: 1 })
})

test('reorder preserves layer identity', () => {
  const doc = createStudioDocument()
  const a = createTextLayer({ x: 0, y: 0, width: 50, height: 50 }, 'A')
  const b = createTextLayer({ x: 0, y: 0, width: 50, height: 50 }, 'B')
  doc.layers = [a, b]
  const moved = reorderStudioLayer(doc, a.id, b.id)
  assert.deepEqual(
    moved.layers.map((layer) => layer.id),
    [b.id, a.id]
  )
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
  paint.strokes.push({
    points: [
      { x: 0.3, y: 0.4 },
      { x: 0.5, y: 0.6 }
    ],
    size: 42,
    mode: 'paint'
  })
  const mask = createMaskLayer(doc.width, doc.height)
  mask.strokes.push({ points: [{ x: 0.1, y: 0.2 }], size: 32, mode: 'paint' })
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
  mask.x = 100
  mask.y = 100
  mask.rotation = 90
  assert.deepEqual(studioMaskPoint(mask, { x: 150, y: 150 }), { x: 0.75, y: 0.5 })
  assert.equal(studioMaskPoint(mask, { x: 190, y: 125 }), null)
})

test('painted masks can be picked on canvas without selecting empty or erased areas', () => {
  const mask = createMaskLayer(100, 100)
  mask.x = 50
  mask.strokes.push({
    mode: 'paint',
    size: 20,
    points: [
      { x: 0.2, y: 0.5 },
      { x: 0.8, y: 0.5 }
    ]
  })
  assert.equal(studioMaskContainsPoint(mask, { x: 100, y: 50 }), true)
  assert.equal(studioMaskContainsPoint(mask, { x: 100, y: 80 }), false)
  assert.deepEqual(studioMaskPaintBounds(mask), { x: 4, y: 34, width: 92, height: 32 })
  mask.strokes.push({ mode: 'erase', size: 24, points: [{ x: 0.5, y: 0.5 }] })
  assert.equal(studioMaskContainsPoint(mask, { x: 100, y: 50 }), false)
  assert.equal(studioMaskContainsPoint(mask, { x: 72, y: 50 }), true)
})

test('selection bounds shrink after erasing and disappear when no painted pixels remain', () => {
  const mask = createMaskLayer(100, 100)
  mask.strokes.push({
    mode: 'paint',
    size: 20,
    points: [
      { x: 0.2, y: 0.5 },
      { x: 0.8, y: 0.5 }
    ]
  })
  const original = studioMaskPaintBounds(mask)
  mask.strokes.push({
    mode: 'erase',
    size: 26,
    points: [
      { x: 0.6, y: 0.5 },
      { x: 0.8, y: 0.5 }
    ]
  })
  const shortened = studioMaskPaintBounds(mask)
  assert.ok(shortened)
  assert.ok(shortened.x + shortened.width < original.x + original.width - 20)
  mask.strokes.push({ mode: 'erase', size: 200, points: [{ x: 0.5, y: 0.5 }] })
  assert.equal(studioMaskPaintBounds(mask), null)
  mask.strokes.push({ mode: 'paint', size: 12, points: [{ x: 0.9, y: 0.5 }] })
  assert.ok(studioMaskPaintBounds(mask).x > 70)
})

test('paint strokes can be erased without affecting mask channel and old default names are shortened', () => {
  const doc = createStudioDocument()
  const paint = createPaintLayer(100, 100)
  paint.name = '彩色涂抹 2'
  paint.strokes = [
    { mode: 'paint', size: 20, points: [{ x: 0.5, y: 0.5 }] },
    { mode: 'erase', size: 30, points: [{ x: 0.5, y: 0.5 }] }
  ]
  const mask = createMaskLayer(100, 100)
  mask.name = '编辑遮罩 3'
  mask.strokes = [{ mode: 'paint', size: 20, points: [{ x: 0.5, y: 0.5 }] }]
  const custom = createPaintLayer(100, 100)
  custom.name = '衣服颜色标注'
  doc.layers = [paint, mask, custom]
  const saved = readStudioDocument(JSON.parse(JSON.stringify(doc)))
  assert.deepEqual(
    saved.layers.map((layer) => layer.name),
    ['涂抹 2', '遮罩 3', '衣服颜色标注']
  )
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
  assert.deepEqual(
    studioEditableMaskLayers(doc).map((layer) => layer.id),
    [free.id, grouped.id]
  )
  group.visible = false
  assert.deepEqual(
    studioEditableMaskLayers(doc).map((layer) => layer.id),
    [free.id]
  )
  group.visible = true
  group.locked = true
  assert.deepEqual(
    studioEditableMaskLayers(doc).map((layer) => layer.id),
    [free.id]
  )
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
  const layers = ['A', 'B', 'C', 'D'].map((name) =>
    createTextLayer({ x: 0, y: 0, width: 80, height: 80 }, name)
  )
  doc.layers = layers
  let grouped = moveStudioLayerToGroup(doc, layers[0].id, group.id)
  grouped = moveStudioLayerToGroup(grouped, layers[2].id, group.id)
  grouped = moveStudioLayerToGroup(grouped, layers[1].id, group.id)
  assert.deepEqual(
    grouped.layers.map((layer) => layer.groupId ?? ''),
    [group.id, group.id, group.id, '']
  )
  const movedOut = moveStudioLayerToGroup(grouped, layers[2].id)
  assert.deepEqual(
    movedOut.layers.filter((layer) => layer.groupId === group.id).map((layer) => layer.text),
    ['A', 'B']
  )
  assert.equal(
    movedOut.layers.findIndex((layer) => layer.id === layers[2].id),
    movedOut.layers.findIndex((layer) => layer.id === layers[1].id) + 1
  )
  movedOut.groups[0].visible = false
  const saved = readStudioDocument(JSON.parse(JSON.stringify(movedOut)))
  assert.equal(saved.groups[0].visible, false)
  assert.equal(saved.layers.find((layer) => layer.id === layers[0].id).groupId, group.id)
  assert.equal(
    doc.layers.every((layer) => !layer.groupId),
    true
  )
})

test('grouping nonadjacent layers from different groups keeps their order and removes old memberships', () => {
  const doc = createStudioDocument()
  const oldGroup = createStudioGroup('old'),
    newGroup = createStudioGroup('new')
  doc.groups = [oldGroup, newGroup]
  const layers = ['A', 'B', 'C', 'D'].map((name) => {
    const layer = createTextLayer({ x: 0, y: 0, width: 80, height: 80 }, name)
    layer.name = name
    return layer
  })
  layers[1].groupId = oldGroup.id
  doc.layers = layers
  const grouped = moveStudioLayersToGroup(doc, [layers[3].id, layers[1].id], newGroup.id)
  assert.deepEqual(
    grouped.layers.map((layer) => layer.name),
    ['A', 'C', 'B', 'D']
  )
  assert.deepEqual(
    grouped.layers.map((layer) => layer.groupId ?? ''),
    ['', '', newGroup.id, newGroup.id]
  )
  assert.equal(doc.layers[1].groupId, oldGroup.id)
})

test('assigning text and image selections to an existing group preserves its block and layer geometry', () => {
  const doc = createStudioDocument()
  const target = createStudioGroup('target'),
    source = createStudioGroup('source')
  doc.groups = [target, source]
  const image = createImageLayer('/source.jpg', { x: 12.5, y: -8, width: 640, height: 480 })
  const text = createTextLayer({ x: 44, y: 31, width: 200, height: 80 }, '标题')
  const peer = createTextLayer({ x: 0, y: 0, width: 80, height: 80 }, 'peer')
  const sourcePeer = createTextLayer({ x: 0, y: 0, width: 80, height: 80 }, 'source peer')
  const root = createTextLayer({ x: 0, y: 0, width: 80, height: 80 }, 'root')
  image.groupId = sourcePeer.groupId = source.id
  peer.groupId = target.id
  image.rotation = 25
  text.visible = false
  doc.layers = [image, sourcePeer, root, peer, text]
  const next = moveStudioLayersToGroup(doc, [text.id, peer.id, image.id], target.id)
  assert.deepEqual(
    next.layers.map((layer) => layer.id),
    [sourcePeer.id, root.id, peer.id, image.id, text.id]
  )
  for (const original of [image, text]) {
    assert.deepEqual(
      next.layers.find((layer) => layer.id === original.id),
      { ...original, groupId: target.id }
    )
  }
  assert.equal(doc.layers[0].groupId, source.id)
  assert.equal(doc.layers.at(-1).groupId, undefined)
  assert.deepEqual(
    readStudioDocument(JSON.parse(JSON.stringify(next))).layers.map((layer) => [
      layer.id,
      layer.groupId
    ]),
    next.layers.map((layer) => [layer.id, layer.groupId])
  )
})

test('group creation and batch removal never split remaining members of the former group', () => {
  const doc = createStudioDocument()
  const source = createStudioGroup('source'),
    target = createStudioGroup('target')
  doc.groups = [source, target]
  doc.layers = ['A', 'B', 'C', 'D', 'root'].map((name, index) => ({
    ...createTextLayer({ x: index, y: index, width: 80, height: 80 }, name),
    name,
    groupId: index < 4 ? source.id : undefined
  }))
  const ids = [doc.layers[0].id, doc.layers[2].id]
  for (const groupId of [target.id, undefined]) {
    const next = moveStudioLayersToGroup(doc, ids, groupId)
    assert.deepEqual(
      next.layers.map((layer) => layer.name),
      ['B', 'D', 'A', 'C', 'root']
    )
    assert.deepEqual(
      next.layers.map((layer) => layer.groupId),
      [source.id, source.id, groupId, groupId, undefined]
    )
  }
})

test('assigning members honors an explicitly sorted empty group and preserves other empty boundaries', () => {
  const doc = createStudioDocument()
  const target = { ...createStudioGroup('target'), stackIndex: 1 }
  const empty = { ...createStudioGroup('empty'), stackIndex: 2 }
  doc.groups = [target, empty]
  doc.layers = ['A', 'B', 'C', 'D'].map((name) => ({
    ...createTextLayer({ x: 0, y: 0, width: 80, height: 80 }, name),
    name
  }))
  const next = moveStudioLayersToGroup(doc, [doc.layers[3].id], target.id)
  assert.deepEqual(
    next.layers.map((layer) => layer.name),
    ['A', 'D', 'B', 'C']
  )
  assert.equal(next.groups.find((group) => group.id === empty.id).stackIndex, 3)
  assert.deepEqual(stackLabels(next), ['C', 'empty', 'B', 'target', 'D', 'A'])
  assert.deepEqual(
    stackLabels(readStudioDocument(JSON.parse(JSON.stringify(next)))),
    stackLabels(next)
  )
})

test('membership changes reject locked sources and destinations atomically and skip no-op assignments', () => {
  const doc = createStudioDocument()
  const source = createStudioGroup('source'),
    target = createStudioGroup('target')
  doc.groups = [source, target]
  const first = createTextLayer({ x: 0, y: 0, width: 80, height: 80 }, 'A')
  const second = createImageLayer('/image.png', { x: 1, y: 2, width: 80, height: 80 })
  first.groupId = source.id
  doc.layers = [first, second]
  const ids = [first.id, second.id]
  assert.equal(moveStudioLayersToGroup(doc, ids, 'missing'), doc)
  assert.equal(moveStudioLayersToGroup(doc, [], target.id), doc)
  assert.equal(moveStudioLayerToGroup(doc, first.id, source.id), doc)
  assert.equal(moveStudioLayerToGroup(doc, second.id), doc)
  first.locked = true
  assert.equal(moveStudioLayersToGroup(doc, ids, target.id), doc)
  assert.equal(moveStudioLayersToGroup(doc, ids), doc)
  first.locked = false
  source.locked = true
  assert.equal(moveStudioLayersToGroup(doc, ids, target.id), doc)
  source.locked = false
  target.locked = true
  assert.equal(moveStudioLayersToGroup(doc, ids, target.id), doc)
})

test('dragging a group moves its layers as one stack block and keeps their internal order', () => {
  const doc = createStudioDocument()
  const first = createStudioGroup('first'),
    second = createStudioGroup('second')
  doc.groups = [first, second]
  const [base, a, b, middle, c, d, top] = ['base', 'a', 'b', 'middle', 'c', 'd', 'top'].map(
    (name) => {
      const layer = createTextLayer({ x: 0, y: 0, width: 80, height: 80 }, name)
      layer.name = name
      return layer
    }
  )
  a.groupId = first.id
  b.groupId = first.id
  c.groupId = second.id
  d.groupId = second.id
  doc.layers = [base, a, b, middle, c, d, top]
  const aboveSecond = reorderStudioGroup(doc, first.id, { kind: 'group', id: second.id })
  assert.deepEqual(
    aboveSecond.layers.map((layer) => layer.name),
    ['base', 'middle', 'c', 'd', 'a', 'b', 'top']
  )
  const aboveMember = reorderStudioGroup(aboveSecond, second.id, { kind: 'layer', id: b.id })
  assert.deepEqual(
    aboveMember.layers.map((layer) => layer.name),
    ['base', 'middle', 'a', 'b', 'c', 'd', 'top']
  )
  const bottomed = reorderStudioGroup(aboveMember, first.id, { kind: 'bottom' })
  assert.deepEqual(
    bottomed.layers.map((layer) => layer.name),
    ['a', 'b', 'base', 'middle', 'c', 'd', 'top']
  )
  assert.deepEqual(
    doc.layers.map((layer) => layer.name),
    ['base', 'a', 'b', 'middle', 'c', 'd', 'top']
  )
})

test('layer drops reorder upward and downward inside the same group using visible edges', () => {
  const doc = createStudioDocument(),
    group = createStudioGroup('group')
  doc.groups = [group]
  doc.layers = ['A', 'B', 'C'].map((id) => ({
    ...createTextLayer({ x: 0, y: 0, width: 80, height: 80 }),
    id,
    groupId: group.id
  }))
  const up = dropStudioItem(
    doc,
    { kind: 'layer', id: 'A' },
    { kind: 'layer', id: 'C', position: 'before' }
  )
  assert.deepEqual(
    up.layers.map((layer) => layer.id),
    ['B', 'C', 'A']
  )
  const down = dropStudioItem(
    up,
    { kind: 'layer', id: 'A' },
    { kind: 'layer', id: 'B', position: 'after' }
  )
  assert.deepEqual(
    down.layers.map((layer) => layer.id),
    ['A', 'B', 'C']
  )
  assert.ok(down.layers.every((layer) => layer.groupId === group.id))
  assert.deepEqual(
    doc.layers.map((layer) => layer.id),
    ['A', 'B', 'C']
  )
})

test('groups drop both above and below other groups as intact blocks', () => {
  const doc = createStudioDocument()
  doc.groups = ['first', 'second'].map((id) => ({ ...createStudioGroup(id), id }))
  doc.layers = ['A', 'B', 'C', 'D'].map((id, index) => ({
    ...createTextLayer({ x: 0, y: 0, width: 80, height: 80 }),
    id,
    groupId: index < 2 ? 'first' : 'second'
  }))
  const up = dropStudioItem(
    doc,
    { kind: 'group', id: 'first' },
    { kind: 'group', id: 'second', position: 'before' }
  )
  assert.deepEqual(
    up.layers.map((layer) => layer.id),
    ['C', 'D', 'A', 'B']
  )
  const down = dropStudioItem(
    up,
    { kind: 'group', id: 'first' },
    { kind: 'group', id: 'second', position: 'after' }
  )
  assert.deepEqual(
    down.layers.map((layer) => layer.id),
    ['A', 'B', 'C', 'D']
  )
  const pastChild = dropStudioItem(
    up,
    { kind: 'group', id: 'first' },
    { kind: 'layer', id: 'D', position: 'after' }
  )
  assert.deepEqual(
    pastChild.layers.map((layer) => layer.id),
    ['A', 'B', 'C', 'D']
  )
})

const stackLabels = (doc) =>
  studioLayerRows(doc).map((row) => (row.kind === 'group' ? row.group.name : row.layer.name))

test('empty groups can be sorted against layers and populated groups and survive reload', () => {
  const doc = createStudioDocument()
  const empty = createStudioGroup('empty'),
    group = createStudioGroup('group')
  group.collapsed = true
  doc.groups = [empty, group]
  doc.layers = ['base', 'member', 'top'].map((name) => ({
    ...createTextLayer({ x: 0, y: 0, width: 80, height: 80 }),
    name
  }))
  doc.layers[1].groupId = group.id
  assert.deepEqual(stackLabels(doc), ['empty', 'top', 'group', 'base'])
  for (const [target, expected] of [
    [{ kind: 'group', id: group.id, position: 'before' }, ['top', 'empty', 'group', 'base']],
    [{ kind: 'group', id: group.id, position: 'after' }, ['top', 'group', 'empty', 'base']],
    [{ kind: 'layer', id: doc.layers[0].id, position: 'after' }, ['top', 'group', 'base', 'empty']],
    [{ kind: 'bottom' }, ['top', 'group', 'base', 'empty']]
  ]) {
    const next = dropStudioItem(doc, { kind: 'group', id: empty.id }, target)
    assert.deepEqual(stackLabels(next), expected)
    assert.deepEqual(stackLabels(readStudioDocument(JSON.parse(JSON.stringify(next)))), expected)
    assert.deepEqual(next.layers, doc.layers)
  }
  assert.equal(empty.stackIndex, undefined)
})

test('populated blocks retain the empty group boundary on either side of a drop', () => {
  const doc = createStudioDocument()
  const empty = createStudioGroup('empty'),
    group = createStudioGroup('group')
  group.collapsed = true
  doc.groups = [empty, group]
  doc.layers = ['base', 'one', 'two', 'top'].map((name) => ({
    ...createTextLayer({ x: 0, y: 0, width: 80, height: 80 }),
    name
  }))
  doc.layers[1].groupId = group.id
  doc.layers[2].groupId = group.id
  const movedEmpty = dropStudioItem(
    doc,
    { kind: 'group', id: empty.id },
    { kind: 'layer', id: doc.layers[0].id, position: 'before' }
  )
  for (const [position, expected] of [
    ['before', ['top', 'group', 'empty', 'base']],
    ['after', ['top', 'empty', 'group', 'base']]
  ]) {
    const next = dropStudioItem(
      movedEmpty,
      { kind: 'group', id: group.id },
      { kind: 'group', id: empty.id, position }
    )
    assert.deepEqual(stackLabels(next), expected)
    assert.deepEqual(
      next.layers.filter((layer) => layer.groupId === group.id).map((layer) => layer.name),
      ['one', 'two']
    )
  }
  const another = createStudioGroup('another')
  movedEmpty.groups.push(another)
  const bottom = dropStudioItem(movedEmpty, { kind: 'group', id: another.id }, { kind: 'bottom' })
  assert.equal(stackLabels(bottom).at(-1), 'another')
  const top = dropStudioItem(bottom, { kind: 'group', id: empty.id }, { kind: 'top' })
  assert.equal(stackLabels(top)[0], 'empty')
  empty.locked = true
  assert.deepEqual(dropStudioItem(doc, { kind: 'group', id: empty.id }, { kind: 'bottom' }), doc)
})

test('group translation moves hidden and rotated members together without changing relative geometry', () => {
  const doc = createStudioDocument(),
    group = createStudioGroup('group')
  doc.groups = [group]
  const outside = createTextLayer({ x: 10, y: 20, width: 80, height: 80 })
  const first = createImageLayer('/image.png', { x: 1.25, y: -3.5, width: 240, height: 180 })
  const hidden = createTextLayer({ x: 80.75, y: 44.5, width: 160, height: 60 })
  first.groupId = hidden.groupId = group.id
  first.rotation = 32
  hidden.visible = false
  doc.layers = [outside, first, hidden]
  const original = structuredClone(doc)
  const next = moveStudioGroup(doc, group.id, 12, -8)
  assert.equal(next.layers[0], outside)
  for (let index = 1; index < 3; index++) {
    assert.deepEqual(next.layers[index], {
      ...doc.layers[index],
      x: doc.layers[index].x + 12,
      y: doc.layers[index].y - 8
    })
  }
  assert.deepEqual(doc, original)
  const before = studioGroupBounds(doc, group.id),
    after = studioGroupBounds(next, group.id)
  assert.ok(Math.abs(after.x - before.x - 12) < 1e-9)
  assert.ok(Math.abs(after.y - before.y + 8) < 1e-9)
})

test('locked groups or members prevent partial group translation', () => {
  const doc = createStudioDocument(),
    group = createStudioGroup('group')
  doc.groups = [group]
  doc.layers = [
    createTextLayer({ x: 0, y: 0, width: 80, height: 80 }),
    createTextLayer({ x: 100, y: 100, width: 80, height: 80 })
  ]
  doc.layers.forEach((layer) => {
    layer.groupId = group.id
  })
  group.locked = true
  assert.equal(moveStudioGroup(doc, group.id, 10, 20), doc)
  group.locked = false
  doc.layers[1].locked = true
  assert.equal(moveStudioGroup(doc, group.id, 10, 20), doc)
  assert.equal(moveStudioGroup(doc, 'missing', 10, 20), doc)
  assert.equal(moveStudioGroup({ ...doc, layers: [] }, group.id, 10, 20).layers.length, 0)
})

test('a layer can leave its own group above, below, or at either list boundary', () => {
  const doc = createStudioDocument(),
    group = createStudioGroup('group')
  doc.groups = [group]
  doc.layers = ['A', 'B', 'C'].map((id) => ({
    ...createTextLayer({ x: 0, y: 0, width: 80, height: 80 }),
    id,
    groupId: group.id
  }))
  for (const target of [
    { kind: 'group', id: group.id, position: 'before' },
    { kind: 'group', id: group.id, position: 'after' },
    { kind: 'top' },
    { kind: 'bottom' }
  ]) {
    const moved = dropStudioItem(doc, { kind: 'layer', id: 'B' }, target)
    assert.equal(moved.layers.find((layer) => layer.id === 'B').groupId, undefined)
    assert.deepEqual(
      moved.layers.filter((layer) => layer.groupId).map((layer) => layer.id),
      ['A', 'C']
    )
    assert.equal(
      moved.layers[target.kind === 'top' || target.position === 'before' ? 2 : 0].id,
      'B'
    )
  }
  const inside = dropStudioItem(
    doc,
    { kind: 'layer', id: 'B' },
    { kind: 'group', id: group.id, position: 'inside' }
  )
  assert.equal(inside.layers.at(-1).groupId, group.id)
  group.locked = true
  assert.deepEqual(dropStudioItem(doc, { kind: 'layer', id: 'B' }, { kind: 'bottom' }), doc)
})

test('guide and editable mask strokes survive save and canvas scaling', () => {
  const doc = createStudioDocument()
  const guide = createGuideLayer({ x: 100, y: 200, width: 300, height: 120 })
  guide.prompt = 'edit this region'
  const mask = createMaskLayer(doc.width, doc.height)
  mask.strokes = [
    {
      mode: 'paint',
      size: 24,
      points: [
        { x: 0.2, y: 0.3 },
        { x: 0.3, y: 0.4 }
      ]
    },
    { mode: 'erase', size: 12, points: [{ x: 0.25, y: 0.35 }] }
  ]
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
  for (const [width, height] of [
    [6400, 4000],
    [12, 8]
  ]) {
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
