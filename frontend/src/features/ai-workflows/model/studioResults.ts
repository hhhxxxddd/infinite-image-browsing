import type { StudioTask } from '../api/studioTasks'

export function studioTaskResults(task: StudioTask) {
  return task.results?.length
    ? task.results
    : task.artifact_id
      ? [{ artifact_id: task.artifact_id, label: '', node_id: '' }]
      : []
}
export function imageResultBatches(
  tasks: StudioTask[],
  workspaceId?: string,
  productionId?: string,
  purpose?: 'image_edit' | 'image_generation'
) {
  if (!workspaceId) return []
  return tasks
    .filter(
      (task) =>
        task.workspace_id === workspaceId &&
        (task.document_id ?? '') === (productionId ?? '') &&
        (!purpose || (task.purpose ?? 'image_edit') === purpose) &&
        studioTaskResults(task).length
    )
    .sort((a, b) => b.created_at - a.created_at)
}
