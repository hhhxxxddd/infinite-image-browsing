import type { WorkspaceAsset } from './workspaceModel'
import type { StudioTask } from '@/features/ai-workflows/public'

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
