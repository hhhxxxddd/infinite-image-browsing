import { axiosInst } from '@/shared/api/httpClient'

export type RuntimeVariant = 'cpu' | 'cu128'
export type DesktopRuntimeStatus = {
  supported: boolean
  installed: boolean
  path: string
  recipe: string
  update_available: boolean
  variant: RuntimeVariant
  check: { ready?: boolean; device?: string; detail?: string; versions?: Record<string, string> }
  job: { running: boolean; stage: string; error: string; progress: number }
}

export async function getDesktopRuntime(): Promise<DesktopRuntimeStatus> {
  return (await axiosInst.value.get('/ai-runtime')).data
}

export async function manageDesktopRuntime(
  action: 'check' | 'install',
  variant: RuntimeVariant
): Promise<DesktopRuntimeStatus> {
  return (await axiosInst.value.post(`/ai-runtime/${action}`, { variant })).data
}
