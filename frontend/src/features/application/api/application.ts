import { axiosInst } from '@/shared/api/httpClient'
import type { ExtraPathModel, Tag } from '@/features/media-library/public'

import type { ArchiveSettings } from '@/features/settings/public'

export interface AutoTagFilter {
  field: string
  operator: string
  value: string
}

export interface AutoTagRule {
  tag: string
  filters: AutoTagFilter[]
}

export interface FullscreenLayoutSettings {
  enable: boolean
  panelWidth: number
  alwaysOn: boolean
}

export interface AppSettingValues {
  global: Record<string, unknown>
  fullscreen_layout: FullscreenLayoutSettings
  auto_tag_rules: AutoTagRule[]
  workbench_projects: unknown
  [key: `workspace_snapshot_${string}`]: unknown
}
export const greeting = async () => {
  const resp = await axiosInst.value.get('hello')
  return resp.data as string
}

export interface GlobalConf {
  all_custom_tags: Tag[]
  is_win: boolean
  cwd: string
  home: string
  working_dir: string
  archive: ArchiveSettings
  extra_paths: ExtraPathModel[]
  enable_access_control: boolean
  launch_mode: 'server'
  app_fe_setting: Partial<AppSettingValues>
  is_readonly: boolean
}

export const getGlobalSetting = async () => {
  const resp = await axiosInst.value.get('/global_setting')
  return resp.data as GlobalConf
}

export const getVersion = async () => {
  const resp = await axiosInst.value.get('/version')
  return resp.data as { hash?: string; tag?: string }
}

export const setAppFeSetting = async <Key extends keyof AppSettingValues>(
  name: Key,
  setting: AppSettingValues[Key]
) => {
  await axiosInst.value.post('/app_fe_setting', { name, value: JSON.stringify(setting) })
}

export const removeAppFeSetting = async (name: keyof GlobalConf['app_fe_setting']) => {
  await axiosInst.value.delete('/app_fe_setting', { data: { name } })
}
