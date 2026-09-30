import { axiosInst } from '@/shared/api/httpClient'

export type MediaRuntimeStatus = {
  supported: boolean
  ready: boolean
  source: 'managed' | 'system' | 'missing'
  path: string
  version: string
  ffprobe_version: string
  managed_installed: boolean
  recipe: string
  update_available: boolean
  job: { running: boolean; stage: string; error: string; progress: number }
}

export async function getMediaRuntime(): Promise<MediaRuntimeStatus> {
  return (await axiosInst.value.get('/media-runtime')).data
}

export async function manageMediaRuntime(action: 'check' | 'install'): Promise<MediaRuntimeStatus> {
  return (await axiosInst.value.post(`/media-runtime/${action}`)).data
}
