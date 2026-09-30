import test from 'node:test'
import assert from 'node:assert/strict'
import { toggleMediaSelection } from './mediaSelection.ts'

test('ordinary card clicks accumulate selections and only toggle the clicked file', () => {
  const paths = ['a', 'b', 'c']
  const first = toggleMediaSelection(new Set(), paths, 'a')
  const second = toggleMediaSelection(first, paths, 'b')
  assert.deepEqual([...first], ['a'])
  assert.deepEqual([...second], ['a', 'b'])
  assert.deepEqual([...toggleMediaSelection(second, paths, 'a')], ['b'])
  assert.deepEqual([...toggleMediaSelection(second, paths, 'c')], ['a', 'b', 'c'])
})

test('Shift adds ranges in either direction without clearing other selections', () => {
  const paths = ['a', 'b', 'c', 'd', 'e']
  assert.deepEqual([...toggleMediaSelection(new Set(['e']), paths, 'c', 'a')].sort(), [
    'a',
    'b',
    'c',
    'e'
  ])
  assert.deepEqual([...toggleMediaSelection(new Set(['a']), paths, 'b', 'd')].sort(), [
    'a',
    'b',
    'c',
    'd'
  ])
})

test('range anchors follow files after sorting and missing anchors fall back to a toggle', () => {
  assert.deepEqual([...toggleMediaSelection(new Set(['b']), ['c', 'b', 'a'], 'a', 'b')], ['b', 'a'])
  assert.deepEqual(
    [...toggleMediaSelection(new Set(['b']), ['b', 'c'], 'c', 'removed')],
    ['b', 'c']
  )
  assert.deepEqual([...toggleMediaSelection(new Set(['b']), ['b', 'c'], 'removed')], ['b'])
})
