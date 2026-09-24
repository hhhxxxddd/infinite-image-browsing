export type ToolKey = 'image' | 'ai' | 'media'
export type WorkspaceStatus = 'active' | 'paused'
export type MediaKind = 'image' | 'video' | 'audio'

export interface WorkspaceAsset {
  id?: number
  path: string
  name: string
  kind: MediaKind
}

export interface WorkspaceRecord {
  id: string
  name: string
  brief: string
  status: WorkspaceStatus
  createdAt: string
  updatedAt: string
  lastTool: ToolKey
  assets: WorkspaceAsset[]
  outputs: WorkspaceAsset[]
  notes: Partial<Record<ToolKey, string>>
}

const toolKeys: ToolKey[] = ['image', 'ai', 'media']
const mediaKinds: MediaKind[] = ['image', 'video', 'audio']

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readAssets(value: unknown): WorkspaceAsset[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.flatMap((item): WorkspaceAsset[] => {
    if (!record(item) || typeof item.path !== 'string' || !item.path || seen.has(item.path)) return []
    if (typeof item.name !== 'string' || !mediaKinds.includes(item.kind as MediaKind)) return []
    seen.add(item.path)
    return [{ path: item.path, name: item.name, kind: item.kind as MediaKind,
      ...(typeof item.id === 'number' && Number.isSafeInteger(item.id) ? { id: item.id } : {}) }]
  }).slice(0, 500)
}

export function readWorkspaceRecords(value: unknown): WorkspaceRecord[] {
  if (!record(value) || !Array.isArray(value.items)) return []
  return value.items.flatMap((item): WorkspaceRecord[] => {
    if (!record(item) || typeof item.id !== 'string' || typeof item.name !== 'string'
      || !item.name.trim() || typeof item.updatedAt !== 'string') return []
    const legacyTool = item.kind === 'ai' ? 'ai' : item.kind === 'video' || item.kind === 'audio' ? 'media' : 'image'
    const lastTool = item.lastTool === 'templates' ? 'image'
      : toolKeys.includes(item.lastTool as ToolKey) ? item.lastTool as ToolKey : legacyTool
    const notes: WorkspaceRecord['notes'] = {}
    if (record(item.notes)) for (const key of toolKeys) {
      if (typeof item.notes[key] === 'string') notes[key] = (item.notes[key] as string).slice(0, 5000)
    }
    if (!notes.image && record(item.notes) && typeof item.notes.templates === 'string') {
      notes.image = item.notes.templates.slice(0, 5000)
    }
    return [{ id: item.id, name: item.name.trim().slice(0, 80), brief: typeof item.brief === 'string' ? item.brief.slice(0, 500) : '',
      status: item.status === 'paused' ? 'paused' : 'active',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : item.updatedAt,
      updatedAt: item.updatedAt, lastTool, assets: readAssets(item.assets), outputs: readAssets(item.outputs), notes }]
  }).slice(0, 100)
}

export function addWorkspaceAssets(existing: WorkspaceAsset[], incoming: WorkspaceAsset[]): WorkspaceAsset[] {
  const seen = new Set(existing.map(item => item.path))
  return [...existing, ...incoming.filter(item => {
    if (seen.has(item.path)) return false
    seen.add(item.path)
    return true
  })].slice(0, 500)
}
