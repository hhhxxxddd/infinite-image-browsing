import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createImageLayer,
  createStudioDocument,
  createStudioGroup
} from '../../../src/features/image-editor/model/imageStudioModel.ts'
import { inputLayerIds } from '../../../src/features/workspaces/model/aiProductionBranch.ts'
import { resolveAIHandoffSelection } from './aiHandoffSelection.ts'

test('a selected group remains the source of an AI branch, excluding ungrouped layers', () => {
  const document = createStudioDocument('图片分组与 AI 回归')
  const group = createStudioGroup('画面与文字')
  document.groups.push(group)
  const first = createImageLayer('/group-a.png', { x: 0, y: 0, width: 80, height: 80 })
  const second = createImageLayer('/group-b.png', { x: 80, y: 0, width: 80, height: 80 })
  const outside = createImageLayer('/outside.png', { x: 0, y: 80, width: 80, height: 80 })
  first.groupId = group.id
  second.groupId = group.id
  document.layers = [first, second, outside]

  const selection = resolveAIHandoffSelection(document, `group:${group.id}`)
  assert.deepEqual(selection, { scope: { kind: 'group', id: group.id }, label: '画面与文字' })
  assert.deepEqual(inputLayerIds(document, selection.scope), [first.id, second.id])
  assert.throws(() => resolveAIHandoffSelection(document, 'group:missing'), /无可用图层/)
})
