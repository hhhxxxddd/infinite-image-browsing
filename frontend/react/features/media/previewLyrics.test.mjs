import assert from 'node:assert/strict'
import test from 'node:test'
import { activeLyricAt } from './previewLyrics.ts'

test('lyrics follow seeks, exact boundaries and duplicate timestamps', () => {
  const lines = [{ time: 1 }, { time: 2.5 }, { time: 2.5 }, { time: 10 }]
  assert.deepEqual(
    [0, 1, 2.49, 2.5, 9.99, 10, 200, 1.5].map((time) => activeLyricAt(lines, time)),
    [-1, 0, 0, 2, 2, 3, 3, 0]
  )
  assert.equal(activeLyricAt([], 20), -1)
  assert.equal(activeLyricAt(lines, NaN), -1)
})

test('large lyric files use logarithmic time lookups', () => {
  let reads = 0
  const lines = Array.from({ length: 65536 }, (_, index) => ({
    get time() {
      reads++
      return index
    }
  }))
  assert.equal(activeLyricAt(lines, 42000.5), 42000)
  assert.ok(reads <= 17, `${reads} time reads`)
})
