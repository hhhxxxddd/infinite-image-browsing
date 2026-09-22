export function findManagedFolder<T extends { path: string }>(folders: T[], path?: string, windows = false): T | undefined {
  if (!path) return
  const normalize = (value: string) => {
    const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '')
    return windows ? normalized.toLowerCase() : normalized
  }
  const current = normalize(path)
  return folders.filter(folder => {
    const root = normalize(folder.path)
    return current === root || current.startsWith(root + '/')
  }).sort((a, b) => b.path.length - a.path.length)[0]
}

export function topLevelManagedFolders<T extends {path:string}>(folders: T[], windows = false): T[] {
  const normalized = (path: string) => { const value = path.replace(/\\/g, '/').replace(/\/+$/, ''); return windows ? value.toLowerCase() : value }
  return folders.filter((folder, index) => !folders.some((parent, parentIndex) => {
    const path = normalized(folder.path), ancestor = normalized(parent.path)
    return parentIndex !== index && (path.startsWith(ancestor + '/') || (path === ancestor && parentIndex < index))
  }))
}
