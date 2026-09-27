import assert from 'node:assert/strict'
import test from 'node:test'
import { buildWorkspaceStrip } from './workspaceAssetStrip.ts'

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
