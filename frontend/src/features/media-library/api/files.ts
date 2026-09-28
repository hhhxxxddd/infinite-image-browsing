import { Dict } from '@/shared/types/common'
import { axiosInst } from '@/shared/api/httpClient'
import type { StudioDocument } from '@/features/image-editor/public'
import { folderExpansion } from '../model/folderExpansion'

export interface FileNodeInfo {
  edit_snapshot?: { owner: string; revision: string; asset: string }
  workspace_artifact_id?: string
  workspace_artifact_source?: 'image_studio' | 'ai_image_edit'
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

export const getTargetFolderFiles = async (folder_path: string, directoriesOnly = false) => {
  const resp = await axiosInst.value.get('/files', {
    params: { folder_path, directories_only: directoriesOnly }
  })
  return resp.data as { files: FileNodeInfo[] }
}

export const deleteFiles = async (file_paths: string[]) => {
  const resp = await axiosInst.value.post('/delete_files', { file_paths })
  for (const path of file_paths) {
    folderExpansion.forget(path)
    folderExpansion.forget(path, true)
  }
  return resp.data as { ok: true }
}

export const moveFiles = async (
  file_paths: string[],
  dest: string,
  create_dest_folder?: boolean,
  continue_on_error?: boolean
) => {
  const resp = await axiosInst.value.post('/move_files', {
    file_paths,
    dest,
    create_dest_folder,
    continue_on_error
  })
  // Only remap after an entirely successful move; partial failures do not identify their source paths.
  if (!(resp.data as { errors?: string[] }).errors?.length)
    for (const path of file_paths) {
      const name = path
        .replace(/[\\/]+$/, '')
        .split(/[\\/]/)
        .pop()
      if (!name) continue
      const destination = `${dest.replace(/[\\/]+$/, '')}/${name}`
      folderExpansion.remap(path, destination)
      folderExpansion.remap(path, destination, true)
    }
  return resp.data as { files: FileNodeInfo[] }
}

export const copyFiles = async (
  file_paths: string[],
  dest: string,
  create_dest_folder?: boolean,
  continue_on_error?: boolean
) => {
  const resp = await axiosInst.value.post('/copy_files', {
    file_paths,
    dest,
    create_dest_folder,
    continue_on_error
  })
  return resp.data as { files: FileNodeInfo[] }
}

export const mkdirs = async (dest_folder: string) => {
  await axiosInst.value.post('/mkdirs', { dest_folder })
}

export const batchGetFilesInfo = async (paths: string[]) => {
  const resp = await axiosInst.value.post('/batch_get_files_info', { paths })
  return resp.data as Dict<FileNodeInfo>
}

export interface ImageCropRect {
  x: number
  y: number
  width: number
  height: number
}

export const saveEditedImage = async (
  path: string,
  crop: ImageCropRect,
  width: number,
  height: number,
  overwrite = false
) => {
  const resp = await axiosInst.value.post('/edit_image', { path, crop, width, height, overwrite })
  return resp.data as { file: FileNodeInfo }
}

export interface ImageEditRecord {
  id: string
  created_at: string
  updated_at: string
  overwrite: boolean
  source_path: string
  document: StudioDocument
  export_area: 'content' | 'canvas'
  asset_info: Record<string, FileNodeInfo>
}
export const getImageEditHistory = async (path: string, revision?: string) => {
  const response = await axiosInst.value.get('/image_edit_history', { params: { path, revision } })
  return response.data as { record: ImageEditRecord | null }
}
export const saveComposedImage = async (
  path: string,
  width: number,
  height: number,
  renderedBase64: string,
  overwrite = false,
  editorDocument?: StudioDocument,
  exportArea: 'content' | 'canvas' = 'content',
  parentRevision?: string
) => {
  const resp = await axiosInst.value.post('/edit_image', {
    path,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    width,
    height,
    rendered_base64: renderedBase64,
    overwrite,
    editor_document: editorDocument,
    export_area: exportArea,
    parent_revision: parentRevision
  })
  return resp.data as { file: FileNodeInfo; record: ImageEditRecord }
}
