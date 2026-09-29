import assert from 'node:assert/strict'
import test from 'node:test'
import { reactive } from 'vue'
import {
  createStudioDocument,
  createImageLayer,
  createMaskLayer,
  createStudioGroup
} from '../../image-editor/model/imageStudioModel.ts'
import {
  createProductionDraft,
  createWorkspaceWork,
  createWorkspaceWorksRepository
} from './workspaceWorks.ts'
import { createWorkspaceDraftRepository } from './workspaceDraftRepository.ts'
import { prepareAIInput, installAIBranch, matchingAIBranches } from './aiProductionBranch.ts'
import { productionArtifacts } from './productionArtifacts.ts'
import { collectWorkUsedAssets } from './workspaceMaterialsPool.ts'

function fixture() {
  const entries = new Map()
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key)
  }
  const doc = createStudioDocument('旅行.jpg')
  doc.layers = [
    createImageLayer('/one.jpg', { x: 50, y: 80, width: 200, height: 300 }),
    createImageLayer('/two.jpg', { x: 600, y: 100, width: 200, height: 300 })
  ]
  const work = createWorkspaceWork('旅行', 'work')
  work.drafts = [createProductionDraft('image', doc.name, doc.id)]
  createWorkspaceDraftRepository('workspace', storage).save(doc, {
    version: 2,
    activeId: doc.id,
    docs: [doc]
  })
  const repo = createWorkspaceWorksRepository('workspace', storage)
  repo.save({ version: 2, activeId: 'work', works: [work] })
  return { storage, doc, work, repo }
}
test('multiple AI branches retain independent input snapshots, masks, scopes, and source versions', () => {
  const { storage, doc, repo } = fixture()
  const scope = { kind: 'layer', id: doc.layers[0].id }
  const mask = createMaskLayer(200, 300)
  mask.x = 50
  mask.y = 80
  mask.strokes = [{ mode: 'paint', size: 20, points: [{ x: 0.5, y: 0.5 }] }]
  doc.layers.push(mask)
  const original = JSON.stringify(doc)
  const prepared = prepareAIInput(reactive(doc), scope, 'content', [mask.id])
  assert.deepEqual(
    [prepared.width, prepared.height, prepared.layers[1].x, prepared.layers[1].y],
    [200, 300, 0, 0]
  )
  const first = installAIBranch(
    storage,
    'workspace',
    'work',
    doc,
    scope,
    'content',
    '图层一',
    'ai-1',
    'workspace-artifact:input-1',
    prepared,
    []
  )
  assert.equal(JSON.stringify(doc), original)
  const key = `omnigallery:ai-image-edit-v1:workspace:work:ai-1:${encodeURIComponent(first.source.inputPath)}`
  const saved = storage.getItem(key)
  doc.layers[0].zoom = 2
  doc.layers[2].strokes[0].size = 90
  const second = installAIBranch(
    storage,
    'workspace',
    'work',
    doc,
    scope,
    'content',
    '图层一',
    'ai-2',
    'workspace-artifact:input-2',
    prepareAIInput(doc, scope, 'content', []),
    []
  )
  assert.notEqual(first.source.revision, second.source.revision)
  assert.equal(storage.getItem(key), saved)
  assert.equal(JSON.parse(saved).layers[1].strokes[0].size, 20)
  const drafts = repo.load().works[0].drafts
  assert.equal(matchingAIBranches(drafts, doc.id, scope, 'content').length, 2)
  assert.equal(
    matchingAIBranches(drafts, doc.id, { kind: 'layer', id: doc.layers[1].id }, 'content').length,
    0
  )
  assert.equal(matchingAIBranches(drafts, doc.id, scope, 'canvas').length, 0)
  assert.deepEqual(drafts.find((draft) => draft.id === 'ai-1').source, first.source)
})
test('group scopes match by IDs, group input excludes unrelated images, and hidden snapshots never enter used materials', () => {
  const { storage, doc, repo } = fixture()
  const group = createStudioGroup('分组')
  doc.groups.push(group)
  doc.layers[0].groupId = group.id
  const groupedImage = createImageLayer('/grouped.jpg', {
    x: 100,
    y: 180,
    width: 200,
    height: 300
  })
  groupedImage.groupId = group.id
  doc.layers.push(groupedImage)
  const selected = { kind: 'group', id: group.id }
  const prepared = prepareAIInput(doc, selected, 'canvas', [])
  const ref = {
    path: 'workspace-artifact:ref-input',
    originalPath: '/reference.jpg',
    doc: prepared
  }
  const first = installAIBranch(
    storage,
    'workspace',
    'work',
    doc,
    selected,
    'canvas',
    '合成',
    'ai-1',
    'workspace-artifact:input',
    prepared,
    [ref]
  )
  group.name = '重命名分组'
  assert.equal(matchingAIBranches([first], doc.id, selected, 'canvas').length, 1)
  assert.equal(
    matchingAIBranches([first], doc.id, { kind: 'group', id: 'other' }, 'canvas').length,
    0
  )
  assert.deepEqual(first.source.inputPaths, ['/one.jpg', '/grouped.jpg'])
  assert.equal(prepareAIInput(doc, { kind: 'group', id: group.id }, 'content', []).layers.length, 2)
  const used = collectWorkUsedAssets('workspace', repo.load().works[0], storage, [])
  assert.deepEqual(
    new Set(used.map((item) => item.path)),
    new Set(['/one.jpg', '/two.jpg', '/grouped.jpg', '/reference.jpg'])
  )
  storage.setItem(
    `omnigallery:ai-image-refs-v1:workspace:work:ai-1:${encodeURIComponent(first.source.inputPath)}`,
    '[]'
  )
  assert.deepEqual(
    new Set(
      collectWorkUsedAssets('workspace', repo.load().works[0], storage, []).map((item) => item.path)
    ),
    new Set(['/one.jpg', '/two.jpg', '/grouped.jpg'])
  )
  const state = repo.load()
  state.works[0].drafts = state.works[0].drafts.filter((draft) => draft.kind !== 'image')
  repo.save(state)
  assert.equal(repo.load().works[0].drafts[0].source.inputPath, first.source.inputPath)
  assert.ok(
    storage.getItem(
      `omnigallery:ai-image-edit-v1:workspace:work:ai-1:${encodeURIComponent(first.source.inputPath)}`
    )
  )
})
test('artifacts have one owner, image cards aggregate derived branches and AI cards stay isolated', () => {
  const artifacts = [
    { id: 'export', workspace_id: 'ws', document_id: 'image', created_at: '1' },
    {
      id: 'ai1',
      workspace_id: 'ws',
      document_id: 'ai-1',
      lineage: { documentId: 'image' },
      created_at: '2'
    },
    {
      id: 'ai2',
      workspace_id: 'ws',
      document_id: 'ai-2',
      lineage: { documentId: 'image' },
      created_at: '3'
    },
    {
      id: 'other',
      workspace_id: 'else',
      document_id: 'ai-1',
      lineage: { documentId: 'image' },
      created_at: '4'
    },
    { id: 'input', workspace_id: 'ws', input_owner: 'ai-1', document_id: 'image', created_at: '5' }
  ]
  assert.deepEqual(
    productionArtifacts(artifacts, 'ws', 'image', 'image').map((item) => item.id),
    ['ai2', 'ai1', 'export']
  )
  assert.deepEqual(
    productionArtifacts(artifacts, 'ws', 'ai-1', 'ai').map((item) => item.id),
    ['ai1']
  )
})
