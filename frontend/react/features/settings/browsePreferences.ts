import { patchServerPreferences } from './serverPreferences'
import { readSmallThumbnailWidth } from '../media/masonryModel'

export type BrowsePreferences = {
  enableThumbnail: boolean
  gridThumbnailResolution: number
  smallThumbnailWidth: number
  autoUpdateIndex: boolean
}

const key = 'iib-react-browse-preferences'
export const browsePreferencesEvent = 'iib-react-browse-preferences-changed'

const defaults: BrowsePreferences = {
  enableThumbnail: true,
  gridThumbnailResolution: 512,
  smallThumbnailWidth: 176,
  autoUpdateIndex: true
}

function clampStep(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  step: number
) {
  const number = Number(value)
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(minimum, Math.round(number / step) * step))
    : fallback
}

export function readBrowsePreferences(): BrowsePreferences {
  try {
    const saved = JSON.parse(
      localStorage.getItem(key) || localStorage.getItem('omnigallery:useApplicationStore') || 'null'
    ) as (Partial<BrowsePreferences> & { defaultGridCellWidth?: number }) | null
    if (!saved || typeof saved !== 'object') return { ...defaults }
    return {
      enableThumbnail:
        typeof saved.enableThumbnail === 'boolean'
          ? saved.enableThumbnail
          : defaults.enableThumbnail,
      gridThumbnailResolution: clampStep(saved.gridThumbnailResolution, 512, 256, 1024, 64),
      smallThumbnailWidth: readSmallThumbnailWidth(
        saved.smallThumbnailWidth,
        saved.defaultGridCellWidth
      ),
      autoUpdateIndex:
        typeof saved.autoUpdateIndex === 'boolean'
          ? saved.autoUpdateIndex
          : defaults.autoUpdateIndex
    }
  } catch {
    return { ...defaults }
  }
}

function applyBrowsePreferences(prefs: BrowsePreferences) {
  try {
    localStorage.setItem(key, JSON.stringify(prefs))
    window.dispatchEvent(
      new CustomEvent<BrowsePreferences>(browsePreferencesEvent, { detail: prefs })
    )
  } catch {
    /* An unavailable storage context should not break the current session. */
  }
}

export function hydrateBrowsePreferences(global: Record<string, unknown>): void {
  const current = readBrowsePreferences()
  applyBrowsePreferences({
    enableThumbnail:
      typeof global.enableThumbnail === 'boolean'
        ? global.enableThumbnail
        : current.enableThumbnail,
    gridThumbnailResolution: clampStep(
      global.gridThumbnailResolution,
      current.gridThumbnailResolution,
      256,
      1024,
      64
    ),
    smallThumbnailWidth:
      global.smallThumbnailWidth !== undefined || global.defaultGridCellWidth !== undefined
        ? readSmallThumbnailWidth(global.smallThumbnailWidth, global.defaultGridCellWidth)
        : current.smallThumbnailWidth,
    autoUpdateIndex:
      typeof global.autoUpdateIndex === 'boolean' ? global.autoUpdateIndex : current.autoUpdateIndex
  })
}

export function saveBrowsePreferences(prefs: BrowsePreferences): Promise<void> {
  applyBrowsePreferences(prefs)
  return patchServerPreferences(prefs)
}
