import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createStudioDocument,
  createImageLayer,
  createTextLayer,
  readStudioDocument
} from './imageStudioModel.ts'
import {
  imageLayouts,
  comicLayouts,
  studioLayoutFrames,
  applyStudioFrames,
  capturePageTemplate,
  applyPageTemplate
} from './imageStudioLayouts.ts'

test('all eleven presets produce valid independently editable frames on small and 4K canvases', () => {
  for (const size of [
    { width: 180, height: 320 },
    { width: 3840, height: 2160 }
  ])
    for (const preset of [...imageLayouts, ...comicLayouts]) {
      const frames = studioLayoutFrames(size, preset.key)
      assert.ok(frames.length > 0)
      assert.equal(new Set(frames.map((f) => f.id)).size, frames.length)
      assert.ok(
        frames.every(
          (f) =>
            f.x >= 0 &&
            f.y >= 0 &&
            f.width > 0 &&
            f.height > 0 &&
            f.x + f.width <= size.width + 0.001 &&
            f.y + f.height <= size.height + 0.001
        )
      )
      assert.equal(
        readStudioDocument({ ...createStudioDocument(), ...size, layers: frames }).layers.length,
        frames.length
      )
    }
})
test('changing layout keeps original image IDs, crops, text, and excess images', () => {
  const doc = createStudioDocument()
  doc.layers = Array.from({ length: 5 }, (_, i) =>
    createImageLayer(`${i}.png`, { x: 0, y: 0, width: 200, height: 200 })
  )
  doc.layers.push(createTextLayer({ x: 40, y: 40, width: 200, height: 50 }, '对白'))
  const applied = applyStudioFrames(doc, studioLayoutFrames(doc, 'comic-hero'))
  assert.equal(applied.layers.filter((l) => l.frameId).length, 3)
  for (const original of doc.layers) assert.ok(applied.layers.some((l) => l.id === original.id))
  const changed = applyStudioFrames(applied, studioLayoutFrames(doc, 'comic-diagonal'))
  assert.equal(changed.layers.filter((l) => l.kind === 'frame').length, 2)
  assert.equal(changed.layers.filter((l) => l.frameId).length, 2)
  assert.deepEqual(
    changed.layers.find((l) => l.kind === 'text'),
    { ...doc.layers.at(-1), frameId: undefined }
  )
})
test('layout snapshots omit content, while page snapshots restore canvas and remap container IDs', () => {
  const doc = createStudioDocument()
  doc.layers = [createImageLayer('sample.png', { x: 0, y: 0, width: 400, height: 500 })]
  const applied = applyStudioFrames(doc, studioLayoutFrames(doc, 'grid-four'))
  const layout = capturePageTemplate(applied, 'layout')
  assert.equal(layout.layers.length, 4)
  const page = capturePageTemplate(applied, 'image')
  const target = { ...createStudioDocument(), width: 800, height: 1200 }
  const loaded = applyPageTemplate(target, { type: 'image', document: page })
  assert.equal(loaded.id, target.id)
  assert.equal(loaded.width, page.width)
  const image = loaded.layers.find((l) => l.kind === 'image')
  assert.ok(loaded.layers.some((f) => f.kind === 'frame' && f.id === image.frameId))
  assert.ok(loaded.layers.every((l) => !page.layers.some((p) => p.id === l.id)))
  const fitted = applyPageTemplate(target, { type: 'layout', document: layout })
  assert.equal(fitted.width, 800)
  assert.equal(fitted.height, 1200)
})
