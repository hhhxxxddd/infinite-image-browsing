import type { FileNodeInfo } from '../types/fileNode'
import { authorizeRuntimeApiUrl, getRuntimeApiBase } from './runtimeApiBase.ts'
import { managedImageAssetRoute } from './managedImageAssets.ts'

const encode = encodeURIComponent
const version = (file: FileNodeInfo) => encode(file.date || '')
const editSnapshotUrl = (asset: NonNullable<FileNodeInfo['edit_snapshot']>) =>
  authorizeRuntimeApiUrl(
    `${getRuntimeApiBase()}/image_edit_asset?path=${encode(asset.owner)}&revision=${encode(asset.revision)}&asset=${encode(asset.asset)}`
  )

export function toRawFileUrl(file: FileNodeInfo, download = false): string {
  const template = managedImageAssetRoute(file.fullpath)
  if (template) return authorizeRuntimeApiUrl(`${getRuntimeApiBase()}${template}`)
  if (file.edit_snapshot) return editSnapshotUrl(file.edit_snapshot)
  if (file.workspace_artifact_id)
    return authorizeRuntimeApiUrl(
      `${getRuntimeApiBase()}/workspace_artifacts/${encode(file.workspace_artifact_id)}/file${download ? '?download=true' : ''}`
    )
  return authorizeRuntimeApiUrl(
    `${getRuntimeApiBase()}/file?path=${encode(file.fullpath)}&t=${version(file)}${download ? `&disposition=${encode(file.name)}` : ''}`
  )
}

export function toImageUrl(file: FileNodeInfo): string {
  if (managedImageAssetRoute(file.fullpath)) return toRawFileUrl(file)
  if (file.workspace_artifact_id || file.edit_snapshot) return toRawFileUrl(file)
  return authorizeRuntimeApiUrl(
    `${getRuntimeApiBase()}/img/${encode(file.name)}?path=${encode(file.fullpath)}&t=${version(file)}`
  )
}

export function toImageThumbnailUrl(file: FileNodeInfo, size = '512x512'): string {
  if (managedImageAssetRoute(file.fullpath)) return toRawFileUrl(file)
  if (file.edit_snapshot) return editSnapshotUrl(file.edit_snapshot)
  if (file.workspace_artifact_id) {
    const edge = Number(size.split('x')[0])
    return Number.isFinite(edge) && edge <= 1024
      ? authorizeRuntimeApiUrl(
          `${getRuntimeApiBase()}/workspace_artifacts/${encode(file.workspace_artifact_id)}/thumbnail?size=${Math.max(32, Math.round(edge))}`
        )
      : toRawFileUrl(file)
  }
  return authorizeRuntimeApiUrl(
    `${getRuntimeApiBase()}/image-thumbnail?path=${encode(file.fullpath)}&size=${size}&t=${version(file)}`
  )
}
