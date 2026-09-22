import { isTauri } from '@tauri-apps/api/core'
import { invoke } from '@tauri-apps/api/core'
import { ref } from 'vue'
export const tauriConf = ref<{ port: number }>()
export const refreshTauriConf = async () => {
  
  if (!isTauri()) {
    return
  }
  try {
    tauriConf.value = await invoke('get_tauri_conf')
  } catch (error) {
    console.error(error)
  }
}