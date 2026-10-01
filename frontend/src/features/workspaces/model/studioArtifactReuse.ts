import type { WorkspaceArtifact } from './workspaceArtifactTypes.ts'

/** Only a matching PNG composition can satisfy the card's content-area export. */
export function findPublishedStudioArtifact(
  artifacts: WorkspaceArtifact[],
  documentId: string,
  revision: string
): WorkspaceArtifact | undefined {
  return artifacts.find(
    (item) =>
      item.source === 'image_studio' &&
      item.format === 'png' &&
      item.document_id === documentId &&
      item.document_revision === revision
  )
}
