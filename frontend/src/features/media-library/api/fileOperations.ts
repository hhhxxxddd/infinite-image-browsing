import { axiosInst } from '@/shared/api/httpClient'

import type { FileNodeInfo } from '@/features/media-library/api/files'
import type { Dict } from '@/shared/types/common'
export const checkPathExists = async (paths: string[]) => {
  const resp = await axiosInst.value.post('/check_path_exists', { paths })
  return resp.data as Record<string, boolean>
}

export const checkPathIsDirectory = async (paths: string[]) => {
  const resp = await axiosInst.value.post('/check_path_is_directory', { paths })
  return resp.data as Record<string, boolean>
}

export const chooseLocalDirectory = async () => {
  const resp = await axiosInst.value.post('/choose_local_directory')
  return resp.data.path as string | null
}

export const openFolder = async (path: string) => {
  await axiosInst.value.post('/open_folder', { path })
}

export const openWithDefaultApp = async (path: string) => {
  await axiosInst.value.post('/open_with_default_app', { path })
}

export const openWithAppPicker = async (path: string) => {
  await axiosInst.value.post('/open_with_app_picker', { path })
}

export interface Top4MediaInfo extends FileNodeInfo {
  media_type: 'video' | 'image'
}

export const batchGetDirTop4MediaInfo = async (paths: string[]) => {
  const resp = await axiosInst.value.post('/batch_top_4_media_info', { paths })
  return resp.data as Dict<Top4MediaInfo[]>
}

export const setTargetFrameAsCover = async (body: {
  path: string
  base64_img: string
  updated_time: string
}) => {
  await axiosInst.value.post('/set_target_frame_as_video_cover', body)
}

// AI 相关 API

export interface FlattenFolderReq {
  folder_path: string
  dry_run?: boolean
}

export interface FlattenFolderResp {
  success: boolean
  total_files: number
  conflicts: string[]
  moved_files?: number
  errors?: string[]
}

export const flattenFolder = async (req: FlattenFolderReq) => {
  const resp = await axiosInst.value.post('/flatten_folder', req)
  return resp.data as FlattenFolderResp
}
