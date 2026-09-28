import type { FileNodeInfo } from '@/features/media-library/public'
import type { StudioDocument } from './imageStudioModel'
import type { StudioDraftRepository } from './studioDraftRepository'
export interface StudioAsset {
  id?: number
  path: string
  name: string
  kind: 'image' | 'video' | 'audio'
}
export interface StudioArtifactRequest {
  workspaceId: string
  name: string
  format: 'png' | 'jpeg'
  imageBase64: string
  documentId?: string
  documentRevision?: string
}
export type ImageEditorProps = {
  workspaceId: string
  workspaceName: string
  assets: StudioAsset[]
  assetInfo: Record<string, FileNodeInfo>
  readonly?: boolean
  noteDirty: boolean
  noteSaving: boolean
  initialDraftId?: string
  createNew?: boolean
  standalone?: boolean
  mediaFile?: FileNodeInfo
  initialDocument?: StudioDocument
  initialExportArea?: 'content' | 'canvas'
  editRevision?: string
  editSavedAt?: string
  draftRepository?: StudioDraftRepository
  persistArtifact?: (request: StudioArtifactRequest) => Promise<void>
  importLibraryImage?: (file: FileNodeInfo) => Promise<boolean>
}
