import test from 'node:test'
import assert from 'node:assert/strict'
import {
  distributeMasonry,
  layoutMasonry,
  mediaCardWidth,
  readSmallThumbnailWidth,
  masonryColumnCount,
  mediaCardRatio,
  minimumMediaCardHeight
} from './masonryModel.ts'

test('small width is the base for all sizes and older medium widths migrate once', () => {
  assert.equal(mediaCardWidth(176, 'small'), 176)
  assert.equal(mediaCardWidth(176, 'medium'), 246)
  assert.equal(mediaCardWidth(176, 'large'), 334)
  assert.equal(readSmallThumbnailWidth(undefined), 176)
  assert.equal(readSmallThumbnailWidth(undefined, 240), 176)
  assert.equal(readSmallThumbnailWidth(208, 240), 208)
  assert.equal(readSmallThumbnailWidth(1), 128)
  assert.equal(readSmallThumbnailWidth(2048), 512)
  assert.equal(readSmallThumbnailWidth('invalid'), 176)
})

test('resizing changes masonry columns only when another full card and gap fit', () => {
  assert.equal(masonryColumnCount(0, 280), 1)
  assert.equal(masonryColumnCount(863, 280), 2)
  assert.equal(masonryColumnCount(864, 280), 3)
  assert.equal(masonryColumnCount(938, 280), 3)
  assert.equal(masonryColumnCount(938 + 178, 280), 3)
  assert.equal(masonryColumnCount(1156, 280), 4)
  assert.equal(masonryColumnCount(864, 360), 2)
})

test('masonry resize preserves source order, fits its width and leaves gaps between cards', () => {
  const ratios = [1, 2, 0.5, 1.5, 1, 0.75, 2, 1]
  const layouts = [938, 1116, 1156, 280].map((width) => ({
    width,
    layout: layoutMasonry(ratios, width, 280, (ratio) => ratio)
  }))
  for (const { width, layout } of layouts) {
    assert.equal(layout.positions.length, ratios.length)
    for (const [index, position] of layout.positions.entries()) {
      assert.equal(
        position.height,
        Math.max(minimumMediaCardHeight, position.width / ratios[index])
      )
      assert.ok(position.left >= 0 && position.left + position.width <= width + 0.001)
      assert.ok(position.top + position.height <= layout.height + 0.001)
      for (const next of layout.positions.slice(index + 1)) {
        if (position.left !== next.left) continue
        assert.ok(next.top >= position.top + position.height + 12 - 0.001)
      }
    }
  }
  assert.deepEqual(
    layouts[0].layout.positions.map(({ left }) => left === 0),
    layouts[1].layout.positions.map(({ left }) => left === 0)
  )
  assert.deepEqual(
    layoutMasonry([], 938, 280, (ratio) => ratio),
    { height: 0, positions: [] }
  )
})

test('small and wide cards keep a usable minimum height without overlapping their next row', () => {
  const ratios = [2, 16 / 9, 1, 0.5, 2, 2, 1]
  for (const width of [128, 280, 420, 556]) {
    const { positions, height } = layoutMasonry(ratios, width, 128, (ratio) => ratio)
    for (const [index, card] of positions.entries()) {
      assert.ok(card.height >= 144)
      assert.equal(card.height, Math.max(144, card.width / ratios[index]))
      assert.ok(card.top + card.height <= height)
      for (const next of positions.slice(index + 1)) {
        if (card.left === next.left) assert.ok(next.top >= card.top + card.height + 12)
      }
    }
  }
})

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
