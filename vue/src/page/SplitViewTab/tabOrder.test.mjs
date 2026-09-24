import assert from 'node:assert/strict'
import test from 'node:test'
import { moveOpenView } from './tabOrder.ts'

const pane = key => ({key, type: 'local', name: key, path: '/' + key})
const workspace = () => [{id: 'one', key: 'a', panes: [pane('a'), pane('b'), pane('c')]}]
const empty = () => ({key: 'empty', type: 'empty', name: '媒体库'})

test('dragging a tab before or after another tab changes only its list position', () => {
  const tabs = workspace()
  assert.equal(moveOpenView(tabs, 'c', 'a', 'before', empty), true)
  assert.deepEqual(tabs[0].panes.map(item => item.key), ['c', 'a', 'b'])
  assert.equal(moveOpenView(tabs, 'c', 'b', 'after', empty), true)
  assert.deepEqual(tabs[0].panes.map(item => item.key), ['a', 'b', 'c'])
  assert.equal(tabs[0].key, 'a')
})

test('self-drop and missing source do not change tabs', () => {
  const tabs = workspace()
  assert.equal(moveOpenView(tabs, 'a', 'a', 'before', empty), false)
  assert.equal(moveOpenView(tabs, 'missing', 'b', 'after', empty), false)
  assert.deepEqual(tabs[0].panes.map(item => item.key), ['a', 'b', 'c'])
})

test('moving the only pane across workspaces leaves a usable source workspace', () => {
  const tabs = [
    {id: 'one', key: 'a', panes: [pane('a')]},
    {id: 'two', key: 'b', panes: [pane('b')]},
  ]
  assert.equal(moveOpenView(tabs, 'a', 'b', 'after', empty), true)
  assert.deepEqual(tabs[0].panes.map(item => item.key), ['empty'])
  assert.equal(tabs[0].key, 'empty')
  assert.deepEqual(tabs[1].panes.map(item => item.key), ['b', 'a'])
})
