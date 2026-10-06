import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseTimelineTime,
  formatTimelineTime,
  clampTimelineRange,
  clampTimelinePosition,
  timelinePointerTime,
  normalizeTimelineRange,
  setTimelineRangeEndpoint,
  nudgeTimelineTimeInput,
  timelineTimeInputText,
  resolveTimelineTimeInput
} from './timelineTime.ts'
test('precise time input accepts seconds or timecodes without ambiguous invalid minutes', () => {
  assert.equal(parseTimelineTime('1:02:03.125'), 3723.125)
  assert.equal(parseTimelineTime('90.5'), 90.5)
  assert.equal(parseTimelineTime('00:60'), undefined)
  assert.equal(parseTimelineTime(''), undefined)
  assert.equal(parseTimelineTime('-1'), undefined)
  assert.equal(formatTimelineTime(59.9999), '01:00.000')
})
test('reverse drags and bounds produce a normalized range', () => {
  assert.deepEqual(clampTimelineRange(12, -2, 10), { start: 0, end: 10 })
})

test('ruler dragging uses the latest scroll position before its mirrored transform updates', () => {
  const pointer = {
    clientX: 790,
    viewportLeft: 100,
    scrollLeft: 120,
    pixelsPerSecond: 60,
    duration: 60
  }
  const before = timelinePointerTime(pointer)
  assert.equal(before, 13.5)
  assert.equal(timelinePointerTime({ ...pointer, scrollLeft: 138 }), 13.8)
  assert.equal(timelinePointerTime({ ...pointer, clientX: 110, scrollLeft: 102 }), 112 / 60)
})

test('ruler pointer coordinates retain fractional scrolling and clamp at content boundaries', () => {
  const pointer = {
    clientX: 142.25,
    viewportLeft: 142,
    scrollLeft: 29.75,
    pixelsPerSecond: 30,
    duration: 10
  }
  assert.equal(timelinePointerTime(pointer), 1)
  assert.equal(timelinePointerTime({ ...pointer, clientX: 100, scrollLeft: 0 }), 0)
  assert.equal(timelinePointerTime({ ...pointer, clientX: 500 }), 10)
})

test('unset endpoints stay empty and differ from a zero-second in point', () => {
  assert.equal(timelineTimeInputText(null), '')
  assert.equal(timelineTimeInputText(0), '00:00.000')
  assert.equal(normalizeTimelineRange(null, 24), null)
  assert.deepEqual(setTimelineRangeEndpoint(null, 'start', 4.5, 24), { start: 4.5, end: 24 })
  assert.deepEqual(setTimelineRangeEndpoint(null, 'end', 7.25, 24), { start: 0, end: 7.25 })
  assert.deepEqual(setTimelineRangeEndpoint(null, 'start', 0, 24), { start: 0, end: 24 })
})

test('setting an endpoint across the other extends to a content boundary but rejects empty ranges', () => {
  const range = { start: 4, end: 8 }
  assert.deepEqual(setTimelineRangeEndpoint(range, 'start', 10, 24), { start: 10, end: 24 })
  assert.deepEqual(setTimelineRangeEndpoint(range, 'end', 2, 24), { start: 0, end: 2 })
  for (const [endpoint, value] of [
    ['start', 24],
    ['end', 0],
    ['start', -1],
    ['end', 25]
  ]) {
    assert.equal(setTimelineRangeEndpoint(range, endpoint, value, 24), undefined)
  }
  assert.equal(setTimelineRangeEndpoint(null, 'start', 0, 0), undefined)
})

test('shortening content clamps playhead and range; a wholly removed range becomes unset', () => {
  assert.equal(clampTimelinePosition(926.736, 24.0065), 24.0065)
  assert.deepEqual(normalizeTimelineRange({ start: 5, end: 926.736 }, 24.0065), {
    start: 5,
    end: 24.0065
  })
  assert.equal(normalizeTimelineRange({ start: 900, end: 926.736 }, 24.0065), null)
  assert.equal(normalizeTimelineRange({ start: 0, end: 4 }, 0), null)
  assert.equal(normalizeTimelineRange({ start: NaN, end: 4 }, 24), null)
  assert.equal(clampTimelinePosition(Infinity, 24), 0)
  assert.equal(clampTimelinePosition(4, NaN), 0)
})

test('enter and blur resolve typed times or clear range, while invalid input restores real values', () => {
  assert.deepEqual(resolveTimelineTimeInput('7.25', 5, 24), { valid: true, value: 7.25 })
  assert.deepEqual(resolveTimelineTimeInput('', 5, 24, { clearable: true }), {
    valid: true,
    value: null
  })
  assert.deepEqual(resolveTimelineTimeInput(' ', null, 24, { clearable: true }), {
    valid: true,
    value: null
  })
  for (const text of ['', 'oops', '-2', '25', '00:60', 'Infinity']) {
    assert.deepEqual(resolveTimelineTimeInput(text, 5, 24), { valid: false, value: 5 })
  }
  assert.deepEqual(resolveTimelineTimeInput('oops', null, 24, { clearable: true }), {
    valid: false,
    value: null
  })
})

test('escape cancels valid, invalid and empty drafts; confirming unchanged frame labels preserves precision', () => {
  for (const text of ['10', 'invalid', '']) {
    assert.deepEqual(resolveTimelineTimeInput(text, 7.25, 24, { clearable: true, cancel: true }), {
      valid: true,
      value: 7.25
    })
  }
  const exact = 1 / 30
  assert.deepEqual(resolveTimelineTimeInput(formatTimelineTime(exact), exact, 24), {
    valid: true,
    value: exact
  })
})

test('arrow keys start an unset endpoint at zero and retain exact frame steps through rounded labels', () => {
  assert.equal(nudgeTimelineTimeInput('', null, 24, 0.1), 0.1)
  assert.equal(nudgeTimelineTimeInput('', null, 24, -0.1), 0)
  assert.equal(nudgeTimelineTimeInput('invalid', 5, 24, 0.1), 5.1)
  assert.equal(nudgeTimelineTimeInput('24', 24, 24, 0.1), 24)
  let value = 0
  for (let index = 0; index < 30; index++) {
    value = nudgeTimelineTimeInput(formatTimelineTime(value), value, 24, 1 / 30)
  }
  assert.ok(Math.abs(value - 1) < 1e-9)
  assert.equal(formatTimelineTime(value), '00:01.000')
})
