import { axiosInst } from '@/shared/api/httpClient'

export interface WorkspaceArtifact {
  id: string
  workspace_id: string
  name: string
  kind: 'image' | 'video' | 'audio'
  source: 'image_studio' | 'ai_image_edit'
  format: 'png' | 'jpeg' | 'webp'
  width: number
  height: number
  bytes: number
  created_at: string
  document_id?: string
  document_revision?: string
  collected?: boolean
}

export interface WorkspaceArtifactMetadata {
  description: string
  generation_info: string
  embedded_generation_info: string
  inferred_prompt: string
  tag_ids: number[]
  exif: Record<string, string>
  source_image_available: boolean
}

const base = '/workspace_artifacts'

export async function listWorkspaceArtifacts(workspaceId: string): Promise<WorkspaceArtifact[]> {
  return (await axiosInst.value.get(base, { params: { workspace_id: workspaceId } })).data
}

export async function saveWorkspaceArtifact(
  workspaceId: string,
  name: string,
  format: WorkspaceArtifact['format'],
  imageBase64: string,
  source: 'image_studio' | 'ai_image_edit' = 'image_studio',
  generationInfo = '',
  origin?: { documentId: string; documentRevision: string }
): Promise<WorkspaceArtifact> {
  return (
    await axiosInst.value.post(
      base,
      {
        workspace_id: workspaceId,
        name,
        format,
        source,
        image_base64: imageBase64,
        generation_info: generationInfo,
        document_id: origin?.documentId,
        document_revision: origin?.documentRevision
      },
      { handledLocally: true }
    )
  ).data
}

export async function getWorkspaceArtifactMetadata(id: string): Promise<WorkspaceArtifactMetadata> {
  return (await axiosInst.value.get(`${base}/${id}/metadata`)).data
}

export async function updateWorkspaceArtifactMetadata(
  id: string,
  fields: Partial<
    Pick<WorkspaceArtifactMetadata, 'description' | 'generation_info' | 'inferred_prompt'>
  >
): Promise<WorkspaceArtifactMetadata> {
  return (await axiosInst.value.put(`${base}/${id}/metadata`, fields)).data
}

export async function toggleWorkspaceArtifactTag(
  id: string,
  tagId: number
): Promise<{ is_remove: boolean }> {
  return (await axiosInst.value.post(`${base}/${id}/tags`, { tag_id: tagId })).data
}

export async function syncWorkspaceArtifact(
  id: string,
  workId: string,
  directory: string
): Promise<{ path: string; collected: boolean }> {
  return (
    await axiosInst.value.post(
      `${base}/${id}/sync`,
      { work_id: workId, directory },
      { handledLocally: true }
    )
  ).data
}

export async function deleteWorkspaceArtifact(id: string): Promise<void> {
  await axiosInst.value.delete(`${base}/${id}`)
}

export async function renameWorkspaceArtifact(id: string, name: string): Promise<{ name: string }> {
  return (await axiosInst.value.put(`${base}/${id}`, { name }, { handledLocally: true })).data
}

export async function deleteWorkspaceArtifacts(workspaceId: string): Promise<void> {
  await axiosInst.value.delete(base, { params: { workspace_id: workspaceId } })
}
