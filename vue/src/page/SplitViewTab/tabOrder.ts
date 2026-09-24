import type { Tab } from '@/store/useGlobalStore'

export function moveOpenView(tabs: Tab[], sourceKey: string, targetKey: string,
                             side: 'before' | 'after', createEmptyPane: () => Tab['panes'][number]): boolean {
  if (sourceKey === targetKey) return false
  const sourceTab = tabs.find(tab => tab.panes.some(pane => pane.key === sourceKey))
  const targetTab = tabs.find(tab => tab.panes.some(pane => pane.key === targetKey))
  if (!sourceTab || !targetTab) return false
  const sourceIndex = sourceTab.panes.findIndex(pane => pane.key === sourceKey)
  const targetIndex = targetTab.panes.findIndex(pane => pane.key === targetKey)
  const [pane] = sourceTab.panes.splice(sourceIndex, 1)
  const destination = targetTab === sourceTab && sourceIndex < targetIndex ? targetIndex - 1 : targetIndex
  targetTab.panes.splice(destination + (side === 'after' ? 1 : 0), 0, pane)
  if (!sourceTab.panes.length) sourceTab.panes.push(createEmptyPane())
  if (sourceTab.key === sourceKey && sourceTab !== targetTab) sourceTab.key = sourceTab.panes[0].key
  return true
}
