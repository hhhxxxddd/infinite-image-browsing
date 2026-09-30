import type { FileNodeInfo } from '../types/fileNode'
import { getRuntimeApiBase } from './runtimeApiBase'

const encode = encodeURIComponent
const version = (file: FileNodeInfo) => encode(file.date || '')
const editSnapshotUrl = (asset: NonNullable<FileNodeInfo['edit_snapshot']>) =>
  `${getRuntimeApiBase()}/image_edit_asset?path=${encode(asset.owner)}&revision=${encode(asset.revision)}&asset=${encode(asset.asset)}`

export function toRawFileUrl(file: FileNodeInfo, download = false): string {
  if (file.edit_snapshot) return editSnapshotUrl(file.edit_snapshot)
  if (file.workspace_artifact_id)
    return `${getRuntimeApiBase()}/workspace_artifacts/${encode(file.workspace_artifact_id)}/file${download ? '?download=true' : ''}`
  return `${getRuntimeApiBase()}/file?path=${encode(file.fullpath)}&t=${version(file)}${download ? `&disposition=${encode(file.name)}` : ''}`
}

export function toImageUrl(file: FileNodeInfo): string {
  if (file.workspace_artifact_id || file.edit_snapshot) return toRawFileUrl(file)
  return `${getRuntimeApiBase()}/img/${encode(file.name)}?path=${encode(file.fullpath)}&t=${version(file)}`
}

export function toImageThumbnailUrl(file: FileNodeInfo, size = '512x512'): string {
  if (file.edit_snapshot) return editSnapshotUrl(file.edit_snapshot)
  if (file.workspace_artifact_id) {
    const edge = Number(size.split('x')[0])
    return Number.isFinite(edge) && edge <= 1024
      ? `${getRuntimeApiBase()}/workspace_artifacts/${encode(file.workspace_artifact_id)}/thumbnail?size=${Math.max(32, Math.round(edge))}`
      : toRawFileUrl(file)
  }
  return `${getRuntimeApiBase()}/image-thumbnail?path=${encode(file.fullpath)}&size=${size}&t=${version(file)}`
}
