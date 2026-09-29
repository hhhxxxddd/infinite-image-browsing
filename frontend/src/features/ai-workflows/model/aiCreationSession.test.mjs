import assert from 'node:assert/strict'
import test from 'node:test'
import {
  aiCreationSessionKey,
  aiSessionMedia,
  readAICreationSession,
  selectAIMedia,
  selectAIImageTask
} from './aiCreationSession.ts'
import {
  mapStorage,
  collectBrowserWorkspaceState
} from '../../workspaces/model/workspaceStateStore.ts'
import { removeWorkspaceAIDrafts } from '../../workspaces/model/workspaceReferences.ts'

test('media navigation remembers the image task and never changes another file', () => {
  const storage = mapStorage(new Map())
  const oldFile = readAICreationSession(storage, 'workspace', 'work:edit')
  let current = readAICreationSession(storage, 'workspace', 'work:gen', 'image_generation')
  assert.equal(current.imageTask, 'generation')
  current = selectAIImageTask(current, 'edit')
  current = selectAIMedia(current, 'audio')
  assert.equal(aiSessionMedia(current), 'audio')
  current = selectAIMedia(current, 'video')
  storage.setItem(aiCreationSessionKey('workspace', 'work:gen'), JSON.stringify(current))
  const reopened = readAICreationSession(storage, 'workspace', 'work:gen', 'image_generation')
  assert.equal(reopened.section, 'video')
  assert.equal(selectAIMedia(reopened, 'image').section, 'edit')
  assert.deepEqual(readAICreationSession(storage, 'workspace', 'work:edit'), oldFile)
})

test('invalid navigation recovers the legacy default and repairs mismatched image tasks', () => {
  const key = aiCreationSessionKey('workspace', 'work:file')
  const storage = mapStorage(new Map([[key, '{broken']]))
  assert.equal(readAICreationSession(storage, 'workspace', 'work:file').section, 'edit')
  storage.setItem(key, JSON.stringify({ version: 1, section: 'generation', imageTask: 'edit' }))
  assert.equal(readAICreationSession(storage, 'workspace', 'work:file').imageTask, 'generation')
  storage.setItem(key, JSON.stringify({ version: 2, section: 'audio', imageTask: 'edit' }))
  assert.equal(
    readAICreationSession(storage, 'workspace', 'work:file', 'image_generation').section,
    'generation'
  )
})

test('session state migrates and is deleted at exact workspace and production boundaries', () => {
  const keys = ['workspace', 'workspace-other'].flatMap((workspace) =>
    ['work:file', 'work:file-other'].map((scope) => aiCreationSessionKey(workspace, scope))
  )
  const storage = mapStorage(new Map(keys.map((key) => [key, 'session'])))
  const migrated = collectBrowserWorkspaceState('workspace', storage)
  assert.deepEqual(Object.keys(migrated).sort(), keys.slice(0, 2).sort())
  removeWorkspaceAIDrafts(storage, 'workspace:work:file')
  assert.equal(storage.getItem(keys[0]), null)
  assert.equal(storage.length, 3)
  removeWorkspaceAIDrafts(storage, 'workspace')
  assert.equal(storage.length, 2)
  assert.ok(keys.slice(2).every((key) => storage.getItem(key) === 'session'))
})
