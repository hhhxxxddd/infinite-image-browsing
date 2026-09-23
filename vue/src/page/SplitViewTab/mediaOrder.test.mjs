import test from 'node:test'
import assert from 'node:assert/strict'
import { applyMediaOrder, swapMediaInList } from './mediaOrder.ts'
const files = ['a', 'b', 'c', 'd', 'e'].map(fullpath => ({ fullpath }))
const paths = list => list.map(file => file.fullpath)

test('swaps two cards without changing other files or object identity', () => {
  const swapped = swapMediaInList(files, 'b', 'e')
  assert.deepEqual(paths(swapped), ['a', 'e', 'c', 'd', 'b'])
  assert.equal(swapped[1], files[4])
  assert.equal(swapped[4], files[1])
  assert.equal(swapped[2], files[2])
  assert.deepEqual(paths(files), ['a', 'b', 'c', 'd', 'e'])
})

test('local ordering survives pagination and rollback preserves newly loaded items', () => {
  const moved = paths(swapMediaInList(files, 'e', 'a'))
  const appended = [...files, { fullpath: 'f' }]
  assert.deepEqual(paths(applyMediaOrder(appended, moved)), ['e', 'b', 'c', 'd', 'a', 'f'])
  assert.deepEqual(paths(applyMediaOrder(appended, paths(files))), ['a', 'b', 'c', 'd', 'e', 'f'])
})

test('deleted files are not restored by rollback and reset uses server order', () => {
  const remaining = files.filter(file => file.fullpath !== 'b')
  assert.deepEqual(paths(applyMediaOrder(remaining, paths(files))), ['a', 'c', 'd', 'e'])
  assert.deepEqual(applyMediaOrder([...files].reverse(), []), [...files].reverse())
})

test('self-drop and missing cards leave the order untouched', () => {
  assert.deepEqual(swapMediaInList(files, 'a', 'a'), files)
  assert.deepEqual(swapMediaInList(files, 'a', 'missing'), files)
  assert.deepEqual(swapMediaInList(files, 'missing', 'a'), files)
})
