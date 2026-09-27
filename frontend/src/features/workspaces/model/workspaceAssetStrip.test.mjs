import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mergeMaterialHistory,
  readMaterialHistory,
  writeMaterialHistory
} from './workspaceMaterialHistory.ts'
import {
  buildWorkspaceStrip,
  groupWorkspaceStrip,
  workspaceProductPaths,
  sliceWorkspaceStripGroups
} from './workspaceAssetStrip.ts'

const assets = ['other', 'main', 'reference', 'old-result', 'new-result'].map((path) => ({
  path,
  name: path,
  kind: 'image'
}))
const created = ['new-result', 'old-result']
const tasks = [
  { id: 'running', state: 'running' },
  { id: 'completed', state: 'completed' }
]
const keys = (items) =>
  items.map((item) => (item.kind === 'asset' ? item.asset.path : item.task.id))

test('editor and outer strip share product ordering and pagination across the source boundary', () => {
  const original = [...assets]
  const paths = workspaceProductPaths(assets, {
    'old-result': { workspace_artifact_id: 'old', created_time: '2026-09-27' },
    'new-result': { workspace_artifact_id: 'new', created_time: '2026-09-28' },
    other: { created_time: '2026-09-29' }
  })
  assert.deepEqual(paths, created)
  assert.deepEqual(assets, original)
  const groups = groupWorkspaceStrip(buildWorkspaceStrip(assets, [], [], [], paths), paths)
  assert.deepEqual(sliceWorkspaceStripGroups(groups, 0), [])
  assert.deepEqual(
    sliceWorkspaceStripGroups(groups, 2).map((group) => group.key),
    ['products']
  )
  assert.deepEqual(
    sliceWorkspaceStripGroups(groups, 3).map((group) => keys(group.items)),
    [['new-result', 'old-result'], ['other']]
  )
  assert.equal(groups[1].items.length, 3)
})

test('selected history precedes pending tasks and newest results, with no duplicate completed task', () => {
  assert.deepEqual(
    keys(buildWorkspaceStrip(assets, ['main', 'reference'], ['main', 'reference'], tasks, created)),
    ['main', 'reference', 'running', 'new-result', 'old-result', 'other']
  )
})

test('removing a role preserves position; assigning a created result promotes it ahead of tasks', () => {
  const history = ['main', 'reference']
  assert.deepEqual(
    keys(buildWorkspaceStrip(assets, history, ['main'], tasks, created)),
    keys(buildWorkspaceStrip(assets, history, ['main', 'reference'], tasks, created))
  )
  assert.deepEqual(
    keys(buildWorkspaceStrip(assets, ['new-result', ...history], ['new-result'], tasks, created)),
    ['new-result', 'main', 'reference', 'running', 'old-result', 'other']
  )
})

test('old creations remain ahead of unused library assets without task history; stale history is ignored', () => {
  assert.deepEqual(
    keys(buildWorkspaceStrip(assets, ['deleted', 'reference', 'reference'], ['main'], [], created)),
    ['reference', 'main', 'new-result', 'old-result', 'other']
  )
})

test('source groups keep a selected product among newest-first products and preserve reference history', () => {
  const items = buildWorkspaceStrip(
    assets,
    ['old-result', 'reference', 'main'],
    ['old-result'],
    tasks,
    created
  )
  const groups = groupWorkspaceStrip(items, created)
  assert.deepEqual(
    groups.map((group) => [group.key, group.assetCount, keys(group.items)]),
    [
      ['products', 2, ['running', 'new-result', 'old-result']],
      ['references', 3, ['reference', 'main', 'other']]
    ]
  )
  assert.equal(new Set(groups.flatMap((group) => keys(group.items))).size, items.length)
})

test('source groups omit empty origins and do not count pending tasks as finished products', () => {
  assert.deepEqual(groupWorkspaceStrip([], []), [])
  const refs = buildWorkspaceStrip(assets.slice(0, 1), [], [], [], [])
  assert.deepEqual(
    groupWorkspaceStrip(refs, []).map((group) => group.key),
    ['references']
  )
  const pending = groupWorkspaceStrip(buildWorkspaceStrip([], [], [], tasks, []), [])
  assert.equal(pending[0].key, 'products')
  assert.equal(pending[0].assetCount, 0)
  assert.deepEqual(keys(pending[0].items), ['running'])
})

test('used products and references stay first after removing layers or roles and after reopening', () => {
  let history = mergeMaterialHistory([], ['reference'])
  history = mergeMaterialHistory(history, ['old-result'])
  const storage = new Map()
  const adapter = {
    getItem: (key) => storage.get(key),
    setItem: (key, value) => storage.set(key, value)
  }
  writeMaterialHistory('workspace-a', history, adapter)
  const restored = readMaterialHistory('workspace-a', adapter)
  assert.deepEqual(readMaterialHistory('workspace-b', adapter), [])
  for (const selected of [['old-result', 'reference'], []]) {
    const groups = groupWorkspaceStrip(
      buildWorkspaceStrip(assets, restored, selected, tasks, created),
      created,
      restored
    )
    assert.deepEqual(
      groups.map((group) => [group.key, keys(group.items)]),
      [
        ['products', ['old-result', 'running', 'new-result']],
        ['references', ['reference', 'other', 'main']]
      ]
    )
  }
  const surviving = assets.filter((asset) => asset.path !== 'old-result')
  const groups = groupWorkspaceStrip(
    buildWorkspaceStrip(surviving, restored, [], [], created),
    created,
    restored
  )
  assert.deepEqual(keys(groups[0].items), ['new-result'])
  assert.deepEqual(keys(groups[1].items), ['reference', 'other', 'main'])
  assert.equal(new Set(groups.flatMap((group) => keys(group.items))).size, surviving.length)
})

test('material history tolerates invalid storage and deduplicates paths', () => {
  assert.deepEqual(readMaterialHistory('bad', { getItem: () => '{' }), [])
  assert.deepEqual(readMaterialHistory('mixed', { getItem: () => '[1,"a","a",""]' }), ['a'])
  assert.deepEqual(mergeMaterialHistory(['old', 'main'], ['main', 'new']), ['main', 'new', 'old'])
  assert.doesNotThrow(() =>
    writeMaterialHistory('full', ['a'], {
      setItem: () => {
        throw Error('quota')
      }
    })
  )
})
