import type { FileNodeInfo } from '@/api/files'
import type { GridViewFile, Tab, TabPane } from '@/store/useGlobalStore'

export const TAB_LAYOUT_STORAGE_KEY = 'iib://tab-layout:v1'

type SavedPane = Record<string, unknown> & { key: string; type: TabPane['type']; name: string }
type SavedTab = { id: string; key: string; panes: SavedPane[] }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nameOf(pane: TabPane): string {
  return pane.nameFallbackStr || (typeof pane.name === 'string' ? pane.name : '')
}

function saveFile(file: FileNodeInfo): FileNodeInfo | null {
  if (!file || typeof file.fullpath !== 'string' || !file.fullpath) return null
  return {
    fullpath: file.fullpath,
    name: file.name,
    type: file.type,
    size: file.size,
    bytes: file.bytes,
    date: file.date,
    created_time: file.created_time,
    is_under_scanned_path: file.is_under_scanned_path,
    ...(typeof file.cover_url === 'string' ? { cover_url: file.cover_url } : {}),
    ...(typeof file.width === 'number' ? { width: file.width } : {}),
    ...(typeof file.height === 'number' ? { height: file.height } : {}),
  }
}

function restoreFile(value: unknown): FileNodeInfo | null {
  if (!record(value) || typeof value.fullpath !== 'string' || !value.fullpath) return null
  const name = typeof value.name === 'string' ? value.name : value.fullpath.split(/[\\/]/).pop() || value.fullpath
  return {
    fullpath: value.fullpath,
    name,
    type: value.type === 'dir' ? 'dir' : 'file',
    size: typeof value.size === 'string' ? value.size : '',
    bytes: typeof value.bytes === 'number' ? value.bytes : 0,
    date: typeof value.date === 'string' ? value.date : '',
    created_time: typeof value.created_time === 'string' ? value.created_time : '',
    is_under_scanned_path: value.is_under_scanned_path === true,
    ...(typeof value.cover_url === 'string' ? { cover_url: value.cover_url } : {}),
    ...(typeof value.width === 'number' ? { width: value.width } : {}),
    ...(typeof value.height === 'number' ? { height: value.height } : {}),
  }
}

function savePane(pane: TabPane): SavedPane | null {
  const base = { key: pane.key, type: pane.type, name: nameOf(pane) }
  switch (pane.type) {
    case 'empty': return { ...base, section: pane.section ?? 'all' }
    case 'local': return pane.path ? { ...base, path: pane.path, mode: pane.mode } : null
    case 'img-sli': {
      const left = saveFile(pane.left)
      const right = saveFile(pane.right)
      return left && right ? { ...base, left, right } : null
    }
    case 'grid-view': return {
      ...base,
      files: pane.files.map(file => {
        const saved = saveFile(file)
        return saved ? { ...saved, tags: file.tags?.map(tag => ({ ...tag })) } : null
      }).filter(Boolean),
      removable: pane.removable === true,
      allowDragAndDrop: pane.allowDragAndDrop === true,
    }
    case 'global-setting':
    case 'batch-download':
    case 'random-image': return base
  }
}

export function serializeTabLayout(tabs: Tab[]): string {
  const saved: SavedTab[] = tabs.map(tab => {
    const panes = tab.panes.map(savePane).filter((pane): pane is SavedPane => pane !== null)
    return { id: tab.id, key: panes.some(pane => pane.key === tab.key) ? tab.key : panes[0]?.key ?? '', panes }
  }).filter(tab => tab.panes.length)
  return JSON.stringify({ version: 1, tabs: saved })
}

function restorePane(value: unknown): TabPane | null {
  if (!record(value) || typeof value.key !== 'string' || !value.key || typeof value.type !== 'string') return null
  const base = { key: value.key, name: typeof value.name === 'string' ? value.name : '' }
  switch (value.type) {
    case 'empty': return { ...base, type: 'empty', section: ['all', 'image', 'video', 'audio', 'folders'].includes(String(value.section)) ? value.section as 'all' | 'image' | 'video' | 'audio' | 'folders' : 'all' }
    case 'local': return typeof value.path === 'string' && value.path
      ? { ...base, type: 'local', path: value.path, mode: ['walk', 'scanned', 'scanned-fixed'].includes(String(value.mode)) ? value.mode as 'walk' | 'scanned' | 'scanned-fixed' : undefined }
      : null
    case 'img-sli': {
      const left = restoreFile(value.left)
      const right = restoreFile(value.right)
      return left && right ? { ...base, type: 'img-sli', left, right } : null
    }
    case 'grid-view': return {
      ...base, type: 'grid-view',
      files: Array.isArray(value.files) ? value.files.flatMap((file): GridViewFile[] => {
        const restored = restoreFile(file)
        if (!restored) return []
        const tags = record(file) && Array.isArray(file.tags) ? file.tags.filter((tag: unknown) => record(tag) && typeof tag.name === 'string') as GridViewFile['tags'] : undefined
        return [{ ...restored, ...(tags ? { tags } : {}) }]
      }) : [],
      removable: value.removable === true,
      allowDragAndDrop: value.allowDragAndDrop === true,
    }
    case 'global-setting': return { ...base, type: 'global-setting' }
    case 'batch-download': return { ...base, type: 'batch-download' }
    case 'random-image': return { ...base, type: 'random-image' }
    default: return null
  }
}

export function parseTabLayout(raw: string | null): Tab[] | null {
  if (!raw) return null
  try {
    const saved: unknown = JSON.parse(raw)
    if (!record(saved) || saved.version !== 1 || !Array.isArray(saved.tabs)) return null
    const seen = new Set<string>()
    const tabs = saved.tabs.flatMap((value: unknown, index: number): Tab[] => {
      if (!record(value) || !Array.isArray(value.panes)) return []
      const panes = value.panes.flatMap((pane: unknown): TabPane[] => {
        const restored = restorePane(pane)
        if (!restored || seen.has(restored.key)) return []
        seen.add(restored.key)
        return [restored]
      })
      if (!panes.length) return []
      return [{ id: typeof value.id === 'string' && value.id ? value.id : `restored-${index}`, key: panes.some(pane => pane.key === value.key) ? value.key as string : panes[0].key, panes }]
    })
    return tabs.length ? tabs : null
  } catch {
    return null
  }
}
