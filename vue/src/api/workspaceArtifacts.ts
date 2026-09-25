import { axiosInst } from './index'

export interface WorkspaceArtifact {
  id: string
  workspace_id: string
  name: string
  kind: 'image' | 'video' | 'audio'
  source: string
  format: 'png' | 'jpeg' | 'webp'
  width: number
  height: number
  bytes: number
  created_at: string
}

const base = '/db/workspace_artifacts'

export async function listWorkspaceArtifacts(workspaceId: string): Promise<WorkspaceArtifact[]> {
  return (await axiosInst.value.get(base, { params: { workspace_id: workspaceId } })).data
}

export async function saveWorkspaceArtifact(workspaceId: string, name: string, format: WorkspaceArtifact['format'],
  imageBase64: string, source: 'image_studio' | 'ai_image_edit' = 'image_studio'): Promise<WorkspaceArtifact> {
  return (await axiosInst.value.post(base, { workspace_id: workspaceId, name, format, source, image_base64: imageBase64 })).data
}

export async function saveAiImageResult(workspaceId: string, name: string,
  result: { media_type: string; image_base64: string }): Promise<WorkspaceArtifact> {
  const formats: Record<string, WorkspaceArtifact['format']> = {
    'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp',
  }
  const format = formats[result.media_type]
  if (!format) throw new Error(`不支持保存 ${result.media_type} 格式的结果`)
  return saveWorkspaceArtifact(workspaceId, name, format, result.image_base64, 'ai_image_edit')
}

export async function syncWorkspaceArtifact(id: string, directory: string): Promise<string> {
  return (await axiosInst.value.post(`${base}/${id}/sync`, { directory })).data.path
}

export async function deleteWorkspaceArtifact(id: string): Promise<void> {
  await axiosInst.value.delete(`${base}/${id}`)
}

export async function deleteWorkspaceArtifacts(workspaceId: string): Promise<void> {
  await axiosInst.value.delete(base, { params: { workspace_id: workspaceId } })
}
