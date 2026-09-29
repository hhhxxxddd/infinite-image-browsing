import type { WorkspaceArtifact } from '../api/workspaceArtifacts.ts'
import type { ProductionKind } from './workspaceWorks.ts'

/** Derived artifacts are queried by lineage, never copied into a second owner. */
export function productionArtifacts(
  artifacts: WorkspaceArtifact[],
  workspaceId: string,
  productionId: string,
  kind: ProductionKind
) {
  return artifacts
    .filter(
      (item) =>
        item.workspace_id === workspaceId &&
        !item.input_owner &&
        (item.document_id === productionId ||
          (kind === 'image' && item.lineage?.documentId === productionId))
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}
