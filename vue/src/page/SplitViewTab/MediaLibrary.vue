<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { RecycleScroller } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/index.css'
import fileItemCell from '@/components/FileItem.vue'
import MediaSelectionActions from '@/components/MediaSelectionActions.vue'
import type { MenuInfo } from 'ant-design-vue/lib/menu/src/interface'
import { FolderOutlined, PictureOutlined, PlusOutlined, SearchOutlined, ReloadOutlined, PlayCircleOutlined, FolderAddOutlined, DeleteOutlined, FilterOutlined, CloseOutlined } from '@ant-design/icons-vue'
import { getDbBasicInfo, getExpiredDirs, indexScanning, getImagesBySubstr, updateImageData, moveMediaOrder, resetMediaOrder, type DataBaseBasicInfo } from '@/api/db'
import { useGlobalStore } from '@/store/useGlobalStore'
import { createImageSearchIter, useImageSearch } from '@/page/TagSearch/hook'
import { useKeepMultiSelect } from '@/page/fileTransfer/hook'
import { useGlobalEventListen } from '@/util'
import { addToExtraPath } from './extraPathControlFunc'
import { navigate, similarityRequest } from './navigation'
import { useSimilaritySearch } from './useSimilaritySearch'
import { getFileTransferDataFromDragEvent } from '@/util/file'
import { cloneDeep } from 'lodash-es'
import { applyMediaOrder, moveMediaInList } from './mediaOrder'
import { message } from 'ant-design-vue'
import { getTargetFolderFiles, type FileNodeInfo } from '@/api/files'
import { findManagedFolder, topLevelManagedFolders } from './folderScope'
import FolderOverview from './FolderOverview.vue'
import { createSubfolder } from './createSubfolder'
import { deleteSubfolder } from './deleteSubfolder'
import MediaSearchFilters from '@/page/TagSearch/MediaSearchFilters.vue'
import { emptySearchFilters, describeSearchFilters } from '@/page/TagSearch/searchFilters'
const props = defineProps<{ tabIdx:number; paneIdx:number; path?:string; referencePath?:string; section?:'all'|'image'|'video'|'folders'; popAddPathModal?:{path:string; type:import('@/api/db').ExtraPathType} }>()
const g = useGlobalStore()
const folders = computed(() => g.conf?.extra_paths ?? [])
const managedFolder = computed(() => findManagedFolder(folders.value, props.path, g.conf?.is_win))
const folderName = computed(() => props.path === managedFolder.value?.path
  ? managedFolder.value?.alias || props.path?.split(/[/\\]/).filter(Boolean).pop()
  : props.path?.split(/[/\\]/).filter(Boolean).pop())
const includeSubfolders = ref(true)
const subfolders = ref<FileNodeInfo[]>([])
const directoryError = ref('')
const folderScope = () => props.path ? { folder_path: props.path, include_subfolders: includeSubfolders.value } : {}
const breadcrumbs = computed(() => {
  const ancestor = findManagedFolder(topLevelManagedFolders(folders.value, g.conf?.is_win), props.path, g.conf?.is_win)
  if (!props.path || !ancestor) return []
  const root = ancestor.path.replace(/[\\/]+$/, '')
  const names = props.path.slice(root.length).split(/[/\\]/).filter(Boolean)
  const separator = g.conf?.is_win ? '\\' : '/'
  return [{ name: ancestor.alias || root.split(/[/\\]/).pop() || root, path: root },
    ...names.map((name, index) => ({ name, path: root + separator + names.slice(0, index + 1).join(separator) }))]
})
async function loadSubfolders() {
  if (!props.path) return
  directoryError.value = ''
  try { subfolders.value = (await getTargetFolderFiles(props.path)).files.filter(file => file.type === 'dir') }
  catch { subfolders.value = []; directoryError.value = '无法读取子文件夹，请检查目录是否存在或刷新重试。' }
}
async function dropInSubfolder(event: DragEvent, path: string) {
  const data = getFileTransferDataFromDragEvent(event)
  if (!data || g.conf?.is_readonly) return
  const { confirmFileTransfer } = await import('@/page/fileTransfer/hooks/useFileTransfer')
  confirmFileTransfer(data, path)
}
const keyword = ref('')
const filters = ref(emptySearchFilters())
const appliedFilters = ref(emptySearchFilters())
const filtersValid = ref(true)
const filterPanelOpen = ref(false)
const filterSummary = computed(() => describeSearchFilters(filters.value, info.value?.tags ?? []))
const imageChooser = ref<HTMLInputElement>()
const { reference, minimum, loading: searching, error: searchError, result: similarResult, clear: clearSimilarity, search: searchSimilar, chooseFile, choosePath } = useSimilaritySearch(() => ({ ...cloneDeep(filters.value), ...folderScope() }))
const similarityScores = computed(() => new Map(similarResult.value?.files.map(file => [file.fullpath, file.similarity])))
function searchWithImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) chooseFile(file)
  input.value = ''
}
function dropSearchImage(event: DragEvent) {
  const data = getFileTransferDataFromDragEvent(event)
  if (data?.nodes[0]) { choosePath(data.nodes[0].fullpath); return }
  const file = event.dataTransfer?.files[0]
  if (file) chooseFile(file)
}
const queryText = ref('')
const busy = ref(false)
let reloadPending = false
const error = ref('')
const info = ref<DataBaseBasicInfo>()
const pageSize = ref(100)
const localOrder = ref<string[]>([])
const reorderBusy = ref(false)
const libraryIter = createImageSearchIter(cursor => getImagesBySubstr({ ...appliedFilters.value, ...folderScope(), cursor, surstr:queryText.value, regexp:'', media_type:props.section === 'image' || props.section === 'video' ? props.section : 'all', size:pageSize.value, manual_order:true }))
const iter = reactive({
  get res() { return reference.value ? similarResult.value?.files ?? [] : applyMediaOrder(libraryIter.res ?? [], localOrder.value) },
  get load() { return reference.value ? true : libraryIter.load },
  next: () => reference.value || reorderBusy.value ? Promise.resolve(false) : libraryIter.next()
})
const { openPreview, images, stackViewEl, previewIdx, itemSize, gridItems, showGenInfo, imageGenInfo, multiSelectedIdxs, onFileItemClick, scroller, showMenuIdx, onFileDragStart, onFileDragEnd, cellWidth, onScroll, onContextMenuClickU, props:upstream, changeIndchecked, seedChangeChecked, getGenDiff, getGenDiffWatchDep } = useImageSearch(iter)
const { onClearAllSelected, onSelectAll, onReverseSelect } = useKeepMultiSelect()
const selectedFiles = computed(() => multiSelectedIdxs.value.map(idx => images.value[idx]).filter(Boolean))
function selectionAction(key: string) {
  const idx = multiSelectedIdxs.value[0]
  if (images.value[idx]) void onContextMenuClickU({ key } as MenuInfo, images.value[idx], idx)
}
const dragPaths = ref<string[]>([])
const dropMarker = ref<{ path: string; after: boolean }>()
function startMediaDrag(event: DragEvent, idx: number) {
  onFileDragStart(event, idx)
  dragPaths.value = multiSelectedIdxs.value.includes(idx)
    ? images.value.filter((_, index) => multiSelectedIdxs.value.includes(index)).map(file => file.fullpath)
    : [images.value[idx].fullpath]
}
function endMediaDrag() { dragPaths.value = []; dropMarker.value = undefined; onFileDragEnd() }
function overMedia(event: DragEvent, path: string) {
  if (reference.value || busy.value || reorderBusy.value || g.conf?.is_readonly || !dragPaths.value.length || dragPaths.value.includes(path)) return
  event.preventDefault()
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  dropMarker.value = { path, after: event.clientX > bounds.left + bounds.width / 2 }
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}
function scrollWhileDragging(event: DragEvent) {
  if (!dragPaths.value.length || reference.value) return
  const element = scroller.value?.$el
  if (!element) return
  const bounds = element.getBoundingClientRect()
  if (event.clientY < bounds.top + 50) element.scrollTop -= 24
  else if (event.clientY > bounds.bottom - 50) element.scrollTop += 24
}
async function refreshOrder() {
  const selected = new Set(selectedFiles.value.map(file => file.fullpath))
  const scrollTop = scroller.value?.$el.scrollTop ?? 0
  pageSize.value = Math.max(100, images.value.length)
  try {
    await libraryIter.reset({ refetch: true })
    localOrder.value = []
    await nextTick()
    multiSelectedIdxs.value = images.value.flatMap((file, idx) => selected.has(file.fullpath) ? [idx] : [])
    if (scroller.value) scroller.value.$el.scrollTop = scrollTop
    onScroll()
  } finally { pageSize.value = 100 }
}
function setLocalOrder(paths: string[]) {
  const previewPath = images.value[previewIdx.value]?.fullpath
  localOrder.value = paths
  if (previewPath) previewIdx.value = images.value.findIndex(file => file.fullpath === previewPath)
}
async function dropMedia(event: DragEvent, path: string) {
  const marker = dropMarker.value
  if (!marker || marker.path !== path || reference.value || busy.value || reorderBusy.value || g.conf?.is_readonly) return
  event.preventDefault()
  event.stopPropagation()
  const paths = [...dragPaths.value]
  const before = images.value.map(file => file.fullpath)
  const after = moveMediaInList(images.value, paths, path, marker.after).map(file => file.fullpath)
  endMediaDrag()
  if (before.every((value, index) => value === after[index])) return
  reorderBusy.value = true
  // A pending next-page read must not append data from before the move.
  // abort() preserves both the loaded cards and the next-page cursor.
  if (libraryIter.loading) libraryIter.abort()
  setLocalOrder(after)
  try {
    await moveMediaOrder(paths, path, marker.after)
  } catch (e: any) {
    setLocalOrder(before)
    message.error(e.response?.data?.detail || '排序保存失败，已恢复原顺序，请重试')
  } finally {
    reorderBusy.value = false
    if (reloadPending) { reloadPending = false; void reload() }
    else onScroll()
  }
}
async function restoreDateOrder() {
  reorderBusy.value = true
  try { await resetMediaOrder(); await refreshOrder(); message.success('已恢复按时间排序') }
  catch { message.error('恢复排序失败，请重试') }
  finally { reorderBusy.value = false }
}
watch(() => [props.tabIdx,props.paneIdx], () => { upstream.value = props }, { immediate:true })
let normalScrollIndex = 0
watch(() => !!reference.value, async active => {
  if (active) normalScrollIndex = scroller.value?.findItemIndex(scroller.value.getScroll().start) ?? 0
  multiSelectedIdxs.value = []
  previewIdx.value = 0
  await nextTick()
  scroller.value?.scrollToItem(active ? 0 : normalScrollIndex)
  onScroll()
})
watch(similarResult, async () => {
  if (!reference.value) return
  multiSelectedIdxs.value = []
  previewIdx.value = 0
  await nextTick()
  scroller.value?.scrollToItem(0)
  onScroll()
})
watch(similarityRequest, request => {
  if (!request || request.paneKey !== g.tabList[props.tabIdx]?.panes[props.paneIdx]?.key) return
  choosePath(request.path)
  similarityRequest.value = undefined
}, {immediate: true})
watch(() => props.referencePath, path => { if (path) choosePath(path) }, {immediate: true})
function searchText() { clearSimilarity(); void reload() }
function applyFilters() {
  if (!filtersValid.value) { message.warning('请完整填写有效的尺寸或比例'); return }
  if (reference.value) void searchSimilar()
  else void reload()
}
function refreshSearch() { if (reference.value) void searchSimilar(); else void reload() }
function changeFolderScope() {
  void reload()
  if (reference.value) void searchSimilar()
}
async function reload(scan=false) {
  if (props.section === 'folders') return
  if (!filtersValid.value) { message.warning('请完整填写有效的尺寸或比例'); return }
  if (busy.value || reorderBusy.value) { reloadPending = true; return }
  busy.value=true; error.value=''
  try {
    if (scan) await updateImageData()
    const [dbInfo] = await Promise.all([getDbBasicInfo(), loadSubfolders()])
    info.value = dbInfo
    {
      multiSelectedIdxs.value=[]
      queryText.value=keyword.value.trim()
      appliedFilters.value=cloneDeep(filters.value)
      await libraryIter.reset({refetch:true})
      localOrder.value = []
      if (scan && reference.value) await searchSimilar()
      await nextTick()
      scroller.value?.scrollToItem(0)
      onScroll()
    }
  } catch (e) { error.value=e instanceof Error ? e.message : '加载失败，请重试' }
  finally {
    busy.value=false
    indexReady.value = false
    if (reloadPending) { reloadPending=false; void reload() }
  }
}
const scanError = ref('')
const indexReady = ref(false)
let checkInProgress = false
let lastCheck = 0
let disposed = false
let scanInterval: ReturnType<typeof setInterval> | undefined
async function scanLibrary(refresh = false) {
  if (g.conf?.is_readonly || indexScanning.value) return
  scanError.value = ''
  try {
    await updateImageData()
    if (disposed) return
    const updated = await getDbBasicInfo()
    if (disposed) return
    info.value = updated
    await loadSubfolders()
    if (refresh && !busy.value && !reorderBusy.value) {
      await reload()
      if (reference.value) await searchSimilar()
    } else indexReady.value = true
  } catch (cause:any) {
    if (!disposed) scanError.value = cause.response?.data?.detail || '扫描失败，请重试'
  }
}
async function checkIndex(force = false) {
  if (disposed || document.hidden || checkInProgress || indexScanning.value || props.section === 'folders' || !folders.value.length || busy.value || reorderBusy.value) return
  if (!force && Date.now() - lastCheck < 60000) return
  checkInProgress = true
  lastCheck = Date.now()
  try {
    const state = await getExpiredDirs()
    if (disposed) return
    if (info.value) Object.assign(info.value, state)
    if (state.expired && g.autoUpdateIndex && !g.conf?.is_readonly) await scanLibrary()
  } catch { /* Keep the existing list usable during a temporary connection failure. */ }
  finally { checkInProgress = false }
}
const onVisible = () => { if (!document.hidden) void checkIndex() }
onMounted(async () => {
  g.keepMultiSelect = false
  document.addEventListener('visibilitychange', onVisible)
  scanInterval = setInterval(() => void checkIndex(), 60000)
  await reload()
  if(props.popAddPathModal) addToExtraPath(props.popAddPathModal.type,props.popAddPathModal.path)
  else void checkIndex(true)
})
onUnmounted(() => { disposed = true; clearInterval(scanInterval); document.removeEventListener('visibilitychange', onVisible) })
watch(() => g.autoUpdateIndex, enabled => { if (enabled) void checkIndex(true) })
useGlobalEventListen('updateGlobalSettingDone', () => reload())
useGlobalEventListen('searchIndexExpired', () => { if(info.value) info.value.expired=true; void checkIndex(true) })
function openFolder(path:string) { navigate('local',{path,mode:'scanned-fixed'}) }
</script>
<template>
 <div class="library" :ref="el => { stackViewEl = el as HTMLDivElement }">
  <FolderOverview v-if="section === 'folders'" />
  <template v-else>
   <Teleport to="#media-header-search">
    <form class="header-library-search" @submit.prevent="searchText" @dragover.prevent @drop.prevent="dropSearchImage">
      <input v-model="keyword" :aria-label="path ? '搜索当前文件夹' : '搜索媒体库'" :placeholder="reference ? '输入文字可切换搜索' : path ? `搜索 ${folderName}，或拖入图片` : '搜索媒体，或拖入图片'" />
      <button type="submit" title="搜索" aria-label="搜索"><SearchOutlined /></button>
      <button type="button" title="以图搜图" aria-label="以图搜图：选择参考图片" @click="imageChooser?.click()"><PictureOutlined /></button>
      <input ref="imageChooser" class="image-search-input" type="file" accept=".png,.jpg,.jpeg,.webp,.avif,.bmp,.gif,.jpe" aria-label="搜索框参考图片" @change="searchWithImage" />
    </form>
    <a-button type="text" class="header-library-icon" :class="{ 'filter-active': filterSummary || filterPanelOpen }" :title="filterSummary || '筛选与显示'" aria-label="筛选与显示" :aria-expanded="filterPanelOpen" aria-controls="library-filter-panel" @click="filterPanelOpen = !filterPanelOpen"><FilterOutlined /><i v-if="filterSummary" class="filter-dot" /></a-button>
    <a-button type="text" class="header-library-icon optional-tool" title="逐张查看" aria-label="逐张查看" :disabled="!images.length" @click="openPreview(0)"><PlayCircleOutlined /></a-button>
    <a-button type="text" class="header-library-icon" title="刷新" aria-label="刷新" :loading="busy || searching" @click="refreshSearch"><ReloadOutlined /></a-button>
   </Teleport>
   <nav v-if="path" class="folder-breadcrumbs" aria-label="文件夹位置">
    <FolderOutlined />
    <template v-for="(crumb, index) in breadcrumbs" :key="crumb.path">
      <span v-if="index" class="breadcrumb-separator">/</span>
      <button :title="crumb.path" :aria-current="index === breadcrumbs.length - 1 ? 'location' : undefined" @click="openFolder(crumb.path)">{{ crumb.name }}</button>
    </template>
    <a-button class="new-subfolder" size="small" type="text" :disabled="g.conf?.is_readonly" @click="createSubfolder(path!, async () => { await loadSubfolders() })"><FolderAddOutlined />新建子文件夹</a-button>
   </nav>
   <div v-if="subfolders.length" class="subfolder-strip" aria-label="子文件夹">
    <span class="subfolder-label">下级文件夹</span>
    <div v-for="folder in subfolders" :key="folder.fullpath" class="subfolder-chip" @dragover.prevent @drop.prevent.stop="dropInSubfolder($event, folder.fullpath)">
      <button :title="folder.fullpath" @click="openFolder(folder.fullpath)"><FolderOutlined /><span>{{ folder.name }}</span></button>
      <button class="delete-subfolder" :disabled="g.conf?.is_readonly" :aria-label="`删除子文件夹：${folder.name}`" title="删除空文件夹" @click="deleteSubfolder(folder.fullpath, loadSubfolders)"><DeleteOutlined /></button>
    </div>
   </div>
   <a-alert v-if="directoryError" type="warning" :message="directoryError" class="index-notice" />
   <div class="library-meta compact-meta">
    <span v-if="reorderBusy" role="status">正在保存排序…</span>
    <span v-if="reference" role="status">{{ searching ? '正在查找相似图片…' : `相似图片 ${images.length} 项` }}</span>
    <span v-else-if="path">已显示 {{ images.length }} 项 · {{ includeSubfolders ? '包含子文件夹' : '仅当前文件夹' }}</span>
    <span v-else>共 {{ info?.img_count ?? 0 }} 项 · 已显示 {{ images.length }} 项</span>
    <button v-if="reference" type="button" title="清除以图搜图" @click="clearSimilarity">清除搜图 <CloseOutlined /></button>
    <button v-if="filterSummary" class="active-filter-summary" type="button" :title="filterSummary" @click="filterPanelOpen = true">{{ filterSummary }}</button>
    <a-button v-if="images.length" size="small" type="text" class="select-loaded" @click="onSelectAll">全选已加载</a-button>
   </div>
   <aside v-show="filterPanelOpen" id="library-filter-panel" class="library-filter-panel" aria-label="筛选与显示" @keydown.esc.stop="filterPanelOpen = false">
    <div class="filter-panel-heading"><strong>筛选与显示</strong><a-button type="text" title="关闭筛选" aria-label="关闭筛选" @click="filterPanelOpen = false"><CloseOutlined /></a-button></div>
    <div class="filter-panel-scroll">
      <section v-if="path" class="folder-scope-options">
        <strong>浏览范围</strong>
        <a-checkbox v-model:checked="includeSubfolders" @change="changeFolderScope">包含子文件夹</a-checkbox>
        <p :title="path">{{ path }}</p>
      </section>
      <MediaSearchFilters panel v-model="filters" :tags="info?.tags ?? []" :loading="busy || searching" @validity="filtersValid = $event" @apply="applyFilters" />
      <section v-if="reference" class="panel-section" aria-label="图片搜索条件">
        <strong>以图搜图</strong>
        <div class="panel-reference"><img v-if="reference.preview" :src="reference.preview" alt="搜图参考图片" /><span :title="reference.name">{{ reference.name }}</span></div>
        <label class="panel-range">最低相似分 <input v-model.number="minimum" aria-label="最低相似分" type="range" min="0" max="100" step="5" @change="searchSimilar" /><b>{{ minimum }}</b></label>
        <p v-if="similarResult">已比较 {{ similarResult.checked }} 张 · 最多显示 100 项</p>
        <a-button size="small" @click="imageChooser?.click()">更换图片</a-button>
      </section>
      <section class="panel-section"><strong>显示与索引</strong>
        <p>拖动卡片到其他卡片前后即可排序，多选后可整组移动。顺序在媒体库和文件夹中共用。</p>
        <a-button v-if="!path" size="small" :disabled="reorderBusy || !!reference || g.conf?.is_readonly" @click="restoreDateOrder">恢复时间排序</a-button>
        <label class="panel-range">缩略图 <input aria-label="缩略图大小" type="range" min="96" max="384" step="16" v-model.number="cellWidth" /></label>
        <a-button size="small" :loading="indexScanning" :disabled="busy || g.conf?.is_readonly" @click="scanLibrary(true)">扫描新增文件</a-button>
      </section>
    </div>
   </aside>
   <div v-if="indexScanning || scanError || indexReady || (info?.expired && folders.length)" class="index-notice scan-notice" role="status">
     <span>{{ indexScanning ? '正在后台扫描新增文件，可继续浏览…' : scanError || (indexReady ? '媒体索引已更新，点击刷新查看最新内容。' : '发现文件夹变化，扫描后即可查找新增文件。') }}</span>
     <a-button v-if="!indexScanning" size="small" type="link" :disabled="busy || reorderBusy || g.conf?.is_readonly" @click="indexReady && !scanError ? refreshSearch() : scanLibrary(true)">{{ indexReady && !scanError ? '刷新列表' : '立即扫描' }}</a-button>
   </div>
   <MediaSelectionActions :files="selectedFiles" @select-all="onSelectAll" @reverse-select="onReverseSelect" @clear="onClearAllSelected" @action="selectionAction" />
      <RecycleScroller
        :ref="(el) => { scroller = el as any }"
        class="file-list"
        v-if="images?.length"
        :items="images"
        :item-size="itemSize.first"
        key-field="fullpath"
        :item-secondary-size="itemSize.second"
        :gridItems="gridItems"
        @scroll="onScroll" @dragover="scrollWhileDragging"
      >
        <template #after>
          <div style="height: 96px;"/>
        </template>
        <template v-slot="{ item: file, index: idx }">
          <div class="media-cell" :class="{ 'drop-before': dropMarker?.path === file.fullpath && !dropMarker.after, 'drop-after': dropMarker?.path === file.fullpath && dropMarker.after }"
            @dragover="overMedia($event, file.fullpath)" @dragleave="dropMarker = undefined" @drop="dropMedia($event, file.fullpath)">
          <file-item-cell
            :idx="idx"
            :file="file"
            :cell-width="cellWidth"
            v-model:show-menu-idx="showMenuIdx"
            @dragstart="startMediaDrag"
            @dragend="endMediaDrag"
            @file-item-click="onFileItemClick"
            @tiktok-view="(_file, idx) => openPreview(idx)"
            :selected="multiSelectedIdxs.includes(idx)"
            @context-menu-click="onContextMenuClickU"
            :is-selected-mutil-files="multiSelectedIdxs.length > 1"
            :enable-change-indicator="changeIndchecked"
            :seed-change-checked="seedChangeChecked"
            :get-gen-diff="getGenDiff"
            :get-gen-diff-watch-dep="getGenDiffWatchDep"
          />
          <span v-if="reference" class="similarity-score" :style="{bottom: '38px'}">相似分 {{ similarityScores.get(file.fullpath) }}</span>
          </div>
        </template>
      </RecycleScroller>

  <a-alert v-if="searchError || error" type="error" show-icon :message="searchError || error" class="index-notice"><template #action><a-button @click="refreshSearch">重试</a-button></template></a-alert>
  <div v-else-if="(searching || busy) && !images.length" class="loading-state"><a-spin/><p>{{ reference ? '正在本机比较图片，首次搜图可能需要一点时间…' : '正在读取媒体库…' }}</p></div>
  <div v-else-if="reference && !images.length" class="library-empty"><PictureOutlined /><h2>没有找到相似图片</h2><p>试着降低最低相似分、更换参考图片，或扫描更多图片。</p><a-button @click="clearSimilarity">清除搜图</a-button></div>
  <div v-else-if="!images.length" class="library-empty">
   <div class="empty-illustration" aria-hidden="true"><div class="picture-back"/><div class="picture-front"><PictureOutlined /></div><span class="mini-folder"><FolderOutlined /></span></div>
   <h2>{{ !folders.length ? '从一个文件夹开始' : queryText ? '没有找到匹配的媒体' : path ? '当前范围内还没有已收录的媒体' : '这里还没有媒体文件' }}</h2>
   <p>{{ !folders.length ? '添加图片或视频所在的文件夹，建立你的本地媒体库。' : queryText ? '尝试更短的文件名，或更换搜索词。' : '扫描已添加的文件夹，将图片和视频收录到媒体库。' }}</p>
   <p v-if="!folders.length" class="empty-note">文件留在原来的位置，无需复制或上传。</p>
   <a-button v-if="!folders.length" type="primary" size="large" :disabled="g.conf?.is_readonly" @click="addToExtraPath('walk')"><PlusOutlined /> 添加第一个文件夹</a-button>
   <a-button v-else-if="!queryText" type="primary" :disabled="g.conf?.is_readonly" @click="scanLibrary(true)"><ReloadOutlined /> 扫描文件夹</a-button>
   <a-button v-else @click="keyword=''; reload()">清除搜索</a-button>
   <div v-if="!folders.length" class="onboarding-steps"><span><b>1</b> 添加文件夹</span><span><b>2</b> 扫描图片与视频</span><span><b>3</b> 浏览、搜索和整理</span></div>
  </div>
  <a-modal v-model:open="showGenInfo" title="生成信息" :footer="null"><pre class="generation-info">{{ imageGenInfo }}</pre></a-modal>

  </template>
 </div>
</template>
<style scoped lang="scss">
.image-search-filter {display:flex;align-items:center;gap:14px;margin:0 32px 14px;padding:10px 14px;border:1px solid var(--zp-border);border-radius:8px;background:var(--primary-color-1);flex-shrink:0;img{width:44px;height:44px;object-fit:contain;border-radius:4px;background:var(--zp-primary-background);}}
.reference-caption {display:flex;flex-direction:column;gap:3px;min-width:0;max-width:220px;strong{font-size:13px;}span{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--zp-secondary);}}
.similarity-threshold {display:flex;align-items:center;gap:10px;margin-left:auto;font-size:12px;input{width:110px;accent-color:var(--primary-color);}b{width:24px;}}
.media-cell {position:relative;}.similarity-score {position:absolute;bottom:56px;right:16px;pointer-events:none;z-index:1;border-radius:4px;padding:3px 7px;background:#0067c0e6;color:white;font-size:11px;}
.library {height:100%;display:flex;flex-direction:column;min-height:0;background:var(--zp-primary-background);}
.selection-actions {display:flex;gap:16px;align-items:center;padding:8px 32px;color:var(--primary-color);font-size:13px;}
.image-search-input {position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none;}
.library-search .image-search-button {white-space:nowrap;border-left:1px solid var(--zp-border);padding-left:10px;}
.library-toolbar {display:flex;align-items:center;gap:10px;padding:20px 32px 14px;flex-shrink:0;}
.grow {flex:1;}.result-count{color:var(--zp-secondary);font-size:13px;}
.library-search {display:flex;align-items:center;gap:10px;max-width:440px;flex:1;background:var(--zp-secondary-background);border:1px solid var(--zp-border);border-radius:6px;padding:7px 12px;color:var(--zp-secondary);input{min-width:0;flex:1;background:transparent;border:0;outline:0;color:var(--zp-primary);font:inherit;}button{background:none;border:0;color:var(--primary-color);cursor:pointer;font:inherit;} &:focus-within{border-color:var(--primary-color);}}
.library-meta{display:flex;align-items:center;gap:16px;padding:0 32px 14px;font-size:12px;color:var(--zp-secondary);flex-shrink:0;}.size-control{display:flex;gap:10px;align-items:center;margin-left:auto;input{width:100px;accent-color:var(--primary-color);}}
.index-notice{margin:0 32px 12px;}.file-list{flex:1;min-height:0;padding:0 24px;overflow:auto;}.loading-state{text-align:center;padding:80px;}
.library-empty{flex:1;min-height:400px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 24px 70px;text-align:center;background:radial-gradient(ellipse at 50% 40%,var(--primary-color-1),transparent 60%);h2{font-size:24px;font-weight:600;margin:24px 0 12px;}p{font-size:14px;color:var(--zp-secondary);margin:0 0 10px;}.empty-note{font-size:12px;margin-bottom:24px;}}
.empty-illustration{height:120px;width:160px;position:relative;}.picture-back{position:absolute;width:120px;height:88px;left:2px;top:10px;border-radius:10px;background:#c9e3fb;transform:rotate(-12deg);border:1px solid #adcfea;}.picture-front{position:absolute;left:22px;top:22px;width:120px;height:88px;border:5px solid var(--zp-primary-background);border-radius:10px;background:#e2f0ff;color:#3585c7;display:grid;place-items:center;font-size:52px;box-shadow:0 10px 30px #0067c019;}.mini-folder{position:absolute;right:0;bottom:0;width:42px;height:42px;border-radius:10px;background:#0067c0;color:white;display:grid;place-items:center;font-size:24px;box-shadow:0 4px 12px #0067c025;}
.onboarding-steps{display:flex;gap:28px;margin-top:48px;color:var(--zp-secondary);font-size:12px;b{display:inline-grid;place-items:center;width:21px;height:21px;border:1px solid var(--zp-border);border-radius:50%;margin-right:8px;font-weight:500;}}
.folder-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:20px;padding:8px 32px 32px;overflow:auto;}.folder-card{border:1px solid var(--zp-border);border-radius:9px;overflow:hidden;}.folder-open{display:flex;flex-direction:column;align-items:flex-start;gap:10px;padding:24px;width:100%;border:0;background:var(--zp-secondary-background);cursor:pointer;text-align:left;color:var(--zp-primary);strong{font-size:15px;}small{width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--zp-secondary);}}.folder-art{color:#3b8bd2;font-size:42px;}.folder-actions{display:flex;justify-content:space-between;padding:8px;}.generation-info{white-space:pre-wrap;max-height:60vh;overflow:auto;}
@media(max-width:760px){.image-search-filter{margin:0 14px 14px;gap:10px;flex-wrap:wrap;}.similarity-threshold{margin-left:0;}.library-toolbar{padding:14px;flex-wrap:wrap;}.library-search{flex-basis:100%;}.library-meta{padding:0 14px 12px;flex-wrap:wrap;}.onboarding-steps{gap:12px;flex-wrap:wrap;justify-content:center;}.folder-grid{padding:14px;}.library-empty h2{font-size:21px;}}

.library{overflow:auto;min-width:0;}.library-toolbar{flex-wrap:wrap;gap:10px;}.library-toolbar>.grow{display:none;}
.library-search{flex:1 1 340px;max-width:none;min-width:0;min-height:36px;}.library-search>button{flex-shrink:0;white-space:nowrap;}
.library-toolbar>.ant-btn{flex-shrink:0;}.library-meta{flex-wrap:wrap;gap:10px 16px;line-height:1.6;}.library-meta>.size-control{flex-shrink:0;}
.image-search-filter{flex-wrap:wrap;gap:12px;}.reference-caption{flex:1 1 140px;}.similarity-threshold{flex-wrap:wrap;}.image-search-filter>img{flex-shrink:0;}
.library-empty{min-height:260px;flex-shrink:0;padding:32px 24px;}.library-empty h2{line-height:1.4;}.library-empty p{line-height:1.7;}
.selection-actions{flex-wrap:wrap;}.folder-grid{grid-template-columns:repeat(auto-fill,minmax(min(240px,100%),1fr));}.folder-card{min-width:0;}.folder-actions{flex-wrap:wrap;gap:6px;}
.folder-open strong{overflow-wrap:anywhere;}.onboarding-steps{flex-wrap:wrap;justify-content:center;line-height:1.6;}
.library .file-list{min-height:140px;}
@container(max-width:650px){.library-toolbar{padding:16px;}.library-search{flex-basis:100%;}.library-meta{padding:0 16px 14px;}.image-search-filter{margin-inline:16px;}.size-control{margin-left:0;}.library .file-list{padding-inline:8px;}.onboarding-steps{margin-top:24px;}.index-notice{margin-inline:16px;}.loading-state{padding:48px 16px;}}

</style>
<style scoped>
.library-filters{margin:0 24px 8px;flex-shrink:0;}
@media(max-width:550px){.library-filters{margin-inline:16px;}}
</style>

<style scoped>
.header-library-search{display:flex;flex:1;min-width:60px;align-items:center;height:36px;border:1px solid var(--zp-border);border-radius:7px;background:var(--zp-secondary-background);padding:0 6px 0 12px;}
.header-library-search:focus-within{border-color:var(--primary-color);}
.header-library-search>input:not([type="file"]){flex:1;width:0;min-width:0;font:inherit;font-size:13px;border:0;outline:0;background:transparent;color:var(--zp-primary);}
.header-library-search>button{width:30px;height:30px;flex-shrink:0;display:grid;place-items:center;background:none;border:0;border-radius:4px;cursor:pointer;font-size:16px;color:var(--zp-secondary);}
.header-library-search>button:hover{background:var(--primary-color-1);color:var(--primary-color);}
.header-library-icon{position:relative;padding:4px 8px;flex-shrink:0;font-size:16px;}
.header-library-icon.filter-active{color:var(--primary-color);background:var(--primary-color-1);}
.filter-dot{position:absolute;right:5px;top:5px;width:5px;height:5px;background:var(--primary-color);border-radius:50%;}
.library .compact-meta{height:36px;min-height:36px;padding:0 20px;flex-wrap:nowrap;gap:10px;font-size:11px;}
.compact-meta>span{white-space:nowrap;}.compact-meta>button:not(.ant-btn){background:none;border:0;color:var(--primary-color);cursor:pointer;font-size:11px;}
.compact-meta .active-filter-summary{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;min-width:0;}
.compact-meta .select-loaded{margin-left:auto;flex-shrink:0;font-size:11px;}
.library-filter-panel{position:absolute;top:8px;right:12px;bottom:12px;width:min(330px,calc(100% - 24px));z-index:45;border:1px solid var(--zp-border);border-radius:10px;background:var(--zp-primary-background);box-shadow:0 8px 32px #0002;display:flex;flex-direction:column;overflow:hidden;}
.filter-panel-heading{height:46px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:0 12px 0 16px;border-bottom:1px solid var(--zp-border);font-size:13px;}
.filter-panel-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:16px;}
.panel-section{border-top:1px solid var(--zp-border);margin-top:16px;padding-top:14px;font-size:12px;}.panel-section>strong{display:block;margin-bottom:10px;font-size:12px;}
.panel-range{display:flex;gap:8px;align-items:center;margin:12px 0;}.panel-range input{flex:1;min-width:0;accent-color:var(--primary-color);}
.panel-reference{display:flex;gap:10px;align-items:center;}.panel-reference img{width:40px;height:40px;object-fit:cover;border-radius:5px;}.panel-reference span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.library .file-list{padding-inline:12px;}
@media(max-width:650px){.optional-tool{display:none;}.header-library-icon{padding-inline:5px;}.library .compact-meta{padding-inline:12px;}}
</style>

<style scoped>
.media-cell.drop-before::before,.media-cell.drop-after::after{content:'';position:absolute;top:8px;bottom:8px;width:3px;border-radius:2px;background:var(--primary-color);z-index:110;pointer-events:none;}
.media-cell.drop-before::before{left:1px;}.media-cell.drop-after::after{right:1px;}
</style>

<style scoped>.library .file-list{overflow-anchor:none;}</style>

<style scoped>
.folder-breadcrumbs{display:flex;align-items:center;gap:8px;padding:12px 20px 4px;font-size:13px;min-height:36px;flex-shrink:0;overflow-x:auto;white-space:nowrap;}
.folder-breadcrumbs>button{padding:2px 4px;background:none;border:0;color:var(--zp-secondary);font:inherit;cursor:pointer;}
.folder-breadcrumbs>button[aria-current]{color:var(--zp-primary);font-weight:600;}
.breadcrumb-separator{color:var(--zp-secondary);}
.subfolder-strip{display:flex;gap:8px;padding:8px 20px 4px;overflow-x:auto;flex-shrink:0;}
.subfolder-strip>button{display:flex;align-items:center;gap:7px;max-width:220px;flex-shrink:0;border:1px solid var(--zp-border);border-radius:6px;background:var(--zp-primary-background);color:var(--zp-primary);font-size:12px;padding:6px 10px;cursor:pointer;}
.subfolder-strip>button:hover{background:var(--primary-color-1);border-color:var(--primary-color);}
.subfolder-strip>button>span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.subfolder-strip .anticon,.folder-breadcrumbs>.anticon{color:var(--primary-color);}
.folder-scope-options{padding-bottom:12px;margin-bottom:12px;border-bottom:1px solid var(--zp-border);font-size:12px;}
.folder-scope-options>strong{display:block;margin-bottom:10px;}.folder-scope-options>p{color:var(--zp-secondary);overflow-wrap:anywhere;margin:8px 0 0;font-size:11px;}
.folder-entry-note{font-size:12px;color:var(--zp-secondary);padding:4px 8px;}.folder-actions{align-items:center;}
</style>

<style scoped>.folder-breadcrumbs .new-subfolder{margin-left:auto;flex-shrink:0;color:var(--primary-color);font-size:12px;}</style>

<style scoped>
.scan-notice{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 12px;background:var(--primary-color-1);border-radius:6px;font-size:12px;}.scan-notice>span{min-width:0;}.scan-notice .ant-btn{flex-shrink:0;}.subfolder-label{color:var(--zp-secondary);font-size:11px;align-self:center;flex-shrink:0;}.subfolder-chip{display:flex;align-items:center;flex-shrink:0;border:1px solid var(--zp-border);border-radius:6px;overflow:hidden;}.subfolder-chip button{display:flex;gap:6px;align-items:center;background:none;border:0;color:var(--zp-primary);font-size:12px;cursor:pointer;padding:6px 8px;}.subfolder-chip button:hover{background:var(--primary-color-1);}.subfolder-chip .delete-subfolder{color:var(--zp-secondary);border-left:1px solid var(--zp-border);}.subfolder-chip .delete-subfolder:hover{color:#ff4d4f;}
</style>
