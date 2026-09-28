import { shallowRef } from 'vue'

export const FOLDER_EXPANSION_STORAGE_KEY = 'omnigallery:folder-expansion:v1'
type ExpansionStorage = Pick<Storage, 'getItem' | 'setItem'>

function pathKey(path: string, windows: boolean) {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '') || '/'
  return `${windows ? 'win' : 'posix'}:${windows ? normalized.toLowerCase() : normalized}`
}

function descendantPrefix(key: string) {
  return key.endsWith('/') ? key : `${key}/`
}

function readStates(storage?: ExpansionStorage): Map<string, boolean> {
  try {
    const saved = JSON.parse(storage?.getItem(FOLDER_EXPANSION_STORAGE_KEY) ?? 'null')
    if (saved?.version !== 1 || !Array.isArray(saved.entries)) return new Map()
    return new Map(
      saved.entries.filter(
        (entry: unknown): entry is [string, boolean] =>
          Array.isArray(entry) &&
          entry.length === 2 &&
          typeof entry[0] === 'string' &&
          /^(win|posix):.+/.test(entry[0]) &&
          typeof entry[1] === 'boolean'
      )
    )
  } catch {
    return new Map()
  }
}

export function createFolderExpansion(storage?: ExpansionStorage) {
  const states = shallowRef(readStates(storage))

  function save(next: Map<string, boolean>) {
    if (
      next.size === states.value.size &&
      [...next].every(([path, expanded]) => states.value.get(path) === expanded)
    )
      return
    states.value = next
    try {
      storage?.setItem(
        FOLDER_EXPANSION_STORAGE_KEY,
        JSON.stringify({ version: 1, entries: [...next] })
      )
    } catch {
      // Restricted or full storage must not disable directory browsing.
    }
  }

  return {
    get(path: string, windows = false): boolean | undefined {
      return states.value.get(pathKey(path, windows))
    },
    set(path: string, expanded: boolean, windows = false) {
      const next = new Map(states.value)
      next.set(pathKey(path, windows), expanded)
      save(next)
    },
    forget(path: string, windows = false) {
      const key = pathKey(path, windows)
      const prefix = descendantPrefix(key)
      save(
        new Map([...states.value].filter(([entry]) => entry !== key && !entry.startsWith(prefix)))
      )
    },
    remap(source: string, destination: string, windows = false) {
      const from = pathKey(source, windows)
      const to = pathKey(destination, windows)
      const prefix = descendantPrefix(from)
      const next = new Map(states.value)
      const moved = [...next].filter(([key]) => key === from || key.startsWith(prefix))
      for (const [key] of moved) next.delete(key)
      for (const [key, expanded] of moved)
        next.set(key === from ? to : descendantPrefix(to) + key.slice(prefix.length), expanded)
      save(next)
    },
    reconcileChildren(parent: string, children: string[], windows = false) {
      const prefix = descendantPrefix(pathKey(parent, windows))
      const present = new Set(children.map((child) => pathKey(child, windows)))
      save(
        new Map(
          [...states.value].filter(([key]) => {
            if (!key.startsWith(prefix)) return true
            const childKey = prefix + key.slice(prefix.length).split('/')[0]
            return present.has(childKey)
          })
        )
      )
    },
    retainRoots(roots: string[], windows = false) {
      const keys = roots.map((root) => pathKey(root, windows))
      const platform = windows ? 'win:' : 'posix:'
      save(
        new Map(
          [...states.value].filter(
            ([key]) =>
              !key.startsWith(platform) ||
              keys.some((root) => key === root || key.startsWith(descendantPrefix(root)))
          )
        )
      )
    }
  }
}

function browserStorage(): ExpansionStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

// One reactive record for both the directory page and embedded directory views.
export const folderExpansion = createFolderExpansion(browserStorage())
