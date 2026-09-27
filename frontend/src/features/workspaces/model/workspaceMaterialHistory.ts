const HISTORY_LIMIT = 500

/** Removing a role or layer never removes its material from the promotion history. */
export function mergeMaterialHistory(history: string[], paths: string[]): string[] {
  return [...new Set([...paths, ...history].filter(Boolean))].slice(0, HISTORY_LIMIT)
}

export function readMaterialHistory(
  key: string,
  storage: Pick<Storage, 'getItem'> = localStorage
): string[] {
  try {
    const stored: unknown = JSON.parse(storage.getItem(key) || '[]')
    return Array.isArray(stored)
      ? mergeMaterialHistory(
          [],
          stored.filter((path): path is string => typeof path === 'string')
        )
      : []
  } catch {
    return []
  }
}

export function writeMaterialHistory(
  key: string,
  paths: string[],
  storage: Pick<Storage, 'setItem'> = localStorage
) {
  try {
    storage.setItem(key, JSON.stringify(paths))
  } catch {
    // Keep the in-memory history when browser storage is unavailable.
  }
}
