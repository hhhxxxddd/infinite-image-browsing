import assert from 'node:assert/strict'
import test from 'node:test'
import { createStudioDocument } from '../../image-editor/public/document.ts'
import { createImageLayer } from '../../image-editor/model/imageStudioModel.ts'
import { workspaceImageDocumentKey } from './workspaceDraftRepository.ts'
import { createWorkspaceWork, createProductionDraft } from './workspaceWorks.ts'
import { collectWorkspaceMaterials, collectWorkUsedAssets } from './workspaceMaterialsPool.ts'

const asset = (path, kind = 'image') => ({ path, kind, name: path.split('/').pop() })
function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  }
}
function saveImage(storage, draft, paths) {
  const doc = createStudioDocument(draft.name)
  doc.id = draft.id
  doc.layers = paths.map((path) =>
    createImageLayer(path, { x: 0, y: 0, width: 100, height: 100 }, path)
  )
  storage.setItem(workspaceImageDocumentKey('workspace', draft.id), JSON.stringify(doc))
}
test('shared workspace pool retains legacy references and outcomes from every work without duplicates', () => {
  const first = createWorkspaceWork('第一集'),
    second = createWorkspaceWork('第二集')
  first.assets = [asset('photo.jpg')]
  second.assets = [asset('voice.mp3', 'audio')]
  first.outputs = [asset('finished.png')]
  const created = [asset('workspace-artifact:output')]
  const pool = collectWorkspaceMaterials(
    { assets: [asset('photo.jpg')], outputs: [asset('old-result.mp4', 'video')] },
    [first, second],
    created
  )
  assert.deepEqual(
    pool.map((file) => file.path),
    ['photo.jpg', 'old-result.mp4', 'finished.png', 'voice.mp3', 'workspace-artifact:output']
  )
  assert.deepEqual(first.assets, [asset('photo.jpg')])
})
test('used material list traces real image layers across drafts and excludes unused pool, outputs and other works', () => {
  const storage = memoryStorage(),
    work = createWorkspaceWork('短剧')
  const first = createProductionDraft('image', '第一集分镜'),
    second = createProductionDraft('image', '第二集分镜')
  const other = createProductionDraft('image', '其他作品画布')
  work.drafts = [first, second]
  work.assets = [asset('unused.jpg')]
  work.outputs = [asset('finished.png')]
  saveImage(storage, first, ['sea.jpg', 'sea.jpg'])
  saveImage(storage, second, ['sea.jpg', 'workspace-artifact:input'])
  saveImage(storage, other, ['other.jpg'])
  const known = [{ ...asset('sea.jpg'), name: '海边参考' }, asset('finished.png')]
  const used = collectWorkUsedAssets('workspace', work, storage, known)
  assert.deepEqual(
    used.map((file) => file.path),
    ['sea.jpg', 'workspace-artifact:input']
  )
  assert.equal(used[0].name, '海边参考')
  assert.deepEqual(
    used[0].drafts.map((draft) => draft.id),
    [first.id, second.id]
  )
  assert.deepEqual(collectWorkUsedAssets('other-workspace', work, storage, known), [])
  saveImage(storage, first, [])
  saveImage(storage, second, [])
  assert.deepEqual(collectWorkUsedAssets('workspace', work, storage, known), [])
})
test('AI usage follows the current saved main image and reference list, excluding old inputs and other drafts', () => {
  const storage = memoryStorage(),
    work = createWorkspaceWork('短剧')
  const ai = createProductionDraft('ai', 'AI画面'),
    other = createProductionDraft('ai', '其他草稿')
  work.drafts = [ai]
  const scope = `workspace:${work.id}:${ai.id}`
  storage.setItem(`omnigallery:ai-image-edit-asset-v1:${scope}`, 'main.jpg')
  storage.setItem(`omnigallery:ai-image-edit-v1:${scope}:${encodeURIComponent('main.jpg')}`, '{}')
  storage.setItem(
    `omnigallery:ai-image-edit-v1:${scope}:${encodeURIComponent('previous.jpg')}`,
    '{}'
  )
  storage.setItem(
    `omnigallery:ai-image-refs-v1:${scope}:${encodeURIComponent('main.jpg')}`,
    JSON.stringify(['ref.jpg', 'ref.jpg'])
  )
  storage.setItem(
    `omnigallery:ai-image-edit-asset-v1:workspace:${work.id}:${other.id}`,
    'other.jpg'
  )
  const used = collectWorkUsedAssets('workspace', work, storage, [])
  assert.deepEqual(
    used.map((file) => file.path),
    ['main.jpg', 'ref.jpg']
  )
  storage.setItem(`omnigallery:ai-image-refs-v1:${scope}:${encodeURIComponent('main.jpg')}`, '[]')
  assert.deepEqual(
    collectWorkUsedAssets('workspace', work, storage, []).map((file) => file.path),
    ['main.jpg']
  )
  storage.setItem(
    `omnigallery:ai-image-refs-v1:${scope}:${encodeURIComponent('main.jpg')}`,
    'broken'
  )
  assert.deepEqual(
    collectWorkUsedAssets('workspace', work, storage, []).map((file) => file.path),
    ['main.jpg']
  )
})
