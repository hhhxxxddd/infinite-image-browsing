import type { FileNodeInfo } from '@/features/media-library/public'
import {
  exportStudioBlob,
  studioExportDocument,
  studioDocumentRevision,
  type StudioDocument
} from '@/features/image-editor/public'
import { blobToBase64 } from '@/shared/lib/blobEncoding'
import {
  listWorkspaceArtifacts,
  saveWorkspaceArtifact,
  type WorkspaceArtifact
} from '../api/workspaceArtifacts'
import { findPublishedStudioArtifact } from './studioArtifactReuse'

/** Look up the exact persisted version before rendering another full-resolution image. */
export async function publishStudioDraft(
  workspaceId: string,
  document: StudioDocument,
  assetInfo: Record<string, FileNodeInfo>
): Promise<WorkspaceArtifact> {
  const exportDocument = studioExportDocument(document, true)
  const revision = studioDocumentRevision(exportDocument)
  const artifacts = await listWorkspaceArtifacts(workspaceId)
  const existing = findPublishedStudioArtifact(artifacts, document.id, revision)
  if (existing) return existing
  const blob = await exportStudioBlob(exportDocument, assetInfo)
  return saveWorkspaceArtifact(
    workspaceId,
    document.name + '.png',
    'png',
    await blobToBase64(blob),
    'image_studio',
    '',
    { documentId: document.id, documentRevision: revision }
  )
}
