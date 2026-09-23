<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import { omit } from 'lodash-es'
import { useDocumentVisibility } from '@vueuse/core'
import { useGlobalStore, type TabPane } from '@/store/useGlobalStore'
import { globalEvents, useGlobalEventListen } from '@/util'
import { AppstoreOutlined, PictureOutlined, VideoCameraOutlined, FolderOutlined, SettingOutlined, PlusOutlined, HistoryOutlined, MenuOutlined, CloseOutlined, CompassOutlined, SplitCellsOutlined } from '@ant-design/icons-vue'
import ImgSliDrawer from '../ImgSli/ImgSliDrawer.vue'
import { useImgSliStore } from '@/store/useImgSli'
import { addDroppedFolders, addToExtraPath } from './extraPathControlFunc'
import { isTauri } from '@/util/env'
import { listen, TauriEvent } from '@tauri-apps/api/event'
import { message } from 'ant-design-vue'
import { navigate, pageNames, sectionNames } from './navigation'
import { findManagedFolder } from './folderScope'
import { getFileTransferDataFromDragEvent } from '@/util/file'
const global = useGlobalStore()
// Resolve the former system preference once; the switch now stores an explicit theme.
if (global.darkModeControl === 'auto') global.darkModeControl = global.computedTheme
const imageComparison = useImgSliStore()
const compMap: Record<TabPane['type'], ReturnType<typeof defineAsyncComponent>> = {
  local: defineAsyncComponent(() => import('@/page/fileTransfer/stackView.vue')),
  empty: defineAsyncComponent(() => import('./MediaLibrary.vue')),
  'global-setting': defineAsyncComponent(() => import('@/page/globalSetting/globalSetting.vue')),
  'tag-search-matched-image-grid': defineAsyncComponent(
    () => import('@/page/TagSearch/MatchedImageGrid.vue')
  ),
  'topic-search-matched-image-grid': defineAsyncComponent(
    () => import('@/page/TopicSearch/MatchedImageGrid.vue')
  ),
  'tag-search': defineAsyncComponent(() => import('@/page/TagSearch/TagSearch.vue')),
  'fuzzy-search': defineAsyncComponent(() => import('@/page/TagSearch/SubstrSearch.vue')),
  'topic-search': defineAsyncComponent(() => import('./MediaLibrary.vue')),
  'img-sli': defineAsyncComponent(() => import('@/page/ImgSli/ImgSliPagePane.vue')),
  'batch-download': defineAsyncComponent(() => import('@/page/batchDownload/batchDownload.vue')),
  'grid-view': defineAsyncComponent(() => import('@/page/gridView/gridView.vue')),
  'random-image': defineAsyncComponent(() => import('@/page/randomImage/randomImage.vue')),
}

// Replace obsolete views still present in an open session.
watch(() => global.tabList.map(tab => tab.panes.map(pane => pane.type)), () => {
  for (const tab of global.tabList) {
    if (tab.panes.some(pane => !Object.prototype.hasOwnProperty.call(compMap, pane.type))) {
      tab.panes = tab.panes.map(pane => Object.prototype.hasOwnProperty.call(compMap, pane.type)
        ? pane : { ...global.createEmptyPane(), key: pane.key })
    }
  }
}, { immediate: true })

const focusedKey = ref('')
const compact = ref(false)
const entries = computed(() => global.tabList.flatMap((tab, tabIdx) => tab.panes.map((pane, paneIdx) => ({ pane, tab, tabIdx, paneIdx }))))
const current = computed(() => entries.value.find(v => v.pane.key === focusedKey.value) ?? entries.value.find(v => v.pane.key === v.tab.key) ?? entries.value[0])
const paneProps = computed(() => omit(current.value?.pane ?? {}, 'key'))
const title = computed(() => {
  const pane = current.value?.pane
  if (pane?.type === 'empty') return sectionNames[pane.section ?? 'all']
  if (pane?.type === 'local') return pane.path?.split(/[\\/]/).filter(Boolean).pop() || '文件夹'
  return pageNames[pane?.type ?? 'empty']
})
const managedFolder = computed(() => current.value?.pane.type === 'local' && findManagedFolder(global.conf?.extra_paths ?? [], current.value.pane.path, global.conf?.is_win))
const showingFolders = computed(() => (current.value?.pane.type === 'empty' && current.value.pane.section === 'folders') || !!managedFolder.value)
let stopNativeFileDrop: (() => void) | undefined
let fileDropMounted = false
function allowExternalFileDrop(event: DragEvent) {
  if (event.dataTransfer?.types.includes('Files') && !event.dataTransfer.types.includes('application/x-iib-files')) event.preventDefault()
}
function sendExternalFileDrop(event: DragEvent) {
  if (!event.dataTransfer?.files.length || event.dataTransfer.types.includes('application/x-iib-files')) return
  event.preventDefault()
  if (!showingFolders.value || global.conf?.is_readonly) return
  const hasDirectory = Array.from(event.dataTransfer.items).some(item => item.webkitGetAsEntry?.()?.isDirectory)
    || Array.from(event.dataTransfer.files).some(file => !file.type && file.size === 0)
  if (!hasDirectory && event.target instanceof Element && event.target.closest('.header-library-search')) return
  if (hasDirectory) event.stopPropagation()
  // The pinned Windows receiver needs this frontend handler (its bundled
  // injection has a syntax error). WebView2 sends the true paths to Rust;
  // browser File objects alone intentionally do not expose those paths.
  const bridge = (window as Window & { chrome?: { webview?: { postMessageWithAdditionalObjects?: (message: string, files: FileList) => void } } }).chrome?.webview
  bridge?.postMessageWithAdditionalObjects?.('__TAURI_PLUGIN_WIN_FILE_DROP__', event.dataTransfer.files)
}
onMounted(async () => {
  if (!isTauri) return
  fileDropMounted = true
  document.addEventListener('dragover', allowExternalFileDrop, true)
  document.addEventListener('drop', sendExternalFileDrop, true)
  const unlisten = await listen<{paths: string[]}>(TauriEvent.DRAG_DROP, event => {
    if (!showingFolders.value || global.conf?.is_readonly) return
    void addDroppedFolders(event.payload.paths).catch(() => message.error('添加文件夹失败，请检查目录是否可读取'))
  }, { target: { kind: 'WebviewWindow', label: 'main' } })
  if (fileDropMounted) stopNativeFileDrop = unlisten
  else unlisten()
})
onUnmounted(() => {
  fileDropMounted = false
  stopNativeFileDrop?.()
  document.removeEventListener('dragover', allowExternalFileDrop, true)
  document.removeEventListener('drop', sendExternalFileDrop, true)
})
const activeComponent = computed(() => managedFolder.value ? compMap.empty : compMap[current.value?.pane.type ?? 'empty'])
const hasHeaderSearch = computed(() => (managedFolder.value || ['empty', 'topic-search'].includes(current.value?.pane.type ?? '')))
const primary = [
  { label: '全部媒体', section: 'all', icon: AppstoreOutlined },
  { label: '图片', section: 'image', icon: PictureOutlined },
  { label: '视频', section: 'video', icon: VideoCameraOutlined },
  { label: '文件夹', section: 'folders', icon: FolderOutlined },
] as const
const dropTarget = ref('')
function folderDragOver(event: DragEvent, path: string) {
  if (global.conf?.is_readonly || !event.dataTransfer?.types.includes('application/x-iib-files')) return
  event.preventDefault()
  dropTarget.value = path
}
async function dropIntoFolder(event: DragEvent, path: string) {
  dropTarget.value = ''
  const data = getFileTransferDataFromDragEvent(event)
  if (data && !global.conf?.is_readonly) {
    event.preventDefault()
    const { confirmFileTransfer } = await import('@/page/fileTransfer/hooks/useFileTransfer')
    confirmFileTransfer(data, path)
  }
}
const folders = computed(() => global.conf?.extra_paths ?? [])
const openViews = computed(() => entries.value.filter(({pane}) => !['empty', 'topic-search', 'batch-download', 'random-image', 'global-setting', 'tag-search', 'fuzzy-search'].includes(pane.type) && !(pane.type === 'local' && findManagedFolder(folders.value, pane.path, global.conf?.is_win))))
function go(type: TabPane['type'], options: Parameters<typeof navigate>[1] = {}) { focusedKey.value = navigate(type, options) }
function focus(key: string) { const entry = entries.value.find(v => v.pane.key === key); if (entry) { entry.tab.key = key; focusedKey.value = key } }
function close(tabIdx: number, key: string) {
  const tab = global.tabList[tabIdx]
  if (!tab) return
  const index = tab.panes.findIndex(p => p.key === key)
  if (index < 0) return
  tab.panes.splice(index, 1)
  if (!tab.panes.length) tab.panes.push(global.createEmptyPane())
  if (tab.key === key) tab.key = tab.panes[Math.max(0, index - 1)].key
  if (focusedKey.value === key) focusedKey.value = tab.key
}
watch(() => global.tabList.map(tab => tab.key), (keys, old = []) => {
  const changed = keys.find((key, i) => key !== old[i])
  if (changed) focusedKey.value = changed
}, { immediate: true })
useGlobalEventListen('closeTabPane', close)
watch(useDocumentVisibility(), value => value === 'visible' && globalEvents.emit('returnToIIB'))
</script>
<template>
  <div class="media-app" :class="{ compact }">
    <aside class="app-sidebar" aria-label="主导航">
      <div class="app-brand"><span class="brand-mark" aria-hidden="true"><svg class="brand-symbol" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 12.5V24a2 2 0 0 0 2 2h12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><rect x="11" y="6" width="15" height="15" rx="3" stroke="currentColor" stroke-width="2.2"/><path d="m18.5 9.5 1.35 3.65 3.65 1.35-3.65 1.35-1.35 3.65-1.35-3.65-3.65-1.35 3.65-1.35 1.35-3.65Z" fill="currentColor"/></svg></span><div><strong>拾影</strong><small>收集影像，留住灵感</small></div></div>
      <nav class="nav-scroll">
        <div class="nav-caption">媒体库</div>
        <button v-for="item in primary" :key="item.section" class="nav-item" :class="{ selected: current?.pane.type === 'empty' && (current.pane.section ?? 'all') === item.section }" :aria-current="current?.pane.type === 'empty' && (current.pane.section ?? 'all') === item.section ? 'page' : undefined" :title="item.label" :aria-label="item.label" @click="go('empty', { section: item.section })"><component :is="item.icon" /><span>{{ item.label }}</span></button>

        <div class="nav-caption folder-caption"><span>已添加的文件夹</span><button aria-label="添加文件夹" title="添加文件夹" @click="addToExtraPath('walk')"><PlusOutlined /></button></div>
        <p v-if="!folders.length" class="sidebar-hint">添加文件夹后会显示在这里</p>
        <button v-for="folder in folders" :key="folder.path" class="nav-item folder-link" :data-drop-active="dropTarget === folder.path" @dragover="folderDragOver($event, folder.path)" @dragleave="dropTarget = ''" @drop.stop="dropIntoFolder($event, folder.path)" :aria-label="folder.alias || folder.path" :title="folder.path" :class="{ selected: managedFolder && managedFolder.path === folder.path }" @click="go('local', { path: folder.path, mode: 'scanned-fixed' })"><FolderOutlined /><span>{{ folder.alias || folder.path.split(/[\\/]/).filter(Boolean).pop() }}</span></button>
        <template v-if="openViews.length"><div class="nav-caption">正在浏览</div><div v-for="entry in openViews" :key="entry.pane.key" class="open-view"><button class="nav-item" :class="{ selected: current?.pane.key === entry.pane.key }" @click="focus(entry.pane.key)"><HistoryOutlined /><span>{{ entry.pane.nameFallbackStr || (typeof entry.pane.name === 'string' ? entry.pane.name : pageNames[entry.pane.type]) }}</span></button><button class="close-view" aria-label="关闭此视图" @click="close(entry.tabIdx, entry.pane.key)"><CloseOutlined /></button></div></template>
      </nav>
      <div class="sidebar-bottom"><button class="nav-item" title="设置" aria-label="设置" :class="{ selected: current?.pane.type === 'global-setting' }" @click="go('global-setting')"><SettingOutlined /><span>设置</span></button><div class="theme-control"><a-switch :checked="global.darkModeControl === 'dark'" aria-label="深色模式" @change="global.darkModeControl = $event ? 'dark' : 'light'">
        <template #checkedChildren><svg class="theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.1A8.5 8.5 0 0 1 9.9 3.5a8.5 8.5 0 1 0 10.6 10.6Z" /></svg></template>
        <template #unCheckedChildren><svg class="theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg></template>
      </a-switch></div><div class="local-status"><i></i><span>文件保存在本机</span></div></div>
    </aside>
    <main class="app-main">
      <header class="app-header">
        <button class="sidebar-toggle" aria-label="展开或收起侧栏" title="展开或收起侧栏" @click="compact = !compact"><MenuOutlined /></button>
        <div id="media-header-search" v-show="hasHeaderSearch" class="header-search-slot"></div>
        <h1 v-if="!hasHeaderSearch" class="page-title">{{ title }}</h1>
        <div class="header-actions">
          <a-button class="header-action-icon" :type="current?.pane.type === 'random-image' ? 'primary' : 'text'" title="随机回顾" aria-label="随机回顾" @click="go('random-image')"><CompassOutlined /></a-button>
          <a-button class="header-action-icon" :type="imageComparison.drawerVisible ? 'primary' : 'text'" title="图片对比" aria-label="图片对比" @click="imageComparison.drawerVisible = true"><SplitCellsOutlined /></a-button>
          <a-button type="primary" size="small" class="add-folder" title="添加文件夹" aria-label="添加文件夹" :disabled="global.conf?.is_readonly" @click="addToExtraPath('walk')"><PlusOutlined /><span class="tool-label">添加文件夹</span></a-button>
        </div>
      </header>
      <div id="media-selection-dock" class="selection-dock"></div>
      <section class="app-content" aria-label="媒体内容"><component v-if="current" :is="activeComponent" :key="current.pane.key" v-bind="paneProps" :tabIdx="current.tabIdx" :paneIdx="current.paneIdx" :paneKey="current.pane.key" /></section>
    </main>
    <ImgSliDrawer />
  </div>
</template>
<style scoped lang="scss">
.media-app { display:flex; height:100dvh; overflow:hidden; background:var(--zp-secondary-background); color:var(--zp-primary); }
.app-sidebar { width:224px; flex-shrink:0; display:flex; flex-direction:column; background:var(--zp-secondary-background); border-right:1px solid var(--zp-border); }
.app-brand { display:flex; gap:12px; align-items:center; padding:28px 20px 24px; strong {font-size:17px; font-weight:600;} small {display:block; font-size:11px; color:var(--zp-secondary); margin-top:4px;} }
.brand-mark { width:38px; height:38px; border-radius:10px; display:grid; place-items:center; color:white; background:linear-gradient(145deg,#1677c7,#08447d); box-shadow:inset 0 1px #ffffff40; }
.brand-symbol { width:29px; height:29px; display:block; }
.nav-scroll { flex:1; min-height:0; overflow:auto; padding:0 12px; }
.nav-caption { padding:22px 12px 9px; font-size:11px; color:var(--zp-secondary); letter-spacing:1px; &:first-child {padding-top:0;} }
button { font:inherit; cursor:pointer; }
.nav-item { width:100%; display:flex; align-items:center; gap:13px; padding:10px 13px; margin:3px 0; border:0; border-radius:7px; background:transparent; color:inherit; text-align:left; position:relative; .anticon {font-size:18px; flex-shrink:0;} span:last-child {overflow:hidden; text-overflow:ellipsis; white-space:nowrap;} &:hover {background:var(--primary-color-1);} &.selected {background:var(--primary-color-2); color:var(--primary-color); font-weight:600; &::before {content:''; position:absolute; left:0; width:3px; height:18px; border-radius:3px; background:var(--primary-color);}} }
.folder-caption {display:flex; justify-content:space-between; align-items:center; button {border:0; background:none; color:inherit;} }
.sidebar-hint {font-size:12px; line-height:1.8; padding:0 12px; color:var(--zp-secondary);}
.sidebar-bottom {padding:12px; border-top:1px solid var(--zp-border);}
.theme-control {display:flex; justify-content:flex-end; align-items:center; padding:10px 13px;}
.theme-icon {width:14px;height:14px;display:block;}
.theme-control :deep(.ant-switch-inner-checked),.theme-control :deep(.ant-switch-inner-unchecked){display:flex;align-items:center;justify-content:center;height:22px;line-height:1;}
.theme-control :deep(.ant-switch-inner-unchecked){margin-top:-22px;}
.local-status {display:flex; align-items:center; gap:8px; padding:8px 13px; font-size:11px; color:var(--zp-secondary); i{width:6px;height:6px;border-radius:50%;background:#1c9b65;}}
.open-view {display:flex; align-items:center; .nav-item {min-width:0;} .close-view {border:0;background:none;color:var(--zp-secondary);padding:5px;} }
.app-main {flex:1; min-width:0; display:flex; flex-direction:column; background:var(--zp-primary-background);}
.app-header {height:100px; flex-shrink:0; display:flex; align-items:center; gap:16px; padding:20px 32px; border-bottom:1px solid var(--zp-border);}
.page-heading {flex:1; min-width:0; h1 {font-size:26px;letter-spacing:-.6px;font-weight:600;margin:0 0 5px;} p{font-size:12px;color:var(--zp-secondary);margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;} }
.add-folder {height:36px; box-shadow:none;}
.sidebar-toggle {border:0; background:none; color:var(--zp-secondary); padding:6px; font-size:18px;}
.app-content {--pane-max-height:calc(100dvh - 100px); --scroll-container-max-height:calc(100dvh - 100px); flex:1;min-height:0; overflow:auto;position:relative;}
.compact .app-sidebar {width:64px; .app-brand {padding:28px 12px;} .app-brand>div,.nav-caption,.sidebar-hint,.nav-item span:last-child,.theme-control,.local-status,.close-view {display:none;} .nav-item {padding:12px 10px;} }
@media(max-width:760px) {.app-sidebar {width:64px;} .app-brand {padding:20px 12px;} .app-brand>div,.nav-caption,.sidebar-hint,.nav-item span:last-child,.theme-control,.local-status,.close-view {display:none;} .nav-item {padding:12px 10px;} .app-header {padding:16px;gap:8px;} .page-heading h1{font-size:21px;} .sidebar-toggle{display:none;} }


.app-main,.app-sidebar{min-height:0;}.app-brand,.sidebar-bottom{flex-shrink:0;}
.brand-mark,.sidebar-toggle,.add-folder{flex-shrink:0;}
.page-heading h1{overflow-wrap:anywhere;line-height:1.25;}
.app-header{height:auto;min-height:100px;}
.app-content{min-width:0;}
@media(max-height:650px){.app-brand{padding-top:16px;padding-bottom:16px;}.local-status{display:none;}.sidebar-bottom{padding:8px;}}
@media(max-width:600px){.app-header{padding:12px;min-height:88px;}.page-heading h1{font-size:19px;}.page-heading p{white-space:normal;line-height:1.5;}.add-folder{padding-inline:8px;font-size:12px;}}

</style>

<style scoped>
.header-actions{display:flex;gap:4px;align-items:center;flex-shrink:0;}
.folder-link[data-drop-active="true"]{background:var(--primary-color-2);outline:2px dashed var(--primary-color);outline-offset:-2px;}
@media(max-width:900px){.app-header{flex-wrap:wrap;}.header-actions{margin-left:auto;}.page-heading{flex-basis:calc(100% - 48px);}}
</style>

<style scoped>
.app-main{position:relative;}
.app-header{height:64px;min-height:64px;padding:12px 20px;gap:12px;flex-wrap:nowrap;}
.header-search-slot{flex:1;min-width:0;display:flex;align-items:center;gap:6px;}
.page-title{flex:1;margin:0;font-size:18px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.header-actions{margin:0;gap:4px;}
.header-actions .header-action-icon{width:36px;height:36px;padding:0;display:inline-grid;place-items:center;font-size:18px;}
.add-folder{height:30px;}
.app-content{--pane-max-height:calc(100dvh - 64px);--scroll-container-max-height:calc(100dvh - 64px);}
.selection-dock{position:absolute;bottom:16px;left:16px;right:16px;z-index:40;display:flex;justify-content:center;pointer-events:none;}
@media(max-width:1100px){.header-actions .tool-label{display:none;}.app-header{padding-inline:12px;gap:8px;}}
@media(max-width:600px){.app-header{padding:8px;gap:4px;}.header-actions{gap:0;}.header-actions :deep(.ant-btn){padding-inline:6px;}.selection-dock{left:8px;right:8px;bottom:8px;}}
</style>
