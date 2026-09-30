import assert from 'node:assert/strict'
import test from 'node:test'

import { previewSwipeDirection } from './previewGesture.ts'

test('short vertical swipes navigate in the legacy direction', () => {
  assert.equal(previewSwipeDirection({ x: 100, y: 200 }, { x: 105, y: 105 }, 800), 'next')
  assert.equal(previewSwipeDirection({ x: 100, y: 200 }, { x: 102, y: 300 }, 800), 'previous')
})

test('small or primarily horizontal gestures do not change media', () => {
  assert.equal(previewSwipeDirection({ x: 100, y: 200 }, { x: 101, y: 165 }, 800), null)
  assert.equal(previewSwipeDirection({ x: 100, y: 200 }, { x: 225, y: 105 }, 800), null)
})
