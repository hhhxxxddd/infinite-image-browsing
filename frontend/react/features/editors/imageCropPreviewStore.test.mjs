import assert from 'node:assert/strict'
import test from 'node:test'
import { createImageCropPreview } from './imageCropPreviewStore.ts'

test('crop outline and dimension inputs share the latest gesture without changing its starting frame', () => {
  const store = createImageCropPreview()
  const original = { x: 0, y: 0, width: 200, height: 300 }
  const next = { x: 20, y: 30, width: 160, height: 240 }
  let dimensions
  const unsubscribe = store.subscribe(() => {
    const frame = store.frame(original)
    dimensions = [frame.width, frame.height]
  })
  store.publish(original, next)
  assert.equal(store.frame(original), next)
  assert.deepEqual(dimensions, [160, 240])
  assert.deepEqual(original, { x: 0, y: 0, width: 200, height: 300 })
  store.clear()
  assert.equal(store.frame(original), original)
  assert.deepEqual(dimensions, [200, 300])
  unsubscribe()
})

test('numeric input or a new layer replaces the gesture frame without inheriting old dimensions', () => {
  const store = createImageCropPreview()
  const original = { x: 0, y: 0, width: 200, height: 300 }
  store.publish(original, { x: 20, y: 30, width: 160, height: 240 })
  const entered = { x: 50, y: 30, width: 100, height: 240 }
  assert.equal(store.frame(entered), entered)
  assert.equal(store.frame({ ...original }).width, 200)
})
