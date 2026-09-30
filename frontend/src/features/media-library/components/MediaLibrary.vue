<script setup lang="ts">
import { getErrorMessage } from '@/shared/lib/errorMessage'

import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import MasonryScroller from './MasonryScroller.vue'
import SimilarityMethodControl from '@/features/media-library/components/SimilarityMethodControl.vue'
import fileItemCell from '@/features/media-library/components/FileItem.vue'
import MediaSelectionActions from '@/features/media-library/components/MediaSelectionActions.vue'
import type { MenuInfo } from 'ant-design-vue/lib/menu/src/interface'
import {
  FolderOutlined,
  PictureOutlined,
  PlusOutlined,
  SearchOutlined,
  ReloadOutlined,
  PlayCircleOutlined,
  FolderAddOutlined,
  DeleteOutlined,
  FilterOutlined
} from '@ant-design/icons-vue'
import {
  getDbBasicInfo,
  getExpiredDirs,
  indexScanning,
  getImagesBySubstr,
  updateImageData,
  swapMediaOrder,
  resetMediaOrder,
  type MediaLibraryInfo
} from '@/features/media-library/api/library'
import { useApplicationStore } from '@/features/application/public'
import { createImageSearchIter, useImageSearch } from '../model/mediaSearchHook'
import { useKeepMultiSelect } from '@/features/media-library/composables/folderBrowserContext'
import { useGlobalEventListen } from '@/features/application/public'
import { addToExtraPath } from '../model/extraPathControlFunc'
import { navigate, similarityRequest } from '@/features/application/public'
import { useSimilaritySearch } from '../model/useSimilaritySearch'
import { getFileTransferDataFromDragEvent } from '@/features/media-library/model/mediaFiles'
import { cloneDeep } from 'lodash-es'
import { applyMediaOrder, swapMediaInList } from '../model/mediaOrder'
import { message } from 'ant-design-vue'
import { getTargetFolderFiles, type FileNodeInfo } from '@/features/media-library/api/files'
import { findManagedFolder, topLevelManagedFolders } from '../../../shared/lib/folderScope'
import FolderOverview from './FolderOverview.vue'
import { createSubfolder } from '../model/createSubfolder'
import { deleteSubfolder } from '../model/deleteSubfolder'
import MediaFilterPanel from './MediaFilterPanel.vue'
import MediaSearchBox from '@/features/media-library/components/MediaSearchBox.vue'
import {
  getQwenStatus,
  startQwenIndex,
  searchQwen,
  type QwenResult,
  type QwenStatus
} from '@/features/ai-workflows/public'
import { emptySearchFilters, describeSearchFilters } from '../model/searchFilters'
import { MIN_GRID_CELL_WIDTH } from '@/features/application/public'
const props = defineProps<{
  tabIdx: number
  paneIdx: number
  path?: string
  referencePath?: string
  section?: 'all' | 'image' | 'video' | 'audio' | 'folders'
  popAddPathModal?: {
    path: string
    type: import('@/features/media-library/api/library').ExtraPathType
  }
}>()
const g = useApplicationStore()
const folders = computed(() => g.conf?.extra_paths ?? [])
const includeSubfolders = ref(true)
const draftIncludeSubfolders = ref(true)
const subfolders = ref<FileNodeInfo[]>([])
const directoryDialogOpen = ref(false)
const directoryError = ref('')
const folderScope = () =>
  props.path ? { folder_path: props.path, include_subfolders: includeSubfolders.value } : {}
const breadcrumbs = computed(() => {
  const ancestor = findManagedFolder(
    topLevelManagedFolders(folders.value, g.conf?.is_win),
    props.path,
    g.conf?.is_win
  )
  if (!props.path || !ancestor) return []
  const root = ancestor.path.replace(/[\\/]+$/, '')
  const names = props.path.slice(root.length).split(/[/\\]/).filter(Boolean)
  const separator = g.conf?.is_win ? '\\' : '/'
  return [
    { name: ancestor.alias || root.split(/[/\\]/).pop() || root, path: root },
    ...names.map((name, index) => ({
      name,
      path: root + separator + names.slice(0, index + 1).join(separator)
    }))
  ]
})
async function loadSubfolders() {
  if (!props.path) return
  directoryError.value = ''
  try {
    subfolders.value = (await getTargetFolderFiles(props.path, true)).files
  } catch {
    subfolders.value = []
    directoryError.value = '无法读取子文件夹，请检查目录是否存在或刷新重试。'
  }
}
async function dropInSubfolder(event: DragEvent, path: string) {
  const data = getFileTransferDataFromDragEvent(event)
  if (!data || g.conf?.is_readonly) return
  const { confirmFileTransfer } =
    await import('@/features/media-library/composables/useFileTransfer')
  confirmFileTransfer(data, path)
}
const keyword = ref('')
const filters = ref(emptySearchFilters())
const appliedFilters = ref(emptySearchFilters())
const filtersValid = ref(true)
const filterPanelOpen = ref(false)
const filterSummary = computed(() =>
  describeSearchFilters(appliedFilters.value, info.value?.tags ?? [])
)
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
const {
  reference,
  method: similarityMethod,
  chooseMethod: chooseSimilarityMethod,
  minimum,
  loading: searching,
  error: searchError,
  result: similarResult,
  clear: clearSimilarity,
  search: searchSimilar,
  chooseFile,
  choosePath
} = useSimilaritySearch(() => ({ ...cloneDeep(appliedFilters.value), ...folderScope() }))
const similarityScores = computed(
  () => new Map(similarResult.value?.files.map((file) => [file.fullpath, file.similarity]))
)
function displayRelevance(score: number | undefined, fraction = false) {
  if (score === undefined || !Number.isFinite(score)) return '—'
  return Math.round(Math.min(100, Math.max(0, score * (fraction ? 100 : 1))))
}
function searchWithImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) chooseFile(file)
  input.value = ''
}
function pasteSearchImage(event: ClipboardEvent) {
  if (
    event.defaultPrevented ||
    props.section === 'folders' ||
    document.querySelector('.preview-viewer')
  )
    return
  const target = event.target
  if (
    target instanceof Element &&
    target.closest('textarea, select, [contenteditable], [role="textbox"], [role="dialog"]')
  )
    return
  if (
    target instanceof Element &&
    target.closest('input') &&
    !target.closest('.header-library-search')
  )
    return
  const clipboard = event.clipboardData
  const file =
    Array.from(clipboard?.items ?? [])
      .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
      ?.getAsFile() ??
    Array.from(clipboard?.files ?? []).find((item) => item.type.startsWith('image/'))
  if (!file) return
  event.preventDefault()
  chooseFile(file, file.name ? `剪贴板图片 · ${file.name}` : '剪贴板图片')
}
const queryText = ref('')
const busy = ref(false)
let reloadPending = false
const error = ref('')
const info = ref<MediaLibraryInfo>()
const pageSize = ref(100)
const localOrder = ref<string[]>([])
const reorderBusy = ref(false)
const semanticMode = ref(false)
const semanticInput = ref('')
const headerSearchInput = computed({
  get: () => (semanticMode.value ? semanticInput.value : keyword.value),
  set: (value: string) => {
    if (semanticMode.value) semanticInput.value = value
    else keyword.value = value
  }
})
const semanticQuery = ref('')
const semanticResult = ref<QwenResult>()
const semanticRerank = ref(false)
const semanticSearchedRerank = ref(false)
const semanticStatus = ref<QwenStatus>()
const rerankerStatus = ref<QwenStatus>()
const semanticLoading = ref(false)
const semanticError = ref('')
const semanticScores = computed(
  () => new Map((semanticResult.value?.files ?? []).map((file) => [file.fullpath, file.relevance]))
)
let semanticRequest = 0
let semanticStatusTimer: ReturnType<typeof setInterval> | undefined
let semanticStatusInFlight = false
const libraryIter = createImageSearchIter((cursor) =>
  getImagesBySubstr({
    ...appliedFilters.value,
    ...folderScope(),
    cursor,
    surstr: queryText.value,
    regexp: '',
    media_type:
      props.section === 'image' || props.section === 'video' || props.section === 'audio'
        ? props.section
        : 'all',
    size: pageSize.value,
    manual_order: true
  })
)
const iter = reactive({
  get res() {
    return reference.value
      ? (similarResult.value?.files ?? [])
      : semanticQuery.value
        ? (semanticResult.value?.files ?? [])
        : applyMediaOrder(libraryIter.res ?? [], localOrder.value)
  },
  get load() {
    return reference.value || semanticQuery.value ? true : libraryIter.load
  },
  next: () =>
    reference.value || semanticQuery.value || reorderBusy.value
      ? Promise.resolve(false)
      : libraryIter.next()
})
const {
  openPreview,
  images,
  stackViewEl,
  previewIdx,
  gridItems,
  showGenInfo,
  imageGenInfo,
  multiSelectedIdxs,
  onFileItemClick,
  scroller,
  showMenuIdx,
  onFileDragStart,
  onFileDragEnd,
  cellWidth,
  onScroll,
  onContextMenuClickU,
  props: upstream
} = useImageSearch(iter, { fillGridWidth: true, horizontalPadding: 24 })
const thumbnailSizePreset = computed({
  get: () =>
    ['small', 'medium', 'large'].includes(g.thumbnailSizePreset) ? g.thumbnailSizePreset : 'custom',
  set: (value: 'custom' | 'small' | 'medium' | 'large') => {
    g.thumbnailSizePreset = value
  }
})
const thumbnailSizeOptions = [
  { value: 'custom', label: '自定义' },
  { value: 'small', label: '小' },
  { value: 'medium', label: '中' },
  { value: 'large', label: '大' }
] as const
const thumbnailPresetWidths = { small: MIN_GRID_CELL_WIDTH, medium: 240, large: 320 } as const
watch(
  [thumbnailSizePreset, () => g.defaultGridCellWidth],
  ([preset, customWidth]) => {
    cellWidth.value = preset === 'custom' ? customWidth : thumbnailPresetWidths[preset]
  },
  { immediate: true }
)
const { onClearAllSelected, onSelectAll, onReverseSelect } = useKeepMultiSelect()
const selectedFiles = computed(() =>
  multiSelectedIdxs.value.map((idx) => images.value[idx]).filter(Boolean)
)
const selectedIndexSet = computed(() => new Set(multiSelectedIdxs.value))
const selectedDragPaths = computed(() =>
  images.value.filter((_, idx) => selectedIndexSet.value.has(idx)).map((file) => file.fullpath)
)
const allLoadedSelected = computed(
  () => images.value.length > 0 && images.value.every((_, idx) => selectedIndexSet.value.has(idx))
)
function toggleLoadedSelection() {
  if (allLoadedSelected.value) onClearAllSelected()
  else onSelectAll()
}
function onLibraryKeydown(event: KeyboardEvent) {
  if (
    event.defaultPrevented ||
    event.key.toLowerCase() !== 'a' ||
    !(event.ctrlKey || event.metaKey) ||
    event.altKey ||
    event.shiftKey ||
    event.repeat ||
    event.isComposing ||
    !images.value.length
  )
    return
  const target = event.target
  if (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable], [role="textbox"], [role="dialog"]')
  )
    return
  if (document.querySelector('.preview-viewer')) return
  event.preventDefault()
  toggleLoadedSelection()
}
function selectionAction(key: string) {
  const idx = multiSelectedIdxs.value[0]
  if (images.value[idx])
    void onContextMenuClickU({ key } as MenuInfo, images.value[idx], idx).catch((error: unknown) =>
      message.error(getErrorMessage(error, '操作失败，请重试'))
    )
}
const dragPaths = ref<string[]>([])
const sortDragPath = ref('')
const dropTarget = ref('')
function startMediaDrag(event: DragEvent, idx: number) {
  onFileDragStart(event, idx)
  sortDragPath.value = images.value[idx]?.fullpath ?? ''
  dragPaths.value = selectedIndexSet.value.has(idx)
    ? selectedDragPaths.value
    : [images.value[idx].fullpath]
}
function endMediaDrag() {
  dragPaths.value = []
  sortDragPath.value = ''
  dropTarget.value = ''
  onFileDragEnd()
}
function onCardImageDimensions(path: string, width: number, height: number) {
  ;(
    scroller.value as unknown as
      { setDimensions?: (path: string, width: number, height: number) => void } | undefined
  )?.setDimensions?.(path, width, height)
}
function overMedia(event: DragEvent, path: string) {
  if (
    reference.value ||
    semanticQuery.value ||
    busy.value ||
    reorderBusy.value ||
    g.conf?.is_readonly ||
    !sortDragPath.value ||
    sortDragPath.value === path
  )
    return
  event.preventDefault()
  dropTarget.value = path
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}
function leaveMedia(event: DragEvent, path: string) {
  if (dropTarget.value !== path) return
  const card = event.currentTarget as HTMLElement
  if (event.relatedTarget instanceof Node && card.contains(event.relatedTarget)) return
  const bounds = card.getBoundingClientRect()
  if (
    event.clientX >= bounds.left &&
    event.clientX <= bounds.right &&
    event.clientY >= bounds.top &&
    event.clientY <= bounds.bottom
  )
    return
  dropTarget.value = ''
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
  const selected = new Set(selectedFiles.value.map((file) => file.fullpath))
  const scrollTop = scroller.value?.$el.scrollTop ?? 0
  pageSize.value = Math.max(100, images.value.length)
  try {
    await libraryIter.reset({ refetch: true })
    localOrder.value = []
    await nextTick()
    multiSelectedIdxs.value = images.value.flatMap((file, idx) =>
      selected.has(file.fullpath) ? [idx] : []
    )
    if (scroller.value) scroller.value.$el.scrollTop = scrollTop
    onScroll()
  } finally {
    pageSize.value = 100
  }
}
function setLocalOrder(paths: string[]) {
  const previewPath = images.value[previewIdx.value]?.fullpath
  localOrder.value = paths
  if (previewPath)
    previewIdx.value = images.value.findIndex((file) => file.fullpath === previewPath)
}
async function dropMedia(event: DragEvent, path: string) {
  const source = sortDragPath.value
  if (
    !source ||
    source === path ||
    dropTarget.value !== path ||
    reference.value ||
    semanticQuery.value ||
    busy.value ||
    reorderBusy.value ||
    g.conf?.is_readonly
  )
    return
  event.preventDefault()
  event.stopPropagation()
  const before = images.value.map((file) => file.fullpath)
  const after = swapMediaInList(images.value, source, path).map((file) => file.fullpath)
  endMediaDrag()
  if (before.every((value, index) => value === after[index])) return
  reorderBusy.value = true
  // A pending next-page read must not append data from before the move.
  // abort() preserves both the loaded cards and the next-page cursor.
  if (libraryIter.loading) libraryIter.abort()
  setLocalOrder(after)
  try {
    await swapMediaOrder(source, path)
  } catch (e) {
    setLocalOrder(before)
    message.error(getErrorMessage(e, '排序保存失败，已恢复原顺序，请重试'))
  } finally {
    reorderBusy.value = false
    if (reloadPending) {
      reloadPending = false
      void reload()
    } else onScroll()
  }
}
async function restoreDateOrder() {
  reorderBusy.value = true
  try {
    await resetMediaOrder()
    await refreshOrder()
    message.success('已恢复按时间排序')
  } catch {
    message.error('恢复排序失败，请重试')
  } finally {
    reorderBusy.value = false
  }
}
watch(
  () => [props.tabIdx, props.paneIdx],
  () => {
    upstream.value = props
  },
  { immediate: true }
)
let normalScrollIndex = 0
watch(
  () => !!reference.value,
  async (active) => {
    if (active) {
      semanticMode.value = false
      clearSemantic()
      syncSemanticStatusPolling()
    } else if (!semanticMode.value && queryText.value !== keyword.value.trim()) {
      void reload()
    }
    if (active)
      normalScrollIndex = scroller.value?.findItemIndex(scroller.value.getScroll().start) ?? 0
    multiSelectedIdxs.value = []
    previewIdx.value = 0
    await nextTick()
    scroller.value?.scrollToItem(active ? 0 : normalScrollIndex)
    onScroll()
  }
)
watch(similarResult, async () => {
  if (!reference.value) return
  multiSelectedIdxs.value = []
  previewIdx.value = 0
  await nextTick()
  scroller.value?.scrollToItem(0)
  onScroll()
})
watch(semanticResult, async (result) => {
  if (!semanticQuery.value || !result) return
  multiSelectedIdxs.value = []
  previewIdx.value = 0
  await nextTick()
  scroller.value?.scrollToItem(0)
  onScroll()
})
watch(
  similarityRequest,
  (request) => {
    if (!request || request.paneKey !== g.tabList[props.tabIdx]?.panes[props.paneIdx]?.key) return
    choosePath(request.path)
    similarityRequest.value = undefined
  },
  { immediate: true }
)
watch(
  () => props.referencePath,
  (path) => {
    if (path) choosePath(path)
  },
  { immediate: true }
)
function clearSemanticAndReload() {
  clearSemantic()
  reload()
}
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
    const [embedding, reranker] = await Promise.all([
      getQwenStatus('embedding'),
      getQwenStatus('reranker')
    ])
    semanticStatus.value = embedding
    rerankerStatus.value = reranker
  } catch {
    /* The normal API error handler reports a failed request. */
  } finally {
    semanticStatusInFlight = false
  }
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
watch(
  () => semanticStatus.value?.running,
  (running, previous) => {
    if (previous && !running && reference.value && similarityMethod.value === 'qwen')
      void searchSimilar()
  }
)
async function buildSemanticIndex() {
  semanticError.value = ''
  try {
    await startQwenIndex()
    await refreshSemanticStatus()
  } catch (cause) {
    semanticError.value = getErrorMessage(cause, '启动语义索引失败')
  }
}
async function runSemanticSearch() {
  const query = semanticInput.value.trim()
  if (!query) {
    clearSemantic()
    void reload()
    return
  }
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
  } catch (cause) {
    if (request === semanticRequest) semanticError.value = getErrorMessage(cause, '语义搜索失败')
  } finally {
    if (request === semanticRequest) semanticLoading.value = false
  }
}
function submitHeaderSearch() {
  if (semanticMode.value) void runSemanticSearch()
  else {
    clearSemantic()
    clearSimilarity()
    void reload()
  }
}
function applySearchExample(example: string) {
  if (semanticMode.value) semanticInput.value = example
  else keyword.value = example
  submitHeaderSearch()
}
function applyFilters() {
  if (!filtersValid.value) {
    message.warning('请完整填写有效的尺寸或比例')
    return
  }
  appliedFilters.value = cloneDeep(filters.value)
  includeSubfolders.value = draftIncludeSubfolders.value
  filterPanelOpen.value = false
  refreshSearch()
}
function refreshSearch() {
  if (reference.value) void searchSimilar()
  else if (semanticMode.value) {
    if (semanticInput.value.trim()) void runSemanticSearch()
    else {
      clearSemantic()
      void reload()
    }
  } else void reload()
}
async function reload(scan = false) {
  if (props.section === 'folders') return
  if (busy.value || reorderBusy.value) {
    reloadPending = true
    return
  }
  busy.value = true
  error.value = ''
  try {
    if (scan) await updateImageData()
    multiSelectedIdxs.value = []
    queryText.value = semanticMode.value ? '' : keyword.value.trim()
    // The periodic expiry check runs separately; it should not hold up cards.
    const [dbInfo] = await Promise.all([
      getDbBasicInfo(false),
      loadSubfolders(),
      libraryIter.reset({ refetch: true })
    ])
    info.value = dbInfo
    {
      localOrder.value = []
      if (scan && reference.value) await searchSimilar()
      else if (scan && semanticQuery.value) await runSemanticSearch()
      await nextTick()
      scroller.value?.scrollToItem(0)
      onScroll()
    }
  } catch (e) {
    error.value = getErrorMessage(e, '加载失败，请重试')
  } finally {
    busy.value = false
    indexReady.value = false
    if (reloadPending) {
      reloadPending = false
      void reload()
    }
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
  } catch (cause) {
    if (!disposed) scanError.value = getErrorMessage(cause, '扫描失败，请重试')
  }
}
async function checkIndex(force = false) {
  if (
    disposed ||
    document.hidden ||
    checkInProgress ||
    indexScanning.value ||
    !folders.value.length ||
    busy.value ||
    reorderBusy.value
  )
    return
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
  } catch {
    /* Keep the existing list usable during a temporary connection failure. */
  } finally {
    checkInProgress = false
  }
}
const onVisible = () => {
  if (!document.hidden) void checkIndex()
}
onMounted(async () => {
  g.keepMultiSelect = false
  document.addEventListener('visibilitychange', onVisible)
  document.addEventListener('keydown', onLibraryKeydown)
  document.addEventListener('paste', pasteSearchImage)
  scanInterval = setInterval(() => void checkIndex(), 60000)
  await reload()
  if (props.popAddPathModal) addToExtraPath(props.popAddPathModal.type, props.popAddPathModal.path)
  else void checkIndex(true)
})
onUnmounted(() => {
  disposed = true
  clearInterval(scanInterval)
  clearInterval(semanticStatusTimer)
  document.removeEventListener('visibilitychange', onVisible)
  document.removeEventListener('keydown', onLibraryKeydown)
  document.removeEventListener('paste', pasteSearchImage)
})
watch(
  () => g.autoUpdateIndex,
  (enabled) => {
    if (enabled) void checkIndex(true)
  }
)
useGlobalEventListen('updateGlobalSettingDone', () => reload())
useGlobalEventListen('folderRenamed', () => {
  void reload()
  void loadSubfolders()
})
useGlobalEventListen('searchIndexExpired', () => {
  if (info.value) info.value.expired = true
  void checkIndex(true)
})
useGlobalEventListen('imageCreated', () => {
  if (props.section !== 'folders' && !reference.value && !semanticQuery.value) void refreshOrder()
})
function openFolder(path: string) {
  navigate('local', { path, mode: 'scanned-fixed' })
}

function clearKeywordAndReload() {
  keyword.value = ''
  void reload()
}
function reloadFolderContents() {
  void loadSubfolders()
  void reload()
}
</script>
<template>
  <div
    class="library"
    :ref="
      (el) => {
        stackViewEl = el as HTMLDivElement
      }
    "
  >
    <FolderOverview v-if="section === 'folders'" />
    <template v-else>
      <Teleport to="#media-header-search">
        <MediaSearchBox
          v-model="headerSearchInput"
          :semantic-mode="semanticMode"
          :label="path ? '搜索当前文件夹' : '搜索媒体库'"
          :placeholder="reference ? '输入文字可切换搜索' : undefined"
          @submit="submitHeaderSearch"
          @mode-change="toggleSemanticMode"
          @image-file="chooseFile"
          @image-path="choosePath"
          @example="applySearchExample"
        />
        <input
          ref="imageChooser"
          class="image-search-input"
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.avif,.bmp,.gif,.jpe"
          aria-label="搜索框参考图片"
          @change="searchWithImage"
        />
        <a-button
          type="text"
          class="header-library-icon"
          :class="{ 'filter-active': filterSummary || filterPanelOpen }"
          :title="filterSummary || '筛选媒体'"
          aria-label="筛选媒体"
          :aria-expanded="filterPanelOpen"
          aria-controls="library-filter-panel"
          @click="toggleFilterPanel"
          ><FilterOutlined /><i v-if="filterSummary" class="filter-dot"
        /></a-button>
        <a-button
          type="text"
          class="header-library-icon optional-tool"
          title="逐张查看"
          aria-label="逐张查看"
          :disabled="!images.length"
          @click="openPreview(0)"
          ><PlayCircleOutlined
        /></a-button>
        <a-button
          type="text"
          class="header-library-icon header-refresh"
          title="刷新"
          :aria-label="busy || searching ? '正在刷新' : '刷新'"
          :disabled="busy || searching"
          @click="refreshSearch"
          ><ReloadOutlined :class="{ spinning: busy || searching }"
        /></a-button>
      </Teleport>
      <Teleport to="#media-header-secondary">
        <div class="library-meta compact-meta">
          <div class="library-meta-summary">
            <div
              v-if="semanticMode"
              class="semantic-toolbar"
              role="group"
              aria-label="画面搜索选项"
            >
              <div class="semantic-toolbar-inner">
                <template v-if="semanticStatus?.state === 'ready'">
                  <div
                    class="semantic-rerank"
                    :title="
                      rerankerStatus?.state === 'ready'
                        ? '对前 20 张候选图片再次排序'
                        : 'AI 重排暂不可用，请在设置中配置'
                    "
                  >
                    <span>AI 重排</span
                    ><a-switch
                      v-model:checked="semanticRerank"
                      size="small"
                      aria-label="AI 重排"
                      :disabled="rerankerStatus?.state !== 'ready'"
                    />
                  </div>
                  <span class="semantic-index-count" role="status"
                    >已索引
                    <strong
                      >{{ semanticStatus.indexed_count }} / {{ semanticStatus.image_count }}</strong
                    ></span
                  >
                  <a-button
                    class="semantic-update-index"
                    size="small"
                    :loading="semanticStatus.running"
                    :disabled="g.conf?.is_readonly"
                    @click="buildSemanticIndex"
                    >{{ semanticStatus.indexed_count ? '更新索引' : '建立索引' }}</a-button
                  >
                  <span
                    v-if="semanticStatus.error"
                    class="semantic-index-error"
                    :title="semanticStatus.error"
                    >索引失败</span
                  >
                </template>
                <template v-else>
                  <span role="status">{{
                    semanticStatus ? '画面搜索未就绪' : '正在检查画面搜索…'
                  }}</span>
                  <a-button
                    v-if="semanticStatus"
                    type="link"
                    size="small"
                    @click="navigate('global-setting')"
                    >打开设置</a-button
                  >
                </template>
              </div>
            </div>
            <span v-if="reorderBusy" role="status">正在保存排序…</span>
            <span v-if="reference" role="status">{{
              searching
                ? '正在查找相似图片…'
                : `${similarityMethod === 'qwen' ? 'AI 相似图片' : '疑似重复图片'} ${images.length} 项 · 按相关度排序`
            }}</span>
            <span v-else-if="semanticQuery" role="status">{{
              semanticLoading
                ? '正在搜索画面…'
                : `${semanticSearchedRerank ? 'AI 重排' : '画面搜索'}结果 ${images.length} 项 · 按相关度排序`
            }}</span>
            <span v-else-if="!semanticMode && path"
              >已显示 {{ images.length }} 项 ·
              {{ includeSubfolders ? '包含子文件夹' : '仅当前文件夹' }}</span
            >
            <span v-else-if="!semanticMode"
              >共 {{ info?.media_count ?? 0 }} 项 · 已显示 {{ images.length }} 项</span
            >
            <button
              v-if="filterSummary"
              class="active-filter-summary"
              type="button"
              :title="filterSummary"
              @click="openFilterPanel"
            >
              {{ filterSummary }}
            </button>
          </div>
          <div class="library-meta-actions">
            <a-button
              v-if="!path"
              size="small"
              :disabled="reorderBusy || !!reference || !!semanticQuery || g.conf?.is_readonly"
              @click="restoreDateOrder"
              >恢复时间排序</a-button
            >
            <a-button
              size="small"
              title="扫描新增文件"
              :loading="indexScanning"
              :disabled="busy || g.conf?.is_readonly"
              @click="scanLibrary(true)"
              >扫描新增</a-button
            >
            <div class="thumbnail-size-control">
              <span>缩略图</span>
              <div class="thumbnail-size-segments" role="radiogroup" aria-label="缩略图大小">
                <label
                  v-for="option in thumbnailSizeOptions"
                  :key="option.value"
                  class="thumbnail-size-option"
                >
                  <input
                    v-model="thumbnailSizePreset"
                    type="radio"
                    :name="`thumbnail-size-${tabIdx}-${paneIdx}`"
                    :value="option.value"
                  />
                  <span>{{ option.label }}</span>
                </label>
              </div>
            </div>
            <a-button
              size="small"
              class="select-loaded"
              :disabled="!images.length"
              :aria-pressed="allLoadedSelected"
              @click="toggleLoadedSelection"
              >{{ allLoadedSelected ? '取消全选' : '全选已加载' }}</a-button
            >
          </div>
        </div>
      </Teleport>
      <nav v-if="path" class="folder-breadcrumbs" aria-label="文件夹位置">
        <FolderOutlined />
        <template v-for="(crumb, index) in breadcrumbs" :key="crumb.path">
          <span v-if="index" class="breadcrumb-separator">/</span>
          <button
            :title="`打开或拖入文件：${crumb.path}`"
            :aria-current="index === breadcrumbs.length - 1 ? 'location' : undefined"
            @dragover.prevent
            @drop.prevent.stop="dropInSubfolder($event, crumb.path)"
            @click="openFolder(crumb.path)"
          >
            {{ crumb.name }}
          </button>
        </template>
        <a-button
          class="view-directory"
          size="small"
          type="text"
          @click="directoryDialogOpen = true"
          ><FolderOutlined />查看目录</a-button
        >
        <a-button
          class="new-subfolder"
          size="small"
          type="text"
          :disabled="g.conf?.is_readonly"
          @click="
            path &&
            createSubfolder(path, async () => {
              await loadSubfolders()
            })
          "
          ><FolderAddOutlined />新建子文件夹</a-button
        >
      </nav>
      <div v-if="subfolders.length" class="subfolder-strip" aria-label="子文件夹">
        <span class="subfolder-label">下级文件夹</span>
        <div
          v-for="folder in subfolders"
          :key="folder.fullpath"
          class="subfolder-chip"
          @dragover.prevent
          @drop.prevent.stop="dropInSubfolder($event, folder.fullpath)"
        >
          <button :title="folder.fullpath" @click="openFolder(folder.fullpath)">
            <FolderOutlined /><span>{{ folder.name }}</span>
          </button>
          <button
            class="delete-subfolder"
            :disabled="g.conf?.is_readonly"
            :aria-label="`删除子文件夹：${folder.name}`"
            title="删除空文件夹"
            @click="deleteSubfolder(folder.fullpath, loadSubfolders)"
          >
            <DeleteOutlined />
          </button>
        </div>
      </div>
      <a-alert
        v-if="directoryError"
        type="warning"
        :message="directoryError"
        class="index-notice"
      />
      <div v-if="reference" class="image-search-filter" role="group" aria-label="当前搜图源图">
        <img v-if="reference.preview" :src="reference.preview" :alt="`源图：${reference.name}`" />
        <span v-else class="source-placeholder" aria-hidden="true"><PictureOutlined /></span>
        <div class="reference-caption">
          <strong>正在用这张图查找相似图片</strong
          ><span :title="reference.path || reference.name">{{ reference.name }}</span
          ><span v-if="similarityMethod === 'qwen' && semanticStatus?.state === 'ready'"
            >已索引 {{ semanticStatus.indexed_count }} /
            {{ semanticStatus.image_count }} 张图片</span
          >
        </div>
        <SimilarityMethodControl
          :model-value="similarityMethod"
          @update:model-value="chooseSimilarityMethod"
        />
        <div class="source-actions">
          <a-button
            v-if="
              similarityMethod === 'qwen' &&
              semanticStatus?.state === 'ready' &&
              (semanticStatus.indexed_count ?? 0) < (semanticStatus.image_count ?? 0)
            "
            size="small"
            :loading="semanticStatus.running"
            :disabled="g.conf?.is_readonly"
            @click="buildSemanticIndex"
            >更新画面索引</a-button
          ><a-button size="small" @click="imageChooser?.click()">更换图片</a-button
          ><a-button size="small" @click="clearSimilarity">清除搜图</a-button>
        </div>
      </div>
      <MediaFilterPanel
        id="library-filter-panel"
        v-model="filters"
        :open="filterPanelOpen"
        :tags="info?.tags ?? []"
        :disabled="busy || searching"
        @validity="filtersValid = $event"
        @close="closeFilterPanel"
        @reset="resetFilterDraft"
        @clear="clearFilterDraft"
        @apply="applyFilters"
      >
        <template #before>
          <section v-if="path" class="folder-scope-options">
            <strong>浏览范围</strong>
            <a-checkbox v-model:checked="draftIncludeSubfolders">包含子文件夹</a-checkbox>
            <p :title="path">{{ path }}</p>
          </section>
        </template>
        <section v-if="reference" class="panel-section" aria-label="图片搜索条件">
          <strong>以图搜图</strong>
          <div class="panel-reference">
            <img v-if="reference.preview" :src="reference.preview" alt="搜图参考图片" /><span
              :title="reference.name"
              >{{ reference.name }}</span
            >
          </div>
          <p>
            {{
              similarityMethod === 'qwen'
                ? '按图像内容取最相近的前 100 张；默认不设最低分。'
                : '按构图哈希和颜色匹配，适合尺寸或压缩变化的近重复图片。'
            }}
          </p>
          <label class="panel-range"
            >最低相关度
            <input
              v-model.number="minimum"
              aria-label="最低相关度"
              type="range"
              min="0"
              max="100"
              step="5"
            /><b>{{ minimum }}</b></label
          >
          <p v-if="similarResult">已比较 {{ similarResult.checked }} 张 · 最多显示 100 项</p>
          <a-button size="small" @click="imageChooser?.click()">更换图片</a-button>
        </section>
      </MediaFilterPanel>
      <div
        v-if="indexScanning || scanError || indexReady || (info?.expired && folders.length)"
        class="index-notice scan-notice"
        role="status"
      >
        <span>{{
          indexScanning
            ? '正在后台扫描新增文件，可继续浏览…'
            : scanError ||
              (indexReady
                ? '媒体索引已更新，点击刷新查看最新内容。'
                : '发现文件夹变化，扫描后即可查找新增文件。')
        }}</span>
        <a-button
          v-if="!indexScanning"
          size="small"
          type="link"
          :disabled="busy || reorderBusy || g.conf?.is_readonly"
          @click="indexReady && !scanError ? refreshSearch() : scanLibrary(true)"
          >{{ indexReady && !scanError ? '刷新列表' : '立即扫描' }}</a-button
        >
      </div>
      <MediaSelectionActions
        :files="selectedFiles"
        :current-folder="path"
        :all-loaded-selected="allLoadedSelected"
        @select-all="toggleLoadedSelection"
        @reverse-select="onReverseSelect"
        @clear="onClearAllSelected"
        @action="selectionAction"
      />
      <MasonryScroller
        ref="scroller"
        class="file-list"
        v-if="images?.length"
        :items="images"
        :cell-width="cellWidth"
        :column-count="gridItems"
        @scroll="onScroll"
        @dragover="scrollWhileDragging"
      >
        <template #after>
          <div style="height: 96px" />
        </template>
        <template v-slot="{ item: file, index: idx, cardHeight }">
          <div
            class="media-cell"
            :class="{ 'swap-target': dropTarget === file.fullpath }"
            @dragover="overMedia($event, file.fullpath)"
            @dragleave="leaveMedia($event, file.fullpath)"
            @drop="dropMedia($event, file.fullpath)"
          >
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
              :selected="selectedIndexSet.has(idx)"
              :native-drag-paths="selectedIndexSet.has(idx) ? selectedDragPaths : undefined"
              @context-menu-click="onContextMenuClickU"
              :is-selected-mutil-files="multiSelectedIdxs.length > 1"
            />
            <span v-if="reference && similarityScores.has(file.fullpath)" class="similarity-score"
              >相关度 {{ displayRelevance(similarityScores.get(file.fullpath)) }}</span
            >
            <span
              v-else-if="semanticQuery && semanticScores.has(file.fullpath)"
              class="similarity-score"
              :title="semanticSearchedRerank ? 'AI 重排相关度' : '画面搜索相关度'"
            >
              相关度 {{ displayRelevance(semanticScores.get(file.fullpath), true) }}
            </span>
          </div>
        </template>
      </MasonryScroller>

      <a-alert
        v-if="searchError || semanticError || error"
        type="error"
        show-icon
        :message="searchError || semanticError || error"
        class="index-notice"
        ><template #action><a-button @click="refreshSearch">重试</a-button></template></a-alert
      >
      <div
        v-else-if="(searching || semanticLoading || busy) && !images.length"
        class="loading-state"
      >
        <a-spin />
        <p>
          {{
            reference
              ? '正在本机比较图片，首次搜图可能需要一点时间…'
              : semanticQuery
                ? '正在匹配画面内容…'
                : '正在读取媒体库…'
          }}
        </p>
      </div>
      <div v-else-if="reference && !images.length" class="library-empty">
        <PictureOutlined />
        <h2>没有找到相似图片</h2>
        <p>试着降低最低相似分、更换参考图片，或扫描更多图片。</p>
        <a-button @click="clearSimilarity">清除搜图</a-button>
      </div>
      <div v-else-if="semanticQuery && !images.length" class="library-empty">
        <SearchOutlined />
        <h2>没有找到相关画面</h2>
        <p>试试换一种描述，或先建立、更新语义索引。</p>
        <a-button @click="clearSemanticAndReload">清除语义搜索</a-button>
      </div>
      <div v-else-if="!images.length" class="library-empty">
        <div class="empty-illustration" aria-hidden="true">
          <div class="picture-back" />
          <div class="picture-front"><PictureOutlined /></div>
          <span class="mini-folder"><FolderOutlined /></span>
        </div>
        <h2>
          {{
            !folders.length
              ? '从一个文件夹开始'
              : queryText
                ? '没有找到匹配的媒体'
                : path
                  ? '当前范围内还没有已收录的媒体'
                  : '这里还没有媒体文件'
          }}
        </h2>
        <p>
          {{
            !folders.length
              ? '添加图片或视频所在的文件夹，建立你的本地媒体库。'
              : queryText
                ? '检查搜索指令、标签名称或文件夹范围，也可以打开语法帮助。'
                : '扫描已添加的文件夹，将图片和视频收录到媒体库。'
          }}
        </p>
        <p v-if="!folders.length" class="empty-note">文件留在原来的位置，无需复制或上传。</p>
        <a-button
          v-if="!folders.length"
          type="primary"
          size="large"
          :disabled="g.conf?.is_readonly"
          @click="addToExtraPath('walk')"
          ><PlusOutlined /> 添加第一个文件夹</a-button
        >
        <a-button
          v-else-if="!queryText"
          type="primary"
          :disabled="g.conf?.is_readonly"
          @click="scanLibrary(true)"
          ><ReloadOutlined /> 扫描文件夹</a-button
        >
        <a-button v-else @click="clearKeywordAndReload">清除搜索</a-button>
        <div v-if="!folders.length" class="onboarding-steps">
          <span><b>1</b> 添加文件夹</span><span><b>2</b> 扫描图片与视频</span
          ><span><b>3</b> 浏览、搜索和整理</span>
        </div>
      </div>
      <a-modal
        v-model:open="directoryDialogOpen"
        title="查看目录"
        :footer="null"
        width="min(960px, calc(100vw - 32px))"
        :destroy-on-close="true"
        class="directory-dialog"
      >
        <FolderOverview
          v-if="directoryDialogOpen"
          embedded
          :focus-path="path"
          @opened="directoryDialogOpen = false"
          @changed="reloadFolderContents"
        />
      </a-modal>
      <a-modal v-model:open="showGenInfo" title="生成信息" :footer="null">
        <pre class="generation-info">{{ imageGenInfo }}</pre>
      </a-modal>
    </template>
  </div>
</template>
<style scoped lang="scss">
.image-search-filter {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 0 32px 14px;
  padding: 10px 14px;
  border: 1px solid var(--zp-border);
  border-radius: 8px;
  background: var(--primary-color-1);
  flex-shrink: 0;
  img,
  .source-placeholder {
    width: 64px;
    height: 64px;
    flex-shrink: 0;
    border-radius: 5px;
    background: var(--zp-primary-background);
  }
  img {
    object-fit: contain;
  }
  .source-placeholder {
    display: grid;
    place-items: center;
    font-size: 24px;
    color: var(--zp-secondary);
  }
}
.reference-caption {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  strong {
    font-size: 13px;
  }
  span {
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--zp-secondary);
  }
}
.source-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  flex-shrink: 0;
  font-family: var(--ui-font);
  font-size: 12px;
  font-weight: 400;
  line-height: 18px;
  color: var(--ui-text);
}
.similarity-threshold {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
  font-size: 12px;
  input {
    width: 110px;
    accent-color: var(--primary-color);
  }
  b {
    width: 24px;
  }
}
.media-cell {
  position: relative;
  width: 100%;
  height: 100%;
}
/* The masonry position already includes its own 8px edge gutter. FileItem's
   generic margin would shift the card away from the swap target overlay. */
.media-cell :deep(.file.grid) {
  display: block;
  margin: 0;
}
.similarity-score {
  position: absolute;
  top: 9px;
  left: 36px;
  pointer-events: none;
  z-index: 102;
  box-sizing: border-box;
  max-width: calc(100% - 76px);
  height: 20px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: 5px;
  padding: 2px 6px;
  background: var(--primary-color);
  color: var(--ui-on-accent);
  font-size: 11px;
  line-height: 16px;
}
.library {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: transparent;
}
.selection-actions {
  display: flex;
  gap: 16px;
  align-items: center;
  padding: 8px 32px;
  color: var(--primary-color);
  font-size: 13px;
}
.image-search-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  overflow: hidden;
  pointer-events: none;
}
.library-search .image-search-button {
  white-space: nowrap;
  border-left: 1px solid var(--zp-border);
  padding-left: 10px;
}
.library-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 20px 32px 14px;
  flex-shrink: 0;
}
.grow {
  flex: 1;
}
.result-count {
  color: var(--zp-secondary);
  font-size: 13px;
}
.library-search {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 440px;
  flex: 1;
  background: var(--zp-secondary-background);
  border: 1px solid var(--zp-border);
  border-radius: 6px;
  padding: 7px 12px;
  color: var(--zp-secondary);
  input {
    min-width: 0;
    flex: 1;
    background: transparent;
    border: 0;
    outline: 0;
    color: var(--zp-primary);
    font: inherit;
  }
  button {
    background: none;
    border: 0;
    color: var(--primary-color);
    cursor: pointer;
    font: inherit;
  }
  &:focus-within {
    border-color: var(--primary-color);
  }
}
.library-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 32px 14px;
  font-size: 12px;
  color: var(--zp-secondary);
  flex-shrink: 0;
}
.size-control {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-left: auto;
  input {
    width: 100px;
    accent-color: var(--primary-color);
  }
}
.index-notice {
  margin: 0 32px 12px;
}
.file-list {
  flex: 1;
  min-height: 0;
  padding: 0 24px;
  overflow: auto;
}
.loading-state {
  text-align: center;
  padding: 80px;
}
.library-empty {
  flex: 1;
  min-height: 400px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 24px 70px;
  text-align: center;
  background: radial-gradient(ellipse at 50% 40%, var(--primary-color-1), transparent 60%);
  h2 {
    font-size: 24px;
    font-weight: 600;
    margin: 24px 0 12px;
  }
  p {
    font-size: 14px;
    color: var(--zp-secondary);
    margin: 0 0 10px;
  }
  .empty-note {
    font-size: 12px;
    margin-bottom: 24px;
  }
}
.empty-illustration {
  height: 120px;
  width: 160px;
  position: relative;
}
.picture-back {
  position: absolute;
  width: 120px;
  height: 88px;
  left: 2px;
  top: 10px;
  border-radius: 10px;
  background: var(--ui-accent-soft);
  transform: rotate(-12deg);
  border: 1px solid var(--ui-border);
}
.picture-front {
  position: absolute;
  left: 22px;
  top: 22px;
  width: 120px;
  height: 88px;
  border: 5px solid var(--ui-surface);
  border-radius: 10px;
  background: var(--ui-surface-soft);
  color: var(--primary-color);
  display: grid;
  place-items: center;
  font-size: 52px;
  box-shadow: var(--ui-shadow-card);
}
.mini-folder {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 42px;
  height: 42px;
  border-radius: 10px;
  background: var(--primary-color);
  color: var(--ui-on-accent);
  display: grid;
  place-items: center;
  font-size: 24px;
  box-shadow: var(--ui-shadow-card);
}
.onboarding-steps {
  display: flex;
  gap: 28px;
  margin-top: 48px;
  color: var(--zp-secondary);
  font-size: 12px;
  b {
    display: inline-grid;
    place-items: center;
    width: 21px;
    height: 21px;
    border: 1px solid var(--zp-border);
    border-radius: 50%;
    margin-right: 8px;
    font-weight: 500;
  }
}
.folder-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 20px;
  padding: 8px 32px 32px;
  overflow: auto;
}
.folder-card {
  border: 1px solid var(--zp-border);
  border-radius: 9px;
  overflow: hidden;
}
.folder-open {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  padding: 24px;
  width: 100%;
  border: 0;
  background: var(--zp-secondary-background);
  cursor: pointer;
  text-align: left;
  color: var(--zp-primary);
  strong {
    font-size: 15px;
  }
  small {
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--zp-secondary);
  }
}
.folder-art {
  color: var(--primary-color);
  font-size: 42px;
}
.folder-actions {
  display: flex;
  justify-content: space-between;
  padding: 8px;
}
.generation-info {
  white-space: pre-wrap;
  max-height: 60vh;
  overflow: auto;
}
@media (max-width: 760px) {
  .image-search-filter {
    margin: 0 14px 14px;
    gap: 10px;
    flex-wrap: wrap;
  }
  .similarity-threshold {
    margin-left: 0;
  }
  .library-toolbar {
    padding: 14px;
    flex-wrap: wrap;
  }
  .library-search {
    flex-basis: 100%;
  }
  .library-meta {
    padding: 0 14px 12px;
    flex-wrap: wrap;
  }
  .onboarding-steps {
    gap: 12px;
    flex-wrap: wrap;
    justify-content: center;
  }
  .folder-grid {
    padding: 14px;
  }
  .library-empty h2 {
    font-size: 21px;
  }
}

.library {
  overflow: auto;
  min-width: 0;
}
.library-toolbar {
  flex-wrap: wrap;
  gap: 10px;
}
.library-toolbar > .grow {
  display: none;
}
.library-search {
  flex: 1 1 340px;
  max-width: none;
  min-width: 0;
  min-height: 36px;
}
.library-search > button {
  flex-shrink: 0;
  white-space: nowrap;
}
.library-toolbar > .ant-btn {
  flex-shrink: 0;
}
.library-meta {
  flex-wrap: wrap;
  gap: 10px 16px;
  line-height: 1.6;
}
.library-meta > .size-control {
  flex-shrink: 0;
}
.image-search-filter {
  flex-wrap: wrap;
  gap: 12px;
}
.reference-caption {
  flex: 1 1 140px;
}
.similarity-threshold {
  flex-wrap: wrap;
}
.image-search-filter > img {
  flex-shrink: 0;
}
.library-empty {
  min-height: 260px;
  flex-shrink: 0;
  padding: 32px 24px;
}
.library-empty h2 {
  line-height: 1.4;
}
.library-empty p {
  line-height: 1.7;
}
.selection-actions {
  flex-wrap: wrap;
}
.folder-grid {
  grid-template-columns: repeat(auto-fill, minmax(min(240px, 100%), 1fr));
}
.folder-card {
  min-width: 0;
}
.folder-actions {
  flex-wrap: wrap;
  gap: 6px;
}
.folder-open strong {
  overflow-wrap: anywhere;
}
.onboarding-steps {
  flex-wrap: wrap;
  justify-content: center;
  line-height: 1.6;
}
.library .file-list {
  min-height: 140px;
}
@container (max-width:650px) {
  .library-toolbar {
    padding: 16px;
  }
  .library-search {
    flex-basis: 100%;
  }
  .library-meta {
    padding: 0 16px 14px;
  }
  .image-search-filter {
    margin-inline: 16px;
  }
  .size-control {
    margin-left: 0;
  }
  .library .file-list {
    padding-inline: 8px;
  }
  .onboarding-steps {
    margin-top: 24px;
  }
  .index-notice {
    margin-inline: 16px;
  }
  .loading-state {
    padding: 48px 16px;
  }
}
</style>
<style scoped>
.library-filters {
  margin: 0 24px 8px;
  flex-shrink: 0;
}
@media (max-width: 550px) {
  .library-filters {
    margin-inline: 16px;
  }
}
</style>

<style scoped>
.header-library-icon {
  position: relative;
  display: inline-grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 0;
  flex-shrink: 0;
  font-size: 17px;
}
.header-refresh .anticon {
  display: block;
  transform-origin: center;
}
.header-refresh .spinning {
  animation: refresh-spin 0.8s linear infinite;
}
@keyframes refresh-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .header-refresh .spinning {
    animation: none;
  }
}
.header-library-icon.filter-active {
  color: var(--primary-color);
  background: var(--primary-color-1);
}
.filter-dot {
  position: absolute;
  right: 5px;
  top: 5px;
  width: 5px;
  height: 5px;
  background: var(--primary-color);
  border-radius: 50%;
}
.semantic-toolbar {
  flex-shrink: 0;
  min-width: 0;
  font-size: 12px;
  color: var(--zp-secondary);
}
.semantic-toolbar-inner {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  max-width: 100%;
  height: 34px;
  box-sizing: border-box;
  padding: 3px 6px 3px 12px;
  border: 1px solid var(--primary-color-2);
  border-radius: 8px;
  background: var(--primary-color-1);
}
.semantic-rerank {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  color: var(--zp-primary);
  font-weight: 500;
}
.semantic-index-count {
  border-left: 1px solid var(--zp-border);
  padding-left: 12px;
  white-space: nowrap;
}
.semantic-index-count strong {
  color: var(--zp-primary);
  font-weight: 600;
}
.semantic-index-error {
  color: var(--ant-color-error, #d4380d);
  white-space: nowrap;
}
.semantic-toolbar :deep(.ant-btn) {
  height: 26px;
  padding-inline: 9px;
  border-radius: 6px;
  font-size: 12px;
}
.semantic-toolbar :deep(.ant-switch) {
  flex-shrink: 0;
}
.library-meta.compact-meta {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 12px;
  width: 100%;
  height: 34px;
  min-width: 0;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  font-family: var(--ui-font);
  font-size: 12px;
  font-weight: 400;
  line-height: 18px;
}
.library-meta-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.library-meta-summary > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.compact-meta .active-filter-summary {
  max-width: 140px;
  min-width: 0;
  padding: 3px 7px;
  border: 1px solid var(--primary-color-2);
  border-radius: 5px;
  background: var(--primary-color-1);
  color: var(--primary-color);
  cursor: pointer;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 11px;
}
.library-meta-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-shrink: 0;
  gap: 6px;
  margin-left: auto;
  white-space: nowrap;
  color: var(--ui-text);
}
:is(.library-meta-actions, .source-actions) :deep(.ant-btn) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  flex-shrink: 0;
  padding-inline: 9px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  font: inherit;
  box-shadow: none;
}
:is(.library-meta-actions, .source-actions) :deep(.ant-btn:not(:disabled)) {
  color: inherit;
  background: var(--ui-surface-soft);
}
:is(.library-meta-actions, .source-actions) :deep(.ant-btn:not(:disabled):hover) {
  color: var(--primary-color);
  border-color: var(--primary-color);
  background: var(--ui-hover);
  box-shadow: none;
}
.library-meta-actions :deep(.select-loaded[aria-pressed='true']) {
  color: var(--primary-color);
  border-color: var(--primary-color);
  background: var(--primary-color-1);
}
.thumbnail-size-control {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  margin: 0 2px;
  white-space: nowrap;
}
.thumbnail-size-control > span {
  color: var(--ui-muted);
}
.thumbnail-size-segments {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 30px;
  padding: 2px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface-soft);
}
.thumbnail-size-option {
  position: relative;
  cursor: pointer;
}
.thumbnail-size-option input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.thumbnail-size-option span {
  display: block;
  min-width: 28px;
  padding: 3px 8px;
  border-radius: 5px;
  text-align: center;
  font: inherit;
  color: var(--ui-text);
  transition:
    background-color var(--ui-motion-fast) var(--ui-ease),
    color var(--ui-motion-fast) var(--ui-ease),
    box-shadow var(--ui-motion-fast) var(--ui-ease);
}
.thumbnail-size-option:hover span {
  color: var(--ui-text);
  background: var(--ui-hover);
}
.thumbnail-size-option input:checked + span {
  color: var(--primary-color);
  background: var(--ui-surface);
  box-shadow: 0 1px 3px #15283a1f;
  font-weight: 500;
}
.thumbnail-size-option input:focus-visible + span {
  outline: 2px solid var(--primary-color);
  outline-offset: 1px;
}
.panel-section {
  border-top: 1px solid var(--zp-border);
  margin-top: 16px;
  padding-top: 14px;
  font-size: 12px;
}
.panel-section > strong {
  display: block;
  margin-bottom: 10px;
  font-size: 12px;
}
.panel-range {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 12px 0;
}
.panel-range input {
  flex: 1;
  min-width: 0;
  accent-color: var(--primary-color);
}
.panel-reference {
  display: flex;
  gap: 10px;
  align-items: center;
}
.panel-reference img {
  width: 40px;
  height: 40px;
  object-fit: cover;
  border-radius: 5px;
}
.panel-reference span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.library .file-list {
  padding-inline: 12px;
}
@media (max-width: 900px) {
  .thumbnail-size-control > span {
    display: none;
  }
  .library-meta-actions {
    gap: 2px;
  }
}
@media (max-width: 650px) {
  .optional-tool {
    display: none;
  }
  .header-library-icon {
    width: 32px;
    height: 32px;
  }
  .library-meta.compact-meta {
    width: max-content;
    min-width: 100%;
  }
  .library-meta-summary {
    flex: none;
    overflow: visible;
  }
}
</style>

<style scoped>
.media-cell.swap-target::before {
  content: '';
  position: absolute;
  inset: 0;
  border: 3px solid var(--primary-color);
  border-radius: var(--ui-radius);
  background: var(--primary-color-1);
  z-index: 110;
  pointer-events: none;
}
.media-cell.swap-target::after {
  content: '交换位置';
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  padding: 5px 10px;
  border-radius: 5px;
  background: var(--primary-color);
  color: var(--ui-on-accent);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  box-shadow: 0 2px 8px #0004;
  z-index: 111;
  pointer-events: none;
}
</style>

<style scoped>
.library .file-list {
  overflow-anchor: none;
}
</style>

<style scoped>
.folder-breadcrumbs {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px 4px;
  font-size: 13px;
  min-height: 36px;
  flex-shrink: 0;
  overflow-x: auto;
  white-space: nowrap;
}
.folder-breadcrumbs > button {
  padding: 2px 4px;
  background: none;
  border: 0;
  color: var(--zp-secondary);
  font: inherit;
  cursor: pointer;
}
.folder-breadcrumbs > button[aria-current] {
  color: var(--zp-primary);
  font-weight: 600;
}
.breadcrumb-separator {
  color: var(--zp-secondary);
}
.subfolder-strip {
  display: flex;
  gap: 8px;
  padding: 8px 20px 4px;
  overflow-x: auto;
  flex-shrink: 0;
}
.subfolder-strip > button {
  display: flex;
  align-items: center;
  gap: 7px;
  max-width: 220px;
  flex-shrink: 0;
  border: 1px solid var(--zp-border);
  border-radius: 6px;
  background: var(--zp-primary-background);
  color: var(--zp-primary);
  font-size: 12px;
  padding: 6px 10px;
  cursor: pointer;
}
.subfolder-strip > button:hover {
  background: var(--primary-color-1);
  border-color: var(--primary-color);
}
.subfolder-strip > button > span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.subfolder-strip .anticon,
.folder-breadcrumbs > .anticon {
  color: var(--primary-color);
}
.folder-scope-options {
  padding-bottom: 12px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--zp-border);
  font-size: 12px;
}
.folder-scope-options > strong {
  display: block;
  margin-bottom: 10px;
}
.folder-scope-options > p {
  color: var(--zp-secondary);
  overflow-wrap: anywhere;
  margin: 8px 0 0;
  font-size: 11px;
}
.folder-entry-note {
  font-size: 12px;
  color: var(--zp-secondary);
  padding: 4px 8px;
}
.folder-actions {
  align-items: center;
}
</style>

<style scoped>
.folder-breadcrumbs .view-directory {
  margin-left: auto;
  flex-shrink: 0;
  color: var(--primary-color);
  font-size: 12px;
}
.folder-breadcrumbs .new-subfolder {
  flex-shrink: 0;
  color: var(--primary-color);
  font-size: 12px;
}
</style>

<style scoped>
.scan-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 12px;
  border: 1px solid #e8ce73;
  border-radius: 6px;
  background: #fff1bd;
  color: #5b460e;
  font-size: 12px;
}
.scan-notice > span {
  min-width: 0;
}
.scan-notice :deep(.ant-btn) {
  flex-shrink: 0;
  color: #72530b;
}
.scan-notice :deep(.ant-btn):hover {
  color: #4e3905;
}
:global(body.dark .scan-notice) {
  border-color: #8a6d26;
  background: #514116;
  color: #ffe9a6;
}
:global(body.dark .scan-notice .ant-btn) {
  color: #ffd56e;
}
:global(body.dark .scan-notice .ant-btn:hover) {
  color: #ffebad;
}
.subfolder-label {
  color: var(--zp-secondary);
  font-size: 11px;
  align-self: center;
  flex-shrink: 0;
}
.subfolder-chip {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  border: 1px solid var(--zp-border);
  border-radius: 6px;
  overflow: hidden;
}
.subfolder-chip button {
  display: flex;
  gap: 6px;
  align-items: center;
  background: none;
  border: 0;
  color: var(--zp-primary);
  font-size: 12px;
  cursor: pointer;
  padding: 6px 8px;
}
.subfolder-chip button:hover {
  background: var(--primary-color-1);
}
.subfolder-chip .delete-subfolder {
  color: var(--zp-secondary);
  border-left: 1px solid var(--zp-border);
}
.subfolder-chip .delete-subfolder:hover {
  color: #ff4d4f;
}
.header-library-icon {
  font-size: 15px;
}
.folder-breadcrumbs {
  padding: 14px 20px 6px;
}
.folder-breadcrumbs > button {
  border-radius: var(--ui-radius-sm);
}
.folder-breadcrumbs > button:hover {
  background: var(--ui-hover);
  color: var(--ui-text);
}
.subfolder-strip > button,
.subfolder-chip {
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface-soft);
}
.library-empty {
  background: radial-gradient(ellipse at 50% 40%, var(--primary-color-1), transparent 64%);
}
.library-empty h2 {
  margin-top: 20px;
  font-size: 19px;
}
@container (max-width:580px) {
  .folder-breadcrumbs {
    padding-inline: 12px;
  }
  .subfolder-strip {
    padding-inline: 12px;
  }
}
</style>
