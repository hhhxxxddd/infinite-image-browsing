import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  readWorkbenchEditorReturn,
  workbenchEditorDestination,
  workbenchEditorHistoryState
} from './workbenchEditorReturn.ts'

const origin = {
  version: 1,
  workspaceId: 'workspace-original',
  workId: 'work-original',
  screen: 'work',
  pageTab: 'workspace',
  statusView: 'paused',
  materialsView: 'used',
  workTab: 'outputs',
  draftFilter: 'audio',
  scrollTop: 450
}

test('return state retains the original work, tabs, material scope and scroll position', () => {
  const history = workbenchEditorHistoryState({ unrelated: 7 }, origin)
  assert.deepEqual(readWorkbenchEditorReturn(history), origin)
  assert.equal(history.unrelated, 7)
  assert.deepEqual(
    workbenchEditorDestination(origin, origin.workspaceId, ['work-new', origin.workId]),
    {
      screen: 'work',
      workId: origin.workId
    }
  )
})

test('each production filter survives opening and returning from an editor', () => {
  for (const draftFilter of ['all', 'image', 'video', 'audio', 'ai']) {
    const history = workbenchEditorHistoryState(null, { ...origin, workTab: 'drafts', draftFilter })
    assert.equal(readWorkbenchEditorReturn(history).draftFilter, draftFilter)
    assert.equal(readWorkbenchEditorReturn(history).workTab, 'drafts')
  }
})

test('opening a draft from workspace cards returns to the cards, not the entered work', () => {
  const fromWorkspace = { ...origin, screen: 'workspace', workId: '' }
  assert.deepEqual(workbenchEditorDestination(fromWorkspace, origin.workspaceId, [origin.workId]), {
    screen: 'workspace',
    workId: ''
  })
})

test('a deleted original work falls back to its workspace without opening a different work', () => {
  assert.deepEqual(workbenchEditorDestination(origin, origin.workspaceId, ['work-replacement']), {
    screen: 'workspace',
    workId: ''
  })
  assert.equal(workbenchEditorDestination(origin, 'different-workspace', [origin.workId]), null)
})

test('malformed history is ignored and invalid view controls get safe defaults', () => {
  for (const state of [null, [], 'invalid', { omnigalleryWorkbenchEditorReturn: { version: 2 } }])
    assert.equal(readWorkbenchEditorReturn(state), null)
  const history = workbenchEditorHistoryState(null, {
    ...origin,
    pageTab: 'unknown',
    draftFilter: 'unknown',
    workTab: 'unknown',
    materialsView: 'unknown',
    statusView: 'unknown',
    scrollTop: Infinity
  })
  assert.deepEqual(readWorkbenchEditorReturn(history), {
    ...origin,
    pageTab: 'workspace',
    draftFilter: 'all',
    workTab: 'drafts',
    materialsView: 'all',
    statusView: 'active',
    scrollTop: 0
  })
})

test('writing an origin does not mutate prior history or retain mutable view references', () => {
  const originalHistory = { unrelated: { id: 1 } }
  const input = { ...origin }
  const history = workbenchEditorHistoryState(originalHistory, input)
  input.draftFilter = 'video'
  assert.deepEqual(originalHistory, { unrelated: { id: 1 } })
  assert.equal(readWorkbenchEditorReturn(history).draftFilter, 'audio')
})
