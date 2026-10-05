import test from 'node:test'
import assert from 'node:assert/strict'
import {
  editorTaskActions,
  canRemoveEditorTaskRecord,
  editorTaskDeleteUrl,
  editorTaskRequests,
  exportEditorTasks,
  filterEditorTasks,
  imageEditorTasks,
  imageToolEditorTasks,
  mergeEditorTasks,
  videoProxyEditorTasks
} from './editorTaskModel.ts'

const ai = (extra = {}) => ({
  id: 'ai-1',
  workspace_id: 'workspace-1',
  document_id: 'image-1',
  name: '修改图片',
  state: 'running',
  error: '',
  artifact_id: '',
  created_at: 30,
  ...extra
})
const exportTask = (extra = {}) => ({
  id: 'export-1',
  workspace_id: 'workspace-1',
  document_id: 'video-1',
  document_revision: 'revision',
  name: '成片',
  state: 'running',
  phase: 'rendering',
  progress: 25,
  error: '',
  created_at: 20,
  updated_at: 21,
  artifact: null,
  ...extra
})
const job = (extra = {}) => ({
  id: 'tool-1',
  document_key: 'key-1',
  layer_id: 'layer-1',
  layer_name: '照片',
  source_revision: 'revision',
  state: 'running',
  source: { path: 'source', width: 10, height: 10 },
  handled: false,
  error: '',
  created_at: 10,
  tool_id: 'image-upscale',
  ...extra
})
const scope = {
  workspaceId: 'workspace-1',
  documentId: 'video-1',
  workDocumentIds: ['video-1', 'image-1'],
  scope: 'document'
}
const actions = {
  readonly: false,
  documentId: 'video-1',
  exportKind: 'video',
  canRetryExport: true,
  canCancelTool: true
}

test('media task requests use only the real document key and never fake workspace identity', () => {
  for (const workspaceId of ['', 'media-image', 'workspace-1']) {
    assert.deepEqual(
      editorTaskRequests({ workspaceId, mediaPath: 'E:\\照片.png', documentKey: 'key with & ?' }),
      [{ source: 'image-tools', url: '/image-ai-tools/tasks?document_key=key+with+%26+%3F' }]
    )
  }
  assert.deepEqual(editorTaskRequests({ workspaceId: '' }), [])
  assert.deepEqual(editorTaskRequests({ workspaceId: 'media-image' }), [])
  assert.equal(editorTaskRequests({ workspaceId: 'workspace-1' }).length, 3)
})

test('a video editor can view mixed task types in its work while excluding another workspace', () => {
  const tasks = mergeEditorTasks(
    imageEditorTasks([ai(), ai({ id: 'other', workspace_id: 'workspace-2' })]),
    exportEditorTasks([exportTask()], 'video'),
    exportEditorTasks([exportTask({ id: 'sound', document_id: 'audio-1' })], 'audio')
  )
  assert.deepEqual(
    filterEditorTasks(tasks, scope).map((task) => task.id),
    ['export-1']
  )
  assert.deepEqual(
    filterEditorTasks(tasks, { ...scope, scope: 'work' }).map((task) => task.id),
    ['ai-1', 'export-1']
  )
  assert.deepEqual(
    filterEditorTasks(tasks, { ...scope, scope: 'workspace' }).map((task) => task.id),
    ['ai-1', 'sound', 'export-1']
  )
  assert.equal(filterEditorTasks(tasks, { ...scope, scope: 'workspace', kind: 'ai' }).length, 1)
})

test('status filtering distinguishes active, complete and interrupted or cancelled tasks', () => {
  const tasks = imageEditorTasks([
    ai(),
    ai({ id: 'done', state: 'completed' }),
    ai({ id: 'lost', state: 'interrupted' }),
    ai({ id: 'cancel', state: 'cancelled' }),
    ai({ id: 'fail', state: 'failed' })
  ])
  const filter = { ...scope, documentId: 'image-1' }
  assert.deepEqual(
    filterEditorTasks(tasks, { ...filter, status: 'active' }).map((task) => task.id),
    ['ai-1']
  )
  assert.deepEqual(
    filterEditorTasks(tasks, { ...filter, status: 'completed' }).map((task) => task.id),
    ['done']
  )
  assert.deepEqual(
    filterEditorTasks(tasks, { ...filter, status: 'exception' }).map((task) => task.id),
    ['lost', 'cancel', 'fail']
  )
})

test('resume is available only for recoverable AI tracking, never failed export or generation', () => {
  assert.deepEqual(
    editorTaskActions(
      imageEditorTasks([ai({ state: 'interrupted', resumable: true })])[0],
      actions
    ),
    ['resume', 'cancel']
  )
  assert.deepEqual(editorTaskActions(imageEditorTasks([ai({ state: 'failed' })])[0], actions), [])
  assert.deepEqual(
    editorTaskActions(
      exportEditorTasks([exportTask({ state: 'interrupted' })], 'video')[0],
      actions
    ),
    ['retry-export']
  )
})

test('export retry uses only the current document and export adapter, and readonly has no mutations', () => {
  const task = exportEditorTasks([exportTask({ state: 'failed' })], 'video')[0]
  assert.deepEqual(editorTaskActions(task, actions), ['retry-export'])
  assert.deepEqual(editorTaskActions(task, { ...actions, documentId: 'different' }), [])
  assert.deepEqual(editorTaskActions(task, { ...actions, exportKind: 'audio' }), [])
  assert.deepEqual(editorTaskActions(task, { ...actions, canRetryExport: false }), [])
  assert.deepEqual(
    editorTaskActions(imageEditorTasks([ai()])[0], { ...actions, readonly: true }),
    []
  )
})

test('already requested AI cancellation cannot be sent twice', () => {
  assert.deepEqual(
    editorTaskActions(imageEditorTasks([ai({ cancel_requested: true })])[0], actions),
    []
  )
})

test('export results require matching media kind, workspace and document before preview', () => {
  const artifact = {
    id: 'artifact',
    name: '成片.mp4',
    kind: 'video',
    workspace_id: 'workspace-1',
    document_id: 'video-1'
  }
  const task = exportTask({ state: 'completed', artifact })
  assert.equal(exportEditorTasks([task], 'video')[0].results.length, 1)
  for (const change of [{ kind: 'audio' }, { workspace_id: 'other' }, { document_id: 'other' }])
    assert.equal(
      exportEditorTasks([{ ...task, artifact: { ...artifact, ...change } }], 'video')[0].results
        .length,
      0
    )
  assert.equal(exportEditorTasks([{ ...task, state: 'running' }], 'video')[0].results.length, 0)
})

test('media image processing keeps managed result paths and does not create artifact identity', () => {
  const tasks = imageToolEditorTasks(
    [
      job({
        state: 'completed',
        result: { path: 'editor-asset:' + 'a'.repeat(64), width: 20, height: 20 }
      }),
      job({ id: 'other', document_key: 'other' }),
      job({ id: 'cancel', state: 'canceled' })
    ],
    { workspaceId: '', documentId: 'media-doc', documentKey: 'key-1' }
  )
  assert.equal(tasks.length, 2)
  assert.equal(tasks[0].results[0].artifactId, undefined)
  assert.match(tasks[0].results[0].path, /^editor-asset:/)
  assert.equal(tasks[1].state, 'cancelled')
  assert.equal(
    filterEditorTasks(tasks, {
      workspaceId: '',
      documentId: 'media-doc',
      workDocumentIds: [],
      scope: 'document'
    }).length,
    2
  )
  const active = imageToolEditorTasks([job()], {
    workspaceId: '',
    documentId: 'media-doc',
    documentKey: 'key-1'
  })[0]
  assert.deepEqual(editorTaskActions(active, { ...actions, canCancelTool: false }), [])
  assert.deepEqual(editorTaskActions(active, actions), ['cancel'])
})

test('source-qualified task ids do not collide and live hook state replaces older fetched records', () => {
  const fetched = exportEditorTasks([exportTask()], 'video')
  const live = exportEditorTasks([exportTask({ state: 'cancelled' })], 'video')
  const mixed = mergeEditorTasks(fetched, exportEditorTasks([exportTask()], 'audio'), live)
  assert.equal(mixed.length, 2)
  assert.equal(mixed.find((task) => task.source === 'video-export').state, 'cancelled')
  assert.equal(exportEditorTasks([exportTask({ progress: Infinity })], 'video')[0].progress, 0)
})

test('video preview proxy states are session processing tasks, never exported artifact results', () => {
  const jobs = [
    { id: 'proxy-1', path: 'E:\\影片.mp4', fingerprint: 'hash', state: 'running', progress: 35 },
    {
      id: 'proxy-2',
      path: '/ready.mp4',
      fingerprint: 'hash',
      state: 'succeeded',
      progress: 100,
      proxy_url: '/cache.mp4'
    },
    {
      id: 'proxy-3',
      path: '/failed.mp4',
      fingerprint: 'hash',
      state: 'failed',
      progress: 0,
      error: '磁盘不足'
    }
  ]
  const tasks = videoProxyEditorTasks(jobs, { workspaceId: 'workspace-1', documentId: 'video-1' })
  assert.deepEqual(
    tasks.map((task) => task.state),
    ['running', 'completed', 'failed']
  )
  assert.ok(tasks.every((task) => task.kind === 'processing' && !task.results.length))
  assert.equal(tasks[0].progress, 35)
  assert.equal(tasks[0].name, '影片.mp4 · 预览代理')
  assert.equal(filterEditorTasks(tasks, { ...scope, status: 'active' }).length, 1)
  assert.equal(filterEditorTasks(tasks, { ...scope, scope: 'workspace' }).length, 3)
  assert.deepEqual(editorTaskActions(tasks[0], { ...actions, canCancelProxy: true }), ['cancel'])
  assert.deepEqual(editorTaskActions(tasks[0], actions), [])
  assert.deepEqual(editorTaskActions(tasks[2], { ...actions, canCancelProxy: true }), [])
  assert.deepEqual(videoProxyEditorTasks(jobs, { workspaceId: '', documentId: 'media-doc' }), [])
  assert.ok(
    editorTaskRequests({ workspaceId: 'workspace-1' }).every(
      (request) => request.source !== 'video-proxy'
    )
  )
})

test('task deletion respects final state, remote uncertainty, backend capability and readonly', () => {
  const done = imageEditorTasks([ai({ state: 'completed' })])[0]
  assert.equal(canRemoveEditorTaskRecord(done, false), true)
  assert.equal(canRemoveEditorTaskRecord(done, true), false)
  assert.equal(canRemoveEditorTaskRecord(imageEditorTasks([ai()])[0], false), false)
  assert.equal(
    canRemoveEditorTaskRecord(
      imageEditorTasks([ai({ state: 'interrupted', resumable: true })])[0],
      false
    ),
    false
  )
  assert.equal(
    canRemoveEditorTaskRecord(
      imageEditorTasks([ai({ state: 'failed', deletable: false })])[0],
      false
    ),
    false
  )
  assert.equal(
    canRemoveEditorTaskRecord(
      exportEditorTasks([exportTask({ state: 'interrupted' })], 'video')[0],
      false
    ),
    true
  )
})

test('deletion routes use the correct owner and proxy records never issue a server delete', () => {
  const done = imageEditorTasks([ai({ state: 'completed', id: 'id & ?' })])[0]
  assert.equal(editorTaskDeleteUrl(done), '/image-ai/tasks/id%20%26%20%3F?workspace_id=workspace-1')
  const tool = imageToolEditorTasks(
    [job({ state: 'completed', document_key: 'key & ?', id: 'tool' })],
    { workspaceId: '', documentId: 'media-doc', documentKey: 'key & ?' }
  )[0]
  assert.equal(editorTaskDeleteUrl(tool), '/image-ai-tools/tasks/tool?document_key=key+%26+%3F')
  const proxy = videoProxyEditorTasks(
    [{ id: 'proxy', path: '/file', fingerprint: 'hash', state: 'succeeded', progress: 100 }],
    { workspaceId: 'workspace-1', documentId: 'video-1' }
  )[0]
  assert.equal(canRemoveEditorTaskRecord(proxy, false), true)
  assert.equal(editorTaskDeleteUrl(proxy), null)
})

test('deleted idempotent responses cannot recreate rows or expose result previews', () => {
  assert.deepEqual(
    imageEditorTasks([ai({ state: 'completed', deleted: true, artifact_id: 'artifact' })]),
    []
  )
  assert.deepEqual(exportEditorTasks([exportTask({ deleted: true })], 'video'), [])
  assert.deepEqual(
    imageToolEditorTasks([job({ deleted: true })], {
      workspaceId: '',
      documentId: 'media-doc',
      documentKey: 'key-1'
    }),
    []
  )
})
