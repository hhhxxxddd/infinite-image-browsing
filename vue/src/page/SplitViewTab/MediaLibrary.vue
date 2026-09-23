<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import MasonryScroller from './MasonryScroller.vue'
import fileItemCell from '@/components/FileItem.vue'
import MediaSelectionActions from '@/components/MediaSelectionActions.vue'
import type { MenuInfo } from 'ant-design-vue/lib/menu/src/interface'
import { FolderOutlined, PictureOutlined, PlusOutlined, SearchOutlined, ReloadOutlined, PlayCircleOutlined, FolderAddOutlined, DeleteOutlined, FilterOutlined, CloseOutlined, RobotOutlined } from '@ant-design/icons-vue'
import { getDbBasicInfo, getExpiredDirs, indexScanning, getImagesBySubstr, updateImageData, moveMediaOrder, resetMediaOrder, type DataBaseBasicInfo } from '@/api/db'
import { useGlobalStore } from '@/store/useGlobalStore'
import { createImageSearchIter, useImageSearch } from './mediaSearchHook'
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
import LibraryFilterFields from './LibraryFilterFields.vue'
import SearchSyntaxHelp from '@/components/SearchSyntaxHelp.vue'
import { getQwenStatus, startQwenIndex, searchQwen, type QwenResult, type QwenStatus } from '@/api/qwen3vl'
import { emptySearchFilters, describeSearchFilters } from './searchFilters'
const props = defineProps<{ tabIdx:number; paneIdx:number; path?:string; referencePath?:string; section?:'all'|'image'|'video'|'folders'; popAddPathModal?:{path:string; type:import('@/api/db').ExtraPathType} }>()
const g = useGlobalStore()
const folders = computed(() => g.conf?.extra_paths ?? [])
const includeSubfolders = ref(true)
const draftIncludeSubfolders = ref(true)
const subfolders = ref<FileNodeInfo[]>([])
const directoryDialogOpen = ref(false)
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
  try { subfolders.value = (await getTargetFolderFiles(props.path, true)).files }
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
const filterSummary = computed(() => describeSearchFilters(appliedFilters.value, info.value?.tags ?? []))
function openFilterPanel() {
  filters.value = cloneDeep(appliedFilters.value)
  draftIncludeSubfolders.value = includeSubfolders.value
  filterPanelOpen.value = true
}
function closeFilterPanel() {
  filterPanelOpen.value = false
  filters.value = cloneDeep(appliedFilters.value)
  draftIncludeSubfolders.value = includeSubfolders.value
}
function toggleFilterPanel() {
  if (filterPanelOpen.value) closeFilterPanel()
  else openFilterPanel()
}
function resetFilterDraft() {
  filters.value = cloneDeep(appliedFilters.value)
  draftIncludeSubfolders.value = includeSubfolders.value
}
function clearFilterDraft() {
  filters.value = emptySearchFilters()
  draftIncludeSubfolders.value = true
}
const imageChooser = ref<HTMLInputElement>()
const { reference, method: similarityMethod, chooseMethod: chooseSimilarityMethod, minimum, loading: searching, error: searchError, result: similarResult, clear: clearSimilarity, search: searchSimilar, chooseFile, choosePath } = useSimilaritySearch(() => ({ ...cloneDeep(appliedFilters.value), ...folderScope() }))
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
function pasteSearchImage(event: ClipboardEvent) {
  if (event.defaultPrevented || props.section === 'folders' || document.querySelector('.tiktok-viewer')) return
  const target = event.target
  if (target instanceof Element && target.closest('textarea, select, [contenteditable], [role="textbox"], [role="dialog"]')) return
  if (target instanceof Element && target.closest('input') && !target.closest('.header-library-search')) return
  const clipboard = event.clipboardData
  const file = Array.from(clipboard?.items ?? []).find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile()
    ?? Array.from(clipboard?.files ?? []).find(item => item.type.startsWith('image/'))
  if (!file) return
  event.preventDefault()
  chooseFile(file, file.name ? `剪贴板图片 · ${file.name}` : '剪贴板图片')
}
const queryText = ref('')
const busy = ref(false)
let reloadPending = false
const error = ref('')
const info = ref<DataBaseBasicInfo>()
const pageSize = ref(100)
const localOrder = ref<string[]>([])
const reorderBusy = ref(false)
const semanticMode = ref(false)
const semanticInput = ref('')
const headerSearchInput = computed({
  get: () => semanticMode.value ? semanticInput.value : keyword.value,
  set: (value: string) => { if (semanticMode.value) semanticInput.value = value; else keyword.value = value }
})
const semanticQuery = ref('')
const semanticResult = ref<QwenResult>()
const semanticRerank = ref(false)
const semanticSearchedRerank = ref(false)
const semanticStatus = ref<QwenStatus>()
const rerankerStatus = ref<QwenStatus>()
const semanticLoading = ref(false)
const semanticError = ref('')
const semanticScores = computed(() => new Map((semanticResult.value?.files ?? []).map(file => [file.fullpath, {
  relevance: file.relevance,
  embedding: 'embedding_score' in file ? file.embedding_score : undefined
}])))
let semanticRequest = 0
let semanticStatusTimer: ReturnType<typeof setInterval> | undefined
let semanticStatusInFlight = false
const libraryIter = createImageSearchIter(cursor => getImagesBySubstr({ ...appliedFilters.value, ...folderScope(), cursor, surstr:queryText.value, regexp:'', media_type:props.section === 'image' || props.section === 'video' ? props.section : 'all', size:pageSize.value, manual_order:true }))
const iter = reactive({
  get res() { return reference.value ? similarResult.value?.files ?? [] : semanticQuery.value ? semanticResult.value?.files ?? [] : applyMediaOrder(libraryIter.res ?? [], localOrder.value) },
  get load() { return reference.value || semanticQuery.value ? true : libraryIter.load },
  next: () => reference.value || semanticQuery.value || reorderBusy.value ? Promise.resolve(false) : libraryIter.next()
})
const { openPreview, images, stackViewEl, previewIdx, gridItems, showGenInfo, imageGenInfo, multiSelectedIdxs, onFileItemClick, scroller, showMenuIdx, onFileDragStart, onFileDragEnd, cellWidth, onScroll, onContextMenuClickU, props:upstream, changeIndchecked, seedChangeChecked, getGenDiff, getGenDiffWatchDep } = useImageSearch(iter, { fillGridWidth: true, horizontalPadding: 24 })
const thumbnailSizePreset = ref<'custom' | 'small' | 'medium' | 'large'>('custom')
const thumbnailPresetWidths = { small: 128, medium: 176, large: 256 } as const
watch(thumbnailSizePreset, preset => {
  cellWidth.value = preset === 'custom' ? g.defaultGridCellWidth : thumbnailPresetWidths[preset]
})
watch(() => g.defaultGridCellWidth, width => {
  if (thumbnailSizePreset.value === 'custom') cellWidth.value = width
})
const { onClearAllSelected, onSelectAll, onReverseSelect } = useKeepMultiSelect()
const selectedFiles = computed(() => multiSelectedIdxs.value.map(idx => images.value[idx]).filter(Boolean))
const selectedIndexSet = computed(() => new Set(multiSelectedIdxs.value))
const selectedDragPaths = computed(() => images.value.filter((_, idx) => selectedIndexSet.value.has(idx)).map(file => file.fullpath))
const allLoadedSelected = computed(() => images.value.length > 0 && images.value.every((_, idx) => selectedIndexSet.value.has(idx)))
function toggleLoadedSelection() {
  if (allLoadedSelected.value) onClearAllSelected()
  else onSelectAll()
}
function onLibraryKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.key.toLowerCase() !== 'a' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.repeat || event.isComposing || !images.value.length) return
  const target = event.target
  if (target instanceof Element && target.closest('input, textarea, select, [contenteditable], [role="textbox"], [role="dialog"]')) return
  if (document.querySelector('.tiktok-viewer')) return
  event.preventDefault()
  toggleLoadedSelection()
}
function selectionAction(key: string) {
  const idx = multiSelectedIdxs.value[0]
  if (images.value[idx]) void onContextMenuClickU({ key } as MenuInfo, images.value[idx], idx)
    .catch((error: any) => message.error(error.response?.data?.detail || '操作失败，请重试'))
}
const dragPaths = ref<string[]>([])
const dragPathSet = computed(() => new Set(dragPaths.value))
const dropMarker = ref<{ path: string; after: boolean }>()
function startMediaDrag(event: DragEvent, idx: number) {
  onFileDragStart(event, idx)
  dragPaths.value = selectedIndexSet.value.has(idx)
    ? selectedDragPaths.value
    : [images.value[idx].fullpath]
}
function endMediaDrag() { dragPaths.value = []; dropMarker.value = undefined; onFileDragEnd() }
function onCardImageDimensions(path: string, width: number, height: number) {
  (scroller.value as unknown as { setDimensions?: (path: string, width: number, height: number) => void } | undefined)?.setDimensions?.(path, width, height)
}
function overMedia(event: DragEvent, path: string) {
  if (reference.value || semanticQuery.value || busy.value || reorderBusy.value || g.conf?.is_readonly || !dragPaths.value.length || dragPathSet.value.has(path)) return
  event.preventDefault()
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  dropMarker.value = { path, after: event.clientX > bounds.left + bounds.width / 2 }
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}
function scrollWhileDragging(event: DragEvent) {
  if (!dragPaths.value.length || reference.value || semanticQuery.value) return
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
  if (!marker || marker.path !== path || reference.value || semanticQuery.value || busy.value || reorderBusy.value || g.conf?.is_readonly) return
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
  if (active) {
    semanticMode.value = false
    clearSemantic()
    syncSemanticStatusPolling()
  } else if (!semanticMode.value && queryText.value !== keyword.value.trim()) {
    void reload()
  }
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
watch(semanticResult, async result => {
  if (!semanticQuery.value || !result) return
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
function clearSemantic() {
  semanticRequest++
  semanticQuery.value = ''
  semanticResult.value = undefined
  semanticError.value = ''
  semanticLoading.value = false
}
async function refreshSemanticStatus() {
  if (semanticStatusInFlight) return
  semanticStatusInFlight = true
  try {
    const [embedding, reranker] = await Promise.all([getQwenStatus('embedding'), getQwenStatus('reranker')])
    semanticStatus.value = embedding
    rerankerStatus.value = reranker
  }
  catch { /* The normal API error handler reports a failed request. */ }
  finally { semanticStatusInFlight = false }
}
function toggleSemanticMode() {
  semanticMode.value = !semanticMode.value
  if (semanticMode.value) clearSimilarity()
  else clearSemantic()
  syncSemanticStatusPolling()
  // The normal library iterator is kept while searching semantically. Reveal
  // its existing cards on mode changes instead of fetching and resetting them.
  if (!semanticMode.value && queryText.value !== keyword.value.trim()) void reload()
}
function syncSemanticStatusPolling() {
  clearInterval(semanticStatusTimer)
  semanticStatusTimer = undefined
  if (semanticMode.value || (reference.value && similarityMethod.value === 'qwen')) {
    void refreshSemanticStatus()
    semanticStatusTimer = setInterval(() => void refreshSemanticStatus(), 10000)
  }
}
watch([reference, similarityMethod], syncSemanticStatusPolling)
watch(() => semanticStatus.value?.running, (running, previous) => {
  if (previous && !running && reference.value && similarityMethod.value === 'qwen') void searchSimilar()
})
async function buildSemanticIndex() {
  semanticError.value = ''
  try {
    await startQwenIndex()
    await refreshSemanticStatus()
  }
  catch (cause: any) { semanticError.value = cause?.message || '启动语义索引失败' }
}
async function runSemanticSearch() {
  const query = semanticInput.value.trim()
  if (!query) { clearSemantic(); void reload(); return }
  clearSimilarity()
  const request = ++semanticRequest
  semanticQuery.value = query
  semanticResult.value = undefined
  semanticError.value = ''
  semanticLoading.value = true
  multiSelectedIdxs.value = []
  try {
    const rerank = semanticRerank.value
    const filters = { ...cloneDeep(appliedFilters.value), ...folderScope() }
    const result = await searchQwen(query, filters, rerank)
    if (request === semanticRequest) {
      semanticResult.value = result
      semanticSearchedRerank.value = rerank
    }
  } catch (cause: any) {
    if (request === semanticRequest) semanticError.value = cause?.message || '语义搜索失败'
  } finally {
    if (request === semanticRequest) semanticLoading.value = false
  }
}
function submitHeaderSearch() {
  if (semanticMode.value) void runSemanticSearch()
  else { clearSemantic(); clearSimilarity(); void reload() }
}
function onHeaderSearchKeydown(event: KeyboardEvent) {
  if (event.isComposing) return
  event.preventDefault()
  submitHeaderSearch()
}
function applySearchExample(example: string) {
  if (semanticMode.value) semanticInput.value = example
  else keyword.value = example
  submitHeaderSearch()
}
function applyFilters() {
  if (!filtersValid.value) { message.warning('请完整填写有效的尺寸或比例'); return }
  appliedFilters.value = cloneDeep(filters.value)
  includeSubfolders.value = draftIncludeSubfolders.value
  filterPanelOpen.value = false
  refreshSearch()
}
function refreshSearch() {
  if (reference.value) void searchSimilar()
  else if (semanticMode.value) {
    if (semanticInput.value.trim()) void runSemanticSearch()
    else { clearSemantic(); void reload() }
  } else void reload()
}
async function reload(scan=false) {
  if (props.section === 'folders') return
  if (busy.value || reorderBusy.value) { reloadPending = true; return }
  busy.value=true; error.value=''
  try {
    if (scan) await updateImageData()
    multiSelectedIdxs.value=[]
    queryText.value=semanticMode.value ? '' : keyword.value.trim()
    // The periodic expiry check runs separately; it should not hold up cards.
    const [dbInfo] = await Promise.all([getDbBasicInfo(false), loadSubfolders(), libraryIter.reset({refetch:true})])
    info.value = dbInfo
    {
      localOrder.value = []
      if (scan && reference.value) await searchSimilar()
      else if (scan && semanticQuery.value) await runSemanticSearch()
      await nextTick()
      scroller.value?.scrollToItem(0)
      onScroll()
    }
  } catch (e: any) { error.value=e?.response?.data?.detail || (e instanceof Error ? e.message : '加载失败，请重试') }
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
      else if (semanticQuery.value) await runSemanticSearch()
    } else indexReady.value = true
  } catch (cause:any) {
    if (!disposed) scanError.value = cause.response?.data?.detail || '扫描失败，请重试'
  }
}
async function checkIndex(force = false) {
  if (disposed || document.hidden || checkInProgress || indexScanning.value || !folders.value.length || busy.value || reorderBusy.value) return
  if (!force && Date.now() - lastCheck < 60000) return
  checkInProgress = true
  lastCheck = Date.now()
  try {
    const state = await getExpiredDirs()
    if (disposed) return
    if (info.value) Object.assign(info.value, state)
    if (state.expired && g.autoUpdateIndex && !g.conf?.is_readonly) {
      if (props.section === 'folders') await updateImageData()
      else await scanLibrary()
    }
  } catch { /* Keep the existing list usable during a temporary connection failure. */ }
  finally { checkInProgress = false }
}
const onVisible = () => { if (!document.hidden) void checkIndex() }
onMounted(async () => {
  g.keepMultiSelect = false
  document.addEventListener('visibilitychange', onVisible)
  document.addEventListener('keydown', onLibraryKeydown)
  document.addEventListener('paste', pasteSearchImage)
  scanInterval = setInterval(() => void checkIndex(), 60000)
  await reload()
  if(props.popAddPathModal) addToExtraPath(props.popAddPathModal.type,props.popAddPathModal.path)
  else void checkIndex(true)
})
onUnmounted(() => { disposed = true; clearInterval(scanInterval); clearInterval(semanticStatusTimer); document.removeEventListener('visibilitychange', onVisible); document.removeEventListener('keydown', onLibraryKeydown); document.removeEventListener('paste', pasteSearchImage) })
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
    <SearchSyntaxHelp icon-only :semantic-mode="semanticMode" @example="applySearchExample" />
    <form class="header-library-search" :class="{ 'semantic-mode': semanticMode }" @submit.prevent="submitHeaderSearch" @dragover.prevent @drop.prevent="dropSearchImage">
      <input v-model="headerSearchInput" :aria-label="semanticMode ? '按画面内容搜索' : path ? '搜索当前文件夹' : '搜索媒体库'" :placeholder="semanticMode ? '描述想找的画面，回车搜索' : reference ? '输入文字可切换搜索' : '搜索文件名、标签、描述，或拖入/粘贴图片'" :maxlength="semanticMode ? 500 : undefined" @keydown.enter="onHeaderSearchKeydown" />
      <button type="submit" :title="semanticMode ? '搜索画面' : '搜索'" :aria-label="semanticMode ? '搜索画面' : '搜索'"><SearchOutlined /></button>
      <button class="semantic-entry" type="button" :title="semanticMode ? '切换到文字搜索' : '切换到 AI 画面搜索'" :aria-label="semanticMode ? '切换到文字搜索' : '切换到 AI 画面搜索'" :aria-pressed="semanticMode" @click="toggleSemanticMode"><RobotOutlined /></button>
      <button type="button" title="以图搜图：选择或粘贴图片" aria-label="以图搜图：选择参考图片" @click="imageChooser?.click()"><PictureOutlined /></button>
      <input ref="imageChooser" class="image-search-input" type="file" accept=".png,.jpg,.jpeg,.webp,.avif,.bmp,.gif,.jpe" aria-label="搜索框参考图片" @change="searchWithImage" />
    </form>
    <a-button type="text" class="header-library-icon" :class="{ 'filter-active': filterSummary || filterPanelOpen }" :title="filterSummary || '筛选媒体'" aria-label="筛选媒体" :aria-expanded="filterPanelOpen" aria-controls="library-filter-panel" @click="toggleFilterPanel"><FilterOutlined /><i v-if="filterSummary" class="filter-dot" /></a-button>
    <a-button type="text" class="header-library-icon optional-tool" title="逐张查看" aria-label="逐张查看" :disabled="!images.length" @click="openPreview(0)"><PlayCircleOutlined /></a-button>
    <a-button type="text" class="header-library-icon header-refresh" title="刷新" :aria-label="busy || searching ? '正在刷新' : '刷新'" :disabled="busy || searching" @click="refreshSearch"><ReloadOutlined :class="{ spinning: busy || searching }" /></a-button>
   </Teleport>
   <Teleport to="#media-header-secondary">
    <div class="library-meta compact-meta">
      <div class="library-meta-summary">
        <div v-if="semanticMode" class="semantic-toolbar" role="group" aria-label="画面搜索选项">
          <div class="semantic-toolbar-inner">
            <template v-if="semanticStatus?.state === 'ready'">
              <div class="semantic-rerank" :title="rerankerStatus?.state === 'ready' ? '对前 20 张候选图片再次排序' : 'AI 重排暂不可用，请在设置中配置'"><span>AI 重排</span><a-switch v-model:checked="semanticRerank" size="small" aria-label="AI 重排" :disabled="rerankerStatus?.state !== 'ready'" /></div>
              <span class="semantic-index-count" role="status">已索引 <strong>{{ semanticStatus.indexed_count }} / {{ semanticStatus.image_count }}</strong></span>
              <a-button class="semantic-update-index" size="small" :loading="semanticStatus.running" :disabled="g.conf?.is_readonly" @click="buildSemanticIndex">{{ semanticStatus.indexed_count ? '更新索引' : '建立索引' }}</a-button>
              <span v-if="semanticStatus.error" class="semantic-index-error" :title="semanticStatus.error">索引失败</span>
            </template>
            <template v-else>
              <span role="status">{{ semanticStatus ? '画面搜索未就绪' : '正在检查画面搜索…' }}</span>
              <a-button v-if="semanticStatus" type="link" size="small" @click="navigate('global-setting')">打开设置</a-button>
            </template>
          </div>
        </div>
        <span v-if="reorderBusy" role="status">正在保存排序…</span>
        <span v-if="reference" role="status">{{ searching ? '正在查找相似图片…' : `${similarityMethod === 'qwen' ? '画面相似' : '近重复图片'} ${images.length} 项 · 按相似度排序` }}</span>
        <span v-else-if="semanticQuery" role="status">{{ semanticLoading ? '正在搜索画面…' : `${semanticSearchedRerank ? 'AI 重排' : '画面搜索'}结果 ${images.length} 项 · 按相关度排序` }}</span>
        <span v-else-if="!semanticMode && path">已显示 {{ images.length }} 项 · {{ includeSubfolders ? '包含子文件夹' : '仅当前文件夹' }}</span>
        <span v-else-if="!semanticMode">共 {{ info?.img_count ?? 0 }} 项 · 已显示 {{ images.length }} 项</span>
        <button v-if="filterSummary" class="active-filter-summary" type="button" :title="filterSummary" @click="openFilterPanel">{{ filterSummary }}</button>
      </div>
      <div class="library-meta-actions">
        <a-button v-if="!path" size="small" type="text" :disabled="reorderBusy || !!reference || !!semanticQuery || g.conf?.is_readonly" @click="restoreDateOrder">恢复时间排序</a-button>
        <a-button size="small" type="text" title="扫描新增文件" :loading="indexScanning" :disabled="busy || g.conf?.is_readonly" @click="scanLibrary(true)">扫描新增</a-button>
        <label class="thumbnail-size-control"><span>缩略图</span><select v-model="thumbnailSizePreset" aria-label="缩略图大小"><option value="custom">自定义</option><option value="small">小</option><option value="medium">中</option><option value="large">大</option></select></label>
        <a-button size="small" class="select-loaded" :disabled="!images.length" :aria-pressed="allLoadedSelected" @click="toggleLoadedSelection">{{ allLoadedSelected ? '取消全选' : '全选已加载' }}</a-button>
      </div>
    </div>
   </Teleport>
   <nav v-if="path" class="folder-breadcrumbs" aria-label="文件夹位置">
    <FolderOutlined />
    <template v-for="(crumb, index) in breadcrumbs" :key="crumb.path">
      <span v-if="index" class="breadcrumb-separator">/</span>
      <button :title="`打开或拖入文件：${crumb.path}`" :aria-current="index === breadcrumbs.length - 1 ? 'location' : undefined" @dragover.prevent @drop.prevent.stop="dropInSubfolder($event, crumb.path)" @click="openFolder(crumb.path)">{{ crumb.name }}</button>
    </template>
    <a-button class="view-directory" size="small" type="text" @click="directoryDialogOpen = true"><FolderOutlined />查看目录</a-button>
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
   <div v-if="reference" class="image-search-filter" role="group" aria-label="当前搜图源图">
     <img v-if="reference.preview" :src="reference.preview" :alt="`源图：${reference.name}`" />
     <span v-else class="source-placeholder" aria-hidden="true"><PictureOutlined /></span>
     <div class="reference-caption"><strong>正在用这张图查找相似图片</strong><span :title="reference.path || reference.name">{{ reference.name }}</span><span v-if="similarityMethod === 'qwen' && semanticStatus?.state === 'ready'">已索引 {{ semanticStatus.indexed_count }} / {{ semanticStatus.image_count }} 张图片</span></div>
     <label class="similarity-method">搜索方式 <select :value="similarityMethod" aria-label="以图搜图方式" @change="chooseSimilarityMethod(($event.target as HTMLSelectElement).value as 'qwen' | 'hash')"><option value="qwen">画面相似</option><option value="hash">近重复图片</option></select></label>
     <div class="source-actions"><a-button v-if="similarityMethod === 'qwen' && semanticStatus?.state === 'ready' && (semanticStatus.indexed_count ?? 0) < (semanticStatus.image_count ?? 0)" size="small" :loading="semanticStatus.running" :disabled="g.conf?.is_readonly" @click="buildSemanticIndex">更新画面索引</a-button><a-button size="small" @click="imageChooser?.click()">更换图片</a-button><a-button size="small" type="text" @click="clearSimilarity">清除搜图</a-button></div>
   </div>
   <aside v-show="filterPanelOpen" id="library-filter-panel" class="library-filter-panel" aria-label="筛选媒体" @keydown.esc.stop="closeFilterPanel">
    <div class="filter-panel-heading"><strong>筛选媒体</strong><a-button type="text" title="关闭筛选" aria-label="关闭筛选" @click="closeFilterPanel"><CloseOutlined /></a-button></div>
    <div class="filter-panel-scroll">
      <section v-if="path" class="folder-scope-options">
        <strong>浏览范围</strong>
        <a-checkbox v-model:checked="draftIncludeSubfolders">包含子文件夹</a-checkbox>
        <p :title="path">{{ path }}</p>
      </section>
      <LibraryFilterFields v-model="filters" :tags="info?.tags ?? []" :disabled="busy || searching" @validity="filtersValid = $event" />
      <section v-if="reference" class="panel-section" aria-label="图片搜索条件">
        <strong>以图搜图</strong>
        <div class="panel-reference"><img v-if="reference.preview" :src="reference.preview" alt="搜图参考图片" /><span :title="reference.name">{{ reference.name }}</span></div>
        <p>{{ similarityMethod === 'qwen' ? '按图像内容取最相近的前 100 张；默认不设最低分。' : '按构图哈希和颜色匹配，适合尺寸或压缩变化的近重复图片。' }}</p>
        <label class="panel-range">最低相似分 <input v-model.number="minimum" aria-label="最低相似分" type="range" min="0" max="100" step="5" /><b>{{ minimum }}</b></label>
        <p v-if="similarResult">已比较 {{ similarResult.checked }} 张 · 最多显示 100 项</p>
        <a-button size="small" @click="imageChooser?.click()">更换图片</a-button>
      </section>
    </div>
    <div class="filter-panel-footer">
      <a-button @click="resetFilterDraft">重置</a-button>
      <a-button type="primary" :disabled="!filtersValid || busy || searching" @click="applyFilters">应用筛选</a-button>
      <a-button class="clear-filter-button" :disabled="busy || searching" @click="clearFilterDraft">清空全部筛选</a-button>
    </div>
   </aside>
   <div v-if="indexScanning || scanError || indexReady || (info?.expired && folders.length)" class="index-notice scan-notice" role="status">
     <span>{{ indexScanning ? '正在后台扫描新增文件，可继续浏览…' : scanError || (indexReady ? '媒体索引已更新，点击刷新查看最新内容。' : '发现文件夹变化，扫描后即可查找新增文件。') }}</span>
     <a-button v-if="!indexScanning" size="small" type="link" :disabled="busy || reorderBusy || g.conf?.is_readonly" @click="indexReady && !scanError ? refreshSearch() : scanLibrary(true)">{{ indexReady && !scanError ? '刷新列表' : '立即扫描' }}</a-button>
   </div>
   <MediaSelectionActions :files="selectedFiles" :current-folder="path" :all-loaded-selected="allLoadedSelected" @select-all="toggleLoadedSelection" @reverse-select="onReverseSelect" @clear="onClearAllSelected" @action="selectionAction" />
      <MasonryScroller
        :ref="(el) => { scroller = el as any }"
        class="file-list"
        v-if="images?.length"
        :items="images"
        :cell-width="cellWidth"
        :column-count="gridItems"
        @scroll="onScroll" @dragover="scrollWhileDragging"
      >
        <template #after>
          <div style="height: 96px;"/>
        </template>
        <template v-slot="{ item: file, index: idx, cardHeight }">
          <div class="media-cell" :class="{ 'drop-before': dropMarker?.path === file.fullpath && !dropMarker.after, 'drop-after': dropMarker?.path === file.fullpath && dropMarker.after }"
            @dragover="overMedia($event, file.fullpath)" @dragleave="dropMarker = undefined" @drop="dropMedia($event, file.fullpath)">
          <file-item-cell
            :idx="idx"
            :file="file"
            :cell-width="cellWidth"
            :display-height="cardHeight"
            @image-dimensions="onCardImageDimensions"
            v-model:show-menu-idx="showMenuIdx"
            @dragstart="startMediaDrag"
            @dragend="endMediaDrag"
            @file-item-click="onFileItemClick"
            @tiktok-view="(_file, idx) => openPreview(idx)"
            :selected="selectedIndexSet.has(idx)"
            :native-drag-paths="selectedIndexSet.has(idx) ? selectedDragPaths : undefined"
            @context-menu-click="onContextMenuClickU"
            :is-selected-mutil-files="multiSelectedIdxs.length > 1"
            :enable-change-indicator="changeIndchecked"
            :seed-change-checked="seedChangeChecked"
            :get-gen-diff="getGenDiff"
            :get-gen-diff-watch-dep="getGenDiffWatchDep"
          />
          <span v-if="reference" class="similarity-score" :style="{bottom: '38px'}">{{ similarityMethod === 'qwen' ? '画面' : '近重复' }} {{ similarityScores.get(file.fullpath) }}</span>
          <span v-else-if="semanticQuery && semanticScores.has(file.fullpath)" class="similarity-score" :style="{bottom: '38px'}" :title="semanticSearchedRerank ? '重排分数 / 向量相似度' : '当前模型的相似度分数'">
            {{ semanticSearchedRerank ? '重排' : '相关' }} {{ semanticScores.get(file.fullpath)?.relevance }}<template v-if="semanticSearchedRerank"> · 向量 {{ semanticScores.get(file.fullpath)?.embedding }}</template>
          </span>
          </div>
        </template>
      </MasonryScroller>

  <a-alert v-if="searchError || semanticError || error" type="error" show-icon :message="searchError || semanticError || error" class="index-notice"><template #action><a-button @click="refreshSearch">重试</a-button></template></a-alert>
  <div v-else-if="(searching || semanticLoading || busy) && !images.length" class="loading-state"><a-spin/><p>{{ reference ? '正在本机比较图片，首次搜图可能需要一点时间…' : semanticQuery ? '正在匹配画面内容…' : '正在读取媒体库…' }}</p></div>
  <div v-else-if="reference && !images.length" class="library-empty"><PictureOutlined /><h2>没有找到相似图片</h2><p>试着降低最低相似分、更换参考图片，或扫描更多图片。</p><a-button @click="clearSimilarity">清除搜图</a-button></div>
  <div v-else-if="semanticQuery && !images.length" class="library-empty"><SearchOutlined /><h2>没有找到相关画面</h2><p>试试换一种描述，或先建立、更新语义索引。</p><a-button @click="clearSemantic(); reload()">清除语义搜索</a-button></div>
  <div v-else-if="!images.length" class="library-empty">
   <div class="empty-illustration" aria-hidden="true"><div class="picture-back"/><div class="picture-front"><PictureOutlined /></div><span class="mini-folder"><FolderOutlined /></span></div>
   <h2>{{ !folders.length ? '从一个文件夹开始' : queryText ? '没有找到匹配的媒体' : path ? '当前范围内还没有已收录的媒体' : '这里还没有媒体文件' }}</h2>
   <p>{{ !folders.length ? '添加图片或视频所在的文件夹，建立你的本地媒体库。' : queryText ? '检查搜索指令、标签名称或文件夹范围，也可以打开语法帮助。' : '扫描已添加的文件夹，将图片和视频收录到媒体库。' }}</p>
   <p v-if="!folders.length" class="empty-note">文件留在原来的位置，无需复制或上传。</p>
   <a-button v-if="!folders.length" type="primary" size="large" :disabled="g.conf?.is_readonly" @click="addToExtraPath('walk')"><PlusOutlined /> 添加第一个文件夹</a-button>
   <a-button v-else-if="!queryText" type="primary" :disabled="g.conf?.is_readonly" @click="scanLibrary(true)"><ReloadOutlined /> 扫描文件夹</a-button>
   <a-button v-else @click="keyword=''; reload()">清除搜索</a-button>
   <div v-if="!folders.length" class="onboarding-steps"><span><b>1</b> 添加文件夹</span><span><b>2</b> 扫描图片与视频</span><span><b>3</b> 浏览、搜索和整理</span></div>
  </div>
  <a-modal v-model:open="directoryDialogOpen" title="查看目录" :footer="null" width="min(960px, calc(100vw - 32px))" :destroy-on-close="true" class="directory-dialog">
   <FolderOverview v-if="directoryDialogOpen" embedded :focus-path="path" @opened="directoryDialogOpen = false" @changed="loadSubfolders(); reload()" />
  </a-modal>
  <a-modal v-model:open="showGenInfo" title="生成信息" :footer="null"><pre class="generation-info">{{ imageGenInfo }}</pre></a-modal>

  </template>
 </div>
</template>
<style scoped lang="scss">
.image-search-filter {display:flex;align-items:center;gap:14px;margin:0 32px 14px;padding:10px 14px;border:1px solid var(--zp-border);border-radius:8px;background:var(--primary-color-1);flex-shrink:0;img,.source-placeholder{width:64px;height:64px;flex-shrink:0;border-radius:5px;background:var(--zp-primary-background);}img{object-fit:contain;}.source-placeholder{display:grid;place-items:center;font-size:24px;color:var(--zp-secondary);}}
.reference-caption {display:flex;flex:1;flex-direction:column;gap:4px;min-width:0;strong{font-size:13px;}span{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--zp-secondary);}}
.source-actions{display:flex;align-items:center;gap:6px;margin-left:auto;flex-shrink:0;}
.similarity-method{display:flex;align-items:center;gap:7px;white-space:nowrap;font-size:12px;color:var(--zp-secondary);}.similarity-method select{padding:5px 8px;border:1px solid var(--zp-border);border-radius:5px;background:var(--zp-primary-background);color:var(--zp-primary);font:inherit;}
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
.header-library-search.semantic-mode{box-shadow:0 0 0 2px var(--primary-color-1),0 0 14px 2px var(--primary-color-2);}
.header-library-search.semantic-mode:focus-within{box-shadow:0 0 0 2px var(--primary-color-2),0 0 18px 3px var(--primary-color-2);}
.header-library-search>input:not([type="file"]){flex:1;width:0;min-width:0;font:inherit;font-size:13px;border:0;outline:0;background:transparent;color:var(--zp-primary);}
.header-library-search>button{width:30px;height:30px;flex-shrink:0;display:grid;place-items:center;background:none;border:0;border-radius:4px;cursor:pointer;font-size:16px;color:var(--zp-secondary);}
.header-library-search>button.semantic-entry[aria-pressed="true"]{background:var(--primary-color-2);color:var(--primary-color);}
.header-library-search>button:hover{background:var(--primary-color-1);color:var(--primary-color);}
.header-library-icon{position:relative;display:inline-grid;place-items:center;width:36px;height:36px;padding:0;flex-shrink:0;font-size:17px;}
.header-refresh .anticon{display:block;transform-origin:center}.header-refresh .spinning{animation:refresh-spin .8s linear infinite}
@keyframes refresh-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.header-refresh .spinning{animation:none}}
.header-library-icon.filter-active{color:var(--primary-color);background:var(--primary-color-1);}
.filter-dot{position:absolute;right:5px;top:5px;width:5px;height:5px;background:var(--primary-color);border-radius:50%;}
.semantic-toolbar{flex-shrink:0;min-width:0;font-size:12px;color:var(--zp-secondary);}
.semantic-toolbar-inner{display:inline-flex;align-items:center;gap:12px;max-width:100%;height:34px;box-sizing:border-box;padding:3px 6px 3px 12px;border:1px solid var(--primary-color-2);border-radius:8px;background:var(--primary-color-1);}
.semantic-rerank{display:inline-flex;align-items:center;gap:8px;white-space:nowrap;color:var(--zp-primary);font-weight:500;}
.semantic-index-count{border-left:1px solid var(--zp-border);padding-left:12px;white-space:nowrap;}
.semantic-index-count strong{color:var(--zp-primary);font-weight:600;}
.semantic-index-error{color:var(--ant-color-error,#d4380d);white-space:nowrap;}
.semantic-toolbar :deep(.ant-btn){height:26px;padding-inline:9px;border-radius:6px;font-size:12px;}
.semantic-toolbar :deep(.ant-switch){flex-shrink:0;}
.compact-meta{display:flex;align-items:center;gap:12px;width:100%;height:34px;min-width:0;padding:0 0 0 36px;box-sizing:border-box;font-size:12px;line-height:1.4;}
.library-meta-summary{display:flex;align-items:center;gap:8px;flex:1;min-width:0;overflow:hidden;}
.library-meta-summary>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.compact-meta .active-filter-summary{max-width:140px;min-width:0;padding:3px 7px;border:1px solid var(--primary-color-2);border-radius:5px;background:var(--primary-color-1);color:var(--primary-color);cursor:pointer;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:11px;}
.library-meta-actions{display:flex;align-items:center;justify-content:flex-end;flex-shrink:0;gap:4px;margin-left:auto;white-space:nowrap;}
.library-meta-actions :deep(.ant-btn){height:28px;flex-shrink:0;padding-inline:7px;border-radius:6px;font-size:12px;}
.library-meta-actions :deep(.ant-btn-primary),.library-meta-actions :deep(.select-loaded){font-weight:500;}
.library-meta-actions :deep(.select-loaded){min-width:88px;}
.thumbnail-size-control{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 5px 0 8px;border:1px solid var(--zp-border);border-radius:6px;background:var(--zp-primary-background);white-space:nowrap;}
.thumbnail-size-control select{height:24px;padding:0 17px 0 2px;border:0;background:transparent;color:var(--zp-primary);font:inherit;cursor:pointer;}
.library-filter-panel{position:absolute;top:8px;right:12px;bottom:12px;width:min(330px,calc(100% - 24px));z-index:45;border:1px solid var(--zp-border);border-radius:10px;background:var(--zp-primary-background);box-shadow:0 8px 32px #0002;display:flex;flex-direction:column;overflow:hidden;}
.filter-panel-heading{height:46px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:0 12px 0 16px;border-bottom:1px solid var(--zp-border);font-size:13px;}
.filter-panel-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:16px;}
.filter-panel-footer{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:12px;border-top:1px solid var(--zp-border);background:var(--zp-primary-background)}
.filter-panel-footer>.ant-btn{min-width:0}.filter-panel-footer .clear-filter-button{grid-column:1/-1;background:var(--zp-secondary-background)}
.panel-section{border-top:1px solid var(--zp-border);margin-top:16px;padding-top:14px;font-size:12px;}.panel-section>strong{display:block;margin-bottom:10px;font-size:12px;}
.panel-range{display:flex;gap:8px;align-items:center;margin:12px 0;}.panel-range input{flex:1;min-width:0;accent-color:var(--primary-color);}
.panel-reference{display:flex;gap:10px;align-items:center;}.panel-reference img{width:40px;height:40px;object-fit:cover;border-radius:5px;}.panel-reference span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.library .file-list{padding-inline:12px;}
@media(max-width:900px){.thumbnail-size-control>span{display:none;}.library-meta-actions{gap:2px;}}
@media(max-width:650px){.optional-tool{display:none;}.header-library-icon{width:32px;height:32px;}.compact-meta{width:max-content;min-width:100%;}.library-meta-summary{flex:none;overflow:visible;}}
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

<style scoped>.folder-breadcrumbs .view-directory{margin-left:auto;flex-shrink:0;color:var(--primary-color);font-size:12px;}.folder-breadcrumbs .new-subfolder{flex-shrink:0;color:var(--primary-color);font-size:12px;}</style>

<style scoped>
.scan-notice{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 12px;background:var(--primary-color-1);border-radius:6px;font-size:12px;}.scan-notice>span{min-width:0;}.scan-notice .ant-btn{flex-shrink:0;}.subfolder-label{color:var(--zp-secondary);font-size:11px;align-self:center;flex-shrink:0;}.subfolder-chip{display:flex;align-items:center;flex-shrink:0;border:1px solid var(--zp-border);border-radius:6px;overflow:hidden;}.subfolder-chip button{display:flex;gap:6px;align-items:center;background:none;border:0;color:var(--zp-primary);font-size:12px;cursor:pointer;padding:6px 8px;}.subfolder-chip button:hover{background:var(--primary-color-1);}.subfolder-chip .delete-subfolder{color:var(--zp-secondary);border-left:1px solid var(--zp-border);}.subfolder-chip .delete-subfolder:hover{color:#ff4d4f;}
</style>
