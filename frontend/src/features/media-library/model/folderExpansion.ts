export const FOLDER_EXPANSION_STORAGE_KEY = 'omnigallery:folder-expansion:v1'
type ExpansionStorage = Pick<Storage, 'getItem' | 'setItem'>

export function isWindowsFolderPath(path: string) {
  return /^[a-z]:[\\/]/i.test(path) || path.includes('\\') || path.startsWith('//')
}

export function visibleExpandedFolders(
  roots: readonly { path: string }[],
  children: Readonly<Record<string, readonly { fullpath: string }[]>>,
  expansion: Pick<ReturnType<typeof createFolderExpansion>, 'get'>
) {
  const expanded = new Set<string>()
  function visit(path: string, root: boolean) {
    if (expanded.has(path) || !(expansion.get(path, isWindowsFolderPath(path)) ?? root)) return
    expanded.add(path)
    for (const child of children[path] ?? []) visit(child.fullpath, false)
  }
  for (const root of roots) visit(root.path, true)
  return expanded
}

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
  let states = readStates(storage)
  let revision = 0
  const listeners = new Set<() => void>()

  function save(next: Map<string, boolean>) {
    if (
      next.size === states.size &&
      [...next].every(([path, expanded]) => states.get(path) === expanded)
    )
      return
    states = next
    revision++
    try {
      storage?.setItem(
        FOLDER_EXPANSION_STORAGE_KEY,
        JSON.stringify({ version: 1, entries: [...next] })
      )
    } catch {
      // Restricted or full storage must not disable directory browsing.
    }
    listeners.forEach((listener) => listener())
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    snapshot: () => revision,
    get(path: string, windows = false): boolean | undefined {
      return states.get(pathKey(path, windows))
    },
    set(path: string, expanded: boolean, windows = false) {
      const next = new Map(states)
      next.set(pathKey(path, windows), expanded)
      save(next)
    },
    forget(path: string, windows = false) {
      const key = pathKey(path, windows)
      const prefix = descendantPrefix(key)
      save(new Map([...states].filter(([entry]) => entry !== key && !entry.startsWith(prefix))))
    },
    remap(source: string, destination: string, windows = false) {
      const from = pathKey(source, windows)
      const to = pathKey(destination, windows)
      const prefix = descendantPrefix(from)
      const next = new Map(states)
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
          [...states].filter(([key]) => {
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
          [...states].filter(
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

// One observable record for directory views; existing browser choices remain valid.
export const folderExpansion = createFolderExpansion(browserStorage())
