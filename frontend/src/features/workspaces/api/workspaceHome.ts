import { axiosInst, apiBase } from '@/shared/api/httpClient'

export interface WorkspaceOverview {
  workspace_id: string
  work_count: number
  draft_count: number
  recent_work: { id: string; name: string } | null
  recent_draft: { id: string; name: string } | null
  preview_artifacts: string[]
}

export async function getWorkspaceOverviews(ids: string[]): Promise<WorkspaceOverview[]> {
  const overviews: WorkspaceOverview[] = []
  for (let start = 0; start < ids.length; start += 100) {
    const params = new URLSearchParams()
    ids.slice(start, start + 100).forEach((id) => params.append('workspace_ids', id))
    const result = await axiosInst.value.get<WorkspaceOverview[]>('/workspace_overviews', {
      params,
      handledLocally: true
    })
    overviews.push(...result.data)
  }
  return overviews
}

export async function uploadWorkspaceCover(id: string, imageBase64: string): Promise<string> {
  return (
    await axiosInst.value.post(
      `/workspace_covers/${encodeURIComponent(id)}`,
      { image_base64: imageBase64.replace(/^data:[^,]*,/, '') },
      { handledLocally: true }
    )
  ).data.version
}

export const workspaceCoverUrl = (id: string, version: string) =>
  `${apiBase.value}/workspace_covers/${encodeURIComponent(id)}/${encodeURIComponent(version)}`

export const workspaceArtifactCoverUrl = (id: string) =>
  `${apiBase.value}/workspace_artifacts/${encodeURIComponent(id)}/thumbnail?size=640`
