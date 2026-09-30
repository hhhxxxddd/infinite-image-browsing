import {
  inputLayerIds,
  type AIInputScope
} from '../../../src/features/workspaces/model/aiProductionBranch.ts'
import type { StudioDocument } from '../../../src/features/image-editor/model/imageStudioModel.ts'

/** Resolve the selected source again at submission, never silently fall back to the full canvas. */
export function resolveAIHandoffSelection(
  document: StudioDocument,
  value: string
): { scope: AIInputScope; label: string } {
  const scope: AIInputScope = value.startsWith('group:')
    ? { kind: 'group', id: value.slice(6) }
    : value.startsWith('layer:')
      ? { kind: 'layer', id: value.slice(6) }
      : { kind: 'all' }
  if (value !== 'all' && scope.kind === 'all') throw new Error('所选 AI 输入范围无效')
  if (!inputLayerIds(document, scope).length) throw new Error('所选 AI 输入范围已无可用图层')

  if (scope.kind === 'group') {
    const group = document.groups.find((item) => item.id === scope.id)
    if (!group) throw new Error('所选 AI 分组已不存在')
    return { scope, label: group.name }
  }
  if (scope.kind === 'layer') {
    const layer = document.layers.find((item) => item.id === scope.id)
    if (!layer) throw new Error('所选 AI 图层已不存在')
    return { scope, label: layer.name }
  }
  return { scope, label: '整张画布' }
}
