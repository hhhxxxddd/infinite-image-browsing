/** Framework-independent contracts shared by the React UI and domain models. */
export interface StudioTask {
  id: string
  workspace_id: string
  name: string
  state: 'queued' | 'running' | 'completed' | 'failed'
  created_at: number
  updated_at: number
  error: string
  artifact_id: string
  document_id?: string
  purpose?: 'image_edit' | 'image_generation'
  results?: { artifact_id: string; label: string; node_id: string }[]
}
