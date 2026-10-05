import assert from 'node:assert/strict'
import test from 'node:test'
import { editorVersionGuard, restoreEditorVersion } from './editorVersionOperation.ts'

function fixture() {
  let current = { workspaceId: 'workspace', draftId: 'draft', kind: 'image', revision: 0 }
  let live = true
  const guard = editorVersionGuard(
    current,
    () => current,
    () => live
  )
  const events = []
  const operation = {
    guard,
    read: () => {
      events.push('read')
      return { name: 'version' }
    },
    beforeSave: async () => {
      events.push('save')
      return true
    },
    backup: async () => {
      events.push('backup')
    },
    restore: async (document) => {
      events.push(document.name)
    }
  }
  return {
    operation,
    events,
    update: (next) => {
      current = { ...current, ...next }
    },
    close: () => {
      live = false
    }
  }
}

test('restoration parses, saves and backs up current production before changing it', async () => {
  const { operation, events } = fixture()
  await restoreEditorVersion(operation)
  assert.deepEqual(events, ['read', 'save', 'backup', 'version'])
})

test('invalid snapshots, rejected save and failed backup never run restoration', async () => {
  for (const failure of ['read', 'save', 'backup']) {
    const { operation, events } = fixture()
    operation[{ read: 'read', save: 'beforeSave', backup: 'backup' }[failure]] = () => {
      throw new Error(failure)
    }
    await assert.rejects(restoreEditorVersion(operation), new RegExp(failure))
    assert.equal(events.includes('version'), false)
  }
  const { operation, events } = fixture()
  operation.beforeSave = async () => false
  await assert.rejects(restoreEditorVersion(operation), /请先完成/)
  assert.deepEqual(events, ['read'])
})

test('workspace, draft, kind, scope generation and readonly changes during save or backup cancel recovery', async () => {
  for (const change of [
    { workspaceId: 'another-workspace' },
    { draftId: 'another-draft' },
    { kind: 'ai-image' },
    { revision: 2 },
    { readonly: true },
    { disabled: true }
  ]) {
    for (const wait of ['beforeSave', 'backup']) {
      const { operation, events, update } = fixture()
      operation[wait] = async () => {
        await Promise.resolve()
        update(change)
        return true
      }
      await assert.rejects(restoreEditorVersion(operation), /已取消|不可修改/)
      assert.equal(events.includes('version'), false)
    }
  }
})

test('closing the editor during backup cancels restoration', async () => {
  const { operation, events, close } = fixture()
  operation.backup = async () => {
    close()
  }
  await assert.rejects(restoreEditorVersion(operation), /已取消/)
  assert.equal(events.includes('version'), false)
})

test('readonly can open version history while restoring and creating versions stay prohibited', () => {
  const current = { workspaceId: 'workspace', draftId: 'draft', kind: 'image', readonly: true }
  const open = editorVersionGuard(
    current,
    () => current,
    () => true,
    false
  )
  const write = editorVersionGuard(
    current,
    () => current,
    () => true
  )
  assert.doesNotThrow(open)
  assert.throws(write, /不可修改/)
})

test('a failure while persisting restored content is propagated to the UI', async () => {
  const { operation } = fixture()
  operation.restore = async () => {
    throw new Error('persist failed')
  }
  await assert.rejects(restoreEditorVersion(operation), /persist failed/)
})
