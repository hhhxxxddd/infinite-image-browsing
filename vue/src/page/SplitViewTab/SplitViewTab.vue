<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { debounce, omit } from 'lodash-es'
import { useDocumentVisibility } from '@vueuse/core'
import { useGlobalStore, type TabPane } from '@/store/useGlobalStore'
import { globalEvents, useGlobalEventListen } from '@/util'
import { AppstoreOutlined, PictureOutlined, VideoCameraOutlined, FolderOutlined, SearchOutlined, TagsOutlined, SettingOutlined, PlusOutlined, DownloadOutlined, HistoryOutlined, MenuOutlined, CloseOutlined } from '@ant-design/icons-vue'
import ImgSliDrawer from '../ImgSli/ImgSliDrawer.vue'
import { useImgSliStore } from '@/store/useImgSli'
import { addToExtraPath } from './extraPathControlFunc'
import { navigate, pageNames, sectionNames } from './navigation'
const global = useGlobalStore()
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
  'workspace-snapshot': defineAsyncComponent(() => import('@/page/WorkspeaceSnapshot/index.vue')),
  'random-image': defineAsyncComponent(() => import('@/page/randomImage/randomImage.vue')),
}

// Older workspace snapshots may contain pages that have since been removed.
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
const subtitle = computed(() => current.value?.pane.type === 'local' ? current.value.pane.path : ({
  empty: '在一处浏览与整理你的本地图片和视频', 'tag-search': '用标签整理、筛选和查找你的收藏',
  'fuzzy-search': '按文件名、路径或生成信息查找媒体', 'global-setting': '外观、浏览偏好与文件管理',
  'topic-search': '选择参考图片，在本机按画面相似度查找', 'batch-download': '集中处理需要打包和导出的文件',
  'workspace-snapshot': '保存并恢复当前的浏览位置',
} as Record<string, string>)[current.value?.pane.type ?? 'empty'] ?? '本地媒体工作区')
const primary = [
  { label: '全部媒体', section: 'all', icon: AppstoreOutlined },
  { label: '图片', section: 'image', icon: PictureOutlined },
  { label: '视频', section: 'video', icon: VideoCameraOutlined },
  { label: '文件夹', section: 'folders', icon: FolderOutlined },
] as const
const tools = [
  { label: '搜索媒体', type: 'fuzzy-search', icon: SearchOutlined },
  { label: '标签管理', type: 'tag-search', icon: TagsOutlined },
  { label: '导出与归档', type: 'batch-download', icon: DownloadOutlined },
  { label: '工作区', type: 'workspace-snapshot', icon: HistoryOutlined },
  { label: '随机回顾', type: 'random-image', icon: PictureOutlined },
] as const
const folders = computed(() => global.conf?.extra_paths ?? [])
const openViews = computed(() => entries.value.filter(({pane}) => !['empty', 'topic-search', ...tools.map(t => t.type), 'global-setting'].includes(pane.type) && !(pane.type === 'local' && pane.mode === 'scanned-fixed' && folders.value.some(folder => folder.path === pane.path))))
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
watch(() => global.tabList, debounce(() => global.saveRecord(), 300), { deep: true })
useGlobalEventListen('closeTabPane', close)
watch(useDocumentVisibility(), value => value === 'visible' && globalEvents.emit('returnToIIB'))
</script>
<template>
  <div class="media-app" :class="{ compact }">
    <aside class="app-sidebar" aria-label="主导航">
      <div class="app-brand"><span class="brand-mark"><PictureOutlined /></span><div><strong>本地媒体库</strong><small>图片与视频 · 本机管理</small></div></div>
      <nav class="nav-scroll">
        <div class="nav-caption">媒体库</div>
        <button v-for="item in primary" :key="item.section" class="nav-item" :class="{ selected: current?.pane.type === 'empty' && (current.pane.section ?? 'all') === item.section }" :aria-current="current?.pane.type === 'empty' && (current.pane.section ?? 'all') === item.section ? 'page' : undefined" :title="item.label" :aria-label="item.label" @click="go('empty', { section: item.section })"><component :is="item.icon" /><span>{{ item.label }}</span></button>
        <div class="nav-caption">整理与查找</div>
        <button v-for="item in tools.slice(0, 2)" :key="item.type" class="nav-item" :class="{ selected: current?.pane.type === item.type }" :title="item.label" :aria-label="item.label" @click="go(item.type)"><component :is="item.icon" /><span>{{ item.label }}</span></button>
        <details class="more-tools"><summary title="更多工具" aria-label="更多工具"><span>更多工具</span></summary><button v-for="item in tools.slice(2)" :key="item.type" class="nav-item" :class="{ selected: current?.pane.type === item.type }" :title="item.label" :aria-label="item.label" @click="go(item.type)"><component :is="item.icon" /><span>{{ item.label }}</span></button><button class="nav-item" title="图片对比" aria-label="图片对比" @click="imageComparison.opened = !imageComparison.opened"><PictureOutlined /><span>图片对比</span></button></details>
        <div class="nav-caption folder-caption"><span>已添加的文件夹</span><button aria-label="添加文件夹" title="添加文件夹" @click="addToExtraPath('walk')"><PlusOutlined /></button></div>
        <p v-if="!folders.length" class="sidebar-hint">添加文件夹后会显示在这里</p>
        <button v-for="folder in folders" :key="folder.path" class="nav-item folder-link" :aria-label="folder.alias || folder.path" :title="folder.path" :class="{ selected: current?.pane.type === 'local' && current.pane.path === folder.path }" @click="go('local', { path: folder.path, mode: 'scanned-fixed' })"><FolderOutlined /><span>{{ folder.alias || folder.path.split(/[\\/]/).filter(Boolean).pop() }}</span></button>
        <template v-if="openViews.length"><div class="nav-caption">正在浏览</div><div v-for="entry in openViews" :key="entry.pane.key" class="open-view"><button class="nav-item" :class="{ selected: current?.pane.key === entry.pane.key }" @click="focus(entry.pane.key)"><HistoryOutlined /><span>{{ entry.pane.nameFallbackStr || (typeof entry.pane.name === 'string' ? entry.pane.name : pageNames[entry.pane.type]) }}</span></button><button class="close-view" aria-label="关闭此视图" @click="close(entry.tabIdx, entry.pane.key)"><CloseOutlined /></button></div></template>
      </nav>
      <div class="sidebar-bottom"><button class="nav-item" title="设置" aria-label="设置" :class="{ selected: current?.pane.type === 'global-setting' }" @click="go('global-setting')"><SettingOutlined /><span>设置</span></button><div class="theme-control"><span>外观</span><select v-model="global.darkModeControl" aria-label="外观主题"><option value="light">浅色</option><option value="auto">跟随系统</option><option value="dark">深色</option></select></div><div class="local-status"><i></i><span>文件保存在本机</span></div></div>
    </aside>
    <main class="app-main">
      <header class="app-header"><button class="sidebar-toggle" aria-label="展开或收起侧栏" @click="compact = !compact"><MenuOutlined /></button><div class="page-heading"><h1>{{ title }}</h1><p :title="subtitle">{{ subtitle }}</p></div><a-button type="primary" class="add-folder" :disabled="global.conf?.is_readonly" @click="addToExtraPath('walk')"><PlusOutlined /> 添加文件夹</a-button></header>
      <section class="app-content" aria-label="媒体工作区"><component v-if="current" :is="compMap[current.pane.type]" :key="current.pane.key" v-bind="paneProps" :tabIdx="current.tabIdx" :paneIdx="current.paneIdx" :paneKey="current.pane.key" /></section>
    </main>
    <ImgSliDrawer />
  </div>
</template>
<style scoped lang="scss">
.media-app { display:flex; height:100dvh; overflow:hidden; background:var(--zp-secondary-background); color:var(--zp-primary); }
.app-sidebar { width:224px; flex-shrink:0; display:flex; flex-direction:column; background:var(--zp-secondary-background); border-right:1px solid var(--zp-border); }
.app-brand { display:flex; gap:12px; align-items:center; padding:28px 20px 24px; strong {font-size:17px; font-weight:600;} small {display:block; font-size:11px; color:var(--zp-secondary); margin-top:4px;} }
.brand-mark { width:38px; height:38px; border-radius:10px; display:grid; place-items:center; color:white; background:#0067c0; font-size:23px; }
.nav-scroll { flex:1; min-height:0; overflow:auto; padding:0 12px; }
.nav-caption { padding:22px 12px 9px; font-size:11px; color:var(--zp-secondary); letter-spacing:1px; &:first-child {padding-top:0;} }
button { font:inherit; cursor:pointer; }
.nav-item { width:100%; display:flex; align-items:center; gap:13px; padding:10px 13px; margin:3px 0; border:0; border-radius:7px; background:transparent; color:inherit; text-align:left; position:relative; .anticon {font-size:18px; flex-shrink:0;} span:last-child {overflow:hidden; text-overflow:ellipsis; white-space:nowrap;} &:hover {background:var(--primary-color-1);} &.selected {background:var(--primary-color-2); color:var(--primary-color); font-weight:600; &::before {content:''; position:absolute; left:0; width:3px; height:18px; border-radius:3px; background:var(--primary-color);}} }
.folder-caption {display:flex; justify-content:space-between; align-items:center; button {border:0; background:none; color:inherit;} }
.sidebar-hint {font-size:12px; line-height:1.8; padding:0 12px; color:var(--zp-secondary);}
.more-tools { summary {padding:12px 13px; cursor:pointer; color:var(--zp-secondary); font-size:12px;} }
.compact .more-tools summary {padding:12px 0;text-align:center;list-style:none;span{display:none;} &::after{content:'···';font-size:20px;} }
@media(max-width:760px) {.more-tools summary{padding:12px 0;text-align:center;list-style:none;span{display:none;} &::after{content:'···';font-size:20px;}}}
.sidebar-bottom {padding:12px; border-top:1px solid var(--zp-border);}
.theme-control {display:flex; justify-content:space-between; align-items:center; padding:10px 13px; font-size:12px; color:var(--zp-secondary); select {max-width:112px; border:1px solid var(--zp-border); border-radius:5px; padding:4px; background:var(--zp-primary-background); color:var(--zp-primary);}}
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
