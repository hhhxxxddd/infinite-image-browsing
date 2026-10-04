import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fitAIInputs, layoutAIInputs } from './aiInputBoardLayout.ts'

test('mixed image orientations preserve proportions and do not overlap across rows', () => {
  const inputs = [
    { width: 200, height: 300 },
    { width: 384, height: 160 },
    { width: 10000, height: 10 },
    { width: 10, height: 10000 },
    { width: 256, height: 256 }
  ]
  const frames = layoutAIInputs(inputs)
  for (let i = 0; i < frames.length; i++) {
    assert.ok(
      Math.abs(frames[i].width / frames[i].height - inputs[i].width / inputs[i].height) < 0.00001
    )
    for (let j = 0; j < i; j++) {
      const a = frames[i],
        b = frames[j]
      assert.ok(
        a.x >= b.x + b.width ||
          b.x >= a.x + a.width ||
          a.y >= b.y + b.height + 36 ||
          b.y >= a.y + a.height + 36
      )
    }
  }
})

test('fit includes all images, headers and the append slot in short and narrow viewports', () => {
  const frames = layoutAIInputs(
    Array.from({ length: 15 }, (_, i) => ({ width: i % 2 ? 384 : 200, height: i % 2 ? 160 : 300 }))
  )
  for (const [width, height] of [
    [1250, 380],
    [530, 280],
    [340, 240]
  ]) {
    const fit = fitAIInputs(frames, width, height)
    for (const frame of frames) {
      assert.ok(frame.x * fit.zoom + fit.x >= 0)
      assert.ok((frame.y - 36) * fit.zoom + fit.y >= 0)
      assert.ok((frame.x + frame.width) * fit.zoom + fit.x <= width)
      assert.ok((frame.y + frame.height) * fit.zoom + fit.y <= height)
    }
  }
})

test('fit respects images moved to negative coordinates without modifying their geometry', () => {
  const frames = [
    { x: -400, y: -300, width: 300, height: 280 },
    { x: 500, y: 100, width: 200, height: 150 }
  ]
  const before = structuredClone(frames)
  const fit = fitAIInputs(frames, 900, 400)
  assert.deepEqual(frames, before)
  assert.ok(fit.x + frames[0].x * fit.zoom >= 0)
  assert.ok(fit.y + (frames[0].y - 36) * fit.zoom >= 0)
  assert.ok(fit.x + 700 * fit.zoom <= 900)
  assert.ok(fit.y + 250 * fit.zoom <= 400)
})
