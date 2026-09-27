import { axiosInst } from '@/shared/api/httpClient'

export interface SyncSettings {
  enabled: boolean
  directory: string
}

export const getSyncSettings = async (): Promise<SyncSettings> =>
  (await axiosInst.value.get('/sync_settings')).data

export const saveSyncSettings = async (settings: SyncSettings): Promise<SyncSettings> =>
  (await axiosInst.value.put('/sync_settings', settings)).data

export interface ProjectStorageSettings {
  directory: string
  default_directory: string
  custom_directory: string
  previous_directory?: string
  migrated?: boolean
  files?: number
  bytes?: number
}

export const getProjectStorage = async () =>
  (await axiosInst.value.get<ProjectStorageSettings>('/project_storage')).data

export const saveProjectStorage = async (directory: string) =>
  (
    await axiosInst.value.put<ProjectStorageSettings>(
      '/project_storage',
      { directory },
      { timeout: 0 }
    )
  ).data

export interface ArchiveSettings {
  directory: string
  custom_directory: string
  default_directory: string
}

export const getArchiveSettings = async () =>
  (await axiosInst.value.get<ArchiveSettings>('/archive_settings')).data

export const saveArchiveSettings = async (directory: string) =>
  (await axiosInst.value.put<ArchiveSettings>('/archive_settings', { directory })).data
