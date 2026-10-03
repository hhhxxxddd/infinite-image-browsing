import assert from 'node:assert/strict'
import test from 'node:test'
import { createImageTransformPreview } from './imageTransformPreviewStore.ts'
import {
  createStudioDocument,
  createImageLayer
} from '../../../src/features/image-editor/model/imageStudioModel.ts'

function fixture() {
  const original = {
    ...createStudioDocument('gesture'),
    layers: [createImageLayer('a.png'), createImageLayer('b.png')]
  }
  const next = {
    ...original,
    layers: original.layers.map((layer, index) =>
      index === 0 ? { ...layer, x: 45, y: 64, width: 552, height: 981, rotation: 30 } : layer
    )
  }
  return { original, next }
}

test('canvas and inspector see the same live transform without mutating the committed document', () => {
  const preview = createImageTransformPreview()
  const { original, next } = fixture()
  const before = structuredClone(original)
  let seen
  preview.subscribe(() => {
    seen = [preview.document(original), preview.layer(original.layers[0])]
  })
  preview.publish(original, next)
  assert.equal(seen[0], next)
  assert.equal(seen[1], next.layers[0])
  assert.deepEqual(original, before)
  assert.equal(preview.layer(original.layers[1]), original.layers[1])
})

test('cancel restores canvas and every geometry field together', () => {
  const preview = createImageTransformPreview()
  const { original, next } = fixture()
  preview.publish(original, next)
  preview.clear()
  assert.equal(preview.document(original), original)
  assert.equal(preview.layer(original.layers[0]), original.layers[0])
})

test('a committed or replaced document cannot pick up a stale gesture frame', () => {
  const preview = createImageTransformPreview()
  const { original, next } = fixture()
  preview.publish(original, next)
  const committed = { ...next, updatedAt: 'saved' }
  assert.equal(preview.document(committed), committed)
  assert.equal(preview.layer(committed.layers[0]), committed.layers[0])
  const restored = structuredClone(original)
  assert.equal(preview.document(restored), restored)
  assert.equal(preview.layer(restored.layers[0]), restored.layers[0])
})

test('the final pointer position remains available for one commit, and cleanup stops notifications', () => {
  const preview = createImageTransformPreview()
  const { original, next } = fixture()
  let notifications = 0
  const unsubscribe = preview.subscribe(() => notifications++)
  preview.publish(original, next)
  preview.publish(original, next)
  const last = {
    ...next,
    layers: next.layers.map((layer, index) => (index === 0 ? { ...layer, x: 46 } : layer))
  }
  preview.publish(original, last)
  assert.equal(preview.document(original), last)
  assert.equal(notifications, 2)
  unsubscribe()
  preview.clear()
  assert.equal(notifications, 2)
})
