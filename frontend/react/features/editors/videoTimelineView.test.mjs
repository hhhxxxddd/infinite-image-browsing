import test from 'node:test'
import assert from 'node:assert/strict'
import {
  videoRulerTicks,
  videoRulerStep,
  videoClipVisible,
  videoSoundActive
} from './videoTimelineView.ts'

test('six hour ruler draws only the scrolled viewport at full and fitted zoom', () => {
  for (const zoom of [0.04, 24, 64]) {
    const left = 18000 * zoom
    const ticks = videoRulerTicks(21600, zoom, left, 1600)
    assert.ok(ticks.length < 26)
    assert.ok(ticks.every((t) => t >= 0 && t <= 21600))
    assert.ok(ticks.some((t) => Math.abs(t - 18000) * zoom < 150))
  }
})

test('long intersecting clips are retained and distant clips omitted', () => {
  assert.equal(videoClipVisible(0, 21600, 24, 18000 * 24, 1600), true)
  assert.equal(videoClipVisible(0, 10, 24, 18000 * 24, 1600), false)
})

test('audio changes at boundaries without mounting both adjacent clips', () => {
  assert.equal(videoSoundActive(0, 10, 10), false)
  assert.equal(videoSoundActive(10, 10, 10), true)
})

test('frame ticks follow fps at close zoom; wide zoom changes to minutes without a huge tick array', () => {
  const frames = videoRulerTicks(10, 4096, 0, 1000, 30)
  assert.ok(Math.abs(frames[1] - 1 / 30) < 0.000001)
  const minutes = videoRulerTicks(21600, 0.04, 0, 1000, 30)
  assert.ok(minutes[1] >= 60)
  assert.ok(minutes.length < 30)
})

test('single-tick ruler after shortening content retains the zoom-based grid interval', () => {
  const zoom = 0.8
  const before = videoRulerTicks(926.736, zoom, 0, 900)
  const after = videoRulerTicks(24.0065, zoom, 0, 900)
  assert.deepEqual(after, [0])
  assert.equal(videoRulerStep(zoom), before[1] - before[0])
  assert.equal(videoRulerStep(zoom), 120)
  assert.ok(videoRulerStep(zoom) * zoom >= 72)
})

test('grid interval is stable with no visible ticks and stays legible at extreme zooms', () => {
  assert.deepEqual(videoRulerTicks(24, 0.8, 700, 900), [])
  for (const zoom of [0.00001, 0.04, 0.8, 24, 64, 4096]) {
    const step = videoRulerStep(zoom, 30)
    assert.ok(Number.isFinite(step) && step > 0)
    assert.ok(step * zoom >= 72)
  }
  assert.deepEqual(videoRulerTicks(24, 0, 0, 900), [])
  assert.deepEqual(videoRulerTicks(24, NaN, 0, 900), [])
})

test('audio ruler switches to subsecond ticks at close zoom and only draws the viewport', () => {
  assert.equal(videoRulerStep(1000), 0.1)
  const ticks = videoRulerTicks(86400, 1000, 72000000, 1200)
  assert.ok(ticks.length < 20)
  assert.ok(ticks.every((time) => time >= 72000 && time <= 72001.3))
})
