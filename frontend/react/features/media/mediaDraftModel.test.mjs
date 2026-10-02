import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mediaDraftTarget,
  mediaDraftWorkspaces,
  resolveMediaDraftWorkspace,
  saveMediaDraft
} from './mediaDraftModel.ts'
import {
  createWorkspaceWork,
  createWorkspaceWorksRepository,
  createWorkImageDraftRepository
} from '../../../src/features/workspaces/model/workspaceWorks.ts'
import {
  mapStorage,
  WorkspaceStateStore
} from '../../../src/features/workspaces/model/workspaceStateStore.ts'

const now = '2026-10-02T10:00:00.000Z'
const records = [
  resolveMediaDraftWorkspace([], { newId: 'one', name: '旅行' }, 'image', now).workspace,
  resolveMediaDraftWorkspace(
    [],
    { newId: 'two', name: '音乐' },
    'audio',
    '2026-10-01T10:00:00.000Z'
  ).workspace
]
const image = { path: '/media/photo.png', name: 'photo.png', kind: 'image', id: 42 }

test('the picker exposes existing workspaces without a current workspace or with a stale preference', () => {
  for (const remembered of ['', 'deleted']) {
    const result = mediaDraftWorkspaces({ version: 2, items: records }, remembered)
    assert.deepEqual(
      result.workspaces.map((item) => item.id),
      ['one', 'two']
    )
    assert.equal(result.preferredWorkspaceId, 'one')
  }
  assert.equal(
    mediaDraftWorkspaces({ version: 2, items: records }, 'two').preferredWorkspaceId,
    'two'
  )
  assert.deepEqual(mediaDraftWorkspaces(undefined, ''), {
    workspaces: [],
    preferredWorkspaceId: ''
  })
})

test('an empty workspace remains selectable and a foreign remembered work does not select it', () => {
  const empty = mediaDraftTarget(records[0], { version: 2, activeId: '', works: [] }, 'two:other')
  assert.deepEqual(empty.works, [])
  assert.equal(empty.preferredWorkId, '')
  const first = createWorkspaceWork('第一项', 'first')
  const second = createWorkspaceWork('第二项', 'second')
  const state = { version: 2, activeId: 'first', works: [first, second] }
  assert.equal(mediaDraftTarget(records[0], state, 'two:second').preferredWorkId, 'first')
  assert.equal(mediaDraftTarget(records[0], state, 'one:second').preferredWorkId, 'second')
})

test('new workspace creation preserves existing records and retry reuses its stable ID', () => {
  const destination = { newId: 'new-one', name: '  新的创作  ' }
  const created = resolveMediaDraftWorkspace(records, destination, 'video', now)
  assert.equal(created.created, true)
  assert.equal(created.workspace.name, '新的创作')
  assert.equal(created.workspace.lastTool, 'media')
  const next = [created.workspace, ...records]
  assert.equal(resolveMediaDraftWorkspace(next, destination, 'video', now).created, false)
  assert.equal(records.length, 2)
  assert.equal(
    resolveMediaDraftWorkspace(records, { id: 'two' }, 'image', now).workspace,
    records[1]
  )
  assert.throws(
    () => resolveMediaDraftWorkspace(records, { id: 'deleted' }, 'image', now),
    /已不存在/
  )
  assert.throws(
    () => resolveMediaDraftWorkspace(records, { newId: 'blank', name: ' ' }, 'image', now),
    /名称/
  )
  assert.throws(
    () =>
      resolveMediaDraftWorkspace(
        Array.from({ length: 100 }, (_, i) => ({ ...records[0], id: `ws-${i}` })),
        destination,
        'image',
        now
      ),
    /上限/
  )
})

test('creating a work in an empty workspace imports an editable image and selects the saved draft', () => {
  const storage = mapStorage(new Map())
  const id = saveMediaDraft(
    storage,
    'one',
    { newId: 'work', name: '图片作品' },
    image,
    '图片制作',
    'image-draft',
    { width: 1600, height: 800 }
  )
  assert.equal(id, 'work')
  const state = createWorkspaceWorksRepository('one', storage).load()
  assert.equal(state.activeId, 'work')
  assert.equal(state.works.length, 1)
  assert.equal(state.works[0].activeDraftId, 'image-draft')
  assert.deepEqual(state.works[0].assets, [image])
  assert.equal(state.works[0].drafts[0].kind, 'image')
  const document = createWorkImageDraftRepository('one', 'work', storage).loadDocument(
    'image-draft'
  )
  assert.equal(document.layers[0].path, image.path)
  assert.equal(document.layers[0].width, 810)
  assert.equal(document.layers[0].height, 405)
})

test('existing work imports preserve other works and deduplicate the media association', () => {
  const storage = mapStorage(new Map())
  const repository = createWorkspaceWorksRepository('two', storage)
  const other = createWorkspaceWork('保留的作品', 'other')
  repository.save({ version: 2, activeId: 'other', works: [other] })
  const audio = { path: '/media/music.wav', name: 'music.wav', kind: 'audio' }
  saveMediaDraft(storage, 'two', { newId: 'music', name: '音乐作品' }, audio, '制作一', 'draft-one')
  saveMediaDraft(storage, 'two', { id: 'music' }, audio, '制作二', 'draft-two')
  const state = repository.load()
  assert.deepEqual(state.works[0], other)
  assert.equal(state.activeId, 'music')
  assert.equal(state.works[1].assets.length, 1)
  assert.deepEqual(
    state.works[1].drafts.map((draft) => draft.id),
    ['draft-one', 'draft-two']
  )
  assert.equal(state.works[1].activeDraftId, 'draft-two')
  assert.equal(state.works[1].lastTool, 'media')
})

test('a missing existing work fails without silently creating another work', () => {
  const storage = mapStorage(new Map())
  assert.throws(
    () => saveMediaDraft(storage, 'one', { id: 'deleted' }, image, '制作', 'draft'),
    /已不存在/
  )
  assert.equal(storage.length, 0)
})

test('creating a draft in an existing work records recent usage without changing its creation date', () => {
  const storage = mapStorage(new Map())
  const repository = createWorkspaceWorksRepository('one', storage)
  const work = {
    ...createWorkspaceWork('已有作品', 'existing'),
    createdAt: '2025-01-01T00:00:00.000Z',
    lastOpenedAt: '2025-02-01T00:00:00.000Z'
  }
  repository.save({ version: 2, activeId: 'existing', works: [work] })
  const startedAt = Date.now()
  saveMediaDraft(storage, 'one', { id: 'existing' }, image, '新制作', 'new-draft')
  const saved = repository.load().works[0]
  assert.equal(saved.createdAt, work.createdAt)
  assert.ok(Date.parse(saved.lastOpenedAt) >= startedAt)
  assert.equal(saved.lastOpenedAt, saved.updatedAt)
  assert.equal(saved.activeDraftId, 'new-draft')
})

test('failed persistence rolls back a new work, its image document and the imported media', async () => {
  const store = new WorkspaceStateStore({
    load: async () => ({ revision: 1, imported: true, entries: {} }),
    import: async () => {
      throw new Error('unexpected import')
    },
    save: async () => {
      throw new Error('offline')
    },
    remove: async () => {}
  })
  await store.ensure(() => ({}))
  await assert.rejects(
    store.transaction((storage) =>
      saveMediaDraft(
        storage,
        'one',
        { newId: 'new-work', name: '作品' },
        image,
        '制作',
        'new-draft'
      )
    ),
    /offline/
  )
  assert.equal(store.storage.length, 0)
})
