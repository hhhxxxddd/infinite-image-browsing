/** Public model and API contracts for workspaces. UI entry points remain explicit to preserve lazy loading. */
export type { WorkspaceAsset, WorkspaceRecord } from './model/workspaceModel'
export {
  remapWorkspaceDrafts,
  remapWorkspaceRecords,
  removeWorkspaceAssetDrafts
} from './model/workspaceReferences'
export { submitWorkspaceTask, workspaceTasksKey } from './model/workspaceTasks'
export { buildWorkspaceStrip } from './model/workspaceAssetStrip'
export {
  deleteWorkspaceArtifact,
  getWorkspaceArtifactMetadata,
  toggleWorkspaceArtifactTag,
  updateWorkspaceArtifactMetadata
} from './api/workspaceArtifacts'
export type { WorkspaceArtifactMetadata } from './api/workspaceArtifacts'
export type { MediaPath } from './model/workspaceReferences'
export { addWorkspaceAssets, readWorkspaceRecords } from './model/workspaceModel'
