import assert from 'node:assert/strict'
import test from 'node:test'
import { createStudioDocument } from '../../image-editor/public/document.ts'
import {
  createWorkspaceDraftRepository,
  workspaceImageDocumentKey,
  workspaceImageIndexKey
} from './workspaceDraftRepository.ts'
import {
  createWorkspaceWork,
  createProductionDraft,
  createWorkspaceWorksRepository,
  createWorkImageDraftRepository,
  readWorkspaceWorkState,
  reconcileImageDrafts,
  workspaceWorksKey,
  legacyWorkspaceWorksKey
} from './workspaceWorks.ts'
import {
  remapWorkspaceDrafts,
  removeWorkspaceAIDrafts,
  removeWorkspaceAssetDrafts
} from './workspaceReferences.ts'
import { collectWorkUsedAssets } from './workspaceMaterialsPool.ts'
function memoryStorage() {
  const values = new Map()
  return {
    get length() {
      return values.size
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  }
}
const stateFor = (...works) => ({ version: 2, activeId: works[0]?.id ?? '', works })
function saveImage(storage, workspace, doc) {
  const repo = createWorkspaceDraftRepository(workspace, storage)
  repo.save(doc, { version: 2, activeId: doc.id, docs: [...(repo.loadIndex()?.docs ?? []), doc] })
}
test('legacy typed works migrate into business works with drafts without rewriting image content or backup', () => {
  const storage = memoryStorage(),
    image = createStudioDocument('旧分镜')
  saveImage(storage, 'workspace', image)
  const old = {
    version: 1,
    activeId: image.id,
    works: [
      {
        id: image.id,
        kind: 'image',
        name: '短剧',
        brief: '业务目标',
        assets: [],
        outputs: [],
        lastTool: 'ai'
      }
    ]
  }
  storage.setItem(legacyWorkspaceWorksKey('workspace'), JSON.stringify(old))
  const repo = createWorkspaceWorksRepository('workspace', storage),
    result = repo.load()
  assert.equal(result.version, 2)
  assert.equal(result.works[0].name, '短剧')
  assert.equal(result.works[0].brief, '业务目标')
  assert.equal(result.works[0].drafts[0].name, '旧分镜')
  assert.equal('kind' in result.works[0], false)
  assert.deepEqual(
    createWorkspaceDraftRepository('workspace', storage).loadDocument(image.id),
    image
  )
  assert.equal(storage.getItem(workspaceWorksKey('workspace')), null)
  repo.save(result)
  assert.equal(storage.getItem(legacyWorkspaceWorksKey('workspace')), JSON.stringify(old))
  assert.deepEqual(repo.load(), result)
})
test('unassigned image documents are collected under one stable work without duplicate drafts', () => {
  const storage = memoryStorage(),
    image = createStudioDocument('一'),
    second = createStudioDocument('二')
  saveImage(storage, 'workspace', image)
  saveImage(storage, 'workspace', second)
  const repo = createWorkspaceWorksRepository('workspace', storage)
  assert.equal(repo.load().works.length, 1)
  assert.equal(repo.load().works[0].drafts.length, 2)
  repo.save(repo.load())
  assert.equal(repo.load().works[0].drafts.length, 2)
})
test('one business work restores mixed drafts, references and selection independently by workspace', () => {
  const storage = memoryStorage(),
    work = createWorkspaceWork('某某短剧')
  work.drafts = ['video', 'audio', 'ai'].map((kind) => createProductionDraft(kind, kind))
  work.activeDraftId = work.drafts[1].id
  work.assets = ['image', 'video', 'audio'].map((kind) => ({
    path: `C:/${kind}.file`,
    name: kind,
    kind
  }))
  work.outputs = [...work.assets]
  const repo = createWorkspaceWorksRepository('first', storage)
  repo.save(stateFor(work))
  createWorkspaceWorksRepository('second', storage).save(stateFor(createWorkspaceWork('另一作品')))
  assert.deepEqual(repo.load().works[0], work)
  assert.notEqual(createWorkspaceWorksRepository('second', storage).load().activeId, work.id)
  repo.clear()
  assert.equal(createWorkspaceWorksRepository('second', storage).load().works.length, 1)
})
test('renaming or deleting a draft never renames or deletes its business work', () => {
  const work = createWorkspaceWork('短剧'),
    draft = createProductionDraft('image', '分镜')
  work.drafts = [draft]
  work.activeDraftId = draft.id
  const renamed = reconcileImageDrafts(stateFor(work), [
    { id: draft.id, name: '第二版分镜', updatedAt: '2030' }
  ])
  assert.equal(renamed.works[0].name, '短剧')
  assert.equal(renamed.works[0].drafts[0].name, '第二版分镜')
  const deleted = reconcileImageDrafts(renamed, [])
  assert.equal(deleted.works.length, 1)
  assert.equal(deleted.works[0].drafts.length, 0)
  assert.equal(deleted.works[0].activeDraftId, '')
})
test('image editor repository keeps other work drafts isolated through creation, rename and deletion', () => {
  const storage = memoryStorage(),
    first = createWorkspaceWork('第一作品'),
    second = createWorkspaceWork('第二作品')
  const works = createWorkspaceWorksRepository('workspace', storage)
  works.save(stateFor(first, second))
  const repo1 = createWorkImageDraftRepository('workspace', first.id, storage),
    repo2 = createWorkImageDraftRepository('workspace', second.id, storage)
  const a = createStudioDocument('A'),
    b = createStudioDocument('B')
  repo1.save(a, { version: 2, activeId: a.id, docs: [a] })
  repo2.save(b, { version: 2, activeId: b.id, docs: [b] })
  assert.deepEqual(
    repo1.loadIndex().docs.map((doc) => doc.id),
    [a.id]
  )
  assert.equal(repo1.loadDocument(b.id), undefined)
  a.name = 'A更新'
  repo1.save(a, { version: 2, activeId: a.id, docs: [a] })
  assert.equal(works.load().works.find((work) => work.id === first.id).name, first.name)
  assert.equal(repo2.loadDocument(b.id).name, 'B')
  const mixed = works.load()
  const owner = mixed.works.find((work) => work.id === first.id)
  owner.drafts.push(createProductionDraft('video', '剪辑'), createProductionDraft('ai', '加工'))
  works.save(mixed)
  const order = owner.drafts.map((draft) => draft.id)
  repo1.save(a, { version: 2, activeId: a.id, docs: [a] })
  assert.deepEqual(
    works
      .load()
      .works.find((work) => work.id === first.id)
      .drafts.map((draft) => draft.id),
    order
  )
  repo1.remove(a.id)
  assert.equal(works.load().works.length, 2)
  assert.equal(repo1.loadIndex().docs.length, 0)
  assert.equal(repo2.loadIndex().docs.length, 1)
  assert.throws(() => repo1.save(b, { version: 2, activeId: b.id, docs: [b] }), /其他作品/)
})
test('failed image/work transaction restores the canonical document and both indexes', () => {
  const storage = memoryStorage(),
    work = createWorkspaceWork('作品')
  createWorkspaceWorksRepository('workspace', storage).save(stateFor(work))
  const before = storage.getItem(workspaceWorksKey('workspace')),
    image = createStudioDocument('图片')
  let failed = false
  const failing = {
    ...storage,
    setItem(key, value) {
      if (key === workspaceWorksKey('workspace') && !failed) {
        failed = true
        throw new Error('full')
      }
      storage.setItem(key, value)
    }
  }
  assert.throws(
    () =>
      createWorkImageDraftRepository('workspace', work.id, failing).save(image, {
        version: 2,
        activeId: image.id,
        docs: [image]
      }),
    /full/
  )
  assert.equal(storage.getItem(workspaceWorksKey('workspace')), before)
  assert.equal(storage.getItem(workspaceImageDocumentKey('workspace', image.id)), null)
  assert.equal(storage.getItem(workspaceImageIndexKey('workspace')), null)
})

test('a shared workspace restores more than 100 image drafts across works without truncation', () => {
  const storage = memoryStorage(),
    first = createWorkspaceWork('第一作品'),
    second = createWorkspaceWork('第二作品')
  const works = createWorkspaceWorksRepository('workspace', storage)
  works.save(stateFor(first, second))
  for (const work of [first, second]) {
    const repo = createWorkImageDraftRepository('workspace', work.id, storage)
    for (let index = 0; index < 51; index++) {
      const doc = createStudioDocument(`${work.name}-${index}`)
      repo.save(doc, { version: 2, activeId: doc.id, docs: [doc] })
    }
  }
  assert.equal(createWorkspaceDraftRepository('workspace', storage).loadIndex().docs.length, 102)
  const restored = works.load()
  assert.deepEqual(
    restored.works.map((work) => work.drafts.length),
    [51, 51]
  )
  for (const work of restored.works) {
    const repo = createWorkImageDraftRepository('workspace', work.id, storage)
    assert.equal(repo.loadIndex().docs.length, 51)
    assert.equal(repo.loadDocument(work.drafts.at(-1).id).name, `${work.name}-50`)
  }
})

test('saving an old editor session preserves other window additions and renames, and does not resurrect deletions', () => {
  const storage = memoryStorage(),
    work = createWorkspaceWork('作品')
  const works = createWorkspaceWorksRepository('workspace', storage)
  works.save(stateFor(work))
  const session = createWorkImageDraftRepository('workspace', work.id, storage)
  const other = createWorkImageDraftRepository('workspace', work.id, storage)
  const first = createStudioDocument('第一张'),
    second = createStudioDocument('第二张')
  session.save(first, { version: 2, activeId: first.id, docs: [first] })
  const staleIndex = session.loadIndex()
  other.save(second, { version: 2, activeId: second.id, docs: [first, second] })
  second.name = '其他窗口已重命名'
  other.save(second, { version: 2, activeId: second.id, docs: [first, second] })
  session.save(first, staleIndex)
  assert.equal(session.loadIndex().docs[1].name, second.name)
  assert.equal(works.load().works[0].drafts.length, 2)
  const beforeDelete = session.loadIndex()
  other.remove(second.id)
  session.save(first, beforeDelete)
  assert.deepEqual(
    session.loadIndex().docs.map((doc) => doc.id),
    [first.id]
  )
  assert.equal(session.loadDocument(second.id), undefined)
  other.remove(first.id)
  assert.throws(() => session.save(first, staleIndex), /已删除/)
  assert.equal(works.load().works[0].drafts.length, 0)
})

test('foreign entries in the supplied index cannot transfer ownership or overwrite other draft types', () => {
  const storage = memoryStorage(),
    first = createWorkspaceWork('一'),
    second = createWorkspaceWork('二')
  const audio = createProductionDraft('audio', '音频')
  first.drafts = [audio]
  const works = createWorkspaceWorksRepository('workspace', storage)
  works.save(stateFor(first, second))
  const repo = createWorkImageDraftRepository('workspace', first.id, storage)
  const foreign = createStudioDocument('其他作品图片')
  createWorkImageDraftRepository('workspace', second.id, storage).save(foreign, {
    version: 2,
    activeId: foreign.id,
    docs: [foreign]
  })
  const own = createStudioDocument('自己的图片')
  const before = storage.getItem(workspaceWorksKey('workspace'))
  assert.throws(
    () => repo.save(own, { version: 2, activeId: own.id, docs: [own, foreign] }),
    /其他作品/
  )
  own.id = audio.id
  assert.throws(() => repo.save(own, { version: 2, activeId: own.id, docs: [own] }), /制作类型/)
  assert.equal(storage.getItem(workspaceWorksKey('workspace')), before)
})
test('image layer usage is derived without persisting a second work material pool', () => {
  const storage = memoryStorage(),
    work = createWorkspaceWork('短剧'),
    doc = createStudioDocument('分镜')
  doc.layers = [
    {
      kind: 'image',
      id: 'layer',
      name: '自定义',
      path: 'C:/source/photo.png',
      x: 0,
      y: 0,
      width: 100,
      height: 100
    }
  ]
  createWorkspaceWorksRepository('workspace', storage).save(stateFor(work))
  createWorkImageDraftRepository('workspace', work.id, storage).save(doc, {
    version: 2,
    activeId: doc.id,
    docs: [doc]
  })
  const loaded = createWorkspaceWorksRepository('workspace', storage).load().works[0]
  assert.deepEqual(loaded.assets, [])
  const used = collectWorkUsedAssets('workspace', loaded, storage, [])
  assert.equal(used[0].name, 'photo.png')
  assert.deepEqual(used[0].drafts, [{ id: doc.id, name: doc.name }])
})
test('duplicate draft ownership and invalid selection are sanitized', () => {
  const first = createWorkspaceWork('一'),
    second = createWorkspaceWork('二'),
    draft = createProductionDraft('audio', '旁白')
  first.drafts = [draft]
  second.drafts = [draft]
  second.activeDraftId = draft.id
  const state = readWorkspaceWorkState({ ...stateFor(first, second), activeId: 'invalid' })
  assert.equal(state.works[1].drafts.length, 0)
  assert.equal(state.works[1].activeDraftId, '')
  assert.equal(state.activeId, '')
})
test('path remapping supports mixed business materials and scoped AI drafts without rewriting goals', () => {
  const storage = memoryStorage(),
    work = createWorkspaceWork('短剧'),
    oldPath = 'C:/old/voice.wav',
    newPath = 'C:/new/voice.wav'
  work.assets = [{ path: oldPath, name: 'voice.wav', kind: 'audio' }]
  work.outputs = [...work.assets]
  work.brief = oldPath
  const repo = createWorkspaceWorksRepository('workspace', storage)
  repo.save(stateFor(work))
  const key = `omnigallery:ai-image-edit-v1:workspace:${work.id}:draft:${encodeURIComponent(oldPath)}`
  storage.setItem(key, JSON.stringify({ path: oldPath }))
  remapWorkspaceDrafts(storage, new Map([[oldPath, newPath]]))
  assert.equal(repo.load().works[0].outputs[0].path, newPath)
  assert.equal(repo.load().works[0].brief, oldPath)
  assert.equal(storage.getItem(key), null)
  assert.equal(
    JSON.parse(
      storage.getItem(key.replace(encodeURIComponent(oldPath), encodeURIComponent(newPath)))
    ).path,
    newPath
  )
})
test('AI cleanup is limited to the chosen business draft or deleted asset across scopes', () => {
  const storage = memoryStorage(),
    path = 'C:/photo.png',
    prefix = 'omnigallery:ai-image-edit-asset-v1:'
  storage.setItem(`${prefix}workspace:work:first`, path)
  storage.setItem(`${prefix}workspace:work:second`, path)
  storage.setItem(`${prefix}workspace-other:work:first`, path)
  removeWorkspaceAIDrafts(storage, 'workspace:work:first')
  assert.equal(storage.getItem(`${prefix}workspace:work:first`), null)
  assert.equal(storage.getItem(`${prefix}workspace:work:second`), path)
  removeWorkspaceAssetDrafts(storage, 'workspace', path)
  assert.equal(storage.getItem(`${prefix}workspace:work:second`), null)
  assert.equal(storage.getItem(`${prefix}workspace-other:work:first`), path)
})
test('corrupt storage cannot silently overwrite works', () => {
  const storage = memoryStorage()
  storage.setItem(workspaceWorksKey('workspace'), '{invalid')
  assert.throws(() => createWorkspaceWorksRepository('workspace', storage).load())
  assert.equal(storage.getItem(workspaceWorksKey('workspace')), '{invalid')
})
