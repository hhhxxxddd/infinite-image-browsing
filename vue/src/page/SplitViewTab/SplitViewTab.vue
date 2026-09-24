<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import { omit } from 'lodash-es'
import { useDocumentVisibility } from '@vueuse/core'
import { useGlobalStore, type TabPane } from '@/store/useGlobalStore'
import { globalEvents, useGlobalEventListen } from '@/util'
import { AppstoreOutlined, PictureOutlined, VideoCameraOutlined, CustomerServiceOutlined, ApartmentOutlined, SettingOutlined, PlusOutlined, HistoryOutlined, CloseOutlined, CompassOutlined } from '@ant-design/icons-vue'
import ImgSliDrawer from '../ImgSli/ImgSliDrawer.vue'
import { addDroppedFolders, addToExtraPath } from './extraPathControlFunc'
import { isTauri } from '@/util/env'
import { listen, TauriEvent } from '@tauri-apps/api/event'
import { message } from 'ant-design-vue'
import { navigate, pageNames, sectionNames } from './navigation'
import { findManagedFolder, sameFolderPath } from './folderScope'
import { getFileTransferDataFromDragEvent } from '@/util/file'
import { getFolderIcons } from '@/api/folderIcons'
import FolderIcon from './FolderIcon.vue'
import { moveOpenView } from './tabOrder'
const global = useGlobalStore()
// Resolve the former system preference once; the switch now stores an explicit theme.
if (global.darkModeControl === 'auto') global.darkModeControl = global.computedTheme
const compMap: Record<TabPane['type'], ReturnType<typeof defineAsyncComponent>> = {
  local: defineAsyncComponent(() => import('@/page/fileTransfer/stackView.vue')),
  empty: defineAsyncComponent(() => import('./MediaLibrary.vue')),
  'global-setting': defineAsyncComponent(() => import('@/page/globalSetting/globalSetting.vue')),
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
const compact = ref(window.innerWidth <= 760)
const entries = computed(() => global.tabList.flatMap((tab, tabIdx) => tab.panes.map((pane, paneIdx) => ({ pane, tab, tabIdx, paneIdx }))))
const current = computed(() => entries.value.find(v => v.pane.key === focusedKey.value) ?? entries.value.find(v => v.pane.key === v.tab.key) ?? entries.value[0])
const paneProps = computed(() => omit(current.value?.pane ?? {}, 'key'))
function rootForPane(pane: TabPane) {
  if (pane.type !== 'local' || !pane.path) return
  return (global.conf?.extra_paths ?? []).find(folder => sameFolderPath(folder.path, pane.path!, global.conf?.is_win))
}
function paneLabel(pane: TabPane): string {
  if (pane.type === 'local') {
    const root = rootForPane(pane)
    return root?.alias || pane.path?.split(/[\\/]/).filter(Boolean).pop() || '文件夹'
  }
  return pane.nameFallbackStr || (typeof pane.name === 'string' ? pane.name : pageNames[pane.type] ?? '媒体')
}
const title = computed(() => {
  const pane = current.value?.pane
  if (pane?.type === 'empty') return sectionNames[pane.section ?? 'all']
  if (pane?.type === 'local') return paneLabel(pane)
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
onMounted(() => {
  void getFolderIcons().then(icons => { global.folderIcons = icons }).catch(() => message.warning('目录图标未能加载'))
})
onUnmounted(() => {
  fileDropMounted = false
  stopNativeFileDrop?.()
  document.removeEventListener('dragover', allowExternalFileDrop, true)
  document.removeEventListener('drop', sendExternalFileDrop, true)
})
const activeComponent = computed(() => managedFolder.value ? compMap.empty : compMap[current.value?.pane.type ?? 'empty'])
const hasHeaderSearch = computed(() => managedFolder.value || current.value?.pane.type === 'empty')
const hasLibrarySearch = computed(() => hasHeaderSearch.value && !(current.value?.pane.type === 'empty' && current.value.pane.section === 'folders'))
const primary = [
  { label: '全部媒体', section: 'all', icon: AppstoreOutlined },
  { label: '目录', section: 'folders', icon: ApartmentOutlined },
  { label: '图片', section: 'image', icon: PictureOutlined },
  { label: '视频', section: 'video', icon: VideoCameraOutlined },
  { label: '音频', section: 'audio', icon: CustomerServiceOutlined },
] as const
function primarySelected(section: typeof primary[number]['section']) {
  return (current.value?.pane.type === 'empty' && (current.value.pane.section ?? 'all') === section)
    || (section === 'folders' && !!managedFolder.value)
}
const dropTarget = ref('')
function folderDragOver(event: DragEvent, path: string) {
  if (global.conf?.is_readonly || !event.dataTransfer?.types.includes('application/x-iib-files')) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  dropTarget.value = path
}
async function dropIntoFolder(event: DragEvent, path: string, tabKey?: string) {
  dropTarget.value = ''
  const data = getFileTransferDataFromDragEvent(event)
  if (data && !global.conf?.is_readonly) {
    event.preventDefault()
    event.stopPropagation()
    const { confirmFileTransfer } = await import('@/page/fileTransfer/hooks/useFileTransfer')
    confirmFileTransfer(data, path, () => { if (tabKey) focus(tabKey) })
  }
}
const openViews = computed(() => entries.value.filter(({pane}) => !['empty', 'batch-download', 'random-image', 'global-setting'].includes(pane.type)))
const tabDrop = ref<{key: string; side: 'before' | 'after'}>()
function startTabDrag(event: DragEvent, key: string) {
  event.dataTransfer?.setData('application/x-iib-open-view', key)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function overTab(event: DragEvent, key: string) {
  if (!event.dataTransfer?.types.includes('application/x-iib-open-view')) return
  event.preventDefault()
  event.stopPropagation()
  event.dataTransfer.dropEffect = 'move'
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  tabDrop.value = {key, side: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'}
}
function dropTab(event: DragEvent, key: string) {
  if (!event.dataTransfer?.types.includes('application/x-iib-open-view')) return
  event.preventDefault()
  event.stopPropagation()
  const source = event.dataTransfer.getData('application/x-iib-open-view')
  const side = tabDrop.value?.key === key ? tabDrop.value.side : 'before'
  if (moveOpenView(global.tabList, source, key, side, global.createEmptyPane) && focusedKey.value === source) {
    const target = global.tabList.find(tab => tab.panes.some(pane => pane.key === source))
    if (target) target.key = source
  }
  tabDrop.value = undefined
}
function leaveTab(event: DragEvent, key: string) {
  const row = event.currentTarget as HTMLElement
  const bounds = row.getBoundingClientRect()
  if (event.clientX >= bounds.left && event.clientX <= bounds.right &&
      event.clientY >= bounds.top && event.clientY <= bounds.bottom) return
  if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) return
  if (tabDrop.value?.key === key) tabDrop.value = undefined
}
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
      <div class="app-brand"><button class="brand-mark" type="button" :aria-label="compact ? '展开侧栏' : '收起侧栏'" :title="compact ? '展开侧栏' : '收起侧栏'" :aria-expanded="!compact" @click="compact = !compact"><svg class="brand-symbol" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M8 12.5V24a2 2 0 0 0 2 2h12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><rect x="11" y="6" width="15" height="15" rx="3" stroke="currentColor" stroke-width="2.2"/><path d="m18.5 9.5 1.35 3.65 3.65 1.35-3.65 1.35-1.35 3.65-1.35-3.65-3.65-1.35 3.65-1.35 1.35-3.65Z" fill="currentColor"/></svg></button><div><strong>拾影</strong><small>收集影像，留住灵感</small></div></div>
      <nav class="nav-scroll">
        <div class="nav-caption"><span class="nav-caption-label">媒体库</span></div>
        <div v-for="item in primary" :key="item.section" class="primary-nav-row" :class="{ 'directory-row': item.section === 'folders' }">
          <button class="nav-item" :class="{ selected: primarySelected(item.section) }" :aria-current="primarySelected(item.section) ? 'page' : undefined" :title="item.label" :aria-label="item.label" @click="go('empty', { section: item.section })"><component :is="item.icon" /><span>{{ item.label }}</span></button>
          <button v-if="item.section === 'folders'" class="directory-add" type="button" aria-label="添加文件夹" title="添加文件夹" :disabled="global.conf?.is_readonly" @click="addToExtraPath('walk')"><PlusOutlined /></button>
        </div>
        <div class="nav-caption"><span class="nav-caption-label">功能区</span></div>
        <button class="nav-item" :class="{ selected: current?.pane.type === 'random-image' }" :aria-current="current?.pane.type === 'random-image' ? 'page' : undefined" title="挑一挑" aria-label="挑一挑" @click="go('random-image')"><CompassOutlined /><span>挑一挑</span></button>
        <div class="nav-caption"><span class="nav-caption-label">标签页</span></div>
        <p v-if="!openViews.length" class="sidebar-hint">点击目录节点，在这里打开</p>
        <div v-for="entry in openViews" :key="entry.pane.key" class="open-view" :class="{ 'tab-drop-before': tabDrop?.key === entry.pane.key && tabDrop.side === 'before', 'tab-drop-after': tabDrop?.key === entry.pane.key && tabDrop.side === 'after' }" draggable="true" :title="`拖动调整标签页位置：${paneLabel(entry.pane)}`" @dragstart="startTabDrag($event, entry.pane.key)" @dragover="overTab($event, entry.pane.key)" @drop="dropTab($event, entry.pane.key)" @dragend="tabDrop = undefined" @dragleave="leaveTab($event, entry.pane.key)">
          <button class="nav-item" :class="{ selected: current?.pane.key === entry.pane.key }"
            :data-drop-active="entry.pane.type === 'local' && dropTarget === entry.pane.path"
            :title="entry.pane.type === 'local' ? `拖动文件到：${entry.pane.path}` : undefined"
            :aria-label="rootForPane(entry.pane) ? `根目录：${paneLabel(entry.pane)}` : paneLabel(entry.pane)"
            @dragover="entry.pane.type === 'local' && entry.pane.path && folderDragOver($event, entry.pane.path)"
            @dragleave="dropTarget = ''"
            @drop="entry.pane.type === 'local' && entry.pane.path && dropIntoFolder($event, entry.pane.path, entry.pane.key)"
            @click="focus(entry.pane.key)">
            <FolderIcon v-if="entry.pane.type === 'local' && entry.pane.path" :path="entry.pane.path" :root="!!rootForPane(entry.pane)" />
            <HistoryOutlined v-else />
            <span class="tab-label">{{ paneLabel(entry.pane) }}</span>
          </button>
          <button class="close-view" :aria-label="`关闭标签页：${paneLabel(entry.pane)}`" @dragstart.stop.prevent @click="close(entry.tabIdx, entry.pane.key)"><CloseOutlined /></button>
        </div>
      </nav>
      <div class="sidebar-bottom"><div class="bottom-controls"><button class="nav-item" title="设置" aria-label="设置" :class="{ selected: current?.pane.type === 'global-setting' }" @click="go('global-setting')"><SettingOutlined /><span>设置</span></button><div class="theme-control"><a-switch :checked="global.darkModeControl === 'dark'" aria-label="深色模式" @change="global.darkModeControl = $event ? 'dark' : 'light'">
        <template #checkedChildren><svg class="theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.1A8.5 8.5 0 0 1 9.9 3.5a8.5 8.5 0 1 0 10.6 10.6Z" /></svg></template>
        <template #unCheckedChildren><svg class="theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg></template>
      </a-switch></div></div><div class="local-status"><i></i><span>文件保存在本机</span></div></div>
    </aside>
    <main class="app-main">
      <header v-if="current?.pane.type !== 'random-image'" class="app-header" :class="{ 'library-header': hasLibrarySearch }">
        <div id="media-header-search" v-show="hasHeaderSearch" class="header-search-slot"></div>
        <h1 v-if="!hasHeaderSearch" class="page-title">{{ title }}</h1>
        <div class="header-actions">
          <a-button type="primary" size="small" class="add-folder" title="添加文件夹" aria-label="添加文件夹" :disabled="global.conf?.is_readonly" @click="addToExtraPath('walk')"><PlusOutlined /><span class="tool-label">添加文件夹</span></a-button>
        </div>
        <div v-show="hasLibrarySearch" id="media-header-secondary" class="header-secondary-slot"></div>
      </header>
      <div id="media-selection-dock" class="selection-dock"></div>
      <section class="app-content" aria-label="媒体内容"><Transition name="workspace-switch"><component v-if="current" :is="activeComponent" :key="`${current.pane.key}:${current.pane.type === 'local' ? current.pane.path : ''}`" v-bind="paneProps" :tabIdx="current.tabIdx" :paneIdx="current.paneIdx" :paneKey="current.pane.key" /></Transition></section>
    </main>
    <ImgSliDrawer />
  </div>
</template>
<style scoped lang="scss">
.media-app { display:flex; height:100dvh; overflow:hidden; background:var(--zp-secondary-background); color:var(--zp-primary); }
.app-sidebar { width:224px; flex-shrink:0; display:flex; flex-direction:column; overflow:hidden; background:var(--zp-secondary-background); border-right:1px solid var(--zp-border); transition:width .22s ease; }
.app-brand { display:flex; gap:12px; align-items:center; padding:28px 20px 24px; transition:padding .22s ease; strong {font-size:16px; font-weight:600;} small {display:block; font-size:11px; color:var(--zp-secondary); margin-top:4px;} }
.app-brand>div { min-width:0; max-width:160px; overflow:hidden; white-space:nowrap; opacity:1; transition:max-width .22s ease,opacity .14s ease; }
.brand-mark { width:38px; height:38px; padding:0; border:0; border-radius:10px; display:grid; place-items:center; color:white; background:linear-gradient(145deg,#1677c7,#08447d); box-shadow:inset 0 1px #ffffff40; }
.brand-mark:focus-visible { outline:2px solid var(--primary-color); outline-offset:3px; }
.brand-symbol { width:29px; height:29px; display:block; }
.nav-scroll { flex:1; min-height:0; overflow:auto; padding:0 12px; }
.nav-caption { position:relative; display:flex; align-items:flex-end; height:48px; overflow:hidden; padding:0 12px 9px; font-size:11px; color:var(--zp-secondary); letter-spacing:1px; white-space:nowrap; transition:height .22s ease,padding .22s ease,margin .22s ease; &:first-child {height:25px;} }
.nav-caption-label { display:block; max-width:170px; overflow:hidden; opacity:1; transition:max-width .22s ease,opacity .14s ease,transform .22s ease; }
.nav-caption::after { content:''; position:absolute; top:50%; left:50%; width:0; border-top:1px solid var(--zp-secondary); opacity:0; transform:translate(-50%,-50%); transition:width .22s ease,opacity .14s ease; }
button { font:inherit; cursor:pointer; }
.nav-item { width:100%; display:flex; align-items:center; gap:11px; padding:9px 12px; margin:3px 0; border:0; border-radius:7px; background:transparent; color:inherit; text-align:left; font-size:14px; position:relative; transition:gap .22s ease,padding .22s ease; .anticon {font-size:16px; flex-shrink:0;} span:last-child {max-width:170px;overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:1; transition:max-width .22s ease,opacity .14s ease;} &:hover {background:var(--primary-color-1);} &.selected {background:var(--primary-color-2); color:var(--primary-color); font-weight:600; &::before {content:''; position:absolute; left:0; width:3px; height:18px; border-radius:3px; background:var(--primary-color);}} }
.primary-nav-row{position:relative;min-width:0}
.directory-row .nav-item{padding-right:42px}
.directory-add{position:absolute;right:6px;top:50%;transform:translateY(-50%);display:grid;place-items:center;width:28px;height:28px;border:0;border-radius:var(--ui-radius-sm);background:transparent;color:var(--zp-secondary);font-size:15px;transition:background-color var(--ui-motion-fast) var(--ui-ease),color var(--ui-motion-fast) var(--ui-ease)}
.directory-add:hover,.directory-add:focus-visible{background:var(--primary-color-1);color:var(--primary-color)}
.directory-add:disabled{opacity:.4;cursor:default}
.sidebar-hint {max-height:48px; overflow:hidden; margin:4px 0; font-size:12px; line-height:1.8; padding:0 12px; color:var(--zp-secondary); opacity:1; transition:max-height .22s ease,margin .22s ease,opacity .14s ease;}
.sidebar-bottom {padding:12px; border-top:1px solid var(--zp-border);}
.bottom-controls {display:flex; align-items:center; gap:6px;}
.bottom-controls .nav-item {flex:1; min-width:0; width:auto; margin:0;}
.theme-control {display:flex; justify-content:flex-end; align-items:center; flex-shrink:0; padding:0 13px 0 4px;}
.theme-icon {width:14px;height:14px;display:block;}
.theme-control :deep(.ant-switch-inner-checked),.theme-control :deep(.ant-switch-inner-unchecked){display:flex;align-items:center;justify-content:center;height:22px;line-height:1;}
.theme-control :deep(.ant-switch-inner-unchecked){margin-top:-22px;}
.local-status {display:flex; align-items:center; gap:8px; padding:8px 13px; font-size:11px; color:var(--zp-secondary); i{width:6px;height:6px;border-radius:50%;background:#1c9b65;}}
.open-view {display:flex; align-items:center; .nav-item {min-width:0;} .close-view {border:0;background:none;color:var(--zp-secondary);padding:5px;} }
.open-view .tab-label{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.open-view{position:relative;cursor:grab}.open-view:active{cursor:grabbing}
.open-view.tab-drop-before::before,.open-view.tab-drop-after::after{content:'';position:absolute;left:6px;right:6px;height:2px;border-radius:2px;background:var(--primary-color);z-index:2;pointer-events:none}
.open-view.tab-drop-before::before{top:0}.open-view.tab-drop-after::after{bottom:0}
.app-main {flex:1; min-width:0; display:flex; flex-direction:column; background:var(--zp-primary-background);}
.app-header {height:100px; flex-shrink:0; display:flex; align-items:center; gap:16px; padding:20px 32px; border-bottom:1px solid var(--zp-border);}
.page-heading {flex:1; min-width:0; h1 {font-size:26px;letter-spacing:-.6px;font-weight:600;margin:0 0 5px;} p{font-size:12px;color:var(--zp-secondary);margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;} }
.add-folder {height:36px; box-shadow:none;}
.app-content {--pane-max-height:calc(100dvh - 100px); --scroll-container-max-height:calc(100dvh - 100px); flex:1;min-height:0; overflow:auto;position:relative;}
.compact .app-sidebar {width:64px; .app-brand {padding:28px 12px;} .app-brand>div,.sidebar-hint,.nav-item span:last-child {opacity:0;pointer-events:none;} .app-brand>div,.nav-item span:last-child {max-width:0;} .nav-caption {height:25px;padding:0;margin:4px 0 1px;align-items:center;justify-content:center;pointer-events:none;} .nav-caption::after {width:28px;opacity:.45;} .nav-caption-label {max-width:0;opacity:0;transform:translateY(-3px);} .sidebar-hint {max-height:0;margin:0;} .nav-item {gap:0;padding:9px 10px;justify-content:center;} .directory-row .nav-item{padding:9px 10px;justify-content:center}.directory-add{display:none}.theme-control,.local-status,.close-view {display:none;} }
@media(prefers-reduced-motion:reduce){.app-sidebar,.app-brand,.app-brand>div,.nav-caption,.nav-caption::after,.nav-caption-label,.directory-add,.nav-item,.nav-item span:last-child,.sidebar-hint{transition:none;}}
@media(max-width:760px) {.app-header {padding:16px;gap:8px;} .page-heading h1{font-size:21px;} }


.app-main,.app-sidebar{min-height:0;}.app-brand,.sidebar-bottom{flex-shrink:0;}
.brand-mark,.add-folder{flex-shrink:0;}
.page-heading h1{overflow-wrap:anywhere;line-height:1.25;}
.app-header{height:auto;min-height:100px;}
.app-content{min-width:0;}
.workspace-switch-enter-active,.workspace-switch-leave-active{transition:opacity var(--ui-motion-fast) var(--ui-ease),transform var(--ui-motion-fast) var(--ui-ease);}
.workspace-switch-leave-active{position:absolute;inset:0;z-index:1;width:100%;pointer-events:none;}
.workspace-switch-enter-from{opacity:0;transform:translateY(4px)}
.workspace-switch-leave-to{opacity:0;transform:translateY(-4px)}
@media(max-height:650px){.app-brand{padding-top:16px;padding-bottom:16px;}.local-status{display:none;}.sidebar-bottom{padding:8px;}}
@media(max-width:600px){.app-header{padding:12px;min-height:88px;}.page-heading h1{font-size:19px;}.page-heading p{white-space:normal;line-height:1.5;}.add-folder{padding-inline:8px;font-size:12px;}}

</style>

<style scoped>
.header-actions{display:flex;gap:4px;align-items:center;flex-shrink:0;}
.open-view .nav-item[data-drop-active="true"]{background:var(--primary-color-2);outline:2px dashed var(--primary-color);outline-offset:-2px;}
@media(max-width:900px){.app-header{flex-wrap:wrap;}.header-actions{margin-left:auto;}.page-heading{flex-basis:calc(100% - 48px);}}
</style>

<style scoped>
.app-main{position:relative;}
.app-header{height:auto;min-height:64px;padding:12px 20px;gap:12px;flex-wrap:nowrap;align-items:flex-start;}
.app-header.library-header{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:36px 34px;column-gap:12px;row-gap:8px;height:100px;min-height:100px;padding-block:10px;align-items:center;}
.header-search-slot{flex:1;min-width:0;display:flex;align-items:center;align-content:flex-start;flex-wrap:wrap;gap:6px;}
.library-header .header-search-slot{grid-column:1;grid-row:1;flex-wrap:nowrap;}
.library-header .header-actions{grid-column:2;grid-row:1;}
.header-secondary-slot{grid-column:1/-1;grid-row:2;min-width:0;width:100%;height:34px;}
.page-title{flex:1;margin:0;font-size:18px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.header-actions{margin:0;gap:4px;min-height:36px;}
.add-folder{height:30px;}
.app-content{--pane-max-height:calc(100dvh - 64px);--scroll-container-max-height:calc(100dvh - 64px);}
.library-header~.app-content{--pane-max-height:calc(100dvh - 100px);--scroll-container-max-height:calc(100dvh - 100px);}
.selection-dock{position:absolute;bottom:16px;left:16px;right:16px;z-index:40;display:flex;justify-content:center;pointer-events:none;}
@media(max-width:1100px){.header-actions .tool-label{display:none;}.app-header{padding-inline:12px;gap:8px;}}
@media(max-width:600px){.app-header{padding:8px;gap:4px;}.header-actions{gap:0;}.header-actions :deep(.ant-btn){padding-inline:6px;}.selection-dock{left:8px;right:8px;bottom:8px;}}
@media(max-width:650px){.header-secondary-slot{overflow-x:auto;scrollbar-width:none;}.header-secondary-slot::-webkit-scrollbar{display:none;}}
</style>
