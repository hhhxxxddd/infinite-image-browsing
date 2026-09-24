import { axiosInst } from './index'

export type FolderIconMap = Record<string, string>

export async function getFolderIcons(): Promise<FolderIconMap> {
  return (await axiosInst.value.get('/db/folder-icons')).data
}

export async function saveFolderIcon(path: string, icon: string): Promise<void> {
  await axiosInst.value.put('/db/folder-icons', { path, icon })
}
