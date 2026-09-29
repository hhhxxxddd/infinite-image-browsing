import assert from 'node:assert/strict'
import { test } from 'node:test'
import { artifactDeleteActions, mergeArtifactActions } from './workspaceArtifactActions.ts'

test('all workspace product sources offer deletion', () => {
  for (const source of ['image_studio', 'ai_image_edit', 'ai_image_generation', 'video', 'audio']) {
    assert.deepEqual(artifactDeleteActions({ workspace_artifact_id: `product-${source}` }, false), [
      { key: 'delete-artifact', label: '删除产物', danger: true, disabled: false }
    ])
  }
})

test('library references and saved input snapshots cannot be deleted as products', () => {
  assert.deepEqual(artifactDeleteActions(undefined, false), [])
  assert.deepEqual(artifactDeleteActions({}, false), [])
  assert.deepEqual(artifactDeleteActions({ workspace_artifact_id: '' }, false), [])
  assert.deepEqual(
    artifactDeleteActions(
      { workspace_artifact_id: 'input-1', workspace_input_owner: 'draft-1' },
      false
    ),
    []
  )
})

test('readonly or busy workspaces disable product deletion', () => {
  const [action] = artifactDeleteActions({ workspace_artifact_id: 'product-1' }, true)
  assert.equal(action.disabled, true)
  assert.equal(action.danger, true)
})

test('tool-specific deletion is preserved without a duplicate product menu entry', () => {
  const mainAction = { key: 'main', label: '设为主图' }
  const toolDelete = { key: 'delete-artifact', label: '删除素材', danger: true }
  const actions = mergeArtifactActions(
    [mainAction, toolDelete],
    { workspace_artifact_id: 'product-1' },
    false
  )
  assert.equal(actions.length, 2)
  assert.equal(actions[0], mainAction)
  assert.equal(actions.filter((action) => action.key === 'delete-artifact').length, 1)
  assert.equal(actions[1].label, '删除产物')
})

test('shared deletion fills missing tool actions and enforces workspace readonly state', () => {
  const product = { workspace_artifact_id: 'product-1' }
  assert.equal(mergeArtifactActions([], product, false)[0].key, 'delete-artifact')
  const [disabled] = mergeArtifactActions(
    [{ key: 'delete-artifact', label: '删除产物', disabled: false }],
    product,
    true
  )
  assert.equal(disabled.disabled, true)
  const [toolDisabled] = mergeArtifactActions(
    [{ key: 'delete-artifact', label: '删除产物', disabled: true }],
    product,
    false
  )
  assert.equal(toolDisabled.disabled, true)
  assert.deepEqual(mergeArtifactActions([], {}, false), [])
})
