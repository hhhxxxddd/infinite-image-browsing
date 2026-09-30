import { isTauri } from '@tauri-apps/api/core'
import { invoke } from '@tauri-apps/api/core'
import { ref } from 'vue'
import { setRuntimeApiBase } from './runtimeApiBase'
export const tauriConf = ref<{ port: number }>()
export const refreshTauriConf = async () => {
  if (!isTauri()) {
    return
  }
  try {
    tauriConf.value = await invoke('get_tauri_conf')
    if (tauriConf.value) setRuntimeApiBase(`http://127.0.0.1:${tauriConf.value.port}/api`)
  } catch (error) {
    console.error(error)
  }
}
