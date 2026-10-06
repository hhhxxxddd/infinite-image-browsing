import test from 'node:test'
import assert from 'node:assert/strict'
import { timelineZoomAnchor } from './timelineZoom.ts'

const view = { viewportWidth: 700 }
const scrollFor = (anchor, zoom) => Math.max(0, anchor.time * zoom - anchor.offset)

test('without a chosen position toolbar zoom keeps its scroll and wheel zoom keeps its pointer anchor', () => {
  const options = { ...view, focusTime: null, previousZoom: 24, nextZoom: 48, scrollLeft: 120 }
  assert.equal(timelineZoomAnchor(options), null)
  const pointerAnchor = { time: 15, offset: 240 }
  assert.equal(timelineZoomAnchor({ ...options, pointerAnchor }), pointerAnchor)
})

test('repeated zoom steps progressively center the chosen time in the content viewport', () => {
  let zoom = 24
  let scrollLeft = 0
  let distance = 350 - 10 * zoom
  for (let step = 0; step < 10; step++) {
    const nextZoom = zoom * 1.4
    const anchor = timelineZoomAnchor({
      ...view,
      focusTime: 10,
      previousZoom: zoom,
      nextZoom,
      scrollLeft
    })
    scrollLeft = scrollFor(anchor, nextZoom)
    const offset = 10 * nextZoom - scrollLeft
    assert.equal(anchor.time, 10)
    assert.ok(Math.abs(offset - 350) < distance)
    assert.ok(offset >= 0 && offset <= 700)
    distance = Math.abs(offset - 350)
    zoom = nextZoom
  }
  assert.ok(distance < 4)
})

test('slider jumps and smaller steps converge to the same chosen position', () => {
  const initial = { ...view, focusTime: 50, previousZoom: 10, scrollLeft: 100 }
  const first = timelineZoomAnchor({ ...initial, nextZoom: 20 })
  const stepped = timelineZoomAnchor({
    ...initial,
    previousZoom: 20,
    nextZoom: 40,
    scrollLeft: scrollFor(first, 20)
  })
  const direct = timelineZoomAnchor({ ...initial, nextZoom: 40 })
  assert.deepEqual(stepped, direct)
})

test('a centered chosen position remains centered on zoom in and out', () => {
  for (const nextZoom of [10, 28, 80]) {
    const anchor = timelineZoomAnchor({
      ...view,
      focusTime: 50,
      previousZoom: 20,
      nextZoom,
      scrollLeft: 650
    })
    assert.equal(50 * nextZoom - scrollFor(anchor, nextZoom), 350)
  }
})

test('zooming brings a chosen position back into view after manual scrolling in either direction', () => {
  for (const scrollLeft of [0, 5000]) {
    const anchor = timelineZoomAnchor({
      ...view,
      focusTime: 50,
      previousZoom: 20,
      nextZoom: 28,
      scrollLeft
    })
    const offset = 50 * 28 - scrollFor(anchor, 28)
    assert.ok(offset > 0 && offset < 700)
  }
})

test('zero is a real chosen time and zoom out near the timeline start cannot require negative scrolling', () => {
  const zero = timelineZoomAnchor({
    ...view,
    focusTime: 0,
    previousZoom: 20,
    nextZoom: 40,
    scrollLeft: 0
  })
  assert.equal(zero.time, 0)
  assert.equal(scrollFor(zero, 40), 0)
  const early = timelineZoomAnchor({
    ...view,
    focusTime: 2,
    previousZoom: 20,
    nextZoom: 10,
    scrollLeft: 0
  })
  assert.equal(scrollFor(early, 10), 0)
})
