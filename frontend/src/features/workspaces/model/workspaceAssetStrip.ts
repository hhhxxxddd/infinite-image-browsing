import type { WorkspaceAsset } from './workspaceModel'
import type { StudioTask } from '@/features/ai-workflows/model/studioTaskTypes'
import type { FileNodeInfo } from '@/shared/types/fileNode'

export function workspaceProductPaths(
  assets: WorkspaceAsset[],
  assetInfo: Record<
    string,
    Pick<FileNodeInfo, 'workspace_artifact_id' | 'workspace_input_owner' | 'created_time'>
  >
): string[] {
  return assets
    .filter(
      (asset) =>
        assetInfo[asset.path]?.workspace_artifact_id &&
        !assetInfo[asset.path]?.workspace_input_owner
    )
    .sort((a, b) =>
      (assetInfo[b.path]?.created_time ?? '').localeCompare(assetInfo[a.path]?.created_time ?? '')
    )
    .map((asset) => asset.path)
}

export function sliceWorkspaceStripGroups(groups: WorkspaceStripGroup[], limit: number) {
  let remaining = Math.max(0, limit)
  return groups
    .map((group) => {
      const items = group.items.slice(0, remaining)
      remaining -= items.length
      return { ...group, items }
    })
    .filter((group) => group.items.length)
}

export type WorkspaceStripItem =
  | { kind: 'asset'; key: string; asset: WorkspaceAsset }
  | { kind: 'task'; key: string; task: StudioTask }

/** Keep promotion history even after a role is removed; new results never displace it. */
export function buildWorkspaceStrip(
  assets: WorkspaceAsset[],
  recent: string[],
  selected: string[],
  tasks: StudioTask[],
  createdPaths: string[]
): WorkspaceStripItem[] {
  const remaining = new Map(assets.map((asset) => [asset.path, asset]))
  const items: WorkspaceStripItem[] = []
  const append = (paths: string[]) => {
    for (const path of paths) {
      const asset = remaining.get(path)
      if (!asset) continue
      items.push({ kind: 'asset', key: `asset:${path}`, asset })
      remaining.delete(path)
    }
  }
  append([...recent, ...selected])
  items.push(
    ...tasks
      .filter((task) => task.state !== 'completed')
      .map((task) => ({ kind: 'task' as const, key: `task:${task.id}`, task }))
  )
  append(createdPaths)
  append([...remaining.keys()])
  return items
}

export interface WorkspaceStripGroup {
  key: 'products' | 'references'
  label: string
  items: WorkspaceStripItem[]
  assetCount: number
}

/** Promote usage history within each origin; remaining products stay newest first. */
export function groupWorkspaceStrip(
  items: WorkspaceStripItem[],
  createdPaths: string[],
  promotedPaths: string[] = []
): WorkspaceStripGroup[] {
  const promotedRanks = new Map([...new Set(promotedPaths)].map((path, index) => [path, index]))
  const ranks = new Map(createdPaths.map((path, index) => [path, index]))
  const products: WorkspaceStripItem[] = []
  const references: WorkspaceStripItem[] = []
  for (const item of items) {
    const target = item.kind === 'task' || ranks.has(item.asset.path) ? products : references
    target.push(item)
  }
  const promotionRank = (item: WorkspaceStripItem) =>
    item.kind === 'asset'
      ? (promotedRanks.get(item.asset.path) ?? Number.MAX_SAFE_INTEGER)
      : Number.MAX_SAFE_INTEGER
  const comparePromotion = (a: WorkspaceStripItem, b: WorkspaceStripItem) =>
    promotionRank(a) - promotionRank(b)
  products.sort((a, b) => {
    const rank = (item: WorkspaceStripItem) =>
      item.kind === 'task' ? -1 : (ranks.get(item.asset.path) ?? Number.MAX_SAFE_INTEGER)
    return comparePromotion(a, b) || rank(a) - rank(b)
  })
  references.sort(comparePromotion)
  return [
    {
      key: 'products' as const,
      label: '产物',
      items: products,
      assetCount: products.filter((item) => item.kind === 'asset').length
    },
    { key: 'references' as const, label: '引用', items: references, assetCount: references.length }
  ].filter((group) => group.items.length)
}
