import test from 'node:test'
import assert from 'node:assert/strict'
import { layoutMasonry, masonryItemIndexAt } from './masonryLayout.ts'

test('mixed orientations fill the shortest column without overlapping', () => {
  const media = [
    { name: 'portrait.jpg', width: 800, height: 1200 },
    { name: 'landscape.jpg', width: 1600, height: 900 },
    { name: 'square.jpg', width: 1000, height: 1000 },
    { name: 'another.jpg', width: 1600, height: 900 },
  ]
  const { positions, totalHeight } = layoutMasonry(media, 2, 200)
  assert.deepEqual(positions.map(({ left, top, height }) => [left, top, height]), [
    [8, 8, 300], [224, 8, 113], [224, 137, 200], [8, 324, 113],
  ])
  assert.equal(totalHeight, 453)
  assert.equal(masonryItemIndexAt(positions, 138), 2)
})

test('invalid or unavailable dimensions use bounded fallback heights', () => {
  const { positions } = layoutMasonry([
    { name: 'unknown.png', width: 0, height: 0 },
    { name: 'wide.mp4' },
    { name: 'extreme.jpg', width: 100, height: 2000 },
  ], 1, 200)
  assert.deepEqual(positions.map(item => item.height), [267, 113, 400])
})
