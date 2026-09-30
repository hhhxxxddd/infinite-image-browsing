/** Media API shape shared by Vue and React renderers without importing either UI runtime. */
export interface FileNodeInfo {
  edit_snapshot?: { owner: string; revision: string; asset: string }
  workspace_artifact_id?: string
  workspace_input_owner?: string
  workspace_artifact_source?:
    'image_studio' | 'ai_image_edit' | 'ai_image_generation' | 'audio_studio' | 'video_studio'
  id?: number
  size: string
  type: 'file' | 'dir'
  created_time: string
  name: string
  date: string
  bytes: number
  fullpath: string
  is_under_scanned_path: boolean
  gen_info_raw?: string
  gen_info_obj?: object
  cover_url?: string
  cloud_only?: boolean
  width?: number | null
  height?: number | null
}
