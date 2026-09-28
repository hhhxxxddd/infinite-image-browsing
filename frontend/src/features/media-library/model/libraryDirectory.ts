import { findManagedFolder, topLevelManagedFolders } from '../../../shared/lib/folderScope.ts'

export const LIBRARY_DIRECTORY_STORAGE_KEY = 'omnigallery:library-save-directory:v1'
type DirectoryStorage = Pick<Storage, 'getItem' | 'setItem'>
type DirectoryRoot = { path: string; alias?: string; types: string[] }

export function scannedDirectoryRoots<T extends DirectoryRoot>(folders: T[], windows = false): T[] {
  return topLevelManagedFolders(
    folders.filter((folder) =>
      folder.types.some((type) => type === 'scanned' || type === 'scanned-fixed')
    ),
    windows
  )
}

export function isLibraryDirectory(path: string, roots: { path: string }[], windows = false) {
  if (!path || path.split(/[\\/]/).some((part) => part === '..')) return false
  return !!findManagedFolder(roots, path, windows)
}

export function libraryDirectoryBreadcrumbs(
  roots: { path: string; alias?: string }[],
  path: string,
  windows = false
): { path: string; name: string }[] {
  const root = findManagedFolder(roots, path, windows)
  if (!root) return []
  const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '')
  const relative = normalize(path).slice(normalize(root.path).length).split('/').filter(Boolean)
  const crumbs = [
    {
      path: root.path,
      name: root.alias || root.path.split(/[\\/]/).filter(Boolean).pop() || root.path
    }
  ]
  for (const name of relative) {
    const parent = crumbs[crumbs.length - 1].path.replace(/[\\/]+$/, '')
    crumbs.push({ path: parent + (windows ? '\\' : '/') + name, name })
  }
  return crumbs
}

export function readLibraryDirectory(
  storage: DirectoryStorage | undefined,
  roots: { path: string }[],
  windows = false
): string {
  try {
    const value = JSON.parse(storage?.getItem(LIBRARY_DIRECTORY_STORAGE_KEY) ?? 'null')
    return value?.version === 1 &&
      typeof value.directory === 'string' &&
      isLibraryDirectory(value.directory, roots, windows)
      ? value.directory
      : ''
  } catch {
    return ''
  }
}

export function rememberLibraryDirectory(storage: DirectoryStorage | undefined, directory: string) {
  try {
    storage?.setItem(LIBRARY_DIRECTORY_STORAGE_KEY, JSON.stringify({ version: 1, directory }))
  } catch {
    // Choosing a directory remains usable when local storage is restricted.
  }
}
