import assert from 'node:assert/strict'
import test from 'node:test'
import { createImageDraft, imageRects, readImageDraft } from './imageCreationModel.ts'

test('all nine cells stay inside a small canvas with wide gaps', () => {
  const rects = imageRects({ layout: 'grid-nine', width: 320, height: 320, padding: 80, gap: 160 })
  assert.equal(rects.length, 9)
  assert.ok(rects.every(rect => rect.width > 0 && rect.height > 0 && rect.x >= 0 && rect.y >= 0
    && rect.x + rect.width <= 320 && rect.y + rect.height <= 320))
})

test('six panel layout makes two rows of three cells', () => {
  const rects = imageRects({ layout: 'grid-six', width: 1200, height: 800, padding: 20, gap: 10 })
  assert.equal(rects.length, 6)
  assert.equal(rects[0].y, rects[1].y)
  assert.ok(rects[3].y > rects[0].y)
})

test('draft keeps hidden cells when switching layouts and bounds saved values', () => {
  const draft = createImageDraft()
  draft.slots[3].path = '/media/fourth.jpg'
  const restored = readImageDraft({ ...draft, layout: 'single', width: 9000, background: 'bad' })
  assert.equal(restored.slots[3].path, '/media/fourth.jpg')
  assert.equal(restored.width, 4096)
  assert.equal(restored.background, '#ffffff')
  assert.equal(imageRects(restored).length, 1)
})
