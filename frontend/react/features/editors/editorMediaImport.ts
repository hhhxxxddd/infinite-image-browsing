import { apiFetch } from '../../shared/apiClient'
import {
  addWorkspaceAssets,
  readWorkspaceRecords,
  type WorkspaceAsset
} from '../../../src/features/workspaces/model/workspaceModel'
import type { FileNodeInfo } from '../../../src/shared/types/fileNode'
import type { MediaFile } from '../media/mediaApi'

/** Material strips can preview library files and new workspace artifacts through one viewer. */
export function editorPreviewFile(asset: WorkspaceAsset, file?: FileNodeInfo): MediaFile {
  return {
    id: file?.id,
    name: asset.name,
    fullpath: asset.path,
    type: 'file',
    date: file?.date ?? '',
    created_time: file?.created_time ?? '',
    size: file?.size ?? '',
    bytes: file?.bytes ?? 0,
    width: file?.width,
    height: file?.height,
    cover_url: file?.cover_url,
    cloud_only: file?.cloud_only,
    edit_snapshot: file?.edit_snapshot,
    workspace_artifact_id:
      file?.workspace_artifact_id ??
      (asset.path.startsWith('workspace-artifact:') ? asset.path.slice(19) : undefined)
  }
}

/** Re-read before writing so an editor does not overwrite workbench changes made after it opened. */
export async function importEditorMaterials(
  workspaceId: string,
  incoming: WorkspaceAsset[]
): Promise<WorkspaceAsset[]> {
  const settings = await apiFetch<{
    is_readonly: boolean
    app_fe_setting?: { workbench_projects?: unknown }
  }>('/global_setting')
  if (settings.is_readonly) throw new Error('只读模式不能修改工作区素材')
  const records = readWorkspaceRecords(settings.app_fe_setting?.workbench_projects)
  const current = records.find((record) => record.id === workspaceId)
  if (!current) throw new Error('当前工作区已不存在，请返回工作台刷新')
  const assets = addWorkspaceAssets(current.assets, incoming)
  if (incoming.some((asset) => !assets.some((item) => item.path === asset.path)))
    throw new Error('工作区素材已达 500 项上限')
  if (assets.length === current.assets.length) return assets
  const next = records.map((record) =>
    record.id === workspaceId ? { ...record, assets, updatedAt: new Date().toISOString() } : record
  )
  await apiFetch<void>('/app_fe_setting', {
    method: 'POST',
    body: JSON.stringify({
      name: 'workbench_projects',
      value: JSON.stringify({ version: 2, items: next })
    })
  })
  return assets
}
