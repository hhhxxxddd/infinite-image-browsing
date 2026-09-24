import assert from 'node:assert/strict'
import test from 'node:test'
import { addWorkspaceAssets, readWorkspaceRecords } from './workspaceModel.ts'

test('legacy type becomes a starting tool while keeping existing workspaces', () => {
  const [workspace] = readWorkspaceRecords({ version: 1, items: [{
    id: 'old', name: '旅行短片', kind: 'video', status: 'paused', updatedAt: '2026-09-24T00:00:00Z'
  }] })
  assert.equal(workspace.name, '旅行短片')
  assert.equal(workspace.lastTool, 'media')
  assert.equal(workspace.status, 'paused')
  assert.deepEqual(workspace.assets, [])
})

test('one workspace keeps source and output references without duplicating assets', () => {
  const file = { id: 4, path: '/media/a.jpg', name: 'a.jpg', kind: 'image' }
  const [workspace] = readWorkspaceRecords({ version: 2, items: [{
    id: 'new', name: '旅行九宫格', brief: '准备社媒发布', status: 'active',
    createdAt: '2026-09-24T00:00:00Z', updatedAt: '2026-09-24T00:00:00Z',
    lastTool: 'templates', assets: [file, file], outputs: [file], notes: { templates: '先排版' }
  }] })
  assert.equal(workspace.assets.length, 1)
  assert.equal(workspace.outputs.length, 1)
  assert.equal(workspace.notes.templates, '先排版')
  assert.equal(addWorkspaceAssets(workspace.assets, [file]).length, 1)
})
