import assert from 'node:assert/strict'
import test from 'node:test'
import { assetPreviewIdentity } from './assetPreviewIdentity.ts'

test('all product methods share the same origin and keep the recorded method separate', () => {
  for (const source of ['image_studio', 'ai_image_edit', 'ai_image_generation']) {
    assert.deepEqual(
      assetPreviewIdentity({ workspace_artifact_id: '1', workspace_artifact_source: source }),
      {
        origin: '工作区产物',
        productionSource: source
      }
    )
  }
})

test('input and edit snapshots do not inherit product methods from their underlying file', () => {
  const product = { workspace_artifact_id: '1', workspace_artifact_source: 'ai_image_edit' }
  assert.deepEqual(assetPreviewIdentity({ ...product, workspace_input_owner: 'draft-1' }), {
    origin: '工作区输入快照',
    productionSource: undefined
  })
  assert.deepEqual(assetPreviewIdentity({ ...product, edit_snapshot: { owner: 'draft-1' } }), {
    origin: '编辑快照',
    productionSource: undefined
  })
})

test('uploads, library files and unknown product methods never guess a production method', () => {
  assert.deepEqual(assetPreviewIdentity(), { origin: '上传文件', productionSource: undefined })
  assert.deepEqual(assetPreviewIdentity({ workspace_artifact_source: 'ai_image_generation' }), {
    origin: '媒体库',
    productionSource: undefined
  })
  for (const source of [undefined, 'future_source']) {
    assert.deepEqual(
      assetPreviewIdentity({ workspace_artifact_id: '1', workspace_artifact_source: source }),
      {
        origin: '工作区产物',
        productionSource: undefined
      }
    )
  }
})
