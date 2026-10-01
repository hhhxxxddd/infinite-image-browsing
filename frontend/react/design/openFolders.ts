export interface OpenFolder {
  path: string
  name: string
}

const reactStorageKey = 'omnigallery:react-open-folders:v1'
const legacyStorageKey = 'omnigallery:tab-layout:v1'

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path
}

function parseReactFolders(raw: string | null): OpenFolder[] | null {
  if (!raw) return null
  try {
    const saved: unknown = JSON.parse(raw)
    if (!record(saved) || saved.version !== 1 || !Array.isArray(saved.folders)) return null
    return saved.folders.flatMap((value: unknown): OpenFolder[] => {
      if (!record(value) || typeof value.path !== 'string' || !value.path) return []
      return [
        {
          path: value.path,
          name: typeof value.name === 'string' && value.name ? value.name : folderName(value.path)
        }
      ]
    })
  } catch {
    return null
  }
}

function parseLegacyFolders(raw: string | null): OpenFolder[] {
  if (!raw) return []
  try {
    const saved: unknown = JSON.parse(raw)
    if (!record(saved) || saved.version !== 1 || !Array.isArray(saved.tabs)) return []
    const seen = new Set<string>()
    return saved.tabs.flatMap((tab: unknown): OpenFolder[] => {
      if (!record(tab) || !Array.isArray(tab.panes)) return []
      return tab.panes.flatMap((pane: unknown): OpenFolder[] => {
        if (!record(pane) || pane.type !== 'local' || typeof pane.path !== 'string') return []
        const path = pane.path.trim()
        const key = path.replace(/\\/g, '/').toLocaleLowerCase()
        if (!path || seen.has(key)) return []
        seen.add(key)
        return [
          {
            path,
            name: typeof pane.name === 'string' && pane.name ? pane.name : folderName(path)
          }
        ]
      })
    })
  } catch {
    return []
  }
}

export function readOpenFolders(): OpenFolder[] {
  try {
    return (
      parseReactFolders(localStorage.getItem(reactStorageKey)) ??
      parseLegacyFolders(localStorage.getItem(legacyStorageKey))
    )
  } catch {
    return []
  }
}

export function saveOpenFolders(folders: OpenFolder[]): void {
  try {
    localStorage.setItem(reactStorageKey, JSON.stringify({ version: 1, folders }))
  } catch {
    // Browsing remains available when storage is disabled.
  }
}

export function addOpenFolder(folders: OpenFolder[], path: string): OpenFolder[] {
  const name = folderName(path)
  if (
    folders.some(
      (folder) =>
        folder.path.replace(/\\/g, '/').toLocaleLowerCase() ===
        path.replace(/\\/g, '/').toLocaleLowerCase()
    )
  )
    return folders
  return [...folders, { path, name }]
}
