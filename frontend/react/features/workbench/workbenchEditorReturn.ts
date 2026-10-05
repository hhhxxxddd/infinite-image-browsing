export interface WorkbenchEditorReturn {
  version: 1
  workspaceId: string
  workId: string
  screen: 'home' | 'workspace' | 'work'
  pageTab: 'workspace' | 'config'
  statusView: 'active' | 'paused'
  materialsView: 'all' | 'used'
  workTab: 'drafts' | 'outputs'
  draftFilter: 'all' | 'image' | 'video' | 'audio' | 'ai'
  scrollTop: number
}

const viewKey = 'omnigalleryWorkbenchEditorReturn'
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

export function readWorkbenchEditorReturn(historyState: unknown): WorkbenchEditorReturn | null {
  const value = record(record(historyState)?.[viewKey])
  if (
    value?.version !== 1 ||
    typeof value.workspaceId !== 'string' ||
    typeof value.workId !== 'string' ||
    !['home', 'workspace', 'work'].includes(String(value.screen))
  )
    return null
  return {
    version: 1,
    workspaceId: value.workspaceId,
    workId: value.workId,
    screen: value.screen as WorkbenchEditorReturn['screen'],
    pageTab: value.pageTab === 'config' ? 'config' : 'workspace',
    statusView: value.statusView === 'paused' ? 'paused' : 'active',
    materialsView: value.materialsView === 'used' ? 'used' : 'all',
    workTab: value.workTab === 'outputs' ? 'outputs' : 'drafts',
    draftFilter: ['image', 'video', 'audio', 'ai'].includes(String(value.draftFilter))
      ? (value.draftFilter as WorkbenchEditorReturn['draftFilter'])
      : 'all',
    scrollTop:
      typeof value.scrollTop === 'number' && Number.isFinite(value.scrollTop)
        ? Math.max(0, value.scrollTop)
        : 0
  }
}

export function workbenchEditorHistoryState(historyState: unknown, view: WorkbenchEditorReturn) {
  return { ...record(historyState), [viewKey]: { ...view } }
}

/** A missing original work returns to its workspace, never a different work. */
export function workbenchEditorDestination(
  view: WorkbenchEditorReturn,
  workspaceId: string,
  workIds: readonly string[]
): { screen: WorkbenchEditorReturn['screen']; workId: string } | null {
  if (view.workspaceId !== workspaceId) return null
  if (view.screen === 'work' && workIds.includes(view.workId))
    return { screen: 'work', workId: view.workId }
  return { screen: view.screen === 'home' ? 'home' : 'workspace', workId: '' }
}
