import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createStudioDocument,
  createStudioGroup,
  createTextLayer,
  createImageLayer,
  studioLayerBounds,
  studioContentBounds,
  readStudioDocument
} from './imageStudioModel.ts'
import { captureTextTemplate, insertTextTemplate } from './imageTextTemplates.ts'
import { studioTextEffectDefaults } from './imageStudioTextEffects.ts'
import { templateAssetFile, templateAssetRoute } from '../../../shared/lib/templateAssets.ts'

function fixture() {
  const doc = createStudioDocument(),
    group = createStudioGroup('组合')
  const text = createTextLayer({ x: 300, y: -50, width: 400, height: 100 }, '标题')
  Object.assign(text, {
    groupId: group.id,
    rotation: -12,
    effects: structuredClone(studioTextEffectDefaults)
  })
  text.effects.shadow.enabled = true
  const image = createImageLayer('photo.png', { x: 200, y: 80, width: 500, height: 400 })
  image.groupId = group.id
  image.radius = 20
  doc.groups.push(group)
  doc.layers.push(createTextLayer({ x: 0, y: 0, width: 10, height: 10 }, '外部'), image, text)
  return { doc, group, text, image }
}

test('captures complete mixed group with independent effects, local coordinates and original order', () => {
  const { doc, group, text, image } = fixture()
  const before = structuredClone(doc)
  const captured = captureTextTemplate(doc, { groupId: group.id })
  assert.deepEqual(
    captured.layers.map((layer) => layer.id),
    [image.id, text.id]
  )
  assert.equal(captured.layers[1].x - captured.layers[0].x, text.x - image.x)
  assert.equal(captured.layers[1].rotation, text.rotation)
  const bounds = studioContentBounds(captured)
  assert.ok(bounds.x >= 0 && bounds.y >= 0)
  assert.ok(bounds.width <= captured.width && bounds.height <= captured.height)
  captured.layers[1].effects.shadow.distance = 123
  assert.deepEqual(doc, before)
})

test('single text qualifies and an image-only group does not', () => {
  const { doc, group, text } = fixture()
  const single = captureTextTemplate(doc, { layerId: text.id })
  assert.equal(single.layers.length, 1)
  assert.equal(single.layers[0].groupId, single.groups[0].id)
  doc.layers = doc.layers.filter((layer) => layer.kind === 'image')
  assert.throws(() => captureTextTemplate(doc, { groupId: group.id }), /文字图层/)
})

test('templates retain off-canvas text and effects, then fit their complete bounds on insertion', () => {
  for (const x of [920, -500]) {
    const doc = createStudioDocument()
    doc.width = 1000
    const text = createTextLayer({ x, y: -20, width: 300, height: 100 }, '标题')
    text.rotation = 20
    text.effects = structuredClone(studioTextEffectDefaults)
    text.effects.shadow.enabled = true
    doc.layers = [text]
    const originalBounds = studioLayerBounds(text)
    const saved = captureTextTemplate(doc, { layerId: text.id })
    assert.ok(saved.width >= originalBounds.width)
    assert.ok(saved.height >= originalBounds.height)
    const local = studioLayerBounds(saved.layers[0])
    assert.ok(local.x >= 0 && local.y >= 0)
    const target = { ...createStudioDocument(), width: 200, height: 200 }
    const inserted = insertTextTemplate(target, {
      type: 'text',
      payload_type: 'image-group-v1',
      name: '标题',
      document: saved
    }).document
    const bounds = studioLayerBounds(inserted.layers[0])
    assert.ok(bounds.x >= 0 && bounds.y >= 0)
    assert.ok(bounds.x + bounds.width <= 200 && bounds.y + bounds.height <= 200)
    // Normal image exports still respect their canvas boundary.
    const exportedBounds = studioContentBounds(doc)
    assert.ok(!exportedBounds || exportedBounds.x + exportedBounds.width <= doc.width)
  }
})

test('insertion scales effects and images uniformly, changes IDs, centers, and leaves the target intact', () => {
  const { doc, group } = fixture()
  const captured = captureTextTemplate(doc, { groupId: group.id })
  const template = {
    id: 'saved',
    name: '测试',
    type: 'text',
    payload_type: 'image-group-v1',
    document: captured
  }
  const target = createStudioDocument()
  target.width = 200
  target.height = 300
  target.layers.push(createTextLayer({ x: 3, y: 4, width: 20, height: 10 }, '原有'))
  const before = structuredClone(target),
    source = structuredClone(template)
  const first = insertTextTemplate(target, template),
    second = insertTextTemplate(target, template)
  assert.notEqual(first.groupId, second.groupId)
  assert.deepEqual(target, before)
  assert.deepEqual(template, source)
  assert.equal(first.document.width, 200)
  assert.equal(first.document.layers[0], target.layers[0])
  const image = first.document.layers[1],
    text = first.document.layers[2]
  const scale = image.width / captured.layers[0].width
  assert.equal(image.radius, 20 * scale)
  assert.equal(text.effects.shadow.distance, captured.layers[1].effects.shadow.distance * scale)
  assert.notEqual(text.id, captured.layers[1].id)
  assert.equal(text.groupId, first.groupId)
  const bounds = studioContentBounds({ ...first.document, layers: [image, text] })
  assert.ok(
    bounds.x >= 0 &&
      bounds.y >= 0 &&
      bounds.x + bounds.width <= 200 &&
      bounds.y + bounds.height <= 300
  )
  assert.equal(readStudioDocument(first.document).layers.length, 3)
})

test('opaque template material references reject traversal and do not require cached asset metadata', () => {
  const hash = 'a'.repeat(64)
  assert.equal(templateAssetRoute(`template-asset:${hash}`), `/template-assets/${hash}`)
  assert.equal(templateAssetFile(`template-asset:${hash}`).fullpath, `template-asset:${hash}`)
  assert.equal(
    templateAssetRoute(`template-library:builtin-caption:${hash}`),
    `/templates/builtin-caption/assets/${hash}`
  )
  assert.equal(templateAssetRoute('template-asset:../settings'), undefined)
  assert.equal(templateAssetRoute(`template-library:../escape:${hash}`), undefined)
})
