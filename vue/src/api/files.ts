import { Dict } from '@/util'
import { axiosInst } from '.'

export interface FileNodeInfo {
  workspace_artifact_id?: string
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
  const resp = await axiosInst.value.get('/files', { params: { folder_path, directories_only: directoriesOnly } })
  return resp.data as { files: FileNodeInfo[] }
}


export const deleteFiles = async (file_paths: string[]) => {
  const resp = await axiosInst.value.post('/delete_files', { file_paths })
  return resp.data as { ok: true }
}

export const moveFiles = async (
  file_paths: string[],
  dest: string,
  create_dest_folder?: boolean,
  continue_on_error?: boolean
) => {
  const resp = await axiosInst.value.post('/move_files', { file_paths, dest, create_dest_folder, continue_on_error })
  return resp.data as { files: FileNodeInfo[] }
}

export const copyFiles = async (
  file_paths: string[],
  dest: string,
  create_dest_folder?: boolean,
  continue_on_error?: boolean
) => {
  const resp = await axiosInst.value.post('/copy_files', { file_paths, dest, create_dest_folder, continue_on_error })
  return resp.data as { files: FileNodeInfo[] }
}

export const mkdirs = async (dest_folder: string) => {
  await axiosInst.value.post('/mkdirs', { dest_folder })
}


export const  batchGetFilesInfo = async (paths: string[]) => {
  const resp = await axiosInst.value.post('/batch_get_files_info', { paths }) 
  return  resp.data as Dict<FileNodeInfo>
}

export interface ImageCropRect { x: number; y: number; width: number; height: number }

export const saveEditedImage = async (path: string, crop: ImageCropRect, width: number, height: number) => {
  const resp = await axiosInst.value.post('/edit_image', { path, crop, width, height })
  return resp.data as { file: FileNodeInfo }
}
