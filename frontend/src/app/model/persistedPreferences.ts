import type { persistKeys, useApplicationStore } from '@/features/application/public'
import { SortMethod } from '../../features/application/public/preferences.ts'

type Store = ReturnType<typeof useApplicationStore>
export type PersistedPreferences = Pick<Store, Exclude<(typeof persistKeys)[number], 'recent'>>

/** Validate the server-side settings boundary before assigning values to the store. */
export function parsePersistedPreferences(value: unknown): Partial<PersistedPreferences> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const raw = value as Record<string, unknown>
  const parsed: Partial<PersistedPreferences> = {}
  for (const key of [
    'enableThumbnail',
    'longPressOpenContextMenu',
    'autoRefreshWalkMode',
    'autoRefreshNormalFixedMode',
    'batchDownloadCompress',
    'autoUpdateIndex'
  ] as const) {
    const item = raw[key]
    if (typeof item === 'boolean') parsed[key] = item
  }
  for (const key of [
    'defaultGridCellWidth',
    'gridThumbnailResolution',
    'autoRefreshWalkModePosLimit'
  ] as const) {
    const item = raw[key]
    if (typeof item === 'number' && Number.isFinite(item) && item >= 0) parsed[key] = item
  }
  if (
    raw.darkModeControl === 'auto' ||
    raw.darkModeControl === 'light' ||
    raw.darkModeControl === 'dark'
  ) {
    parsed.darkModeControl = raw.darkModeControl
  }
  if (
    raw.thumbnailSizePreset === 'custom' ||
    raw.thumbnailSizePreset === 'small' ||
    raw.thumbnailSizePreset === 'medium' ||
    raw.thumbnailSizePreset === 'large'
  ) {
    parsed.thumbnailSizePreset = raw.thumbnailSizePreset
  }
  const sorting = Object.values(SortMethod).find((method) => method === raw.defaultSortingMethod)
  if (sorting) parsed.defaultSortingMethod = sorting
  if (raw.lang === 'zhHans' || raw.lang === 'zhHant' || raw.lang === 'de' || raw.lang === 'en') {
    parsed.lang = raw.lang
  }
  if (Array.isArray(raw.fileTypeFilter)) {
    parsed.fileTypeFilter = raw.fileTypeFilter.filter(
      (type): type is 'image' | 'video' | 'audio' | 'all' =>
        type === 'image' || type === 'video' || type === 'audio' || type === 'all'
    )
  }
  if (
    raw.ignoredConfirmActions &&
    typeof raw.ignoredConfirmActions === 'object' &&
    'deleteOneOnly' in raw.ignoredConfirmActions &&
    typeof raw.ignoredConfirmActions.deleteOneOnly === 'boolean'
  ) {
    parsed.ignoredConfirmActions = { deleteOneOnly: raw.ignoredConfirmActions.deleteOneOnly }
  }
  return parsed
}
