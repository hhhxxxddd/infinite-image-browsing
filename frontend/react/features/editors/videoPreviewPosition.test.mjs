import assert from 'node:assert/strict'
import test from 'node:test'
import { videoPreviewActive, videoPreviewTime } from './videoPreviewPosition.ts'
import { previewSourceTime, evaluatedTransform } from './videoStudioModel.ts'

test('the exact whole-timeline end retains its final video frame and caption', () => {
  const video = { start: 0, duration: 4, sourceIn: 0, sourceDuration: 4, rate: 1 }
  const caption = { start: 3, duration: 1 }
  assert.equal(videoPreviewActive(video, 4, 4), true)
  assert.equal(videoPreviewActive(caption, 4, 4), true)
  const time = videoPreviewTime(4, 4, 30, [video, caption])
  assert.equal(time, 119 / 30)
  assert.ok(previewSourceTime(video, time, 30, 24) < 4)
  assert.ok(evaluatedTransform({ ...video, fadeOut: 1 }, time).opacity > 0)
})

test('a cursor beyond the end and real internal gaps stay empty', () => {
  const first = { start: 0, duration: 2 },
    last = { start: 3, duration: 1 }
  assert.equal(videoPreviewActive(last, 4.000001, 4), false)
  assert.equal(videoPreviewTime(4.000001, 4, 30), 4.000001)
  assert.equal(videoPreviewActive(first, 2, 4), false)
  assert.equal(videoPreviewActive(last, 2.5, 4), false)
  assert.equal(videoPreviewTime(2.5, 4, 30), 2.5)
})

test('an audio or subtitle tail does not resurrect an earlier video', () => {
  const video = { start: 0, duration: 3.999 },
    subtitle = { start: 3, duration: 1 }
  assert.equal(videoPreviewActive(video, 4, 4), false)
  assert.equal(videoPreviewActive(subtitle, 4, 4), true)
  assert.equal(videoPreviewActive(subtitle, 6, 6), false)
  assert.equal(videoPreviewActive({ start: 0, duration: 0 }, 0, 0), false)
})

test('non-frame duration uses the last output frame and never samples before a tiny final member', () => {
  assert.equal(videoPreviewTime(4.01, 4.01, 30), 4)
  const caption = { start: 4.005, duration: 0.005 }
  assert.equal(videoPreviewTime(4.01, 4.01, 30, [caption]), 4.005)
  const reverse = { start: 0, duration: 4, sourceIn: 2, sourceDuration: 10, rate: 1, reverse: true }
  assert.equal(previewSourceTime(reverse, videoPreviewTime(4, 4, 30), 30, 30), 2)
})
