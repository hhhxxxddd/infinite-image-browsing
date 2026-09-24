import assert from 'node:assert/strict'
import test from 'node:test'
import { moveOpenView } from './tabOrder.ts'
import { parseTabLayout, serializeTabLayout } from './tabLayout.ts'

const pane = (key, path) => ({ key, type: 'local', name: path, path, mode: 'scanned-fixed' })
const empty = () => ({ key: 'new-empty', type: 'empty', name: '媒体库' })

test('tab order, closed tabs, and active tab survive a session round trip', () => {
  const tabs = [{ id: 'workspace', key: 'b', panes: [
    { key: 'home', type: 'empty', name: '媒体库', section: 'image' },
    pane('a', '/photos/a'), pane('b', '/photos/b'), pane('c', '/photos/c'),
  ] }]
  assert.equal(moveOpenView(tabs, 'c', 'a', 'before', empty), true)
  tabs[0].panes.splice(tabs[0].panes.findIndex(item => item.key === 'a'), 1)
  const restored = parseTabLayout(serializeTabLayout(tabs))
  assert.deepEqual(restored?.[0].panes.map(item => item.key), ['home', 'c', 'b'])
  assert.equal(restored?.[0].key, 'b')
  assert.equal(restored?.[0].panes[0].section, 'image')
  assert.equal(restored?.[0].panes[1].path, '/photos/c')
})

test('only serializable tab data is saved, including comparison and collection files', () => {
  const file = { fullpath: '/photo.jpg', name: 'photo.jpg', type: 'file', size: '1 MB', bytes: 1000, date: '', created_time: '', is_under_scanned_path: true, gen_info_raw: 'large transient prompt' }
  const tabs = [{ id: 'workspace', key: 'grid', panes: [
    { key: 'compare', type: 'img-sli', name: { vnode: true }, nameFallbackStr: '对比', left: file, right: file },
    { key: 'grid', type: 'grid-view', name: '集合', files: [{ ...file, tags: [{ name: '喜欢' }] }] },
  ] }]
  const serialized = serializeTabLayout(tabs)
  assert.equal(serialized.includes('large transient prompt'), false)
  assert.equal(serialized.includes('vnode'), false)
  const restored = parseTabLayout(serialized)
  assert.deepEqual(restored?.[0].panes.map(item => item.type), ['img-sli', 'grid-view'])
  assert.equal(restored?.[0].panes[1].files[0].tags[0].name, '喜欢')
})

test('invalid or obsolete saved layouts fall back safely', () => {
  assert.equal(parseTabLayout('{broken'), null)
  assert.equal(parseTabLayout('{"version":2,"tabs":[]}'), null)
  assert.equal(parseTabLayout('{"version":1,"tabs":[{"panes":[{"key":"x","type":"obsolete"}]}]}'), null)
})

test('workbench stays available after restoring open tabs', () => {
  const tabs = [{ id: 'main', key: 'desk', panes: [
    { key: 'home', type: 'empty', name: '媒体库', section: 'all' },
    { key: 'desk', type: 'workbench', name: '工作台' },
  ] }]
  const restored = parseTabLayout(serializeTabLayout(tabs))
  assert.equal(restored?.[0].key, 'desk')
  assert.equal(restored?.[0].panes[1].type, 'workbench')
})
