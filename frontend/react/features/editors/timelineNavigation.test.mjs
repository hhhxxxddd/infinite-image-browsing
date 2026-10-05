import test from 'node:test'
import assert from 'node:assert/strict'
import {
  timelineNavigationPoints,
  nextTimelinePoint,
  timelineSelectionRange,
  followTimelineViewport,
  locateTimelineSelection
} from './timelineNavigation.ts'
const clips = [
  { id: 'a', start: 0, duration: 4 },
  { id: 'b', start: 4, duration: 6 },
  { id: 'audio', start: 0, duration: 4 }
]

test('navigation deduplicates linked edit points, supports markers only, skips the current cut and never wraps', () => {
  const points = timelineNavigationPoints(clips, [{ time: 3 }, { time: 4 }, { time: NaN }])
  assert.deepEqual(points, [0, 3, 4, 10])
  assert.deepEqual(timelineNavigationPoints(clips, [{ time: 3 }], 'cuts'), [0, 4, 10])
  assert.deepEqual(timelineNavigationPoints(clips, [{ time: 3 }], 'markers'), [3])
  assert.equal(nextTimelinePoint(points, 4, 'next'), 10)
  assert.equal(nextTimelinePoint(points, 4, 'previous'), 3)
  assert.equal(nextTimelinePoint(points, 4 + 1e-7, 'previous'), 3)
  assert.equal(nextTimelinePoint(points, 10, 'next'), undefined)
  assert.equal(nextTimelinePoint(points, 0, 'previous'), undefined)
})

test('locating selection uses actual span and ignores stale ids', () => {
  assert.deepEqual(timelineSelectionRange(clips, ['b', 'audio', 'missing']), { start: 0, end: 10 })
  assert.equal(timelineSelectionRange(clips, ['missing']), null)
  assert.deepEqual(
    locateTimelineSelection(
      { start: 50, end: 54 },
      {
        pixelsPerSecond: 10,
        scrollLeft: 0,
        viewportWidth: 600,
        headerWidth: 100,
        contentDuration: 200
      }
    ),
    { playhead: 50, scrollLeft: 270 }
  )
  const long = locateTimelineSelection(
    { start: 50, end: 150 },
    { pixelsPerSecond: 10, scrollLeft: 0, viewportWidth: 600, headerWidth: 100 }
  )
  assert.equal(long.playhead, 50)
  assert.equal(long.scrollLeft, 475)
})

test('following keeps user view steady within the visible margin and clamps at both ends', () => {
  const view = {
    pixelsPerSecond: 10,
    scrollLeft: 100,
    viewportWidth: 600,
    headerWidth: 100,
    contentDuration: 200
  }
  assert.equal(followTimelineViewport({ ...view, position: 30 }), 100)
  assert.equal(followTimelineViewport({ ...view, position: 60 }), 175)
  assert.equal(followTimelineViewport({ ...view, position: 0 }), 0)
  assert.equal(followTimelineViewport({ ...view, position: 200 }), 1500)
  assert.equal(followTimelineViewport({ ...view, contentDuration: 24, position: 24 }), 0)
})

test('invalid data and zero-size viewports never create invalid navigation coordinates', () => {
  assert.deepEqual(
    timelineNavigationPoints([{ id: 'bad', start: 2, duration: -1 }], [{ time: -1 }]),
    []
  )
  assert.equal(nextTimelinePoint([2, 0, 1, NaN], 1, 'next'), 2)
  assert.equal(
    followTimelineViewport({
      position: 20,
      pixelsPerSecond: NaN,
      scrollLeft: Infinity,
      viewportWidth: NaN,
      contentDuration: NaN
    }),
    0
  )
  assert.ok(
    Number.isFinite(
      followTimelineViewport({ position: 20, pixelsPerSecond: 10, scrollLeft: 0, viewportWidth: 0 })
    )
  )
})
