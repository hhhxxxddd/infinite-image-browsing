import type { WorkspaceAsset, MediaKind } from './workspaceModel'

export type AICreationSection = 'generation' | 'edit' | 'audio' | 'video'

export function materialKinds(tool: 'image' | 'ai', section: AICreationSection): MediaKind[] {
  if (tool === 'image' || section === 'generation' || section === 'edit') return ['image']
  return section === 'audio' ? ['audio'] : ['video', 'image', 'audio']
}

export interface MaterialAction {
  key: string
  label: string
  disabled?: boolean
  danger?: boolean
}

export type MaterialClickMode = 'view' | 'add' | 'replace' | 'switch'
export interface MaterialClickOption {
  value: MaterialClickMode
  label: string
  title: string
  disabled?: boolean
}

/** Tool-owned roles and commands; browsing state belongs to the shared shelf. */
export interface MaterialController {
  assets: WorkspaceAsset[]
  roles: Record<string, string>
  activePath: string
  recentPaths: string[]
  clickMode?: MaterialClickMode
  clickOptions?: MaterialClickOption[]
  setClickMode?: (mode: MaterialClickMode) => void
  select: (asset: WorkspaceAsset, event: MouseEvent) => void
  actions: (asset: WorkspaceAsset) => MaterialAction[]
  runAction: (asset: WorkspaceAsset, key: string) => void
}
