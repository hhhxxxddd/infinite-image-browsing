import test from 'node:test'
import assert from 'node:assert/strict'
import { layoutMasonry, masonryItemIndexAt, masonryScrollAnchor } from './masonryLayout.ts'

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

test('video stream dimensions place portrait and landscape clips at their actual aspect ratios', () => {
  const { positions } = layoutMasonry([
    { name: 'portrait.webm', width: 1080, height: 1920 },
    { name: 'landscape.mp4', width: 1920, height: 1080 },
  ], 2, 200)
  assert.deepEqual(positions.map(item => item.height), [356, 113])
})

test('measured dimensions override fallback sizes without changing source media', () => {
  const media = [{ fullpath: '/portrait.mp4', name: 'portrait.mp4' }]
  const measured = new Map([['/portrait.mp4', { width: 1080, height: 1920 }]])
  assert.equal(layoutMasonry(media, 1, 200).positions[0].height, 113)
  assert.equal(layoutMasonry(media, 1, 200, measured).positions[0].height, 356)
  assert.deepEqual(media, [{ fullpath: '/portrait.mp4', name: 'portrait.mp4' }])
})

test('resizing a mixed masonry grid keeps the visible item as the scroll anchor', () => {
  const media = [
    { name: 'portrait.jpg', width: 800, height: 1200 },
    { name: 'landscape.jpg', width: 1600, height: 900 },
    { name: 'square.jpg', width: 1000, height: 1000 },
    { name: 'another.jpg', width: 1600, height: 900 },
  ]
  const before = layoutMasonry(media, 2, 200)
  const after = layoutMasonry(media, 3, 120)
  const scrollTop = 150
  const anchor = masonryScrollAnchor(before.positions, scrollTop, before.maxItemHeight)
  assert.equal(anchor?.index, 2)
  const destination = after.positions[anchor.index]
  const nextScroll = Math.round(destination.top + (scrollTop - anchor.top) * destination.height / anchor.height)
  assert.equal(nextScroll, 16)
  assert.deepEqual(after.positions.map(position => position.index), [0, 1, 2, 3])
})
