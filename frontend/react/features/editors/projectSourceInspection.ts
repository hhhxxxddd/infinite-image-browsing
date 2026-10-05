import { apiFetch } from '../../shared/apiClient'
import type { WorkspaceAsset } from '../../../src/features/workspaces/model/workspaceModel'
import type { ProjectSourceInspection, ProjectSourceKind } from './projectSources'

export async function inspectProjectSources(
  context: { workspace_id: string; document_id: string; kind: ProjectSourceKind },
  assets: Pick<WorkspaceAsset, 'path' | 'kind'>[],
  signal: AbortSignal,
  progress?: (count: number) => void
) {
  const values: ProjectSourceInspection[] = []
  // Probe headers only. Sequential batches bound FFprobe concurrency and cancellation delay.
  for (let offset = 0; offset < assets.length; offset += 8) {
    signal.throwIfAborted()
    const response = await apiFetch<{ sources: ProjectSourceInspection[] }>(
      '/source_relink/inspect',
      {
        method: 'POST',
        body: JSON.stringify({ ...context, sources: assets.slice(offset, offset + 8) }),
        signal
      }
    )
    values.push(...response.sources)
    progress?.(values.length)
  }
  return values
}
