import type { WorkspaceAsset, WorkspaceRecord } from './workspaceModel'

export interface MediaPath {
  id: number
  path: string
  name: string
}
const cacheKey = 'omnigallery:workbench-media-paths-v1'
const draftPrefixes = [
  'omnigallery:workbench-image-document-v2:',
  'omnigallery:ai-image-edit-v1:',
  'omnigallery:ai-image-edit-asset-v1:',
  'omnigallery:ai-image-edit-recent-v1:',
  'omnigallery:ai-image-refs-v1:',
  'omnigallery:ai-image-ref-v1:'
]
const basename = (path: string) => path.split(/[\\/]/).pop() ?? path

function storageKeys(storage: Storage): string[] {
  return Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
    (key): key is string => key !== null
  )
}

/** Match a whole workspace ID, never a prefix shared with another workspace. */
export function removeWorkspaceAIDrafts(storage: Storage, workspaceId: string) {
  const prefixes = draftPrefixes
    .filter((prefix) => prefix.startsWith('omnigallery:ai-'))
    .map((prefix) => `${prefix}${workspaceId}`)
  const keys = storageKeys(storage)
  for (const key of keys) {
    if (prefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}:`)))
      storage.removeItem(key)
  }
}

/** Remove AI drafts for a deleted artifact without touching other workspaces or image compositions. */
export function removeWorkspaceAssetDrafts(storage: Storage, workspaceId: string, path: string) {
  const encoded = encodeURIComponent(path)
  storage.removeItem(`omnigallery:ai-image-edit-v1:${workspaceId}:${encoded}`)
  storage.removeItem(`omnigallery:ai-image-refs-v1:${workspaceId}:${encoded}`)
  const lastKey = `omnigallery:ai-image-edit-asset-v1:${workspaceId}`
  if (storage.getItem(lastKey) === path) storage.removeItem(lastKey)
  const refPrefix = `omnigallery:ai-image-ref-v1:${workspaceId}:`
  const keys = storageKeys(storage)
  for (const key of keys) {
    if (
      key.startsWith(refPrefix) &&
      (key.startsWith(`${refPrefix}${encoded}:`) || key.endsWith(`:${encoded}`))
    )
      storage.removeItem(key)
    if (
      key.startsWith(`omnigallery:ai-image-refs-v1:${workspaceId}:`) ||
      key === `omnigallery:ai-image-edit-recent-v1:${workspaceId}`
    ) {
      let paths: unknown
      try {
        paths = JSON.parse(storage.getItem(key) || '[]')
      } catch {
        continue
      }
      if (Array.isArray(paths))
        storage.setItem(key, JSON.stringify(paths.filter((item) => item !== path)))
    }
  }
}

/** Only rewrite file references; captions, prompts and custom layer names stay intact. */
function remapDocument(value: unknown, paths: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => remapDocument(item, paths))
  if (!value || typeof value !== 'object') return value
  const item = value as Record<string, unknown>
  const next = Object.fromEntries(
    Object.entries(item).map(([key, child]) => [key, remapDocument(child, paths)])
  )
  const mappedPath = typeof item.path === 'string' ? paths.get(item.path) : undefined
  if (typeof item.path === 'string' && mappedPath !== undefined) {
    next.path = mappedPath
    if (item.name === basename(item.path)) next.name = basename(mappedPath)
  }
  return next
}

export function remapWorkspaceDrafts(storage: Storage, paths: Map<string, string>) {
  if (!paths.size) return
  const encoded = new Map(
    [...paths].map(([oldPath, newPath]) => [
      encodeURIComponent(oldPath),
      encodeURIComponent(newPath)
    ])
  )
  const keys = storageKeys(storage)
  for (const key of keys) {
    if (!draftPrefixes.some((prefix) => key.startsWith(prefix))) continue
    const raw = storage.getItem(key)
    if (raw === null) continue
    const nextKey = key
      .split(':')
      .map((part) => encoded.get(part) ?? part)
      .join(':')
    let next: string
    if (key.startsWith('omnigallery:ai-image-edit-asset-v1:')) next = paths.get(raw) ?? raw
    else {
      let value: unknown
      try {
        value = JSON.parse(raw)
      } catch {
        continue
      }
      if (
        key.startsWith('omnigallery:ai-image-refs-v1:') ||
        key.startsWith('omnigallery:ai-image-edit-recent-v1:')
      ) {
        next = JSON.stringify(
          Array.isArray(value) ? value.map((path) => paths.get(path) ?? path) : value
        )
      } else next = JSON.stringify(remapDocument(value, paths))
    }
    // Keep an existing draft at the destination instead of overwriting newer edits.
    if (nextKey !== key && storage.getItem(nextKey) !== null) continue
    if (next !== raw || nextKey !== key) storage.setItem(nextKey, next)
    if (nextKey !== key) storage.removeItem(key)
  }
}

export function remapWorkspaceRecords(
  records: WorkspaceRecord[],
  paths: Map<string, string>
): WorkspaceRecord[] {
  const remap = (assets: WorkspaceAsset[]) =>
    assets.map((asset) => {
      const path = paths.get(asset.path)
      return path ? { ...asset, path, name: basename(path) } : asset
    })
  return records.map((workspace) => ({
    ...workspace,
    assets: remap(workspace.assets),
    outputs: remap(workspace.outputs)
  }))
}

/** Resolve stable media IDs before any editor reads its path-keyed browser drafts. */
export function reconcileWorkspaceReferences(
  records: WorkspaceRecord[],
  media: MediaPath[],
  storage: Storage
) {
  const byId = new Map(media.map((item) => [item.id, item]))
  let previous: Record<string, string> = {}
  try {
    previous = JSON.parse(storage.getItem(cacheKey) ?? '{}') ?? {}
  } catch {
    /* Fresh cache. */
  }
  const paths = new Map<string, string>()
  const cache: Record<string, string> = {}
  for (const workspace of records)
    for (const asset of [...workspace.assets, ...workspace.outputs]) {
      if (asset.id === undefined) continue
      const current = byId.get(asset.id)
      if (!current) continue
      cache[asset.id] = current.path
      if (asset.path !== current.path) paths.set(asset.path, current.path)
      const oldPath = previous[asset.id]
      if (typeof oldPath === 'string' && oldPath !== current.path) paths.set(oldPath, current.path)
    }
  remapWorkspaceDrafts(storage, paths)
  storage.setItem(cacheKey, JSON.stringify(cache))
  return remapWorkspaceRecords(records, paths)
}
