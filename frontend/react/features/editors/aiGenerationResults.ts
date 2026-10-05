export interface GenerationTaskResult {
  artifactId: string
  label: string
  taskId: string
}

type ResultTask = {
  id: string
  workspace_id: string
  document_id?: string
  purpose?: string
  state: string
  name: string
  created_at?: number
  artifact_id: string
  deleted_artifact_ids?: string[]
  results?: { artifact_id: string; label: string }[]
}

/** A result belongs to a production file by identity, never by its editable name. */
export function generationTaskResults(
  tasks: ResultTask[],
  workspaceId: string,
  documentId: string,
  deletedArtifactIds: ReadonlySet<string> = new Set()
): GenerationTaskResult[] {
  const seen = new Set<string>()
  return tasks
    .map((task, index) => ({ task, index }))
    .filter(
      ({ task }) =>
        task.workspace_id === workspaceId &&
        task.document_id === documentId &&
        task.purpose === 'image_generation' &&
        task.state === 'completed'
    )
    .sort((a, b) => (b.task.created_at ?? b.index) - (a.task.created_at ?? a.index))
    .flatMap(({ task }) => {
      const results = task.results?.length
        ? task.results
        : [{ artifact_id: task.artifact_id, label: task.name }]
      return results.flatMap((result) => {
        if (
          !result.artifact_id ||
          seen.has(result.artifact_id) ||
          deletedArtifactIds.has(result.artifact_id) ||
          task.deleted_artifact_ids?.includes(result.artifact_id)
        )
          return []
        seen.add(result.artifact_id)
        return [
          { artifactId: result.artifact_id, label: result.label || task.name, taskId: task.id }
        ]
      })
    })
}

export function selectGenerationResult(
  results: GenerationTaskResult[],
  currentId: string,
  previousLatestId: string
): string {
  const latest = results[0]?.artifactId ?? ''
  if (previousLatestId && latest && latest !== previousLatestId) return latest
  return results.some((result) => result.artifactId === currentId) ? currentId : latest
}
