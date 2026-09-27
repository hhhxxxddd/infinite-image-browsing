import type { WorkspaceAsset, MediaKind } from './workspaceModel'

export type AICreationSection = 'generation' | 'edit' | 'audio' | 'video'
export const aiCreationSections = [
  { id: 'generation', label: '图片生成' },
  { id: 'edit', label: '图片编辑' },
  { id: 'audio', label: '音频创作' },
  { id: 'video', label: '视频创作' }
] as const

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

/** Tool-owned roles and commands; browsing state belongs to the shared shelf. */
export interface MaterialController {
  assets: WorkspaceAsset[]
  roles: Record<string, string>
  activePath: string
  recentPaths: string[]
  select: (asset: WorkspaceAsset, event: MouseEvent) => void
  actions: (asset: WorkspaceAsset) => MaterialAction[]
  runAction: (asset: WorkspaceAsset, key: string) => void
}
