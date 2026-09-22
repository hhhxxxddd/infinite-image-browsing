import { uniqueId } from 'lodash-es'
import { shallowRef } from 'vue'
import { findManagedFolder } from './folderScope'
import { useGlobalStore, type TabPane } from '@/store/useGlobalStore'

export const pageNames: Partial<Record<TabPane['type'], string>> = {
  empty: '媒体库', local: '文件夹', 'tag-search': '搜索媒体',
  'fuzzy-search': '搜索媒体', 'topic-search': '相似图片搜索',
  'global-setting': '设置', 'batch-download': '导出与归档',
  'random-image': '随机回顾',
  'tag-search-matched-image-grid': '标签搜索结果',
  'topic-search-matched-image-grid': '智能搜索结果', 'grid-view': '媒体集合', 'img-sli': '图片对比',
}
export const similarityRequest = shallowRef<{paneKey: string; path: string}>()
export function openSimilaritySearch(path: string, location: {tabIdx: number; paneIdx: number}) {
  const pane = useGlobalStore().tabList[location.tabIdx]?.panes[location.paneIdx]
  const paneKey = (pane?.type === 'empty' && pane.section !== 'folders') || (pane?.type === 'local' && findManagedFolder(useGlobalStore().conf?.extra_paths ?? [], pane.path, useGlobalStore().conf?.is_win))
    ? pane.key : navigate('empty', {section: 'all'})
  similarityRequest.value = {paneKey, path}
}
export const sectionNames = { all: '全部媒体', image: '图片', video: '视频', folders: '文件夹' }
export function navigate(type: TabPane['type'], options: { section?: keyof typeof sectionNames; path?: string; mode?: 'walk' | 'scanned' | 'scanned-fixed' } = {}) {
  const g = useGlobalStore()
  for (const tab of g.tabList) {
    const found = tab.panes.find(p => p.type === type && (
      p.type === 'empty' ? (p.section ?? 'all') === (options.section ?? 'all') :
      p.type === 'local' ? p.path === options.path && p.mode === options.mode : true
    ))
    if (found) { tab.key = found.key; return found.key }
  }
  const name = type === 'local' && options.path ? (options.path.split(/[\\/]/).filter(Boolean).pop() || options.path) + (options.mode === 'walk' ? '（含子文件夹）' : '') : pageNames[type] ?? '媒体'
  const pane = { type, key: uniqueId('view-'), name, ...options } as TabPane
  if (!g.tabList.length) g.tabList.push({ id: uniqueId('workspace-'), key: pane.key, panes: [pane] })
  else { g.tabList[0].panes.push(pane); g.tabList[0].key = pane.key }
  return pane.key
}
