import test from 'node:test'
import assert from 'node:assert/strict'
import { applyMediaOrder, moveMediaInList, dropAfterCard } from './mediaOrder.ts'
const files = ['a', 'b', 'c', 'd', 'e'].map(fullpath => ({ fullpath }))
const paths = list => list.map(file => file.fullpath)

test('moves a selection immediately, preserving file identity and group order', () => {
  const moved = moveMediaInList(files, ['d', 'b'], 'e', true)
  assert.deepEqual(paths(moved), ['a', 'c', 'e', 'b', 'd'])
  assert.equal(moved[3], files[1])
  assert.equal(moved[4], files[3])
  assert.deepEqual(paths(files), ['a', 'b', 'c', 'd', 'e'])
})

test('local ordering survives pagination and rollback preserves newly loaded items', () => {
  const moved = paths(moveMediaInList(files, ['e'], 'a', false))
  const appended = [...files, { fullpath: 'f' }]
  assert.deepEqual(paths(applyMediaOrder(appended, moved)), ['e', 'a', 'b', 'c', 'd', 'f'])
  assert.deepEqual(paths(applyMediaOrder(appended, paths(files))), ['a', 'b', 'c', 'd', 'e', 'f'])
})

test('deleted files are not restored by rollback and reset uses server order', () => {
  const remaining = files.filter(file => file.fullpath !== 'b')
  assert.deepEqual(paths(applyMediaOrder(remaining, paths(files))), ['a', 'c', 'd', 'e'])
  assert.deepEqual(applyMediaOrder([...files].reverse(), []), [...files].reverse())
})

test('dropping within the selection or onto a missing card does nothing', () => {
  assert.deepEqual(moveMediaInList(files, ['a', 'b'], 'b', true), files)
  assert.deepEqual(moveMediaInList(files, ['a'], 'missing', false), files)
})

test('masonry insertion uses the upper and lower half of a card', () => {
  assert.equal(dropAfterCard(119, 100, 40), false)
  assert.equal(dropAfterCard(120, 100, 40), true)
  assert.equal(dropAfterCard(220, 100, 300), false)
  assert.equal(dropAfterCard(260, 100, 300), true)
})
