import type { InjectionKey, Ref } from 'vue'
import type { FileNodeInfo } from '@/features/media-library/public'
import type { MaterialAction } from './workspaceMaterials'

export interface WorkspaceArtifactActions {
  busy: Readonly<Ref<boolean>>
  disabled: Readonly<Ref<boolean>>
  lastRemovedId: Readonly<Ref<string>>
  resolveFile: (file: FileNodeInfo) => FileNodeInfo | undefined
  rename: (file: FileNodeInfo) => void
  remove: (file: FileNodeInfo) => void
}
export const workspaceArtifactActionsKey: InjectionKey<WorkspaceArtifactActions> = Symbol(
  'workspace-artifact-actions'
)

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
