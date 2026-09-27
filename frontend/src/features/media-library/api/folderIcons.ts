import { axiosInst } from '@/shared/api/httpClient'

export type FolderIconMap = Record<string, string>

export async function getFolderIcons(): Promise<FolderIconMap> {
  return (await axiosInst.value.get('/folder-icons')).data
}

export async function saveFolderIcon(path: string, icon: string): Promise<void> {
  await axiosInst.value.put('/folder-icons', { path, icon })
}
