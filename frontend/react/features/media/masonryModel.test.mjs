import test from 'node:test'
import assert from 'node:assert/strict'
import { distributeMasonry, mediaCardRatio } from './masonryModel.ts'

test('media cards preserve natural aspect ratios with safe bounds', () => {
  assert.equal(mediaCardRatio({ name: 'landscape.jpg', width: 1600, height: 900 }), 1600 / 900)
  assert.equal(mediaCardRatio({ name: 'portrait.png', width: 200, height: 600 }), 0.5)
  assert.equal(mediaCardRatio({ name: 'clip.mp4' }), 16 / 9)
  assert.equal(mediaCardRatio({ name: 'song.mp3' }), 1)
})

test('masonry places each next card in the shortest column without losing source indices', () => {
  const items = [300, 100, 100, 300]
  const columns = distributeMasonry(items, 2, (height) => height)
  assert.deepEqual(
    columns.map((column) => column.map(({ index }) => index)),
    [[0], [1, 2, 3]]
  )
  assert.deepEqual(
    columns
      .flat()
      .map(({ item }) => item)
      .sort(),
    [...items].sort()
  )
})
