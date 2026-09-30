import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addWorkspaceAssets } from '../../../src/features/workspaces/model/workspaceModel.ts'
import { uniqueAIImageChoices } from './aiImageChoices.ts'

test('AI image selectors offer a workspace artifact only once across saved and refreshed assets', () => {
  const path = 'workspace-artifact:3053c72c-3ff4-4998-b664-ff38e38bbf3f'
  const saved = [{ path, name: '画面与文字', kind: 'image' }]
  const refreshed = [{ path, name: '画面与文字 · 已刷新', kind: 'image' }]
  const assets = addWorkspaceAssets([], [...saved, ...refreshed])

  assert.equal(assets.length, 1)
  assert.deepEqual(
    uniqueAIImageChoices([
      { value: path, label: '来源参考 · 画面与文字' },
      ...assets.map((asset) => ({ value: asset.path, label: asset.name }))
    ]),
    [{ value: path, label: '来源参考 · 画面与文字' }]
  )
})

test('AI image selector keeps different inputs and drops repeated source references', () => {
  assert.deepEqual(
    uniqueAIImageChoices([
      { value: 'workspace-artifact:a', label: '来源 · 画布快照' },
      { value: 'workspace-artifact:a', label: '重复快照' },
      { value: 'workspace-artifact:b', label: '第二张图' },
      { value: 'workspace-artifact:b', label: '重复参考' }
    ]),
    [
      { value: 'workspace-artifact:a', label: '来源 · 画布快照' },
      { value: 'workspace-artifact:b', label: '第二张图' }
    ]
  )
})
