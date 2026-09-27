import { axiosInst } from '@/shared/api/httpClient'

export interface NetworkProxySettings {
  enabled: boolean
  url: string
}

export interface NetworkProxyCheck {
  ready: boolean
  detail: string
}

export async function getNetworkProxySettings(): Promise<NetworkProxySettings> {
  return (await axiosInst.value.get('/network-proxy')).data
}

export async function saveNetworkProxySettings(
  settings: NetworkProxySettings
): Promise<NetworkProxySettings> {
  return (await axiosInst.value.put('/network-proxy', settings)).data
}

export async function checkNetworkProxy(): Promise<NetworkProxyCheck> {
  return (await axiosInst.value.get('/network-proxy/check', { timeout: 20000 })).data
}
