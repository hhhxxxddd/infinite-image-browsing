<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import { message, Modal } from 'ant-design-vue'
import {
  AppstoreOutlined, ArrowLeftOutlined,
  AudioOutlined, PictureOutlined, PlusOutlined, RobotOutlined, VideoCameraOutlined
} from '@ant-design/icons-vue'
import { setAppFeSetting } from '@/api'
import { getDbBasicInfo, getImagesBySubstr, type SearchFilters, type Tag } from '@/api/db'
import { batchGetFilesInfo, type FileNodeInfo } from '@/api/files'
import { getQwenStatus, searchQwen, startQwenIndex, type QwenResult, type QwenStatus } from '@/api/qwen3vl'
import { isAudioFile, isImageFile, isVideoFile, toImageThumbnailUrl, toImageUrl, toStreamAudioUrl, toStreamVideoUrl, toVideoCoverUrl } from '@/util/file'
import { copy2clipboardI18n } from '@/util'
import { openPreviewWithFile } from '@/util/mediaPreview'
import { useGlobalStore } from '@/store/useGlobalStore'
import MediaSearchBox from '@/components/MediaSearchBox.vue'
import MediaQuickLook from '@/components/MediaQuickLook.vue'
import ImageCreationStudio from './ImageCreationStudio.vue'
import { clearStudioWorkspace } from './imageStudioModel'
import LibraryFilterFields from '@/page/SplitViewTab/LibraryFilterFields.vue'
import { emptySearchFilters, describeSearchFilters } from '@/page/SplitViewTab/searchFilters'
import { useSimilaritySearch } from '@/page/SplitViewTab/useSimilaritySearch'
import { navigate } from '@/page/SplitViewTab/navigation'
import {
  addWorkspaceAssets, readWorkspaceRecords,
  type ToolKey, type WorkspaceAsset, type WorkspaceRecord, type WorkspaceStatus
} from './workspaceModel'

type ToolTab = 'overview' | ToolKey
type PickerRole = 'source' | 'output'
const global = useGlobalStore()
const tools = [
  { key: 'image', title: '图片制作', detail: '拼接与多图排版', note: '已接入', icon: PictureOutlined, tone: 'blue', features: ['多图拼接', '画布排版', '图片导出'] },
  { key: 'ai', title: 'AI 创作', detail: '在这里配置生图、视频工作流', note: '规划中', icon: RobotOutlined, tone: 'amber', features: ['工作流与服务配置', '图片生成', '视频生成'] },
  { key: 'media', title: '音视频工具', detail: '截取、提取画面与整理台词', note: '规划中', icon: VideoCameraOutlined, tone: 'mint', features: ['视频片段截取', '提取画面', '音频与台词整理'] }
] as const
const activeTool = ref<ToolTab>('overview')
const selectedTool = computed(() => tools.find(tool => tool.key === activeTool.value))
const records = ref<WorkspaceRecord[]>([])
const currentWorkspaceId = useLocalStorage('iib-workbench-current-workspace', '')
const currentWorkspace = computed(() => records.value.find(item => item.id === currentWorkspaceId.value))
const activeCount = computed(() => records.value.filter(item => item.status === 'active').length)
const pausedCount = computed(() => records.value.length - activeCount.value)
const view = ref<WorkspaceStatus>('active')
const visibleRecords = computed(() => records.value.filter(item => item.status === view.value)
  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
const saving = ref(false)
let restored = false
watch(() => global.conf?.app_fe_setting?.workbench_projects, value => {
  records.value = readWorkspaceRecords(value)
  if (!restored && global.conf) {
    restored = true
    if (!records.value.some(item => item.id === currentWorkspaceId.value)) currentWorkspaceId.value = ''
  }
}, { immediate: true })

function updatedLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}
function toolLabel(key: ToolKey) { return tools.find(tool => tool.key === key)?.title ?? '图片制作' }
async function saveRecords(next: WorkspaceRecord[]) {
  if (saving.value || global.conf?.is_readonly) return false
  saving.value = true
  try {
    const data = { version: 2, items: next }
    await setAppFeSetting('workbench_projects', data)
    if (global.conf) global.conf.app_fe_setting.workbench_projects = data
    records.value = next
    return true
  } catch {
    message.error('工作区保存失败，请重试')
    return false
  } finally { saving.value = false }
}

const dialogOpen = ref(false)
const editingId = ref('')
const draftName = ref('')
const draftBrief = ref('')
function showCreate() {
  editingId.value = ''
  draftName.value = ''
  draftBrief.value = ''
  dialogOpen.value = true
}
function showEdit(item: WorkspaceRecord) {
  editingId.value = item.id
  draftName.value = item.name
  draftBrief.value = item.brief
  dialogOpen.value = true
}
async function saveDialog() {
  const name = draftName.value.trim()
  if (!name) { message.warning('请填写作品或任务名称'); return }
  const now = new Date().toISOString()
  let next: WorkspaceRecord[]
  if (editingId.value) {
    next = records.value.map(item => item.id === editingId.value
      ? { ...item, name, brief: draftBrief.value.trim(), updatedAt: now } : item)
  } else {
    if (records.value.length >= 100) { message.warning('工作区数量已达到上限'); return }
    next = [{ id: crypto.randomUUID(), name, brief: draftBrief.value.trim(), status: 'active', createdAt: now,
      updatedAt: now, lastTool: 'image', assets: [], outputs: [], notes: {} }, ...records.value]
  }
  if (await saveRecords(next)) {
    dialogOpen.value = false
    if (!editingId.value) view.value = 'active'
  }
}
async function openWorkspace(item: WorkspaceRecord) {
  if (item.status === 'paused' && !global.conf?.is_readonly) {
    const next = records.value.map(row => row.id === item.id
      ? { ...row, status: 'active' as const, updatedAt: new Date().toISOString() } : row)
    if (!(await saveRecords(next))) return
  }
  currentWorkspaceId.value = item.id
  activeTool.value = 'overview'
}
function backToList() {
  currentWorkspaceId.value = ''
  activeTool.value = 'overview'
}
async function toggleStatus(item: WorkspaceRecord) {
  const status: WorkspaceStatus = item.status === 'active' ? 'paused' : 'active'
  const next = records.value.map(row => row.id === item.id
    ? { ...row, status, updatedAt: new Date().toISOString() } : row)
  if (await saveRecords(next)) message.success(status === 'paused' ? '已搁置工作区' : '已恢复工作区')
}
function confirmRemove(item: WorkspaceRecord) {
  Modal.confirm({
    title: '删除这项工作区？',
    content: '会删除工作区记录、笔记和本机图片草稿；引用的素材与输出文件不会删除。',
    okText: '删除', cancelText: '取消', okType: 'danger',
    onOk: async () => {
      if (!(await saveRecords(records.value.filter(row => row.id !== item.id)))) throw new Error('保存失败')
      if (currentWorkspaceId.value === item.id) backToList()
      await nextTick()
      clearStudioWorkspace(item.id)
    }
  })
}
async function activateTool(key: ToolTab) {
  activeTool.value = key
  const item = currentWorkspace.value
  if (!item || key === 'overview' || item.lastTool === key || global.conf?.is_readonly) return
  await saveRecords(records.value.map(row => row.id === item.id
    ? { ...row, lastTool: key, updatedAt: new Date().toISOString() } : row))
}
async function moveToolTab(event: KeyboardEvent) {
  const keys: ToolTab[] = ['overview', ...tools.map(tool => tool.key)]
  const current = keys.indexOf(activeTool.value)
  const next = event.key === 'ArrowRight' ? (current + 1) % keys.length
    : event.key === 'ArrowLeft' ? (current - 1 + keys.length) % keys.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1 : -1
  if (next < 0) return
  event.preventDefault()
  await activateTool(keys[next])
  await nextTick()
  document.getElementById('workbench-tab-' + keys[next])?.focus()
}

const pickerOpen = ref(false)
const pickerRole = ref<PickerRole>('source')
const pickerQuery = ref('')
const pickerSemanticInput = ref('')
const pickerSemanticMode = ref(false)
const pickerSearchInput = computed({
  get: () => pickerSemanticMode.value ? pickerSemanticInput.value : pickerQuery.value,
  set: (value: string) => { if (pickerSemanticMode.value) pickerSemanticInput.value = value; else pickerQuery.value = value }
})
const pickerLoading = ref(false)
const pickerError = ref('')
const candidates = ref<FileNodeInfo[]>([])
const pickerCursor = ref('')
const pickerHasMore = ref(false)
const pickerFilters = ref<SearchFilters>(emptySearchFilters())
const pickerDraftFilters = ref<SearchFilters>(emptySearchFilters())
const pickerFiltersValid = ref(true)
const pickerFilterOpen = ref(false)
const pickerTags = ref<Tag[]>([])
const pickerFilterSummary = computed(() => describeSearchFilters(pickerFilters.value, pickerTags.value))
const pickerSemanticResult = ref<QwenResult>()
const pickerSemanticLoading = ref(false)
const pickerSemanticError = ref('')
const pickerSemanticStatus = ref<QwenStatus>()
const pickerRerankerStatus = ref<QwenStatus>()
const pickerRerank = ref(false)
let pickerSemanticRequest = 0
let pickerStatusTimer: ReturnType<typeof setInterval> | undefined
const { reference: pickerReference, method: pickerSimilarityMethod, chooseMethod: choosePickerSimilarityMethod,
  minimum: pickerMinimum, loading: pickerSimilarityLoading, error: pickerSimilarityError,
  result: pickerSimilarityResult, clear: clearPickerSimilarity, chooseFile: choosePickerImage,
  choosePath: choosePickerPath, search: searchPickerSimilar } = useSimilaritySearch(() => pickerFilters.value)
const visibleCandidates = computed(() => pickerReference.value ? pickerSimilarityResult.value?.files ?? []
  : pickerSemanticMode.value && pickerSemanticInput.value.trim() ? pickerSemanticResult.value?.files ?? [] : candidates.value)
const pickerBusy = computed(() => pickerLoading.value || pickerSemanticLoading.value || pickerSimilarityLoading.value)
const activePickerError = computed(() => pickerSimilarityError.value || pickerSemanticError.value || pickerError.value)
watch([pickerOpen, pickerSemanticMode, pickerReference, pickerSimilarityMethod], () => {
  clearInterval(pickerStatusTimer)
  pickerStatusTimer = undefined
  if (!pickerOpen.value || !(pickerSemanticMode.value || (pickerReference.value && pickerSimilarityMethod.value === 'qwen'))) return
  void refreshPickerStatus()
  pickerStatusTimer = setInterval(() => void refreshPickerStatus(), 10000)
})
onBeforeUnmount(() => clearInterval(pickerStatusTimer))
const selectedCandidates = ref<FileNodeInfo[]>([])
const selectedPaths = computed(() => selectedCandidates.value.map(file => file.fullpath))
type QuickLookItem = { src: string; name: string; kind: 'image' | 'video' | 'audio' }
const quickLook = ref<QuickLookItem>()
let quickLookTrigger: HTMLElement | null = null
watch(pickerOpen, open => { if (!open) quickLook.value = undefined })
function previewCandidate(file: FileNodeInfo, event: MouseEvent) {
  quickLookTrigger = event.currentTarget as HTMLElement
  const kind = isAudioFile(file.name) ? 'audio' : isVideoFile(file.name) ? 'video' : 'image'
  quickLook.value = { name: file.name, kind,
    src: kind === 'audio' ? toStreamAudioUrl(file) : kind === 'video' ? toStreamVideoUrl(file) : toImageUrl(file) }
}
function previewReference(event: MouseEvent) {
  const reference = pickerReference.value
  if (!reference?.preview) return
  quickLookTrigger = event.currentTarget as HTMLElement
  const src = reference.path
    ? toImageUrl({ name: reference.name, fullpath: reference.path, date: '' } as FileNodeInfo)
    : reference.preview
  quickLook.value = { src, name: reference.name, kind: 'image' }
}
function closeQuickLook() {
  quickLook.value = undefined
  void nextTick(() => { if (quickLookTrigger?.isConnected) quickLookTrigger.focus() })
}
let pickerRequest = 0
async function searchCandidates(more = false) {
  const request = ++pickerRequest
  pickerLoading.value = true
  pickerError.value = ''
  try {
    const result = await getImagesBySubstr({ ...pickerFilters.value, surstr: pickerQuery.value.trim(), regexp: '', cursor: more ? pickerCursor.value : '',
      media_type: 'all', size: 60, manual_order: true })
    if (request === pickerRequest) {
      candidates.value = more ? [...candidates.value, ...result.files.filter(file => file.type === 'file')]
        : result.files.filter(file => file.type === 'file')
      pickerCursor.value = result.cursor.next
      pickerHasMore.value = result.cursor.has_next
    }
  } catch (error: any) {
    if (request === pickerRequest) pickerError.value = error?.response?.data?.detail || '读取媒体库失败，请重试'
  } finally {
    if (request === pickerRequest) pickerLoading.value = false
  }
}
async function refreshPickerStatus() {
  try {
    const [embedding, reranker] = await Promise.all([getQwenStatus('embedding'), getQwenStatus('reranker')])
    pickerSemanticStatus.value = embedding
    pickerRerankerStatus.value = reranker
  } catch { pickerSemanticError.value = '无法检查画面搜索状态' }
}
async function updatePickerIndex() {
  try { await startQwenIndex(); await refreshPickerStatus() }
  catch (error: any) { pickerSemanticError.value = error?.message || '更新索引失败' }
}
async function searchPickerSemantic() {
  const query = pickerSemanticInput.value.trim()
  if (!query) { pickerSemanticResult.value = undefined; return }
  clearPickerSimilarity()
  const request = ++pickerSemanticRequest
  pickerSemanticLoading.value = true
  pickerSemanticError.value = ''
  pickerSemanticResult.value = undefined
  try {
    const result = await searchQwen(query, pickerFilters.value, pickerRerank.value)
    if (request === pickerSemanticRequest) pickerSemanticResult.value = result
  } catch (error: any) {
    if (request === pickerSemanticRequest) pickerSemanticError.value = error?.message || '画面搜索失败'
  } finally {
    if (request === pickerSemanticRequest) pickerSemanticLoading.value = false
  }
}
function submitPickerSearch() {
  if (pickerSemanticMode.value) void searchPickerSemantic()
  else { clearPickerSimilarity(); void searchCandidates() }
}
function changePickerMode(semantic: boolean) {
  pickerSemanticMode.value = semantic
  if (semantic) { clearPickerSimilarity(); void refreshPickerStatus() }
  else { pickerSemanticRequest++; pickerSemanticResult.value = undefined; pickerSemanticError.value = ''; pickerSemanticLoading.value = false }
}
function choosePickerReference(file: File) {
  choosePickerImage(file)
  void refreshPickerStatus()
}
function choosePickerReferencePath(path: string) {
  choosePickerPath(path)
  void refreshPickerStatus()
}
function applyPickerExample(query: string) {
  pickerSearchInput.value = query
  submitPickerSearch()
}
function applyPickerFilters() {
  if (!pickerFiltersValid.value) { message.warning('请完整填写有效的尺寸或比例'); return }
  pickerFilters.value = structuredClone(pickerDraftFilters.value)
  pickerFilterOpen.value = false
  if (pickerReference.value) void searchPickerSimilar()
  else submitPickerSearch()
}
function togglePickerFilters() {
  if (!pickerFilterOpen.value) pickerDraftFilters.value = structuredClone(pickerFilters.value)
  pickerFilterOpen.value = !pickerFilterOpen.value
}
function openPicker(role: PickerRole) {
  pickerSemanticRequest++
  pickerRole.value = role
  pickerQuery.value = ''
  pickerSemanticInput.value = ''
  pickerSemanticMode.value = false
  pickerSemanticResult.value = undefined
  pickerSemanticLoading.value = false
  pickerSemanticError.value = ''
  clearPickerSimilarity()
  pickerFilters.value = emptySearchFilters()
  pickerDraftFilters.value = emptySearchFilters()
  pickerFilterOpen.value = false
  pickerFiltersValid.value = true
  pickerHasMore.value = false
  pickerError.value = ''
  selectedCandidates.value = []
  candidates.value = []
  pickerOpen.value = true
  void searchCandidates()
  void getDbBasicInfo(false).then(info => { pickerTags.value = info.tags }).catch(() => {})
}
function toggleCandidate(file: FileNodeInfo) {
  selectedCandidates.value = selectedPaths.value.includes(file.fullpath)
    ? selectedCandidates.value.filter(item => item.fullpath !== file.fullpath)
    : [...selectedCandidates.value, file]
}
function toAsset(file: FileNodeInfo): WorkspaceAsset {
  return { ...(typeof file.id === 'number' ? { id: file.id } : {}),
    path: file.fullpath, name: file.name,
    kind: isAudioFile(file.name) ? 'audio' : isVideoFile(file.name) ? 'video' : 'image' }
}
async function addPicked() {
  const workspace = currentWorkspace.value
  if (!workspace || !selectedPaths.value.length) return
  const incoming = selectedCandidates.value.map(toAsset)
  const updated = pickerRole.value === 'source'
    ? { ...workspace, assets: addWorkspaceAssets(workspace.assets, incoming), updatedAt: new Date().toISOString() }
    : { ...workspace, outputs: addWorkspaceAssets(workspace.outputs, incoming), updatedAt: new Date().toISOString() }
  if (await saveRecords(records.value.map(row => row.id === workspace.id ? updated : row))) pickerOpen.value = false
}
async function removeAsset(role: PickerRole, path: string) {
  const workspace = currentWorkspace.value
  if (!workspace) return
  const updated = role === 'source'
    ? { ...workspace, assets: workspace.assets.filter(item => item.path !== path), updatedAt: new Date().toISOString() }
    : { ...workspace, outputs: workspace.outputs.filter(item => item.path !== path), updatedAt: new Date().toISOString() }
  await saveRecords(records.value.map(row => row.id === workspace.id ? updated : row))
}
function assetKindLabel(kind: WorkspaceAsset['kind']) {
  return kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'
}
const assetInfo = ref<Record<string, FileNodeInfo>>({})
const brokenThumbs = ref(new Set<string>())
const assetPaths = computed(() => [...(currentWorkspace.value?.assets ?? []), ...(currentWorkspace.value?.outputs ?? [])].map(asset => asset.path))
let assetInfoRequest = 0
watch(assetPaths, async paths => {
  const request = ++assetInfoRequest
  if (!paths.length) { assetInfo.value = {}; return }
  try {
    const result = await batchGetFilesInfo([...new Set(paths)])
    if (request === assetInfoRequest) assetInfo.value = result
  } catch { if (request === assetInfoRequest) assetInfo.value = {} }
}, { immediate: true })
function thumbnailFor(asset: WorkspaceAsset) {
  const info = assetInfo.value[asset.path]
  if (!info || brokenThumbs.value.has(asset.path)) return ''
  return asset.kind === 'image' ? toImageThumbnailUrl(info, '160x160')
    : asset.kind === 'video' ? toVideoCoverUrl(info) : ''
}
function thumbnailFailed(path: string) {
  brokenThumbs.value = new Set([...brokenThumbs.value, path])
}
async function previewAsset(asset: WorkspaceAsset) {
  let info = assetInfo.value[asset.path]
  if (!info) {
    try { info = (await batchGetFilesInfo([asset.path]))[asset.path] }
    catch { /* The warning below covers unavailable files. */ }
  }
  if (!info || info.type !== 'file') { message.warning('原文件暂时不可用'); return }
  openPreviewWithFile(info)
}

const noteDraft = ref('')
watch([currentWorkspace, activeTool], ([workspace, tool]) => {
  noteDraft.value = workspace && tool !== 'overview' ? workspace.notes[tool] ?? '' : ''
}, { immediate: true })
async function saveToolNote() {
  const workspace = currentWorkspace.value
  const key = activeTool.value
  if (!workspace || key === 'overview') return
  const next = records.value.map(row => row.id === workspace.id
    ? { ...row, notes: { ...row.notes, [key]: noteDraft.value.slice(0, 5000) }, updatedAt: new Date().toISOString() } : row)
  if (await saveRecords(next)) message.success('工作笔记已保存')
}
</script>

<template>
  <Teleport to="#workbench-header-slot">
    <div class="workbench-toolbar">
      <div class="workbench-toolbar-heading"><strong>{{ currentWorkspace?.name || '工作台' }}</strong><span>{{ currentWorkspace ? '同一项任务，切换工具继续做' : '按作品或任务管理创作' }}</span></div>
      <nav class="workbench-tool-tabs" role="tablist" aria-label="工作台页面" @keydown="moveToolTab">
        <button id="workbench-tab-overview" type="button" role="tab" :aria-selected="activeTool === 'overview'" aria-controls="workbench-panel-overview" :tabindex="activeTool === 'overview' ? 0 : -1" :class="{ active: activeTool === 'overview' }" @click="activateTool('overview')"><AppstoreOutlined />工作区</button>
        <button v-for="tool in tools" :id="'workbench-tab-' + tool.key" :key="tool.key" type="button" role="tab" :aria-selected="activeTool === tool.key" :aria-controls="'workbench-panel-' + tool.key" :tabindex="activeTool === tool.key ? 0 : -1" :class="{ active: activeTool === tool.key }" @click="activateTool(tool.key)"><component :is="tool.icon" />{{ tool.title }}</button>
      </nav>
    </div>
  </Teleport>
  <div class="workbench-page workspace-pane">
    <div v-if="activeTool === 'overview'" id="workbench-panel-overview" class="workbench-inner" role="tabpanel" aria-labelledby="workbench-tab-overview">
      <template v-if="currentWorkspace">
        <section class="workspace-heading">
          <button class="back-link" type="button" @click="backToList"><ArrowLeftOutlined />全部工作区</button>
          <div class="workspace-heading-row"><div><span class="workspace-kicker">创作任务 · {{ updatedLabel(currentWorkspace.updatedAt) }} 更新</span><h1>{{ currentWorkspace.name }}</h1><p>{{ currentWorkspace.brief || '在这里整理素材与输出，随时切换顶部工具。' }}</p></div><div class="workspace-heading-actions"><a-button type="primary" @click="activateTool(currentWorkspace.lastTool)">继续{{ toolLabel(currentWorkspace.lastTool) }}</a-button><a-button :disabled="global.conf?.is_readonly" @click="showEdit(currentWorkspace)">修改名称与目标</a-button></div></div>
        </section>
        <div class="workspace-columns">
          <section class="work-section asset-panel">
            <div class="section-heading"><div><h2>素材</h2><p>引用媒体库文件，原文件保持原位。</p></div><a-button :disabled="global.conf?.is_readonly" @click="openPicker('source')"><PlusOutlined />加入素材</a-button></div>
            <div v-if="currentWorkspace.assets.length" class="asset-list">
              <a-dropdown v-for="asset in currentWorkspace.assets" :key="asset.path" :trigger="['contextmenu']">
                <button type="button" class="asset-row" :title="`预览：${asset.name}（右键查看更多操作）`" @click="previewAsset(asset)">
                  <span class="asset-thumb"><img v-if="thumbnailFor(asset)" :src="thumbnailFor(asset)" alt="" @error="thumbnailFailed(asset.path)" /><AudioOutlined v-else-if="asset.kind === 'audio'" /><PictureOutlined v-else /></span>
                  <span class="asset-row-copy"><strong>{{ asset.name }}</strong><small :title="asset.path">{{ assetKindLabel(asset.kind) }} · {{ asset.path }}</small></span><span class="asset-row-cue">预览</span>
                </button>
                <template #overlay><a-menu><a-menu-item @click="previewAsset(asset)">预览文件</a-menu-item><a-menu-item @click="copy2clipboardI18n(asset.path)">复制文件路径</a-menu-item><a-menu-divider /><a-menu-item :disabled="global.conf?.is_readonly" @click="removeAsset('source', asset.path)">从工作区移除引用</a-menu-item></a-menu></template>
              </a-dropdown>
            </div>
            <div v-else class="asset-empty">还没有素材。可以从媒体库搜索并加入图片、视频或音频。</div>
          </section>
          <section class="work-section asset-panel">
            <div class="section-heading"><div><h2>输出文件</h2><p>将媒体库里的现有文件记为这项任务的成果；不会生成、复制或移动文件。</p></div><a-button :disabled="global.conf?.is_readonly" @click="openPicker('output')"><PlusOutlined />添加已有文件</a-button></div>
            <div v-if="currentWorkspace.outputs.length" class="asset-list">
              <a-dropdown v-for="asset in currentWorkspace.outputs" :key="asset.path" :trigger="['contextmenu']">
                <button type="button" class="asset-row" :title="`预览：${asset.name}（右键查看更多操作）`" @click="previewAsset(asset)">
                  <span class="asset-thumb"><img v-if="thumbnailFor(asset)" :src="thumbnailFor(asset)" alt="" @error="thumbnailFailed(asset.path)" /><AudioOutlined v-else-if="asset.kind === 'audio'" /><PictureOutlined v-else /></span>
                  <span class="asset-row-copy"><strong>{{ asset.name }}</strong><small :title="asset.path">{{ assetKindLabel(asset.kind) }} · {{ asset.path }}</small></span><span class="asset-row-cue">预览</span>
                </button>
                <template #overlay><a-menu><a-menu-item @click="previewAsset(asset)">预览文件</a-menu-item><a-menu-item @click="copy2clipboardI18n(asset.path)">复制文件路径</a-menu-item><a-menu-divider /><a-menu-item :disabled="global.conf?.is_readonly" @click="removeAsset('output', asset.path)">从工作区移除引用</a-menu-item></a-menu></template>
              </a-dropdown>
            </div>
            <div v-else class="asset-empty">还没有输出文件。图片制作导出后，可从媒体库将成品记录在这里。</div>
          </section>
        </div>
      </template>
      <template v-else>
        <section class="work-section" aria-labelledby="workspaces-title"><div class="section-heading workspace-list-heading"><h2 id="workspaces-title">我的工作区</h2><a-button type="primary" class="new-work" :disabled="global.conf?.is_readonly || !global.conf" @click="showCreate"><PlusOutlined />新建工作区</a-button></div>
          <div class="work-tabs" role="group" aria-label="工作区状态"><button type="button" :class="{ active: view === 'active' }" :aria-pressed="view === 'active'" @click="view = 'active'">进行中 <span>{{ activeCount }}</span></button><button type="button" :class="{ active: view === 'paused' }" :aria-pressed="view === 'paused'" @click="view = 'paused'">已搁置 <span>{{ pausedCount }}</span></button></div>
          <div v-if="visibleRecords.length" class="work-grid"><article v-for="item in visibleRecords" :key="item.id" class="work-card"><button type="button" class="work-card-main" :aria-label="'进入工作区：' + item.name" @click="openWorkspace(item)"><span class="work-card-top"><span class="work-icon"><AppstoreOutlined /></span><span class="work-status" :class="item.status">{{ item.status === 'active' ? '进行中' : '已搁置' }}</span></span><span class="work-card-title">{{ item.name }}</span><span class="work-brief">{{ item.brief || '还没有填写作品目标' }}</span><span class="work-meta">{{ item.assets.length }} 项素材 · {{ item.outputs.length }} 项输出 · 上次在{{ toolLabel(item.lastTool) }} · {{ updatedLabel(item.updatedAt) }}</span><span class="work-card-entry">{{ item.status === 'active' ? '进入工作区' : '恢复并进入' }} <span aria-hidden="true">→</span></span></button><div class="work-card-bottom"><div class="record-actions"><button type="button" :disabled="saving || global.conf?.is_readonly" :aria-label="'修改工作区：' + item.name" @click="showEdit(item)">修改</button><button type="button" :disabled="saving || global.conf?.is_readonly" @click="toggleStatus(item)">{{ item.status === 'active' ? '搁置' : '恢复' }}</button><button type="button" class="remove" :disabled="saving || global.conf?.is_readonly" :aria-label="'删除工作区：' + item.name" @click="confirmRemove(item)">删除</button></div></div></article></div>
          <div v-else class="work-empty"><div class="empty-illustration" aria-hidden="true"><span></span><span></span><span><PlusOutlined /></span></div><strong>{{ view === 'active' ? '还没有进行中的工作区' : '没有已搁置的工作区' }}</strong><p>{{ view === 'active' ? '点击右上角新建工作区。' : '暂时没有需要搁置的内容。' }}</p></div>
        </section>
      </template>
    </div>
    <div v-else-if="activeTool === 'image'" id="workbench-panel-image" class="workbench-inner image-pane" role="tabpanel" aria-labelledby="workbench-tab-image">
      <ImageCreationStudio v-if="currentWorkspace" :workspace-id="currentWorkspace.id" :workspace-name="currentWorkspace.name" :assets="currentWorkspace.assets" :asset-info="assetInfo" :readonly="global.conf?.is_readonly" @add-assets="openPicker('source')" />
      <section v-else class="work-empty choose-workspace"><strong>先打开一项工作区</strong><p>图片制作会使用该工作区里的图片素材。</p><a-button @click="activateTool('overview')">查看工作区</a-button></section>
      <section v-if="currentWorkspace" class="work-section tool-note"><div class="section-heading"><div><h2>制作笔记</h2><p>记录这项作品的想法。</p></div><a-button type="primary" :loading="saving" :disabled="global.conf?.is_readonly" @click="saveToolNote">保存笔记</a-button></div><a-textarea v-model:value="noteDraft" :rows="3" :maxlength="5000" :disabled="global.conf?.is_readonly" placeholder="例如：封面用竖版，标题放在底部" /></section>
    </div>
    <div v-else-if="selectedTool" :id="'workbench-panel-' + selectedTool.key" :key="selectedTool.key" class="workbench-inner tool-pane" role="tabpanel" :aria-labelledby="'workbench-tab-' + selectedTool.key">
      <section v-if="currentWorkspace" class="tool-workspace-strip"><div><span>当前工作区</span><strong>{{ currentWorkspace.name }}</strong><small>{{ currentWorkspace.assets.length }} 项素材 · {{ currentWorkspace.outputs.length }} 项输出</small></div><a-button @click="activateTool('overview')">查看工作区</a-button></section>
      <section class="tool-hero" :class="selectedTool.tone"><div class="tool-icon" :class="selectedTool.tone"><component :is="selectedTool.icon" /></div><div class="tool-hero-copy"><span class="tool-stage">{{ selectedTool.note }} · 页面预览</span><h1>{{ selectedTool.title }}</h1><p>{{ selectedTool.detail }}</p></div><span class="tool-soon">功能待接入</span></section>
      <section v-if="currentWorkspace" class="work-section tool-note"><div class="section-heading"><div><h2>工具笔记</h2><p>记录这项工具的想法；实际编辑功能接入后可继续使用。</p></div><a-button type="primary" :loading="saving" :disabled="global.conf?.is_readonly" @click="saveToolNote">保存笔记</a-button></div><a-textarea v-model:value="noteDraft" :rows="4" :maxlength="5000" :disabled="global.conf?.is_readonly" placeholder="例如：为选好的照片制作一组竖版封面" /><div v-if="currentWorkspace.assets.length" class="tool-assets"><strong>本工作区素材</strong><span v-for="asset in currentWorkspace.assets.slice(0, 12)" :key="asset.path" :title="asset.path">{{ asset.name }}</span><span v-if="currentWorkspace.assets.length > 12">+{{ currentWorkspace.assets.length - 12 }}</span></div></section>
      <section v-else class="work-empty choose-workspace"><strong>先打开一项工作区</strong><p>工具会沿用该工作区的素材与笔记。</p><a-button @click="activateTool('overview')">查看工作区</a-button></section>
      <section class="work-section"><div class="section-heading"><div><h2>计划中的工具</h2><p>这些入口目前展示方向，后续逐步加入实际编辑能力。</p></div></div><div class="tool-feature-list"><div v-for="(feature, index) in selectedTool.features" :key="feature" class="tool-feature"><span class="feature-index">{{ String(index + 1).padStart(2, '0') }}</span><strong>{{ feature }}</strong><span>待接入</span></div></div><div v-if="selectedTool.key === 'ai'" class="cloud-note"><RobotOutlined /><span>生图和视频工作流会在工作台内配置；设置中的 Cloud 接入仍用于描述、提示词反推和标签推荐。</span></div></section>
    </div>
    <a-modal :open="dialogOpen" :title="editingId ? '修改工作区' : '新建工作区'" :confirm-loading="saving" :ok-text="editingId ? '保存' : '创建'" cancel-text="取消" @ok="saveDialog" @cancel="dialogOpen = false"><div class="work-form"><label for="work-name">作品或任务名称</label><a-input id="work-name" v-model:value="draftName" :maxlength="80" placeholder="例如：旅行九宫格" @press-enter="saveDialog" /><label for="work-brief">想完成什么（可选）</label><a-textarea id="work-brief" v-model:value="draftBrief" :rows="3" :maxlength="500" placeholder="例如：用精选照片做一组社媒图" /></div></a-modal>
    <a-modal :open="pickerOpen" :width="680" :title="pickerRole === 'source' ? '从媒体库加入素材' : '添加已有输出文件'" :confirm-loading="saving" :keyboard="!quickLook" :ok-text="pickerRole === 'source' ? '加入工作区' : '记录为输出'" cancel-text="取消" :ok-button-props="{ disabled: selectedPaths.length === 0 }" @ok="addPicked" @cancel="pickerOpen = false">
      <div class="picker-body">
        <p v-if="pickerRole === 'output'" class="picker-explanation">只记录现有文件的引用，不会导出、复制或移动文件。</p>
        <MediaSearchBox v-model="pickerSearchInput" :semantic-mode="pickerSemanticMode" help-first label="搜索媒体库"
          @submit="submitPickerSearch" @mode-change="changePickerMode" @image-file="choosePickerReference"
          @image-path="choosePickerReferencePath" @example="applyPickerExample" />
        <div class="picker-options">
          <button type="button" class="picker-filter-toggle" :aria-expanded="pickerFilterOpen" @click="togglePickerFilters">筛选媒体{{ pickerFilterSummary ? ` · ${pickerFilterSummary}` : '' }}</button>
          <span v-if="pickerSemanticMode && !pickerReference" class="picker-mode-label">AI 画面搜索</span>
          <span v-else-if="pickerReference" class="picker-mode-label">以图搜图</span>
        </div>
        <div v-if="pickerFilterOpen" class="picker-filter-panel"><LibraryFilterFields v-model="pickerDraftFilters" :tags="pickerTags" :disabled="pickerBusy" @validity="pickerFiltersValid = $event" /><div class="picker-filter-actions"><a-button size="small" @click="pickerDraftFilters = emptySearchFilters()">清空筛选</a-button><a-button size="small" type="primary" :disabled="!pickerFiltersValid" @click="applyPickerFilters">应用筛选</a-button></div></div>
        <div v-if="pickerSemanticMode && !pickerReference" class="picker-search-settings">
          <template v-if="pickerSemanticStatus?.state === 'ready'"><label>AI 重排 <a-switch v-model:checked="pickerRerank" size="small" :disabled="pickerRerankerStatus?.state !== 'ready'" /></label><span>已索引 {{ pickerSemanticStatus.indexed_count }} / {{ pickerSemanticStatus.image_count }}</span><a-button size="small" :loading="pickerSemanticStatus.running" :disabled="global.conf?.is_readonly" @click="updatePickerIndex">更新索引</a-button></template>
          <template v-else><span>{{ pickerSemanticStatus ? '画面搜索未就绪' : '正在检查画面搜索…' }}</span><a-button v-if="pickerSemanticStatus" size="small" @click="navigate('global-setting')">打开设置</a-button></template>
        </div>
        <div v-if="pickerReference" class="picker-search-settings picker-reference"><button v-if="pickerReference.preview" type="button" class="picker-reference-preview" :aria-label="`查看参考图片：${pickerReference.name}`" @click="previewReference"><img :src="pickerReference.preview" alt="" /></button><span :title="pickerReference.path || pickerReference.name">{{ pickerReference.name }}</span><label>搜索方式 <select :value="pickerSimilarityMethod" @change="choosePickerSimilarityMethod(($event.target as HTMLSelectElement).value as 'qwen' | 'hash')"><option value="qwen">画面相似</option><option value="hash">近重复图片</option></select></label><label>最低分 <input v-model.number="pickerMinimum" type="range" min="0" max="100" step="5" />{{ pickerMinimum }}</label><a-button v-if="pickerSimilarityMethod === 'qwen' && pickerSemanticStatus?.state === 'ready' && (pickerSemanticStatus.indexed_count ?? 0) < (pickerSemanticStatus.image_count ?? 0)" size="small" :disabled="global.conf?.is_readonly" :loading="pickerSemanticStatus.running" @click="updatePickerIndex">更新索引</a-button><a-button size="small" @click="clearPickerSimilarity">清除搜图</a-button></div>
        <p v-if="activePickerError" class="picker-error" role="alert">{{ activePickerError }}</p>
        <div v-else-if="pickerBusy && !visibleCandidates.length" class="picker-status">{{ pickerReference ? '正在查找相似图片…' : pickerSemanticMode ? '正在匹配画面内容…' : '正在读取媒体库…' }}</div>
        <div v-else-if="!visibleCandidates.length" class="picker-status">没有找到匹配的媒体；请调整搜索词或筛选条件。</div>
        <div v-else class="picker-list"><div v-for="(file, index) in visibleCandidates" :key="file.fullpath" class="picker-row"><input :id="`picker-file-${index}`" type="checkbox" :checked="selectedPaths.includes(file.fullpath)" :aria-label="`选择 ${file.name}`" @change="toggleCandidate(file)" /><button type="button" class="picker-thumbnail" :aria-label="`预览 ${file.name}`" :title="`预览 ${file.name}`" @click="previewCandidate(file, $event)"><img v-if="isImageFile(file.name)" :src="toImageThumbnailUrl(file, '160x160')" alt="" loading="lazy" /><img v-else-if="isVideoFile(file.name)" :src="toVideoCoverUrl(file)" alt="" loading="lazy" /><AudioOutlined v-else /></button><label :for="`picker-file-${index}`" class="picker-select"><span class="asset-kind">{{ isAudioFile(file.name) ? '音频' : isVideoFile(file.name) ? '视频' : isImageFile(file.name) ? '图片' : '文件' }}</span><span class="picker-file"><strong>{{ file.name }}</strong><small :title="file.fullpath">{{ file.fullpath }}</small></span></label></div></div>
        <a-button v-if="!pickerSemanticMode && !pickerReference && pickerHasMore" size="small" :loading="pickerLoading" @click="searchCandidates(true)">加载更多</a-button>
        <p class="picker-count">已选 {{ selectedPaths.length }} 项 · 当前显示 {{ visibleCandidates.length }} 项</p>
      </div>
    </a-modal>
    <MediaQuickLook v-if="quickLook" :src="quickLook.src" :name="quickLook.name" :kind="quickLook.kind" @close="closeQuickLook" />
  </div>
</template>

<style scoped>
.workbench-toolbar{min-width:0}.workbench-toolbar-heading{display:flex;align-items:baseline;gap:12px;min-height:29px;padding:0 8px}.workbench-toolbar-heading strong{font-size:17px;line-height:1.4;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.workbench-toolbar-heading span{color:var(--ui-muted);font-size:12px}
.workbench-tool-tabs{display:flex;align-items:stretch;gap:4px;min-width:0;overflow-x:auto;scrollbar-width:thin;margin-top:4px}.workbench-tool-tabs button{display:flex;align-items:center;justify-content:center;gap:7px;flex:none;min-height:38px;padding:0 14px 9px;border:0;border-bottom:2px solid transparent;border-radius:7px 7px 0 0;background:transparent;color:var(--ui-muted);font:inherit;font-size:13px;white-space:nowrap;cursor:pointer}.workbench-tool-tabs button:hover{background:var(--ui-hover);color:var(--ui-text)}.workbench-tool-tabs button.active{border-bottom-color:var(--primary-color);background:color-mix(in srgb,var(--primary-color) 9%,transparent);color:var(--primary-color);font-weight:650}.workbench-tool-tabs button:focus-visible{outline:2px solid var(--primary-color);outline-offset:-3px}
.workbench-page{height:100%;overflow:auto;background:transparent;color:var(--ui-text)}.workbench-inner{width:100%;padding:24px 28px 40px;display:flex;flex-direction:column;gap:22px}.workspace-heading,.asset-panel,.next-step,.tool-workspace-strip,.tool-note,.work-card,.work-empty{border:1px solid var(--ui-border);border-radius:var(--ui-radius-lg);background:var(--ui-surface)}.section-heading p,.workspace-heading p,.next-step p{margin:0;color:var(--ui-muted);font-size:13px;line-height:1.6}.new-work{height:36px;flex:none}
.work-section{min-width:0}.section-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:16px}.workspace-list-heading{align-items:center}.section-heading h2,.next-step h2{margin:0 0 3px;font-size:18px;line-height:1.35;font-weight:700}.work-tabs{display:flex;gap:16px;border-bottom:1px solid var(--ui-border);margin-bottom:16px}.work-tabs button{display:flex;align-items:center;gap:7px;padding:0 2px 11px;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;background:none;color:var(--ui-muted);font:inherit;font-size:13px;cursor:pointer}.work-tabs button.active{border-color:var(--primary-color);color:var(--primary-color);font-weight:650}.work-tabs button span{padding:0 6px;min-width:20px;border-radius:8px;background:var(--ui-surface-soft);font-size:11px;text-align:center}
.work-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.work-card{min-width:0;overflow:hidden;transition:border-color var(--ui-motion-fast) var(--ui-ease),box-shadow var(--ui-motion-fast) var(--ui-ease)}.work-card:hover{border-color:color-mix(in srgb,var(--primary-color) 42%,var(--ui-border));box-shadow:var(--ui-shadow-card)}.work-card-main{display:block;width:100%;padding:17px 18px 12px;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}.work-card-main:hover{background:var(--ui-hover)}.work-card-main:focus-visible{outline:2px solid var(--primary-color);outline-offset:-2px}.work-card-top{display:flex;justify-content:space-between;align-items:flex-start}.work-icon{height:42px;width:42px;display:grid;place-items:center;border-radius:10px;font-size:20px;background:var(--primary-color-1);color:var(--primary-color)}.work-status{padding:4px 8px;border-radius:6px;background:var(--primary-color-1);color:var(--primary-color);font-size:11px;font-weight:600}.work-status.paused{background:var(--ui-surface-soft);color:var(--ui-muted)}.work-card-title{display:block;margin:14px 0 4px;font-size:16px;font-weight:650;overflow-wrap:anywhere}.work-brief{display:block;margin:0 0 8px;min-height:18px;color:var(--ui-text);font-size:12px}.work-meta{display:block;font-size:11px;color:var(--ui-muted);line-height:1.5}.work-card-entry{display:block;margin-top:14px;color:var(--primary-color);font-size:12px;font-weight:650}.work-card-entry span{margin-left:3px}.work-card-bottom{min-height:42px;padding:5px 12px;border-top:1px solid var(--ui-border);display:flex;align-items:center;justify-content:flex-end}.record-actions{display:flex;align-items:center;gap:4px}.record-actions button,.asset-row button{border:0;border-radius:5px;padding:5px 6px;background:transparent;color:var(--ui-muted);font:inherit;font-size:11px;cursor:pointer}.record-actions button:hover:not(:disabled),.asset-row button:hover:not(:disabled){background:var(--ui-hover);color:var(--ui-text)}.record-actions button.remove:hover:not(:disabled){color:#d44444}.record-actions button:disabled,.asset-row button:disabled{opacity:.5;cursor:default}
.work-empty{min-height:216px;display:flex;align-items:center;justify-content:center;flex-direction:column;text-align:center;padding:20px}.empty-illustration{width:68px;height:52px;position:relative;margin-bottom:15px}.empty-illustration span{position:absolute;display:grid;place-items:center;width:38px;height:42px;border:1px solid var(--ui-border);border-radius:7px;background:var(--ui-surface);box-shadow:0 3px 8px #0000000d}.empty-illustration span:nth-child(1){left:3px;top:5px;transform:rotate(-13deg)}.empty-illustration span:nth-child(2){right:3px;top:5px;transform:rotate(13deg)}.empty-illustration span:nth-child(3){left:15px;top:0;color:var(--primary-color);font-size:18px}.work-empty strong{font-size:15px}.work-empty p{margin:5px 0 12px;color:var(--ui-muted);font-size:12px}
.workspace-heading{padding:22px 26px;background:linear-gradient(115deg,color-mix(in srgb,var(--primary-color) 8%,var(--ui-surface)),var(--ui-surface) 70%)}.back-link{display:inline-flex;gap:6px;align-items:center;border:0;background:none;color:var(--ui-muted);font:inherit;font-size:12px;cursor:pointer;padding:0}.back-link:hover{color:var(--primary-color)}.workspace-heading-row{display:flex;justify-content:space-between;align-items:center;gap:18px;margin-top:17px}.workspace-kicker{color:var(--primary-color);font-size:11px;font-weight:650}.workspace-heading h1{margin:6px 0;font-size:25px;line-height:1.3;overflow-wrap:anywhere}.workspace-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.asset-panel{padding:20px;min-height:210px}.asset-panel .section-heading{align-items:center}.asset-empty{padding:24px 10px;text-align:center;color:var(--ui-muted);font-size:12px;background:var(--ui-surface-soft);border-radius:var(--ui-radius)}.asset-list{display:flex;flex-direction:column;gap:7px;max-height:360px;overflow:auto}.asset-row{display:flex;align-items:center;gap:9px;min-width:0;padding:9px 10px;background:var(--ui-surface-soft);border-radius:var(--ui-radius-sm)}.asset-kind{flex:none;padding:2px 5px;border-radius:4px;background:var(--ui-accent-soft);color:var(--primary-color);font-size:10px}.asset-row>div{flex:1;min-width:0}.asset-row strong,.picker-file strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.asset-row small,.picker-file small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ui-muted);font-size:10px}.next-step{padding:20px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.tool-pane{gap:20px}.tool-workspace-strip{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 17px}.tool-workspace-strip>div{display:flex;align-items:baseline;gap:10px;min-width:0}.tool-workspace-strip span,.tool-workspace-strip small{color:var(--ui-muted);font-size:11px}.tool-workspace-strip strong{font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tool-hero{display:flex;align-items:center;gap:20px;min-height:145px;padding:24px 28px;border:1px solid var(--ui-border);border-radius:var(--ui-radius-lg);background:linear-gradient(112deg,color-mix(in srgb,var(--primary-color) 10%,var(--ui-surface)),var(--ui-surface) 65%)}.tool-hero.violet{background:linear-gradient(112deg,color-mix(in srgb,var(--ui-violet) 11%,var(--ui-surface)),var(--ui-surface) 65%)}.tool-hero.amber{background:linear-gradient(112deg,color-mix(in srgb,var(--ui-amber) 11%,var(--ui-surface)),var(--ui-surface) 65%)}.tool-hero.mint{background:linear-gradient(112deg,color-mix(in srgb,var(--ui-mint) 11%,var(--ui-surface)),var(--ui-surface) 65%)}.tool-icon{display:grid;place-items:center;flex:none;width:58px;height:58px;font-size:25px;border-radius:16px}.tool-icon.blue{background:var(--primary-color-1);color:var(--primary-color)}.tool-icon.violet{background:color-mix(in srgb,var(--ui-violet) 13%,var(--ui-surface));color:var(--ui-violet)}.tool-icon.amber{background:color-mix(in srgb,var(--ui-amber) 13%,var(--ui-surface));color:var(--ui-amber)}.tool-icon.mint{background:color-mix(in srgb,var(--ui-mint) 13%,var(--ui-surface));color:var(--ui-mint)}.tool-hero-copy{flex:1;min-width:0}.tool-stage{color:var(--primary-color);font-size:12px;font-weight:650}.tool-hero h1{margin:7px 0 5px;font-size:26px;line-height:1.25}.tool-hero p{margin:0;color:var(--ui-muted);font-size:13px}.tool-soon{align-self:flex-start;padding:6px 10px;border:1px solid var(--ui-border);border-radius:999px;background:var(--ui-surface);color:var(--ui-muted);font-size:11px;white-space:nowrap}.tool-note{padding:20px}.tool-assets{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:14px}.tool-assets strong{margin-right:6px;font-size:12px}.tool-assets span{max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:4px 8px;border-radius:6px;background:var(--ui-surface-soft);color:var(--ui-muted);font-size:11px}.choose-workspace{min-height:145px}.tool-feature-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.tool-feature{display:flex;align-items:center;gap:12px;min-width:0;min-height:76px;padding:16px;border:1px solid var(--ui-border);border-radius:var(--ui-radius-lg);background:var(--ui-surface)}.feature-index{color:var(--primary-color);font-size:12px;font-weight:700}.tool-feature strong{min-width:0;flex:1;font-size:13px;font-weight:600}.tool-feature>span:last-child{color:var(--ui-muted);font-size:11px;white-space:nowrap}.cloud-note{display:flex;align-items:flex-start;gap:9px;margin-top:12px;padding:12px 14px;border:1px solid var(--ui-border);border-radius:var(--ui-radius);background:var(--ui-surface-soft);color:var(--ui-muted);font-size:12px;line-height:1.55}.cloud-note .anticon{color:var(--primary-color);margin-top:2px}
.work-form{display:flex;flex-direction:column;gap:9px;padding:8px 0 4px}.work-form label{font-size:12px;font-weight:600}.work-form :deep(.ant-input){margin-bottom:8px}.picker-body{display:flex;flex-direction:column;gap:12px}.picker-explanation{margin:0;color:var(--ui-muted);font-size:12px}.picker-list{max-height:330px;overflow:auto;border:1px solid var(--ui-border);border-radius:var(--ui-radius)}.picker-row{display:flex;align-items:center;gap:9px;padding:7px 12px}.picker-row+.picker-row{border-top:1px solid var(--ui-border)}.picker-row:hover{background:var(--ui-hover)}.picker-select{display:flex;align-items:center;gap:9px;flex:1;min-width:0;cursor:pointer}.picker-file{min-width:0;flex:1}.picker-thumbnail{flex:none;width:56px;height:56px;display:grid;place-items:center;overflow:hidden;border:1px solid var(--ui-border);border-radius:6px;padding:0;background:var(--ui-surface-soft);color:var(--primary-color);font-size:22px;cursor:zoom-in}.picker-thumbnail img{display:block;width:100%;height:100%;object-fit:cover}.picker-thumbnail:hover{border-color:var(--primary-color)}.picker-thumbnail:focus-visible,.picker-reference-preview:focus-visible{outline:2px solid var(--primary-color);outline-offset:2px}.picker-status{padding:36px;text-align:center;color:var(--ui-muted)}.picker-error{color:#d44444}.picker-count{margin:0;color:var(--ui-muted);font-size:11px}
.workspace-heading-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}
.asset-row{width:100%;border:1px solid transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}.asset-row:hover{border-color:var(--ui-border);background:var(--ui-hover)}.asset-row:focus-visible{outline:2px solid var(--primary-color);outline-offset:-2px}.asset-row-copy{flex:1;min-width:0}.asset-row-cue{flex:none;color:var(--primary-color);font-size:11px}.asset-thumb{display:grid;place-items:center;flex:none;width:64px;height:64px;overflow:hidden;border-radius:7px;background:var(--ui-accent-soft);color:var(--primary-color);font-size:24px}.asset-thumb img{display:block;width:100%;height:100%;object-fit:cover}
.picker-body>.media-search-box{width:100%}.picker-options{display:flex;align-items:center;justify-content:space-between;gap:8px}.picker-filter-toggle{max-width:80%;padding:4px 0;border:0;background:transparent;color:var(--primary-color);font:inherit;font-size:12px;text-align:left;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.picker-mode-label{color:var(--ui-muted);font-size:11px;white-space:nowrap}.picker-filter-panel{max-height:260px;overflow:auto;padding:12px;border:1px solid var(--ui-border);border-radius:var(--ui-radius);background:var(--ui-surface-soft)}.picker-filter-actions{display:flex;justify-content:flex-end;gap:8px;padding-top:10px}.picker-search-settings{display:flex;align-items:center;flex-wrap:wrap;gap:9px;padding:8px 10px;border:1px solid var(--ui-border);border-radius:var(--ui-radius);background:var(--ui-surface-soft);font-size:11px}.picker-search-settings label{display:flex;align-items:center;gap:5px}.picker-search-settings select{border:1px solid var(--ui-border);border-radius:5px;background:var(--ui-surface);color:var(--ui-text);font:inherit}.picker-reference-preview{flex:none;width:48px;height:48px;overflow:hidden;border:0;border-radius:5px;padding:0;background:var(--ui-surface);cursor:zoom-in}.picker-reference-preview img{display:block;width:100%;height:100%;object-fit:cover}.picker-reference>span{flex:1;min-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.picker-reference input[type=range]{width:70px}
@media(max-width:900px){.workspace-columns,.work-grid{grid-template-columns:1fr}.tool-feature-list{grid-template-columns:1fr}}@media(max-width:780px){.workbench-inner{padding:16px;gap:18px}.workspace-heading-row,.next-step{align-items:flex-start;flex-direction:column}}@media(max-width:520px){.workbench-toolbar-heading span{display:none}.tool-hero{padding:20px;gap:12px;flex-wrap:wrap}.tool-hero h1{font-size:22px}.tool-soon{margin-left:auto}.work-card-bottom,.tool-workspace-strip>div{flex-wrap:wrap}}
</style>
