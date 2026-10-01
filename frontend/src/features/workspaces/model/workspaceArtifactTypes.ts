import type { ProductionSource } from './workspaceWorks'

/** Framework-independent contracts shared by the React UI and domain models. */
export interface WorkspaceArtifact {
  id: string
  workspace_id: string
  name: string
  kind: 'image' | 'video' | 'audio'
  source: 'image_studio' | 'ai_image_edit' | 'ai_image_generation' | 'audio_studio' | 'video_studio'
  format: 'png' | 'jpeg' | 'webp' | 'wav' | 'mp3' | 'mp4'
  width: number
  height: number
  bytes: number
  created_at: string
  document_id?: string
  document_revision?: string
  collected?: boolean
  synced_media?: { id: number; path: string; name: string }[]
  lineage?: ProductionSource | Record<string, never>
  input_owner?: string
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
