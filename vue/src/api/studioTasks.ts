import { axiosInst } from './index'
import type { ImageAICreationMode } from './imageAi'

export interface StudioTask {
  id: string
  workspace_id: string
  name: string
  state: 'queued' | 'running' | 'completed' | 'failed'
  created_at: number
  updated_at: number
  error: string
  artifact_id: string
}
export async function listStudioTasks(workspaceId: string): Promise<StudioTask[]> {
  return (await axiosInst.value.get('/db/image-ai/tasks', {
    params: { workspace_id: workspaceId }, handledLocally: true
  })).data
}
export async function createStudioTask(workspaceId: string, name: string, mode: ImageAICreationMode,
  request: Record<string, unknown>): Promise<StudioTask> {
  return (await axiosInst.value.post('/db/image-ai/tasks', {
    workspace_id: workspaceId, name: name.slice(0, 120), mode, request
  }, { timeout: 60000, handledLocally: true })).data
}
