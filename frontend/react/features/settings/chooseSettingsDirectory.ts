import { isTauri } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { apiFetch } from '../../shared/apiClient'

/** The backend picker selects a directory on the file server when opened in a local browser. */
export async function chooseSettingsDirectory(current: string): Promise<string | undefined> {
  if (isTauri()) {
    const result = await open({ directory: true, defaultPath: current || undefined })
    return typeof result === 'string' ? result : undefined
  }
  const result = await apiFetch<{ path: string | null }>('/choose_local_directory', {
    method: 'POST'
  })
  return result.path || undefined
}
