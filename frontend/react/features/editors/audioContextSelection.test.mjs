import assert from 'node:assert/strict'
import test from 'node:test'
import { audioContextSelection } from './audioContextSelection.ts'

test('right clicking a selected item preserves the whole selection and primary item', () => {
  const primary = { kind: 'clip', id: 'a' }
  const items = ['a', 'b']
  const next = audioContextSelection(primary, items, items, 'clip', 'b')
  assert.equal(next.primary, primary)
  assert.equal(next.items, items)
})

test('a linked item also preserves the explicit selection', () => {
  const primary = { kind: 'clip', id: 'a' }
  const items = ['a']
  const next = audioContextSelection(primary, items, ['a', 'caption'], 'text-cue', 'caption')
  assert.equal(next.primary, primary)
  assert.equal(next.items, items)
})

test('right clicking an unselected item selects only that item', () => {
  assert.deepEqual(
    audioContextSelection({ kind: 'clip', id: 'a' }, ['a'], ['a'], 'text-cue', 'b'),
    {
      primary: { kind: 'cue', id: 'b' },
      items: ['b']
    }
  )
})

test('track and blank menus do not retain an unrelated clip selection', () => {
  const primary = { kind: 'clip', id: 'a' }
  assert.deepEqual(audioContextSelection(primary, ['a'], ['a'], 'track', 'track'), {
    primary: { kind: 'track', id: 'track' },
    items: []
  })
  assert.deepEqual(audioContextSelection(primary, ['a'], ['a'], 'blank'), {
    primary: null,
    items: []
  })
})
