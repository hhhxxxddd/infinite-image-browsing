import { apiFetch } from '../../shared/apiClient'

type GlobalPreferences = Record<string, unknown>

function record(value: unknown): GlobalPreferences {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as GlobalPreferences)
    : {}
}

export async function readServerPreferences(): Promise<GlobalPreferences> {
  const settings = await apiFetch<{ app_fe_setting?: { global?: unknown } }>('/global_setting')
  return record(settings.app_fe_setting?.global)
}

let pending: Promise<unknown> = Promise.resolve()

/** A fresh read for each write preserves settings owned by the Vue app and other tabs. */
export function patchServerPreferences(changes: GlobalPreferences): Promise<void> {
  const write = pending.then(async () => {
    const settings = await apiFetch<{
      app_fe_setting?: { global?: unknown }
      is_readonly?: boolean
    }>('/global_setting')
    if (settings.is_readonly) throw new Error('当前处于只读模式，无法修改设置')
    const current = record(settings.app_fe_setting?.global)
    const next = { ...current, ...changes }
    if (changes.ignoredConfirmActions) {
      next.ignoredConfirmActions = {
        ...record(current.ignoredConfirmActions),
        ...record(changes.ignoredConfirmActions)
      }
    }
    await apiFetch('/app_fe_setting', {
      method: 'POST',
      body: JSON.stringify({ name: 'global', value: JSON.stringify(next) })
    })
  })
  pending = write.catch(() => {})
  return write
}
