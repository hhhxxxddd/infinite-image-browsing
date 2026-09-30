import { patchServerPreferences } from './serverPreferences'

export type GeneralPreferences = {
  longPressOpenContextMenu: boolean
  confirmSingleDelete: boolean
}

const key = 'iib-react-general-preferences'
export const generalPreferencesEvent = 'iib-react-general-preferences-changed'

function legacyPreferences(): Partial<GeneralPreferences> {
  try {
    const store = JSON.parse(localStorage.getItem('omnigallery:useApplicationStore') || 'null') as {
      longPressOpenContextMenu?: boolean
      ignoredConfirmActions?: { deleteOneOnly?: boolean }
    } | null
    return {
      longPressOpenContextMenu: store?.longPressOpenContextMenu,
      confirmSingleDelete:
        store?.ignoredConfirmActions?.deleteOneOnly === undefined
          ? undefined
          : !store.ignoredConfirmActions.deleteOneOnly
    }
  } catch {
    return {}
  }
}

export function readGeneralPreferences(): GeneralPreferences {
  let saved: Partial<GeneralPreferences> | null = null
  try {
    saved = JSON.parse(localStorage.getItem(key) || 'null') as Partial<GeneralPreferences> | null
  } catch {
    /* Ignore a damaged previous value. */
  }
  const source = saved || legacyPreferences()
  return {
    longPressOpenContextMenu:
      typeof source.longPressOpenContextMenu === 'boolean'
        ? source.longPressOpenContextMenu
        : false,
    confirmSingleDelete:
      typeof source.confirmSingleDelete === 'boolean' ? source.confirmSingleDelete : true
  }
}

function applyGeneralPreferences(prefs: GeneralPreferences): void {
  try {
    localStorage.setItem(key, JSON.stringify(prefs))
    window.dispatchEvent(
      new CustomEvent<GeneralPreferences>(generalPreferencesEvent, { detail: prefs })
    )
  } catch {
    /* The current session can continue without persisted preferences. */
  }
}

export function hydrateGeneralPreferences(global: Record<string, unknown>): void {
  const current = readGeneralPreferences()
  const ignored = global.ignoredConfirmActions
  const deleteOneOnly =
    ignored && typeof ignored === 'object' && !Array.isArray(ignored)
      ? (ignored as Record<string, unknown>).deleteOneOnly
      : undefined
  applyGeneralPreferences({
    longPressOpenContextMenu:
      typeof global.longPressOpenContextMenu === 'boolean'
        ? global.longPressOpenContextMenu
        : current.longPressOpenContextMenu,
    confirmSingleDelete:
      typeof deleteOneOnly === 'boolean' ? !deleteOneOnly : current.confirmSingleDelete
  })
}

export function saveGeneralPreferences(prefs: GeneralPreferences): Promise<void> {
  applyGeneralPreferences(prefs)
  return patchServerPreferences({
    longPressOpenContextMenu: prefs.longPressOpenContextMenu,
    ignoredConfirmActions: { deleteOneOnly: !prefs.confirmSingleDelete }
  })
}
