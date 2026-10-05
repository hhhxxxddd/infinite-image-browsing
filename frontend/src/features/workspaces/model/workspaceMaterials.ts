import type { WorkspaceAsset, MediaKind } from './workspaceModel'
import type { FileNodeInfo } from '../../../shared/types/fileNode'

export type EditorMaterialInfo = Partial<
  Pick<FileNodeInfo, 'workspace_artifact_id' | 'workspace_input_owner' | 'created_time' | 'date'>
>

/** Products sort newest first; reference order stays stable across editor operations. */
export function orderEditorMaterials(
  items: readonly WorkspaceAsset[],
  assetInfo: Readonly<Record<string, EditorMaterialInfo | undefined>>,
  originalPath?: string
): WorkspaceAsset[] {
  const products: { asset: WorkspaceAsset; time: number | null; id: string; index: number }[] = []
  const references: WorkspaceAsset[] = []
  items.forEach((asset, index) => {
    const info = assetInfo[asset.path]
    if (!info?.workspace_artifact_id || info.workspace_input_owner) {
      references.push(asset)
      return
    }
    const time = [info.created_time, info.date]
      .map((value) => (value ? Date.parse(value) : NaN))
      .find(Number.isFinite)
    products.push({ asset, time: time ?? null, id: info.workspace_artifact_id, index })
  })
  products.sort((a, b) => {
    if (a.time === null || b.time === null) {
      if (a.time !== null) return -1
      if (b.time !== null) return 1
      return a.index - b.index
    }
    if (a.time !== b.time) return b.time - a.time
    if (a.id !== b.id) return a.id < b.id ? 1 : -1
    return a.index - b.index
  })
  const originalIndex = references.findIndex((asset) => asset.path === originalPath)
  if (originalIndex > 0) references.unshift(...references.splice(originalIndex, 1))
  return [...products.map(({ asset }) => asset), ...references]
}

export type AICreationSection = 'generation' | 'edit' | 'audio' | 'video'

export function materialKinds(tool: 'image' | 'ai', section: AICreationSection): MediaKind[] {
  if (tool === 'image' || section === 'generation' || section === 'edit') return ['image']
  return section === 'audio' ? ['audio'] : ['video', 'image', 'audio']
}

export interface MaterialAction {
  key: string
  label: string
  disabled?: boolean
  danger?: boolean
}
