import assert from 'node:assert/strict'
import test from 'node:test'
import { createAudioTimeline } from '../../../src/features/media-editor/model/audioTimeline.ts'
import { workspaceWorksKey } from '../../../src/features/workspaces/model/workspaceWorks.ts'
import {
  collectBrowserWorkspaceState,
  mapStorage,
  WorkspaceStateStore
} from '../../../src/features/workspaces/model/workspaceStateStore.ts'
import { emptyDocument } from './videoStudioModel.ts'
import { editorVersionsKey } from './editorVersionModel.ts'
import {
  editorRecoveryIndexKey,
  editorRecoveryRawKey,
  editorTimelineStorageKey,
  parseRecoveryDocument,
  readEditorRecoveries,
  recoverEditorDocument
} from './editorRecovery.ts'

function setup(kind = 'video', raw = ' {"version":999,"原始": "\n') {
  const request = {
    workspaceId: 'workspace',
    draftId: 'draft',
    kind,
    name: '制作文件',
    expectedRaw: raw,
    versionId: 'version-a',
    backupId: 'backup-a',
    createdAt: '2026-10-05T10:00:00.000Z'
  }
  const document = kind === 'audio' ? createAudioTimeline() : emptyDocument()
  const version = {
    id: request.versionId,
    name: '正常版本',
    kind,
    createdAt: request.createdAt,
    document
  }
  const entries = new Map([
    [
      workspaceWorksKey('workspace'),
      JSON.stringify({
        version: 2,
        activeId: 'work',
        works: [
          {
            id: 'work',
            name: '作品',
            drafts: [{ id: 'draft', kind, name: '制作文件' }],
            activeDraftId: 'draft'
          }
        ]
      })
    ],
    [editorTimelineStorageKey('workspace', 'draft', kind), raw],
    [editorVersionsKey('workspace', 'draft'), JSON.stringify({ version: 1, entries: [version] })]
  ])
  return {
    request,
    document,
    version,
    entries,
    storage: mapStorage(entries),
    timeline: editorTimelineStorageKey('workspace', 'draft', kind),
    index: editorRecoveryIndexKey('workspace', 'draft'),
    backup: editorRecoveryRawKey('workspace', 'draft', 'backup-a')
  }
}
for (const kind of ['audio', 'video'])
  test(`${kind} recovery retains the exact damaged original and restores a validated snapshot`, () => {
    const fixture = setup(kind)
    const history = fixture.storage.getItem(editorVersionsKey('workspace', 'draft'))
    const result = recoverEditorDocument(fixture.storage, fixture.request)
    assert.equal(fixture.storage.getItem(fixture.backup), fixture.request.expectedRaw)
    assert.deepEqual(
      parseRecoveryDocument(kind, fixture.storage.getItem(fixture.timeline)),
      fixture.document
    )
    assert.equal(fixture.storage.getItem(editorVersionsKey('workspace', 'draft')), history)
    const backups = readEditorRecoveries(fixture.storage.getItem(fixture.index))
    assert.equal(backups.length, 1)
    assert.equal(backups[0].bytes, Buffer.byteLength(fixture.request.expectedRaw))
    assert.equal(result.alreadyApplied, false)
    assert.equal(recoverEditorDocument(fixture.storage, fixture.request).alreadyApplied, true)
    assert.equal(readEditorRecoveries(fixture.storage.getItem(fixture.index)).length, 1)
  })

test('readonly, closed editor, foreign workspace, missing draft/version and wrong kind never write', () => {
  for (const patch of [
    { readonly: true },
    { isCurrent: () => false },
    { workspaceId: 'foreign' },
    { draftId: 'deleted' },
    { versionId: 'deleted' },
    { kind: 'audio' }
  ]) {
    const fixture = setup(),
      before = new Map(fixture.entries)
    assert.throws(() => recoverEditorDocument(fixture.storage, { ...fixture.request, ...patch }))
    assert.deepEqual(fixture.entries, before)
  }
})

test('stale errors, healthy current documents and invalid historical documents cannot overwrite data', () => {
  for (const scenario of ['changed', 'healthy', 'bad-history']) {
    const fixture = setup()
    if (scenario === 'changed') fixture.storage.setItem(fixture.timeline, 'new damaged content')
    if (scenario === 'healthy') {
      fixture.request.expectedRaw = JSON.stringify(fixture.document)
      fixture.storage.setItem(fixture.timeline, fixture.request.expectedRaw)
    }
    if (scenario === 'bad-history')
      fixture.storage.setItem(
        editorVersionsKey('workspace', 'draft'),
        JSON.stringify({
          version: 1,
          entries: [{ ...fixture.version, document: { version: 999 } }]
        })
      )
    const before = new Map(fixture.entries)
    assert.throws(() => recoverEditorDocument(fixture.storage, fixture.request))
    assert.deepEqual(fixture.entries, before)
  }
})

test('backup collisions and damaged indexes are preserved rather than reset', () => {
  for (const scenario of ['raw-exists', 'bad-index', 'foreign-key']) {
    const fixture = setup()
    if (scenario === 'raw-exists') fixture.storage.setItem(fixture.backup, 'older original')
    if (scenario === 'bad-index') fixture.storage.setItem(fixture.index, '{')
    if (scenario === 'foreign-key') fixture.request.backupId = '../foreign:index'
    const before = new Map(fixture.entries)
    assert.throws(() => recoverEditorDocument(fixture.storage, fixture.request))
    assert.deepEqual(fixture.entries, before)
  }
})

test('a local failure between backup and document writes rolls every staged key back', () => {
  const fixture = setup(),
    before = new Map(fixture.entries)
  let failed = false
  const storage = {
    ...fixture.storage,
    setItem(key, value) {
      if (key === fixture.timeline && !failed) {
        failed = true
        throw new Error('disk full')
      }
      fixture.storage.setItem(key, value)
    }
  }
  assert.throws(() => recoverEditorDocument(storage, fixture.request), /disk full/)
  assert.deepEqual(fixture.entries, before)
})

async function durableFixture(mode = 'success') {
  const fixture = setup()
  let snapshot = { revision: 1, imported: true, entries: Object.fromEntries(fixture.entries) }
  let saves = 0
  const patches = []
  const store = new WorkspaceStateStore({
    load: async () => structuredClone(snapshot),
    import: async () => {
      throw new Error('must not migrate')
    },
    remove: async () => {},
    save: async (revision, changes) => {
      saves++
      assert.equal(revision, snapshot.revision)
      patches.push(changes)
      if (mode === 'reject') throw new Error('offline')
      snapshot = {
        ...snapshot,
        revision: revision + 1,
        entries: { ...snapshot.entries, ...changes }
      }
      if (mode === 'unknown') throw new Error('reply lost')
      return { revision: snapshot.revision }
    }
  })
  await store.load(() => ({}), false)
  return {
    ...fixture,
    store,
    patches,
    get saves() {
      return saves
    },
    get snapshot() {
      return snapshot
    },
    setMode(value) {
      mode = value
    }
  }
}
test('remote rejection publishes no partial backup or timeline; a retry saves all three keys together', async () => {
  const fixture = await durableFixture('reject')
  await assert.rejects(
    fixture.store.transaction((storage) => recoverEditorDocument(storage, fixture.request)),
    /offline/
  )
  assert.equal(fixture.store.storage.getItem(fixture.backup), null)
  assert.equal(fixture.store.storage.getItem(fixture.timeline), fixture.request.expectedRaw)
  fixture.setMode('success')
  await fixture.store.transaction((storage) => recoverEditorDocument(storage, fixture.request))
  assert.deepEqual(
    Object.keys(fixture.patches.at(-1)).sort(),
    [fixture.backup, fixture.index, fixture.timeline].sort()
  )
  assert.equal(fixture.snapshot.entries[fixture.backup], fixture.request.expectedRaw)
})
test('an unknown response after a successful atomic write can be recognized without a second backup', async () => {
  const fixture = await durableFixture('unknown')
  await assert.rejects(
    fixture.store.transaction((storage) => recoverEditorDocument(storage, fixture.request)),
    /reply lost/
  )
  fixture.setMode('success')
  const retried = await fixture.store.transaction((storage) =>
    recoverEditorDocument(storage, fixture.request)
  )
  assert.equal(retried.alreadyApplied, true)
  assert.equal(fixture.saves, 1)
  assert.equal(fixture.store.storage.getItem(fixture.backup), fixture.request.expectedRaw)
})
test('switching or entering readonly before the queued transaction executes cancels recovery', async () => {
  const fixture = await durableFixture()
  let current = true
  const recovery = fixture.store.transaction((storage) =>
    recoverEditorDocument(storage, { ...fixture.request, isCurrent: () => current })
  )
  current = false
  await assert.rejects(recovery, /已切换/)
  assert.equal(fixture.saves, 0)
  assert.equal(fixture.store.storage.getItem(fixture.timeline), fixture.request.expectedRaw)
})
test('browser recovery backups use exact workspace boundaries', () => {
  const own = editorRecoveryRawKey('one', 'draft', 'backup'),
    other = editorRecoveryRawKey('one-other', 'draft', 'backup')
  const storage = mapStorage(
    new Map([
      [own, 'raw'],
      [other, 'foreign']
    ])
  )
  assert.deepEqual(collectBrowserWorkspaceState('one', storage), { [own]: 'raw' })
})
