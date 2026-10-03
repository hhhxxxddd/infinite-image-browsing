import assert from 'node:assert/strict'
import test from 'node:test'
import { studioPreviewScale } from './imageStudioPreview.ts'

test('zoomed small documents draw vectors at screen pixels rather than stretching their native bitmap', () => {
  const doc = { width: 200, height: 300 }
  const display = { width: 600, height: 900 }
  assert.equal(studioPreviewScale(doc, display, 1), 3)
  assert.equal(studioPreviewScale(doc, display, 2), 6)
  assert.equal(studioPreviewScale(doc, display, NaN), 3)
  assert.equal(studioPreviewScale(doc, { width: 200, height: 300 }, 1), 1)
})

test('fitted 4K previews use their displayed density and very large zooms stay within the buffer budget', () => {
  const doc = { width: 3840, height: 2160 }
  assert.equal(studioPreviewScale(doc, { width: 960, height: 540 }, 2), 0.5)
  for (const size of [doc, { width: 16384, height: 16384 }, { width: 1, height: 16384 }]) {
    const scale = studioPreviewScale(size, { width: size.width * 4, height: size.height * 4 }, 3)
    assert.ok(Math.max(size.width, size.height) * scale <= 4096 + 1e-6)
    assert.ok(size.width * size.height * scale * scale <= 8 * 1024 * 1024 + 1e-6)
  }
})
