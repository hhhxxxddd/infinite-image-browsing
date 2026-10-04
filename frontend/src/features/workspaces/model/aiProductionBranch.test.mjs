import { createStudioVector } from '../../image-editor/model/imageStudioVectors.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
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
import {
  prepareAIInput,
  prepareAdvancedAIInput,
  workAIArtifacts,
  installAIBranch,
  matchingAIBranches
} from './aiProductionBranch.ts'
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
  const prepared = prepareAIInput(doc, scope, 'content', [mask.id])
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

test('advanced input contains only the selected image appearance, excludes canvas and annotations, and does not mutate source', () => {
  const { doc } = fixture()
  doc.background = '#ffffff'
  const image = doc.layers[0]
  image.x = -50
  image.y = 20
  image.rotation = 90
  image.opacity = 0.6
  image.crop = { x: 0.1, y: 0.2, width: 0.5, height: 0.7 }
  doc.layers.push(createMaskLayer(2000, 2000))
  const before = structuredClone(doc)
  const input = prepareAdvancedAIInput(doc, image.id)
  assert.equal(input.background, 'transparent')
  assert.equal(input.layers.length, 1)
  assert.deepEqual([input.width, input.height], [300, 200])
  assert.equal(input.layers[0].opacity, 0.6)
  assert.deepEqual(input.layers[0].crop, image.crop)
  assert.deepEqual(doc, before)
  assert.throws(() => prepareAdvancedAIInput(doc, 'missing'), /图片图层/)
  assert.throws(() => prepareAdvancedAIInput(doc, doc.layers[2].id), /图片图层/)
  image.locked = true
  assert.throws(() => prepareAdvancedAIInput(doc, image.id), /解锁/)
  image.locked = false
  image.visible = false
  assert.throws(() => prepareAdvancedAIInput(doc, image.id), /可见/)
})

test('advanced input retains parent clipping and opacity without painting frame fill or siblings', () => {
  const { doc } = fixture()
  const frame = createStudioVector('frame', 'ellipse', { x: 100, y: 100, width: 100, height: 100 })
  frame.fill = '#ff0000'
  frame.strokeWidth = 10
  frame.opacity = 0.5
  doc.layers.unshift(frame)
  const image = doc.layers[1]
  image.frameId = frame.id
  const input = prepareAdvancedAIInput(doc, image.id)
  assert.deepEqual([input.width, input.height], [100, 100])
  assert.deepEqual(
    input.layers.map((layer) => layer.id),
    [frame.id, image.id]
  )
  assert.equal(input.layers[0].fill, 'transparent')
  assert.equal(input.layers[0].strokeWidth, 0)
  assert.equal(input.layers[0].opacity, 0.5)
  assert.equal(input.layers[1].frameId, frame.id)
  assert.deepEqual([input.layers[1].x, input.layers[1].y], [-50, -20])
  frame.visible = false
  assert.throws(() => prepareAdvancedAIInput(doc, image.id), /可见/)
})

test('advanced large-image snapshots are bounded without changing aspect ratio', () => {
  const { doc } = fixture()
  Object.assign(doc.layers[0], { width: 8000, height: 4000, x: 0, y: 0 })
  const input = prepareAdvancedAIInput(doc, doc.layers[0].id)
  assert.deepEqual([input.width, input.height], [2048, 1024])
})

function addBranch(fixture, destination, id = 'ai-new', sourceWorkId = 'work') {
  const { storage, doc } = fixture
  return installAIBranch(
    storage,
    'workspace',
    sourceWorkId,
    doc,
    { kind: 'layer', id: doc.layers[0].id },
    'content',
    '图片',
    id,
    `workspace-artifact:input-${id}`,
    prepareAdvancedAIInput(doc, doc.layers[0].id),
    [],
    destination
  )
}

test('new and existing destination works own their AI sessions while provenance keeps the source document', () => {
  const f = fixture()
  const first = addBranch(f, { kind: 'new', workId: 'destination', name: ' AI 作品 ' })
  const second = addBranch(f, { kind: 'existing', workId: 'destination' }, 'ai-existing')
  const works = f.repo.load().works
  assert.equal(works.find((work) => work.id === 'work').drafts.length, 1)
  const target = works.find((work) => work.id === 'destination')
  assert.equal(target.name, 'AI 作品')
  assert.deepEqual(
    target.drafts.map((draft) => draft.id),
    [first.id, second.id]
  )
  assert.equal(target.activeDraftId, second.id)
  assert.equal(first.source.documentId, f.doc.id)
  assert.deepEqual(first.source.inputPaths, ['/one.jpg'])
  for (const draft of [first, second]) {
    assert.equal(
      f.storage.getItem(`omnigallery:ai-image-edit-asset-v1:workspace:destination:${draft.id}`),
      draft.source.inputPath
    )
    assert.equal(
      f.storage.getItem(`omnigallery:ai-image-edit-asset-v1:workspace:work:${draft.id}`),
      null
    )
  }
})

test('invalid or full destinations and incorrect source ownership do not leave branch storage behind', () => {
  const f = fixture()
  const state = f.repo.load()
  const full = createWorkspaceWork('已满', 'full')
  full.drafts = Array.from({ length: 200 }, (_, index) =>
    createProductionDraft('ai', `AI ${index}`, `full-${index}`)
  )
  state.works.push(full)
  f.repo.save(state)
  const saved = JSON.stringify(f.repo.load())
  for (const [target, error] of [
    [{ kind: 'existing', workId: 'gone' }, /目标作品已删除/],
    [{ kind: 'existing', workId: 'full' }, /制作文件数量/],
    [{ kind: 'new', workId: 'work', name: '重复' }, /目标作品已存在/],
    [{ kind: 'new', workId: 'new', name: '   ' }, /作品名称/]
  ]) {
    assert.throws(() => addBranch(f, target), error)
    assert.equal(JSON.stringify(f.repo.load()), saved)
  }
  assert.throws(
    () => addBranch(f, { kind: 'existing', workId: 'work' }, 'ai-new', 'full'),
    /来源制作文件/
  )
  assert.equal(f.storage.getItem('omnigallery:ai-image-edit-asset-v1:workspace:work:ai-new'), null)
  assert.equal(f.storage.getItem('omnigallery:ai-image-edit-asset-v1:workspace:full:ai-new'), null)
  for (let index = state.works.length; index < 200; index++)
    state.works.push(createWorkspaceWork(`作品${index}`, `work-${index}`))
  f.repo.save(state)
  assert.throws(() => addBranch(f, { kind: 'new', workId: 'overflow', name: '超限' }), /作品数量/)
  assert.equal(f.repo.load().works.length, 200)
})

test('work result list excludes private inputs, sibling works, other workspaces and non-AI artifacts', () => {
  const work = createWorkspaceWork('作品', 'work')
  work.drafts = [
    createProductionDraft('ai', 'AI', 'ai'),
    createProductionDraft('image', '图片', 'image')
  ]
  const base = {
    workspace_id: 'workspace',
    kind: 'image',
    source: 'ai_image_edit',
    document_id: 'ai'
  }
  const artifacts = [
    { ...base, id: 'old', created_at: '1' },
    { ...base, id: 'new', created_at: '2', source: 'ai_image_generation' },
    { ...base, id: 'input', input_owner: 'ai' },
    { ...base, id: 'other-work', document_id: 'other-ai', lineage: { documentId: 'image' } },
    { ...base, id: 'other-space', workspace_id: 'other' },
    { ...base, id: 'image', document_id: 'image', source: 'image_studio' },
    { ...base, id: 'video', kind: 'video' }
  ]
  assert.deepEqual(
    workAIArtifacts(artifacts, 'workspace', work).map((item) => item.id),
    ['new', 'old']
  )
  assert.deepEqual(workAIArtifacts(artifacts, 'workspace', undefined), [])
})
