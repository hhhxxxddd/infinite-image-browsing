import { isTauri as inTauri } from '@tauri-apps/api/core'
export const isTauri = inTauri()
export const isStandalone = window === parent