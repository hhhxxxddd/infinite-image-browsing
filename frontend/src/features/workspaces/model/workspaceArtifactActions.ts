import type { FileNodeInfo } from '@/shared/types/fileNode'
import type { MaterialAction } from './workspaceMaterials'

export function artifactDeleteActions(
  file: Pick<FileNodeInfo, 'workspace_artifact_id' | 'workspace_input_owner'> | undefined,
  disabled: boolean
): MaterialAction[] {
  if (!file?.workspace_artifact_id || file.workspace_input_owner) return []
  return [{ key: 'delete-artifact', label: '删除产物', danger: true, disabled }]
}

export function mergeArtifactActions(
  toolActions: MaterialAction[],
  file: Pick<FileNodeInfo, 'workspace_artifact_id' | 'workspace_input_owner'> | undefined,
  disabled: boolean
): MaterialAction[] {
  const deletion = artifactDeleteActions(file, disabled)[0]
  if (!deletion) return toolActions
  if (toolActions.some((action) => action.key === deletion.key))
    return toolActions.map((action) =>
      action.key === deletion.key
        ? { ...action, label: deletion.label, danger: true, disabled: disabled || action.disabled }
        : action
    )
  return [...toolActions, deletion]
}
