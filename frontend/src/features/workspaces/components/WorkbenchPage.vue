<script setup lang="ts">
import { getErrorMessage } from '@/shared/lib/errorMessage'
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, provide, ref, watch } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import { message, Modal } from 'ant-design-vue'
import {
  AppstoreOutlined,
  ArrowLeftOutlined,
  AudioOutlined,
  PictureOutlined,
  PlusOutlined,
  RobotOutlined,
  SettingOutlined,
  VideoCameraOutlined
} from '@ant-design/icons-vue'
import { chooseLibraryDirectory } from '@/features/media-library/public'
import { setAppFeSetting } from '@/features/application/public'
import {
  deleteWorkspaceArtifact,
  deleteWorkspaceArtifacts,
  listWorkspaceArtifacts,
  syncWorkspaceArtifact,
  type WorkspaceArtifact
} from '@/features/workspaces/api/workspaceArtifacts'
import { resolveMediaPaths } from '@/features/media-library/public'
import MediaLibraryPicker from '@/features/media-library/components/MediaLibraryPicker.vue'
import { batchGetFilesInfo, type FileNodeInfo } from '@/features/media-library/public'
import {
  isAudioFile,
  isVideoFile,
  toImageThumbnailUrl,
  toVideoCoverUrl
} from '@/features/media-library/public'
import { copy2clipboardI18n } from '@/shared/lib/clipboard'
import { openPreviewWithFile } from '@/features/media-preview/public'
import { useApplicationStore } from '@/features/application/public'
import WorkspaceAssetPreview from './WorkspaceAssetPreview.vue'
import WorkspaceMaterialShelf from './WorkspaceMaterialShelf.vue'
import WorkspaceWorksPanel from './WorkspaceWorksPanel.vue'
import WorkProductionDrafts from './WorkProductionDrafts.vue'
import { collectWorkspaceMaterials, collectWorkUsedAssets } from '../model/workspaceMaterialsPool'
import MediaCreationPage from './MediaCreationPage.vue'
import { useWorkspaceWorks } from '../composables/useWorkspaceWorks'
import {
  createWorkspaceWorksRepository,
  createWorkImageDraftRepository,
  draftKindLabel,
  draftTool,
  workspaceWorksKey,
  storageTransaction,
  type WorkspaceWork,
  type ProductionDraft,
  type ProductionKind
} from '../model/workspaceWorks'
import { materialKinds, type AICreationSection } from '../model/workspaceMaterials'
import MediaTypeBadge from '@/features/media-library/components/MediaTypeBadge.vue'
import WorkspaceSourceBadge from '@/features/workspaces/components/WorkspaceSourceBadge.vue'
import { fileDisplayName } from '@/shared/lib/fileDisplayName'
import {
  clearWorkspaceImageDrafts,
  createWorkspaceDraftRepository,
  workspaceImageIndexKey,
  workspaceImageDocumentKey
} from '../model/workspaceDraftRepository'
import {
  reconcileWorkspaceReferences,
  removeWorkspaceAIDrafts,
  removeWorkspaceAssetDrafts
} from '../model/workspaceReferences'
import { useWorkspaceTasks, workspaceTasksKey } from '../model/workspaceTasks'
import AITaskCard from '../../ai-workflows/components/AITaskCard.vue'
import {
  addWorkspaceAssets,
  readWorkspaceRecords,
  type MediaKind,
  type ToolKey,
  type WorkspaceAsset,
  type WorkspaceRecord,
  type WorkspaceStatus
} from '../model/workspaceModel'

defineOptions({ inheritAttrs: false })

const ImageCreationPage = defineAsyncComponent(() => import('./ImageCreationPage.vue'))
const AIWorkflowLibrary = defineAsyncComponent(
  () => import('../../ai-workflows/components/AIWorkflowLibrary.vue')
)

const AICreationPage = defineAsyncComponent(
  () => import('../../ai-workflows/components/AICreationPage.vue')
)

type ToolTab = 'overview' | 'config' | ToolKey
type PickerRole = 'source' | 'output'
const global = useApplicationStore()
const tools = [
  {
    key: 'image',
    title: '图片制作',
    detail: '拼接与多图排版',
    note: '已接入',
    icon: PictureOutlined,
    tone: 'blue',
    features: ['多图拼接', '画布排版', '图片导出']
  },
  {
    key: 'media',
    title: '音视频制作',
    detail: '视频与纯音频作品',
    note: '规划中',
    icon: VideoCameraOutlined,
    tone: 'mint',
    features: ['视频片段截取', '提取画面', '音频与台词整理']
  },
  {
    key: 'ai',
    title: 'AI 创作',
    detail: '为当前作品生成与加工素材',
    note: '已接入',
    icon: RobotOutlined,
    tone: 'amber',
    features: ['图片生成', '图片编辑', '音视频创作']
  }
] as const
const activeTool = ref<ToolTab>('overview')
const aiSection = ref<AICreationSection>('edit')
const aiVisited = ref(false),
  configVisited = ref(false)
const aiPage = ref<InstanceType<typeof AICreationPage>>()
const configPage = ref<InstanceType<typeof AIWorkflowLibrary>>()
const materialController = computed(() =>
  activeTool.value === 'ai' && aiSection.value === 'edit'
    ? aiPage.value?.materialController
    : undefined
)
const showMaterials = computed(
  () => !!currentWorkspace.value && (activeTool.value === 'image' || activeTool.value === 'ai')
)
const allowedMaterialKinds = computed(() =>
  materialKinds(activeTool.value === 'image' ? 'image' : 'ai', aiSection.value)
)
function selectMaterial(asset: WorkspaceAsset, event: MouseEvent) {
  if (materialController.value) materialController.value.select(asset, event)
  else void previewAsset(asset)
}
watch(activeTool, (tool) => {
  if (tool === 'ai') aiVisited.value = true
  if (tool === 'config') configVisited.value = true
})
const records = ref<WorkspaceRecord[]>([])
// Keep an open creation session stable when another browser window opens a different workspace.
const currentWorkspaceId = useLocalStorage('omnigallery:workbench-current-workspace', '', {
  listenToStorageChanges: false
})
const currentWorkspace = computed(() =>
  records.value.find((item) => item.id === currentWorkspaceId.value)
)
const {
  works,
  currentWork,
  currentDraft,
  error: workError,
  refresh: refreshWorks,
  select: selectWork,
  create: createWork,
  createDraft: createWorkDraft,
  selectDraft,
  update: updateWork,
  remove: removeWork
} = useWorkspaceWorks(
  () => currentWorkspace.value?.id,
  () => !!global.conf?.is_readonly
)
const imagePage = ref<InstanceType<typeof ImageCreationPage>>()
const imageOpenRequest = ref(0)
const requestedDraftId = ref('')
const { tasks: backgroundTasks, error: taskError } = useWorkspaceTasks(
  () => currentWorkspace.value?.id
)
provide(workspaceTasksKey, backgroundTasks)
const pendingTasks = computed(() =>
  backgroundTasks.value.filter((task) => task.state !== 'completed')
)
const activeCount = computed(() => records.value.filter((item) => item.status === 'active').length)
const pausedCount = computed(() => records.value.length - activeCount.value)
const view = ref<WorkspaceStatus>('active')
const visibleRecords = computed(() =>
  records.value
    .filter((item) => item.status === view.value)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
)
const saving = ref(false)
let restored = false
let referenceLoad = 0
onBeforeUnmount(() => {
  referenceLoad++
  previewRequest++
})
watch(
  () => global.conf?.app_fe_setting?.workbench_projects,
  async (value) => {
    const request = ++referenceLoad
    if (!global.conf) return
    let next = readWorkspaceRecords(value)
    const ids = next
      .flatMap((workspace) => [...workspace.assets, ...workspace.outputs])
      .flatMap((asset) => (asset.id === undefined ? [] : [asset.id]))
    try {
      const media = await resolveMediaPaths(ids)
      if (request !== referenceLoad) return
      next = reconcileWorkspaceReferences(next, media, localStorage)
    } catch {
      if (request !== referenceLoad) return
      message.warning('素材引用更新失败，请刷新工作台重试')
    }
    records.value = next
    if (!restored && global.conf) {
      restored = true
      if (!records.value.some((item) => item.id === currentWorkspaceId.value))
        currentWorkspaceId.value = ''
    }
  },
  { immediate: true }
)

function updatedLabel(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}
function toolLabel(key: ToolKey) {
  return tools.find((tool) => tool.key === key)?.title ?? '图片制作'
}
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
  } finally {
    saving.value = false
  }
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
  if (!name) {
    message.warning('请填写工作区名称')
    return
  }
  const now = new Date().toISOString()
  let next: WorkspaceRecord[]
  if (editingId.value) {
    next = records.value.map((item) =>
      item.id === editingId.value
        ? { ...item, name, brief: draftBrief.value.trim(), updatedAt: now }
        : item
    )
  } else {
    if (records.value.length >= 100) {
      message.warning('工作区数量已达到上限')
      return
    }
    next = [
      {
        id: crypto.randomUUID(),
        name,
        brief: draftBrief.value.trim(),
        status: 'active',
        createdAt: now,
        updatedAt: now,
        lastTool: 'image',
        assets: [],
        outputs: [],
        notes: {}
      },
      ...records.value
    ]
  }
  if (await saveRecords(next)) {
    dialogOpen.value = false
    if (!editingId.value) view.value = 'active'
  }
}
async function openWorkspace(item: WorkspaceRecord) {
  if (item.status === 'paused' && !global.conf?.is_readonly) {
    const next = records.value.map((row) =>
      row.id === item.id
        ? { ...row, status: 'active' as const, updatedAt: new Date().toISOString() }
        : row
    )
    if (!(await saveRecords(next))) return
  }
  currentWorkspaceId.value = item.id
  activeTool.value = 'overview'
}
async function backToList() {
  if (!(await leaveAISession())) return
  if (activeTool.value === 'config' && configPage.value && !(await configPage.value.confirmLeave()))
    return
  currentWorkspaceId.value = ''
  activeTool.value = 'overview'
}
async function toggleStatus(item: WorkspaceRecord) {
  const status: WorkspaceStatus = item.status === 'active' ? 'paused' : 'active'
  const next = records.value.map((row) =>
    row.id === item.id ? { ...row, status, updatedAt: new Date().toISOString() } : row
  )
  if (await saveRecords(next))
    message.success(status === 'paused' ? '已搁置工作区' : '已恢复工作区')
}
function confirmRemove(item: WorkspaceRecord) {
  Modal.confirm({
    title: '删除这项工作区？',
    content:
      '会一并删除工作区记录、作品及本机草稿、笔记和工作区创建的素材；引用及已同步到媒体库的文件不会删除。',
    okText: '删除',
    cancelText: '取消',
    okType: 'danger',
    onOk: async () => {
      if (!(await saveRecords(records.value.filter((row) => row.id !== item.id))))
        throw new Error('保存失败')
      if (currentWorkspaceId.value === item.id) await backToList()
      await nextTick()
      try {
        clearWorkspaceImageDrafts(item.id)
        createWorkspaceWorksRepository(item.id, localStorage).clear()
        removeWorkspaceAIDrafts(localStorage, item.id)
      } catch {
        message.warning('工作区已删除，但本机草稿清理失败')
      }
      try {
        await deleteWorkspaceArtifacts(item.id)
      } catch {
        message.warning('工作区已删除，但清理其创建的素材失败')
      }
    }
  })
}
async function activateTool(key: ToolTab) {
  if (key === activeTool.value) return
  if (activeTool.value === 'ai' && !(await leaveAISession())) return
  if (activeTool.value === 'config' && configPage.value && !(await configPage.value.confirmLeave()))
    return
  activeTool.value = key
  if (
    currentWork.value &&
    key !== 'overview' &&
    key !== 'config' &&
    currentWork.value.lastTool !== key
  )
    updateWork({ ...currentWork.value, lastTool: key })
  const item = currentWorkspace.value
  if (
    !item ||
    key === 'overview' ||
    key === 'config' ||
    item.lastTool === key ||
    global.conf?.is_readonly
  )
    return
  await saveRecords(
    records.value.map((row) =>
      row.id === item.id ? { ...row, lastTool: key, updatedAt: new Date().toISOString() } : row
    )
  )
}
async function moveToolTab(event: KeyboardEvent) {
  const keys: ToolTab[] = ['overview', ...tools.map((tool) => tool.key), 'config']
  const current = keys.indexOf(activeTool.value)
  const next =
    event.key === 'ArrowRight'
      ? (current + 1) % keys.length
      : event.key === 'ArrowLeft'
        ? (current - 1 + keys.length) % keys.length
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? keys.length - 1
            : -1
  if (next < 0) return
  event.preventDefault()
  await activateTool(keys[next])
  await nextTick()
  document.getElementById('workbench-tab-' + keys[next])?.focus()
}

const pickerOpen = ref(false)
const pickerRole = ref<PickerRole>('source')
const pickerWorkId = ref('')
function openPicker(role: PickerRole) {
  pickerRole.value = role
  pickerWorkId.value =
    role === 'output' &&
    currentWork.value &&
    (workDetailOpen.value || activeTool.value !== 'overview')
      ? currentWork.value.id
      : ''
  pickerOpen.value = true
}
function toAsset(file: FileNodeInfo): WorkspaceAsset {
  return {
    ...(typeof file.id === 'number' ? { id: file.id } : {}),
    path: file.fullpath,
    name: file.name,
    kind: isAudioFile(file.name) ? 'audio' : isVideoFile(file.name) ? 'video' : 'image'
  }
}
async function addPicked(files: FileNodeInfo[]) {
  const workspace = currentWorkspace.value
  if (!workspace || !files.length) return
  const incoming = files.map(toAsset)
  const updated = {
    ...workspace,
    assets: addWorkspaceAssets(workspace.assets, incoming),
    updatedAt: new Date().toISOString()
  }
  if (await saveRecords(records.value.map((row) => (row.id === workspace.id ? updated : row)))) {
    const work = works.value.find((item) => item.id === pickerWorkId.value)
    if (work && !updateWork({ ...work, outputs: addWorkspaceAssets(work.outputs, incoming) }))
      return
    pickerOpen.value = false
  }
}
async function importStudioImage(file: FileNodeInfo) {
  const workspace = currentWorkspace.value
  if (!workspace || global.conf?.is_readonly) return false
  if (workspace.assets.some((asset) => asset.path === file.fullpath)) {
    mediaAssetInfo.value = { ...mediaAssetInfo.value, [file.fullpath]: file }
    return true
  }
  const assets = addWorkspaceAssets(workspace.assets, [toAsset(file)])
  if (!assets.some((asset) => asset.path === file.fullpath)) {
    message.warning('工作区素材已达上限，请先移除部分素材')
    return false
  }
  const updated = { ...workspace, assets, updatedAt: new Date().toISOString() }
  if (!(await saveRecords(records.value.map((row) => (row.id === workspace.id ? updated : row)))))
    return false
  if (currentWorkspace.value?.id !== workspace.id) return false
  mediaAssetInfo.value = { ...mediaAssetInfo.value, [file.fullpath]: file }
  return true
}
async function removeAsset(role: PickerRole, path: string) {
  const workspace = currentWorkspace.value
  if (!workspace || global.conf?.is_readonly) return
  const updated = {
    ...workspace,
    assets: workspace.assets.filter((item) => item.path !== path),
    outputs: workspace.outputs.filter((item) => item.path !== path),
    updatedAt: new Date().toISOString()
  }
  if (!(await saveRecords(records.value.map((row) => (row.id === workspace.id ? updated : row)))))
    return
  if (role === 'source' && currentWorkspace.value?.id === workspace.id)
    for (const work of works.value.filter((work) =>
      work.assets.some((asset) => asset.path === path)
    ))
      if (!updateWork({ ...work, assets: work.assets.filter((asset) => asset.path !== path) }))
        break
}
const mediaAssetInfo = ref<Record<string, FileNodeInfo>>({})
const createdArtifacts = ref<WorkspaceArtifact[]>([])
const visibleArtifactCount = ref(60)
const createdAssets = computed<WorkspaceAsset[]>(() =>
  createdArtifacts.value.map((item) => ({
    path: `workspace-artifact:${item.id}`,
    name: item.name,
    kind: item.kind
  }))
)
const workspaceMaterials = computed(() =>
  collectWorkspaceMaterials(
    currentWorkspace.value ?? { assets: [], outputs: [] },
    works.value,
    createdAssets.value
  )
)
const workUsedAssets = computed(() =>
  Object.fromEntries(
    works.value.map((work) => [
      work.id,
      collectWorkUsedAssets(
        currentWorkspace.value?.id ?? '',
        work,
        localStorage,
        workspaceMaterials.value
      )
    ])
  )
)
const currentUsedAssets = computed(() => workUsedAssets.value[currentWork.value?.id ?? ''] ?? [])
const studioAssets = computed(() => [
  ...new Map(
    [...workspaceMaterials.value, ...Object.values(workUsedAssets.value).flat()].map((asset) => [
      asset.path,
      asset
    ])
  ).values()
])
const workspaceSourceAssets = computed(() =>
  workspaceMaterials.value.filter((asset) => !asset.path.startsWith('workspace-artifact:'))
)
const aiWorkspace = computed(
  () =>
    currentWorkspace.value && {
      ...currentWorkspace.value,
      assets: studioAssets.value
    }
)
const assetInfo = computed<Record<string, FileNodeInfo>>(() => {
  const result = { ...mediaAssetInfo.value }
  for (const item of createdArtifacts.value) {
    const path = `workspace-artifact:${item.id}`
    result[path] = {
      workspace_artifact_id: item.id,
      workspace_artifact_source: item.source,
      fullpath: path,
      name: item.name,
      type: 'file',
      size: `${Math.round(item.bytes / 1024)} KB`,
      bytes: item.bytes,
      date: item.created_at,
      created_time: item.created_at,
      is_under_scanned_path: false,
      width: item.width,
      height: item.height
    }
  }
  return result
})
let artifactRequest = 0
async function refreshArtifacts() {
  const id = currentWorkspace.value?.id
  const request = ++artifactRequest
  if (!id) {
    createdArtifacts.value = []
    return
  }
  try {
    const result = await listWorkspaceArtifacts(id)
    if (request === artifactRequest) createdArtifacts.value = result
  } catch {
    if (request === artifactRequest) createdArtifacts.value = []
  }
}
watch(
  () => currentWorkspace.value?.id,
  () => {
    visibleArtifactCount.value = 60
    createdArtifacts.value = []
    void refreshArtifacts()
  },
  { immediate: true }
)
watch(
  () =>
    backgroundTasks.value
      .filter((task) => task.state === 'completed')
      .map((task) => task.artifact_id)
      .join(','),
  () => {
    void refreshArtifacts()
  }
)
async function removeCreatedArtifact(item: WorkspaceArtifact) {
  Modal.confirm({
    title: '删除这项素材？',
    content: '会从当前工作区永久删除该文件。已同步到媒体库的副本会保留。',
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      try {
        await deleteWorkspaceArtifact(item.id)
        try {
          removeWorkspaceAssetDrafts(
            localStorage,
            item.workspace_id,
            `workspace-artifact:${item.id}`
          )
        } catch {
          message.warning('素材已删除，但本机编辑草稿清理失败')
        }
        await refreshArtifacts()
        message.success('素材已删除')
      } catch {
        message.error('删除素材失败')
      }
    }
  })
}
async function syncCreatedArtifact(item: WorkspaceArtifact) {
  try {
    const directory = await chooseLibraryDirectory()
    if (!directory) return
    await syncWorkspaceArtifact(item.id, directory)
    message.success('已同步到媒体库')
  } catch (error) {
    message.error(getErrorMessage(error, '同步到媒体库失败'))
  }
}
const brokenThumbs = ref(new Set<string>())
const assetPaths = computed(() =>
  studioAssets.value
    .filter((asset) => !asset.path.startsWith('workspace-artifact:'))
    .map((asset) => asset.path)
)
let assetInfoRequest = 0
watch(
  assetPaths,
  async (paths) => {
    const request = ++assetInfoRequest
    if (!paths.length) {
      mediaAssetInfo.value = {}
      return
    }
    try {
      const result = await batchGetFilesInfo([...new Set(paths)])
      if (request === assetInfoRequest) mediaAssetInfo.value = result
    } catch {
      if (request === assetInfoRequest) mediaAssetInfo.value = {}
    }
  },
  { immediate: true }
)
function thumbnailFor(asset: WorkspaceAsset) {
  const info = assetInfo.value[asset.path]
  if (!info || brokenThumbs.value.has(asset.path)) return ''
  return asset.kind === 'image'
    ? toImageThumbnailUrl(info, '160x160')
    : asset.kind === 'video'
      ? toVideoCoverUrl(info)
      : ''
}
function thumbnailFailed(path: string) {
  brokenThumbs.value = new Set([...brokenThumbs.value, path])
}
const assetPreview = ref<FileNodeInfo>()
const previewSyncing = ref(false)
async function syncPreviewArtifact() {
  const artifact = previewArtifact.value
  if (!artifact || previewSyncing.value) return
  previewSyncing.value = true
  try {
    await syncCreatedArtifact(artifact)
  } finally {
    previewSyncing.value = false
  }
}
const previewArtifact = computed(() =>
  createdArtifacts.value.find((item) => item.id === assetPreview.value?.workspace_artifact_id)
)
let previewRequest = 0
let previewTrigger: HTMLElement | null = null
watch([() => currentWorkspace.value?.id, activeTool], () => {
  previewRequest++
  assetPreview.value = undefined
})
function closeAssetPreview() {
  previewRequest++
  assetPreview.value = undefined
  void nextTick(() => previewTrigger?.isConnected && previewTrigger.focus({ preventScroll: true }))
}
async function previewAsset(asset: WorkspaceAsset) {
  const request = ++previewRequest
  previewTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  let info = assetInfo.value[asset.path]
  if (!info) {
    try {
      info = (await batchGetFilesInfo([asset.path]))[asset.path]
    } catch {
      /* The warning below covers unavailable files. */
    }
  }
  if (request !== previewRequest) return
  if (!info || info.type !== 'file') {
    message.warning('原文件暂时不可用')
    return
  }
  assetPreview.value = info
}

const workDetailOpen = ref(false)
const workDetailTab = ref<'drafts' | 'outputs'>('drafts')
const currentToolDraft = computed(() =>
  currentDraft.value && draftTool(currentDraft.value.kind) === activeTool.value
    ? currentDraft.value
    : undefined
)
const noteDraft = ref('')
const imageNoteDirty = computed(() => noteDraft.value !== (currentToolDraft.value?.brief ?? ''))
watch(
  [() => currentToolDraft.value?.id, () => currentToolDraft.value?.brief],
  () => {
    noteDraft.value = currentToolDraft.value?.brief ?? ''
  },
  { immediate: true }
)
async function saveToolNote() {
  if (!currentWork.value || !currentToolDraft.value || global.conf?.is_readonly) return
  if (
    updateWork({
      ...currentWork.value,
      drafts: currentWork.value.drafts.map((draft) =>
        draft.id === currentToolDraft.value?.id
          ? { ...draft, brief: noteDraft.value.slice(0, 5000) }
          : draft
      )
    })
  )
    message.success('草稿笔记已保存')
}
const workDialogOpen = ref(false),
  editingWorkId = ref(''),
  workName = ref(''),
  workBrief = ref('')
const productionDialogOpen = ref(false),
  editingProductionId = ref(''),
  productionName = ref(''),
  productionBrief = ref(''),
  productionKind = ref<ProductionKind>('image')
const assetChoiceOpen = ref(false),
  assetChoiceWorkId = ref(''),
  assetChoicePaths = ref<string[]>([])
const workKindLabel = (kind: MediaKind) => ({ image: '图片', video: '视频', audio: '音频' })[kind]
function showNewWork() {
  if (!currentWorkspace.value || global.conf?.is_readonly) return
  editingWorkId.value = ''
  workName.value = ''
  workBrief.value = ''
  workDialogOpen.value = true
}
function showWorkInfo(work: WorkspaceWork) {
  editingWorkId.value = work.id
  workName.value = work.name
  workBrief.value = work.brief
  workDialogOpen.value = true
}
async function leaveAISession() {
  const saved = !aiPage.value || (await aiPage.value.saveBeforeLeave())
  if (saved) refreshWorks()
  return saved
}
async function openWork(work: WorkspaceWork, entry?: ToolKey) {
  if (work.id !== currentWork.value?.id && !(await leaveAISession())) return
  if (!selectWork(work.id)) return
  workDetailOpen.value = true
  workDetailTab.value = 'drafts'
  if (!entry) {
    await activateTool('overview')
    return
  }
  const draft = work.drafts.find(
    (item) => item.id === work.activeDraftId && draftTool(item.kind) === entry
  )
  if (draft) await openDraft(draft)
  else await activateTool(entry)
}
async function selectWorkEntry(id: string) {
  const work = works.value.find((item) => item.id === id)
  if (work && (id === currentWork.value?.id || (await leaveAISession()))) selectWork(id)
}
async function openDraft(draft: ProductionDraft) {
  const work = currentWork.value
  if (!work || !work.drafts.some((item) => item.id === draft.id)) return
  if (draft.id !== currentDraft.value?.id && !(await leaveAISession())) return
  if (!selectDraft(work, draft)) return
  await activateTool(draftTool(draft.kind))
  if (draft.kind === 'image' && activeTool.value === 'image') {
    requestedDraftId.value = draft.id
    imageOpenRequest.value++
  }
}
function imageOpened(id: string) {
  const workId = currentWork.value?.id
  refreshWorks()
  const work = works.value.find((item) => item.id === workId)
  const draft = work?.drafts.find((item) => item.id === id)
  if (work && draft && work.activeDraftId !== id) selectDraft(work, draft)
}
async function saveWorkDialog() {
  if (!currentWorkspace.value || global.conf?.is_readonly) return
  const name = workName.value.trim()
  if (!name) {
    message.warning('请填写作品名称')
    return
  }
  if (editingWorkId.value) {
    const work = works.value.find((item) => item.id === editingWorkId.value)
    if (work && updateWork({ ...work, name, brief: workBrief.value.trim() }))
      workDialogOpen.value = false
  } else {
    if (!(await leaveAISession())) return
    const work = createWork(name, workBrief.value.trim())
    if (!work) {
      if (!workError.value) message.warning('作品数量已达到上限')
      return
    }
    workDialogOpen.value = false
    await openWork(work)
  }
}
function showNewDraft(kind: ProductionKind) {
  if (!currentWork.value || global.conf?.is_readonly) return
  editingProductionId.value = ''
  productionKind.value = kind
  productionName.value = ''
  productionBrief.value = ''
  productionDialogOpen.value = true
}
function showDraftInfo(draft: ProductionDraft) {
  editingProductionId.value = draft.id
  productionKind.value = draft.kind
  productionName.value = draft.name
  productionBrief.value = draft.brief
  productionDialogOpen.value = true
}
async function saveDraftDialog() {
  const work = currentWork.value,
    workspaceId = currentWorkspace.value?.id
  if (!work || !workspaceId || global.conf?.is_readonly || !productionName.value.trim()) return
  const name = productionName.value.trim(),
    brief = productionBrief.value.trim()
  if (editingProductionId.value) {
    const draft = work.drafts.find((item) => item.id === editingProductionId.value)
    if (!draft) return
    try {
      storageTransaction(
        localStorage,
        [
          workspaceWorksKey(workspaceId),
          workspaceImageIndexKey(workspaceId),
          workspaceImageDocumentKey(workspaceId, draft.id)
        ],
        () => {
          if (draft.kind === 'image')
            createWorkspaceDraftRepository(workspaceId, localStorage).rename(draft.id, name)
          if (
            !updateWork({
              ...work,
              drafts: work.drafts.map((item) =>
                item.id === draft.id
                  ? { ...item, name, brief, updatedAt: new Date().toISOString() }
                  : item
              )
            })
          )
            throw new Error('保存失败')
        }
      )
      refreshWorks()
      imagePage.value?.loadDrafts()
      productionDialogOpen.value = false
    } catch {
      refreshWorks()
      message.error('草稿信息保存失败')
    }
    return
  }
  if (!(await leaveAISession())) return
  const draft = createWorkDraft(work, productionKind.value, name, brief)
  if (!draft) {
    if (!workError.value) message.warning('草稿数量已达到上限')
    return
  }
  productionDialogOpen.value = false
  imagePage.value?.loadDrafts()
  await openDraft(draft)
}
function confirmRemoveDraft(draft: ProductionDraft) {
  const work = currentWork.value,
    workspaceId = currentWorkspace.value?.id
  if (!work || !workspaceId || global.conf?.is_readonly) return
  Modal.confirm({
    title: `删除草稿“${draft.name}”？`,
    content: '会删除这份本机制作草稿。作品、原素材和已保存的成果会保留。',
    okText: '删除草稿',
    cancelText: '取消',
    okType: 'danger',
    async onOk() {
      if (currentWork.value?.id !== work.id || !(await leaveAISession()))
        throw new Error('未删除草稿')
      if (draft.kind === 'image')
        createWorkImageDraftRepository(workspaceId, work.id, localStorage).remove(draft.id)
      else {
        if (
          !updateWork({
            ...work,
            drafts: work.drafts.filter((item) => item.id !== draft.id),
            activeDraftId: work.activeDraftId === draft.id ? '' : work.activeDraftId
          })
        )
          throw new Error('删除失败')
        if (draft.kind === 'ai')
          removeWorkspaceAIDrafts(localStorage, `${workspaceId}:${work.id}:${draft.id}`)
      }
      refreshWorks()
      imagePage.value?.loadDrafts()
    }
  })
}
function confirmRemoveWork(work: WorkspaceWork) {
  const workspaceId = currentWorkspace.value?.id
  if (!workspaceId || global.conf?.is_readonly) return
  Modal.confirm({
    title: `删除作品“${work.name}”？`,
    content: '会删除此作品和其中所有本机制作草稿。引用的媒体和已保存的成果文件不会删除。',
    okText: '删除作品',
    cancelText: '取消',
    okType: 'danger',
    async onOk() {
      if (currentWorkspace.value?.id !== workspaceId || !(await leaveAISession()))
        throw new Error('未删除作品')
      const imageIds = work.drafts
        .filter((draft) => draft.kind === 'image')
        .map((draft) => draft.id)
      storageTransaction(
        localStorage,
        [
          workspaceWorksKey(workspaceId),
          workspaceImageIndexKey(workspaceId),
          ...imageIds.map((id) => workspaceImageDocumentKey(workspaceId, id))
        ],
        () => {
          for (const id of imageIds)
            createWorkspaceDraftRepository(workspaceId, localStorage).deleteEntry(id)
          if (!removeWork(work)) throw new Error('作品记录删除失败')
        }
      )
      for (const draft of work.drafts.filter((item) => item.kind === 'ai'))
        removeWorkspaceAIDrafts(localStorage, `${workspaceId}:${work.id}:${draft.id}`)
      refreshWorks()
      imagePage.value?.loadDrafts()
    }
  })
}
function chooseWorkOutputs() {
  if (!currentWork.value || global.conf?.is_readonly) return
  assetChoiceWorkId.value = currentWork.value.id
  assetChoicePaths.value = currentWork.value.outputs.map((asset) => asset.path)
  assetChoiceOpen.value = true
}
const workAssetChoices = computed(() => [
  ...new Map(
    [
      ...studioAssets.value,
      ...(currentWorkspace.value?.outputs ?? []),
      ...(works.value.find((item) => item.id === assetChoiceWorkId.value)?.outputs ?? [])
    ].map((asset) => [asset.path, asset])
  ).values()
])
function toggleWorkAsset(path: string) {
  assetChoicePaths.value = assetChoicePaths.value.includes(path)
    ? assetChoicePaths.value.filter((item) => item !== path)
    : [...assetChoicePaths.value, path]
}
function saveWorkOutputs() {
  const work = works.value.find((item) => item.id === assetChoiceWorkId.value)
  if (!work || global.conf?.is_readonly) return
  const selected = new Set(assetChoicePaths.value)
  if (
    updateWork({
      ...work,
      outputs: workAssetChoices.value.filter((asset) => selected.has(asset.path))
    })
  )
    assetChoiceOpen.value = false
}
function removeWorkOutput(path: string) {
  if (currentWork.value)
    updateWork({
      ...currentWork.value,
      outputs: currentWork.value.outputs.filter((asset) => asset.path !== path)
    })
}
watch(
  () => currentWorkspace.value?.id,
  () => {
    workDialogOpen.value = false
    assetChoiceOpen.value = false
    productionDialogOpen.value = false
    requestedDraftId.value = ''
    imageOpenRequest.value = 0
    workDetailOpen.value = false
  }
)
</script>

<template>
  <div class="workbench-page workspace-pane">
    <Teleport to="#workbench-header-slot">
      <div class="workbench-toolbar">
        <div class="workbench-toolbar-heading">
          <strong>{{ currentWorkspace ? `当前工作区：${currentWorkspace.name}` : '工作台' }}</strong
          ><span>{{ currentWorkspace ? '作品 · 素材 · 成果' : '按项目管理创作' }}</span>
        </div>
        <nav
          class="workbench-tool-tabs"
          role="tablist"
          aria-label="工作台页面"
          @keydown="moveToolTab"
        >
          <button
            id="workbench-tab-overview"
            type="button"
            role="tab"
            :aria-selected="activeTool === 'overview'"
            aria-controls="workbench-panel-overview"
            :tabindex="activeTool === 'overview' ? 0 : -1"
            :class="{ active: activeTool === 'overview' }"
            @click="activateTool('overview')"
          >
            <AppstoreOutlined />工作区
          </button>
          <button
            v-for="tool in tools"
            :id="'workbench-tab-' + tool.key"
            :key="tool.key"
            type="button"
            role="tab"
            :aria-selected="activeTool === tool.key"
            :aria-controls="'workbench-panel-' + tool.key"
            :tabindex="activeTool === tool.key ? 0 : -1"
            :class="{ active: activeTool === tool.key }"
            @click="activateTool(tool.key)"
          >
            <component :is="tool.icon" />{{ tool.title }}
          </button>
          <button
            id="workbench-tab-config"
            type="button"
            role="tab"
            :aria-selected="activeTool === 'config'"
            aria-controls="workbench-panel-config"
            :tabindex="activeTool === 'config' ? 0 : -1"
            :class="{ active: activeTool === 'config' }"
            @click="activateTool('config')"
          >
            <SettingOutlined />工具配置
          </button>
        </nav>
      </div>
    </Teleport>
    <p v-if="taskError" class="task-update-error" role="status">{{ taskError }}</p>
    <p v-if="workError" class="work-storage-error" role="alert">
      {{ workError }} <a-button size="small" @click="refreshWorks">重试</a-button>
    </p>
    <section
      v-if="currentWorkspace && ['image', 'media', 'ai'].includes(activeTool)"
      class="current-work-bar"
      aria-label="当前作品"
    >
      <div class="current-work-copy">
        <small>当前作品</small
        ><a-select
          :value="currentWork?.id"
          placeholder="选择作品"
          aria-label="选择当前作品"
          :options="
            works.map((work) => ({
              value: work.id,
              label: work.name
            }))
          "
          @change="selectWorkEntry(String($event))"
        />
      </div>
      <span v-if="currentWork" class="work-context-summary"
        >{{ currentWork.drafts.length }} 份草稿 · {{ currentWork.outputs.length }} 份成果</span
      >
      <div class="current-work-actions">
        <a-button v-if="currentWork" @click="openWork(currentWork)">作品总览</a-button>
        <a-button
          v-if="currentWork"
          :disabled="global.conf?.is_readonly"
          @click="showWorkInfo(currentWork)"
          >作品信息</a-button
        >
        <a-button
          v-if="currentWork"
          :disabled="global.conf?.is_readonly"
          @click="chooseWorkOutputs()"
          >选择成果</a-button
        >
        <a-button :disabled="global.conf?.is_readonly" @click="showNewWork()"
          ><PlusOutlined />新建作品</a-button
        >
      </div>
    </section>
    <div
      v-if="pendingTasks.length && !showMaterials && activeTool !== 'config'"
      class="workspace-task-list"
      aria-label="后台加工任务"
    >
      <AITaskCard v-for="task in pendingTasks" :key="task.id" :task="task" />
    </div>

    <div v-if="showMaterials" class="workbench-materials">
      <WorkspaceMaterialShelf
        :context-key="`${currentWorkspace?.id}:${currentWork?.id}:${activeTool}:${aiSection}`"
        :assets="studioAssets"
        :asset-info="assetInfo"
        :allowed-kinds="allowedMaterialKinds"
        :tasks="pendingTasks"
        :readonly="global.conf?.is_readonly"
        @select="previewAsset"
        @add="openPicker('source')"
      />
    </div>
    <div
      v-if="activeTool === 'overview'"
      id="workbench-panel-overview"
      class="workbench-inner"
      role="tabpanel"
      aria-labelledby="workbench-tab-overview"
    >
      <template v-if="currentWorkspace">
        <section v-if="!workDetailOpen || !currentWork" class="workspace-heading">
          <button class="back-link" type="button" @click="backToList">
            <ArrowLeftOutlined />全部工作区
          </button>
          <div class="workspace-heading-row">
            <div>
              <span class="workspace-kicker"
                >创作任务 · {{ updatedLabel(currentWorkspace.updatedAt) }} 更新</span
              >
              <h1>{{ currentWorkspace.name }}</h1>
              <p v-if="currentWorkspace.brief">{{ currentWorkspace.brief }}</p>
            </div>
            <div class="workspace-heading-actions">
              <a-button
                v-if="currentWork"
                type="primary"
                @click="openWork(currentWork, currentWork.lastTool)"
                >继续上次作品</a-button
              ><a-button :disabled="global.conf?.is_readonly" @click="showEdit(currentWorkspace)"
                >修改名称与目标</a-button
              >
            </div>
          </div>
        </section>
        <details
          v-if="!workDetailOpen && Object.values(currentWorkspace.notes).some((note) => !!note)"
          class="workspace-project-notes"
        >
          <summary>工作区笔记</summary>
          <section v-for="(note, tool) in currentWorkspace.notes" v-show="note" :key="tool">
            <strong>{{ toolLabel(tool) }}</strong>
            <p>{{ note }}</p>
          </section>
        </details>
        <WorkspaceWorksPanel
          v-if="!workDetailOpen || !currentWork"
          :works="works"
          :active-id="currentWork?.id"
          :asset-info="assetInfo"
          :readonly="global.conf?.is_readonly || !!workError"
          @create="showNewWork"
          @open="openWork"
          @rename="showWorkInfo"
          @remove="confirmRemoveWork"
        />
        <template v-if="workDetailOpen && currentWork">
          <section class="business-work-heading">
            <button type="button" class="back-link" @click="workDetailOpen = false">
              <ArrowLeftOutlined />{{ currentWorkspace.name }} / 全部作品
            </button>
            <div class="workspace-heading-row">
              <div>
                <span class="workspace-kicker">作品</span>
                <h1>{{ currentWork.name }}</h1>
                <p v-if="currentWork.brief">{{ currentWork.brief }}</p>
              </div>
              <a-button :disabled="global.conf?.is_readonly" @click="showWorkInfo(currentWork)"
                >修改名称与目标</a-button
              >
            </div>
            <nav class="business-work-tabs" aria-label="作品内容">
              <button
                type="button"
                :class="{ active: workDetailTab === 'drafts' }"
                @click="workDetailTab = 'drafts'"
              >
                制作草稿 <small>{{ currentWork.drafts.length }}</small></button
              ><button
                type="button"
                :class="{ active: workDetailTab === 'outputs' }"
                @click="workDetailTab = 'outputs'"
              >
                成果 <small>{{ currentWork.outputs.length }}</small>
              </button>
            </nav>
          </section>
          <WorkProductionDrafts
            v-if="workDetailTab === 'drafts'"
            :workspace-id="currentWorkspace.id"
            :drafts="currentWork.drafts"
            :active-id="currentWork.activeDraftId"
            :asset-info="assetInfo"
            :artifacts="createdArtifacts"
            :readonly="global.conf?.is_readonly || !!workError"
            :busy-id="imagePage?.publishingId"
            @create="showNewDraft"
            @open="openDraft"
            @rename="showDraftInfo"
            @remove="confirmRemoveDraft"
            @publish="(draft, sync) => imagePage?.publishDraft(draft.id, sync)"
          />
          <section v-else class="work-section business-files">
            <div class="section-heading">
              <h2>作品成果</h2>
              <div class="business-file-actions">
                <a-button :disabled="global.conf?.is_readonly" @click="chooseWorkOutputs()"
                  >从工作区选择</a-button
                ><a-button :disabled="global.conf?.is_readonly" @click="openPicker('output')"
                  ><PlusOutlined />从媒体库加入</a-button
                >
              </div>
            </div>
            <p class="work-choice-hint">选定用于交付或展示的结果，可保留多个版本。</p>
            <div v-if="currentWork.outputs.length" class="business-file-grid">
              <article v-for="asset in currentWork.outputs" :key="asset.path">
                <button
                  type="button"
                  class="business-file-entry"
                  :aria-label="`预览：${asset.name}`"
                  @click="previewAsset(asset)"
                >
                  <span
                    ><img
                      v-if="thumbnailFor(asset)"
                      :src="thumbnailFor(asset)"
                      alt="" /><AudioOutlined v-else-if="asset.kind === 'audio'" /><PictureOutlined
                      v-else /><MediaTypeBadge :kind="asset.kind" compact /></span
                  ><strong>{{ asset.name }}</strong>
                </button>
                <a-dropdown :trigger="['click', 'contextmenu']"
                  ><a-button type="text" size="small" :aria-label="`文件操作：${asset.name}`"
                    >···</a-button
                  ><template #overlay
                    ><a-menu
                      ><a-menu-item @click="previewAsset(asset)">预览文件</a-menu-item
                      ><a-menu-item @click="copy2clipboardI18n(asset.path)"
                        >复制文件路径</a-menu-item
                      ><a-menu-divider /><a-menu-item
                        :disabled="global.conf?.is_readonly"
                        @click="removeWorkOutput(asset.path)"
                        >移出成果</a-menu-item
                      ></a-menu
                    ></template
                  ></a-dropdown
                >
              </article>
            </div>
            <div v-else class="asset-empty">
              还没有选定成果。可从工作区产物或媒体库已有文件中选择。
            </div>
          </section>
          <details :key="currentWork.id" class="work-used-materials">
            <summary>
              已使用素材 <small>{{ currentUsedAssets.length }}</small>
            </summary>
            <div v-if="currentUsedAssets.length" class="used-material-list">
              <div v-for="asset in currentUsedAssets" :key="asset.path" class="used-material-row">
                <button
                  type="button"
                  :aria-label="`预览已使用素材：${asset.name}`"
                  @click="previewAsset(asset)"
                >
                  <span class="asset-thumb"
                    ><img
                      v-if="thumbnailFor(asset)"
                      :src="thumbnailFor(asset)"
                      alt="" /><PictureOutlined v-else
                  /></span>
                  <strong>{{ asset.name }}</strong>
                </button>
                <small>{{ asset.drafts.map((draft) => draft.name).join(' · ') }}</small>
              </div>
            </div>
            <p v-else class="asset-empty">草稿使用的素材会自动记录在这里。</p>
          </details>
        </template>
        <div v-if="!workDetailOpen || !currentWork" class="workspace-columns">
          <section class="work-section asset-panel material-panel">
            <div class="section-heading">
              <div>
                <h2>工作区素材</h2>
                <p>供不同作品引用。</p>
              </div>
            </div>
            <div class="material-sources">
              <div class="material-source">
                <div class="material-source-heading">
                  <div>
                    <strong>引用</strong
                    ><span class="asset-count">{{ workspaceSourceAssets.length }}</span>
                  </div>
                  <a-button :disabled="global.conf?.is_readonly" @click="openPicker('source')"
                    ><PlusOutlined />从媒体库加入</a-button
                  >
                </div>
                <div v-if="workspaceSourceAssets.length" class="asset-list">
                  <a-dropdown
                    v-for="asset in workspaceSourceAssets"
                    :key="asset.path"
                    :trigger="['contextmenu']"
                  >
                    <button
                      type="button"
                      class="asset-row"
                      :title="`预览：${fileDisplayName(asset.name)}（右键查看更多操作）`"
                      @click="previewAsset(asset)"
                    >
                      <span class="asset-thumb"
                        ><img
                          v-if="thumbnailFor(asset)"
                          :src="thumbnailFor(asset)"
                          alt=""
                          @error="thumbnailFailed(asset.path)" /><AudioOutlined
                          v-else-if="asset.kind === 'audio'" /><PictureOutlined
                          v-else /><MediaTypeBadge :kind="asset.kind" compact
                      /></span>
                      <span class="asset-row-copy"
                        ><strong>{{ fileDisplayName(asset.name) }}</strong></span
                      >
                    </button>
                    <template #overlay
                      ><a-menu
                        ><a-menu-item @click="previewAsset(asset)">预览文件</a-menu-item
                        ><a-menu-item @click="copy2clipboardI18n(asset.path)"
                          >复制文件路径</a-menu-item
                        ><a-menu-divider /><a-menu-item
                          :disabled="global.conf?.is_readonly"
                          @click="removeAsset('source', asset.path)"
                          >从工作区移除引用</a-menu-item
                        ></a-menu
                      ></template
                    >
                  </a-dropdown>
                </div>
                <div v-else class="asset-empty">
                  还没有引用素材。可从媒体库加入图片、视频或音频。
                </div>
              </div>
              <div class="material-source material-created">
                <div class="material-source-heading">
                  <div>
                    <strong>产物</strong
                    ><span class="asset-count">{{ createdArtifacts.length }}</span>
                  </div>
                </div>
                <div v-if="createdArtifacts.length" class="asset-list">
                  <a-dropdown
                    v-for="(item, index) in createdArtifacts.slice(0, visibleArtifactCount)"
                    :key="item.id"
                    :trigger="['contextmenu']"
                  >
                    <button
                      type="button"
                      class="asset-row"
                      :title="`预览：${fileDisplayName(item.name)}（右键查看更多操作）`"
                      @click="previewAsset(createdAssets[index])"
                    >
                      <span class="asset-thumb"
                        ><img
                          :src="thumbnailFor(createdAssets[index])"
                          alt=""
                          @error="thumbnailFailed(createdAssets[index].path)" /><MediaTypeBadge
                          :kind="item.kind"
                          compact /><WorkspaceSourceBadge :source="item.source"
                      /></span>
                      <span class="asset-row-copy"
                        ><strong>{{ fileDisplayName(item.name) }}</strong></span
                      >
                    </button>
                    <template #overlay
                      ><a-menu
                        ><a-menu-item @click="previewAsset(createdAssets[index])"
                          >预览文件</a-menu-item
                        ><a-menu-item
                          v-if="item.source === 'ai_image_edit'"
                          @click="openPreviewWithFile(assetInfo[createdAssets[index].path])"
                          >编辑素材信息</a-menu-item
                        ><a-menu-item
                          :disabled="global.conf?.is_readonly"
                          @click="syncCreatedArtifact(item)"
                          >同步到媒体库</a-menu-item
                        ><a-menu-divider /><a-menu-item
                          :disabled="global.conf?.is_readonly"
                          danger
                          @click="removeCreatedArtifact(item)"
                          >删除素材</a-menu-item
                        ></a-menu
                      ></template
                    >
                  </a-dropdown>
                </div>
                <a-button
                  v-if="createdArtifacts.length > visibleArtifactCount"
                  class="artifact-more"
                  @click="visibleArtifactCount += 60"
                  >显示更多素材（{{ createdArtifacts.length - visibleArtifactCount }} 项）</a-button
                >
                <div v-if="!createdArtifacts.length" class="artifact-empty">
                  <strong>暂无这类素材</strong>
                  <p>
                    图片制作、AI
                    创作等工具产生的内容会在这里管理。需要长期归档时，可主动导回媒体库。
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>
      </template>
      <template v-else>
        <section class="work-section" aria-labelledby="workspaces-title">
          <div class="section-heading workspace-list-heading">
            <h2 id="workspaces-title">我的工作区</h2>
            <a-button
              type="primary"
              class="new-work"
              :disabled="global.conf?.is_readonly || !global.conf"
              @click="showCreate"
              ><PlusOutlined />新建工作区</a-button
            >
          </div>
          <div class="work-tabs" role="group" aria-label="工作区状态">
            <button
              type="button"
              :class="{ active: view === 'active' }"
              :aria-pressed="view === 'active'"
              @click="view = 'active'"
            >
              进行中 <span>{{ activeCount }}</span></button
            ><button
              type="button"
              :class="{ active: view === 'paused' }"
              :aria-pressed="view === 'paused'"
              @click="view = 'paused'"
            >
              已搁置 <span>{{ pausedCount }}</span>
            </button>
          </div>
          <div v-if="visibleRecords.length" class="work-grid">
            <article v-for="item in visibleRecords" :key="item.id" class="work-card">
              <button
                type="button"
                class="work-card-main"
                :aria-label="'进入工作区：' + item.name"
                @click="openWorkspace(item)"
              >
                <span class="work-card-top"
                  ><span class="work-icon"><AppstoreOutlined /></span
                  ><span class="work-status" :class="item.status">{{
                    item.status === 'active' ? '进行中' : '已搁置'
                  }}</span></span
                ><span class="work-card-title">{{ item.name }}</span
                ><span class="work-brief">{{ item.brief || '还没有填写项目目标' }}</span
                ><span class="work-meta"
                  >{{
                    new Set([...item.assets, ...item.outputs].map((asset) => asset.path)).size
                  }}
                  项引用 · 上次在{{ toolLabel(item.lastTool) }} ·
                  {{ updatedLabel(item.updatedAt) }}</span
                ><span class="work-card-entry"
                  >{{ item.status === 'active' ? '进入工作区' : '恢复并进入' }}
                  <span aria-hidden="true">→</span></span
                >
              </button>
              <div class="work-card-bottom">
                <div class="record-actions">
                  <button
                    type="button"
                    :disabled="saving || global.conf?.is_readonly"
                    :aria-label="'修改工作区：' + item.name"
                    @click="showEdit(item)"
                  >
                    修改</button
                  ><button
                    type="button"
                    :disabled="saving || global.conf?.is_readonly"
                    @click="toggleStatus(item)"
                  >
                    {{ item.status === 'active' ? '搁置' : '恢复' }}</button
                  ><button
                    type="button"
                    class="remove"
                    :disabled="saving || global.conf?.is_readonly"
                    :aria-label="'删除工作区：' + item.name"
                    @click="confirmRemove(item)"
                  >
                    删除
                  </button>
                </div>
              </div>
            </article>
          </div>
          <div v-else class="work-empty">
            <div class="empty-illustration" aria-hidden="true">
              <span></span><span></span><span><PlusOutlined /></span>
            </div>
            <strong>{{ view === 'active' ? '还没有进行中的工作区' : '没有已搁置的工作区' }}</strong>
            <p>{{ view === 'active' ? '点击右上角新建工作区。' : '暂时没有需要搁置的内容。' }}</p>
          </div>
        </section>
      </template>
    </div>
    <div
      v-if="currentWorkspace || activeTool === 'image'"
      v-show="activeTool === 'image'"
      id="workbench-panel-image"
      class="workbench-inner image-pane"
      role="tabpanel"
      aria-labelledby="workbench-tab-image"
    >
      <ImageCreationPage
        ref="imagePage"
        v-if="currentWorkspace && currentWork"
        :key="`${currentWorkspace.id}:${currentWork.id}`"
        v-model:note="noteDraft"
        :note-dirty="imageNoteDirty"
        :note-saving="saving"
        :workspace-id="currentWorkspace.id"
        :work-id="currentWork.id"
        :workspace-name="`${currentWork.name} · 图片制作`"
        :assets="studioAssets"
        :asset-info="assetInfo"
        :import-library-image="importStudioImage"
        :artifacts="createdArtifacts"
        :readonly="global.conf?.is_readonly"
        :requested-draft-id="requestedDraftId"
        :open-request="imageOpenRequest"
        @new-work="showNewDraft('image')"
        @opened="imageOpened"
        @drafts-changed="refreshWorks"
        @add-assets="openPicker('source')"
        @save-note="saveToolNote"
        @artifact-saved="refreshArtifacts"
      />
      <section v-else class="work-empty choose-workspace">
        <strong>先选择一项作品</strong>
        <a-button @click="activateTool('overview')">查看工作区</a-button>
      </section>
    </div>
    <div
      v-if="aiVisited"
      v-show="activeTool === 'ai'"
      id="workbench-panel-ai"
      class="workbench-inner ai-pane"
      role="tabpanel"
      aria-labelledby="workbench-tab-ai"
    >
      <AICreationPage
        v-if="currentWork && currentToolDraft?.kind === 'ai'"
        :key="`${currentWorkspace?.id}:${currentWork.id}:${currentToolDraft.id}`"
        ref="aiPage"
        v-model:section="aiSection"
        :active="activeTool === 'ai'"
        :workspace="aiWorkspace"
        :draft-scope="`${currentWork.id}:${currentToolDraft.id}`"
        :asset-info="assetInfo"
        :readonly="global.conf?.is_readonly"
        @artifact-saved="refreshArtifacts"
        @configure="activateTool('config')"
      >
        <template #materials>
          <WorkspaceMaterialShelf
            :context-key="`${currentWorkspace?.id}:${currentWork.id}:ai-overlay:${aiSection}`"
            :assets="studioAssets"
            :asset-info="assetInfo"
            :allowed-kinds="materialKinds('ai', aiSection)"
            :controller="materialController"
            :tasks="pendingTasks"
            :readonly="global.conf?.is_readonly"
            placement="above"
            @select="selectMaterial"
            @add="openPicker('source')"
          />
        </template>
      </AICreationPage>
      <WorkProductionDrafts
        v-if="currentWorkspace && currentWork"
        :workspace-id="currentWorkspace.id"
        :drafts="currentWork.drafts"
        :active-id="currentWork.activeDraftId"
        :kinds="['ai']"
        :asset-info="assetInfo"
        :artifacts="createdArtifacts"
        :readonly="global.conf?.is_readonly || !!workError"
        @create="showNewDraft"
        @open="openDraft"
        @rename="showDraftInfo"
        @remove="confirmRemoveDraft"
      />
      <section v-else class="work-empty choose-workspace">
        <strong>先选择一项作品</strong
        ><a-button @click="activateTool('overview')">查看工作区</a-button>
      </section>
    </div>
    <div
      v-if="configVisited"
      v-show="activeTool === 'config'"
      id="workbench-panel-config"
      class="workbench-inner"
      role="tabpanel"
      aria-labelledby="workbench-tab-config"
    >
      <AIWorkflowLibrary ref="configPage" :readonly="global.conf?.is_readonly" />
    </div>
    <div
      v-if="activeTool === 'media'"
      id="workbench-panel-media"
      class="workbench-inner media-pane"
      role="tabpanel"
      aria-labelledby="workbench-tab-media"
    >
      <MediaCreationPage
        v-if="currentWork && currentToolDraft && ['video', 'audio'].includes(currentToolDraft.kind)"
        :work="currentWork"
        :draft="currentToolDraft"
        :assets="studioAssets"
        :asset-info="assetInfo"
        :readonly="global.conf?.is_readonly"
        @preview="previewAsset"
        @add-assets="openPicker('source')"
        @edit="showDraftInfo(currentToolDraft)"
      />
      <WorkProductionDrafts
        v-if="currentWorkspace && currentWork"
        :workspace-id="currentWorkspace.id"
        :drafts="currentWork.drafts"
        :active-id="currentWork.activeDraftId"
        :kinds="['video', 'audio']"
        :asset-info="assetInfo"
        :artifacts="createdArtifacts"
        :readonly="global.conf?.is_readonly || !!workError"
        @create="showNewDraft"
        @open="openDraft"
        @rename="showDraftInfo"
        @remove="confirmRemoveDraft"
      />
      <section v-else class="work-empty choose-workspace">
        <strong>先选择一项作品</strong
        ><a-button @click="activateTool('overview')">查看工作区</a-button>
      </section>
    </div>
    <a-modal
      :open="workDialogOpen"
      :title="editingWorkId ? '作品信息' : '新建作品'"
      :ok-text="editingWorkId ? '保存' : '创建'"
      cancel-text="取消"
      :ok-button-props="{ disabled: global.conf?.is_readonly || !workName.trim() || !!workError }"
      @ok="saveWorkDialog"
      @cancel="workDialogOpen = false"
    >
      <div class="work-form">
        <label for="creation-work-name">作品名称</label
        ><a-input
          id="creation-work-name"
          v-model:value="workName"
          :maxlength="80"
          placeholder="例如：某某短剧、海边旅行、春季宣传"
          @press-enter="saveWorkDialog"
        />
        <label for="creation-work-brief">创作目标（可选）</label
        ><a-textarea
          id="creation-work-brief"
          v-model:value="workBrief"
          :rows="4"
          :maxlength="5000"
          placeholder="制作目标、想法、台词……"
        />
      </div>
    </a-modal>
    <a-modal
      :open="productionDialogOpen"
      :title="editingProductionId ? '草稿信息' : '新建制作草稿'"
      :ok-text="editingProductionId ? '保存' : '创建并打开'"
      cancel-text="取消"
      :ok-button-props="{
        disabled: global.conf?.is_readonly || !productionName.trim() || !!workError
      }"
      @ok="saveDraftDialog"
      @cancel="productionDialogOpen = false"
    >
      <div class="work-form">
        <template v-if="!editingProductionId"
          ><label>制作方式</label
          ><a-select
            v-model:value="productionKind"
            aria-label="制作方式"
            :options="
              (['image', 'video', 'audio', 'ai'] as const).map((kind) => ({
                value: kind,
                label: draftKindLabel(kind)
              }))
            " /></template
        ><label for="production-name">草稿名称</label
        ><a-input
          id="production-name"
          v-model:value="productionName"
          :maxlength="80"
          placeholder="例如：第一集分镜、旁白录音、图生视频参考"
          @press-enter="saveDraftDialog"
        /><label for="production-brief">草稿笔记（可选）</label
        ><a-textarea
          id="production-brief"
          v-model:value="productionBrief"
          :rows="3"
          :maxlength="5000"
          placeholder="这一步的想法、台词或提示词"
        /><small class="work-form-note"
          >保存在“{{ currentWork?.name }}”中。{{
            ['video', 'audio'].includes(productionKind) ? '音视频剪辑功能仍为布局预览。' : ''
          }}</small
        >
      </div>
    </a-modal>
    <a-modal
      :open="assetChoiceOpen"
      title="选择作品成果"
      ok-text="保存成果"
      cancel-text="取消"
      :width="660"
      :ok-button-props="{ disabled: global.conf?.is_readonly || !!workError }"
      @ok="saveWorkOutputs"
      @cancel="assetChoiceOpen = false"
    >
      <p class="work-choice-hint">选择这件作品用于交付或展示的文件。</p>
      <div v-if="workAssetChoices.length" class="work-asset-choices">
        <button
          v-for="asset in workAssetChoices"
          :key="asset.path"
          type="button"
          :class="{ selected: assetChoicePaths.includes(asset.path) }"
          :aria-pressed="assetChoicePaths.includes(asset.path)"
          :title="asset.path"
          @click="toggleWorkAsset(asset.path)"
        >
          <span class="choice-thumb"
            ><img v-if="thumbnailFor(asset)" :src="thumbnailFor(asset)" alt="" /><AudioOutlined
              v-else-if="asset.kind === 'audio'" /><PictureOutlined v-else /></span
          ><strong>{{ asset.name }}</strong
          ><small>{{
            assetChoicePaths.includes(asset.path) ? '已选择' : workKindLabel(asset.kind)
          }}</small>
        </button>
      </div>
      <div v-else class="asset-empty">工作区还没有可选的文件，先从媒体库加入素材。</div>
    </a-modal>
    <a-modal
      :open="dialogOpen"
      :title="editingId ? '修改工作区' : '新建工作区'"
      :confirm-loading="saving"
      :ok-text="editingId ? '保存' : '创建'"
      cancel-text="取消"
      @ok="saveDialog"
      @cancel="dialogOpen = false"
      ><div class="work-form">
        <label for="work-name">工作区名称</label
        ><a-input
          id="work-name"
          v-model:value="draftName"
          :maxlength="80"
          placeholder="例如：旅行九宫格"
          @press-enter="saveDialog"
        /><label for="work-brief">想完成什么（可选）</label
        ><a-textarea
          id="work-brief"
          v-model:value="draftBrief"
          :rows="3"
          :maxlength="500"
          placeholder="例如：用精选照片做一组社媒图"
        /></div
    ></a-modal>
    <MediaLibraryPicker
      v-if="pickerOpen"
      multiple
      :title="pickerRole === 'source' ? '从媒体库加入素材' : '添加已有成果'"
      :saving="saving"
      :allowed-types="showMaterials && pickerRole === 'source' ? allowedMaterialKinds : undefined"
      :confirm-text="pickerRole === 'source' ? '加入工作区' : '记录为成果'"
      :explanation="
        pickerRole === 'output' ? '只记录现有文件的引用，不会导出、复制或移动文件。' : undefined
      "
      @confirm="addPicked"
      @close="pickerOpen = false"
    />
    <WorkspaceAssetPreview
      v-if="assetPreview"
      :file="assetPreview"
      :workspace-name="currentWorkspace?.name"
      @close="closeAssetPreview"
    >
      <template #actions>
        <a-button
          v-if="previewArtifact"
          type="primary"
          :disabled="global.conf?.is_readonly"
          :loading="previewSyncing"
          @click="syncPreviewArtifact"
          >同步到媒体库</a-button
        >
        <a-button v-else @click="copy2clipboardI18n(assetPreview.fullpath)">复制文件路径</a-button>
      </template>
    </WorkspaceAssetPreview>
  </div>
</template>

<style scoped>
.business-work-heading {
  padding: 0 0 6px;
}
.business-work-heading h1 {
  margin: 8px 0;
  font-size: 24px;
  font-weight: 650;
}
.business-work-heading p {
  color: var(--ui-muted);
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-width: 740px;
  margin: 0;
}
.business-work-tabs {
  display: flex;
  gap: 8px;
  border-bottom: 1px solid var(--ui-border);
  margin-top: 24px;
}
.business-work-tabs button {
  padding: 12px 16px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--ui-muted);
  font: inherit;
  cursor: pointer;
}
.business-work-tabs button.active {
  border-bottom-color: var(--primary-color);
  color: var(--primary-color);
}
.business-work-tabs small {
  margin-left: 6px;
  font-size: 11px;
  opacity: 0.7;
}
.work-used-materials {
  margin-top: 20px;
  padding-top: 14px;
  border-top: 1px solid var(--ui-border);
  font-size: 12px;
}
.work-used-materials summary {
  cursor: pointer;
  width: fit-content;
  color: var(--ui-muted);
}
.work-used-materials summary small {
  margin-left: 6px;
}
.used-material-list {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}
.used-material-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 20px;
  padding: 8px;
  border-radius: 8px;
  background: var(--ui-surface-soft);
}
.used-material-row button {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 0;
  background: none;
  color: var(--ui-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  min-width: 0;
  max-width: 100%;
}
.used-material-row strong {
  overflow-wrap: anywhere;
}
.used-material-row small {
  color: var(--ui-muted);
  overflow-wrap: anywhere;
}
.used-material-row button:focus-visible,
.work-used-materials summary:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 3px;
}
.business-file-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.business-file-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}
.business-file-grid article {
  position: relative;
  background: var(--ui-surface-soft);
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  padding: 8px;
  min-width: 0;
}
.business-file-entry {
  width: 100%;
  padding: 0;
  text-align: left;
  border: 0;
  background: none;
  color: var(--ui-text);
  cursor: pointer;
}
.business-file-entry > span {
  position: relative;
  display: grid;
  place-items: center;
  height: 130px;
  background: var(--ui-surface);
  overflow: hidden;
  border-radius: 6px;
  font-size: 26px;
  color: var(--ui-muted);
}
.business-file-entry img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.business-file-entry strong {
  font-size: 12px;
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  margin-top: 10px;
  padding-right: 20px;
}
.business-file-grid article > .ant-btn {
  position: absolute;
  bottom: 4px;
  right: 3px;
}
.business-work-tabs button:focus-visible,
.business-file-entry:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
}
.media-pane > .production-drafts,
.ai-pane > .production-drafts {
  margin-top: 20px;
}
.workspace-project-notes {
  padding: 12px 16px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-surface);
  color: var(--ui-muted);
  font-size: 12px;
}
.workspace-project-notes summary {
  cursor: pointer;
}
.workspace-project-notes section {
  margin-top: 12px;
}
.workspace-project-notes p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.7;
  margin: 6px 0 0;
}
.current-work-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin: 12px 16px 0;
  padding: 12px 14px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-surface);
}
.current-work-copy {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.current-work-copy small {
  color: var(--ui-muted);
  white-space: nowrap;
  font-size: 11px;
}
.current-work-copy :deep(.ant-select) {
  width: 240px;
  max-width: 100%;
}
.work-context-summary {
  color: var(--ui-muted);
  font-size: 11px;
}
.current-work-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-left: auto;
}
.work-storage-error {
  margin: 12px 16px 0;
  padding: 10px 14px;
  border-radius: 8px;
  color: var(--ant-color-error);
  background: var(--ui-surface);
  font-size: 12px;
}
.work-kind-options {
  display: flex;
}
.work-kind-options :deep(.ant-radio-button-wrapper) {
  flex: 1;
  text-align: center;
}
.work-form-note,
.work-choice-hint {
  color: var(--ui-muted);
  font-size: 12px;
  line-height: 1.7;
}
.work-asset-choices {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  max-height: 430px;
  overflow: auto;
  padding: 2px;
}
.work-asset-choices button {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 8px;
  border: 1px solid var(--ui-border);
  border-radius: 9px;
  background: var(--ui-surface);
  color: var(--ui-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.work-asset-choices button.selected {
  border-color: var(--primary-color);
  background: color-mix(in srgb, var(--primary-color) 8%, var(--ui-surface));
}
.choice-thumb {
  display: grid;
  place-items: center;
  height: 95px;
  width: 100%;
  border-radius: 6px;
  overflow: hidden;
  background: var(--ui-surface-soft);
  color: var(--ui-muted);
  font-size: 25px;
}
.choice-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.work-asset-choices strong {
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
  font-size: 12px;
}
.work-asset-choices small {
  color: var(--ui-muted);
  font-size: 10px;
}
.work-asset-choices button.selected small {
  color: var(--primary-color);
}
.work-asset-choices button:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
}
.media-work-choice-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.media-work-choice-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 10px;
  margin-top: 20px;
}
.media-work-choice-list button {
  padding: 18px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-surface);
  color: var(--ui-text);
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  cursor: pointer;
}
.media-work-choice-list strong {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.media-work-choice-list span {
  font-size: 11px;
  color: var(--primary-color);
}
@media (max-width: 680px) {
  .current-work-copy {
    flex: 1;
  }
  .current-work-copy :deep(.ant-select) {
    width: 100%;
    min-width: 0;
  }
  .current-work-actions {
    margin-left: 0;
  }
  .work-context-summary {
    display: none;
  }
  .work-asset-choices {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.workbench-materials {
  padding: 12px 16px 0;
  position: relative;
  z-index: 5;
}

.workspace-task-list {
  display: flex;
  gap: 8px;
  overflow: auto;
  padding: 10px 0;
}
.task-update-error {
  color: #9b7417;
  font-size: 12px;
}

.workbench-toolbar {
  min-width: 0;
}
.workbench-toolbar-heading {
  display: flex;
  align-items: baseline;
  gap: 12px;
  min-height: 29px;
  padding: 0 8px;
}
.workbench-toolbar-heading strong {
  font-size: 17px;
  line-height: 1.4;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workbench-toolbar-heading span {
  color: var(--ui-muted);
  font-size: 12px;
}
.workbench-tool-tabs {
  display: flex;
  align-items: stretch;
  gap: 4px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: thin;
  margin-top: 4px;
}
.workbench-tool-tabs button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  flex: none;
  min-height: 38px;
  padding: 0 14px 9px;
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 7px 7px 0 0;
  background: transparent;
  color: var(--ui-muted);
  font: inherit;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
}
.workbench-tool-tabs button:hover {
  background: var(--ui-hover);
  color: var(--ui-text);
}
.workbench-tool-tabs button.active {
  border-bottom-color: var(--primary-color);
  background: color-mix(in srgb, var(--primary-color) 9%, transparent);
  color: var(--primary-color);
  font-weight: 650;
}
.workbench-tool-tabs button:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: -3px;
}
.workbench-page {
  height: 100%;
  overflow: auto;
  background: transparent;
  color: var(--ui-text);
}
.workbench-inner {
  width: 100%;
  padding: 12px 16px 40px;
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.workspace-heading,
.asset-panel,
.next-step,
.tool-workspace-strip,
.tool-note,
.work-card,
.work-empty {
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-lg);
  background: var(--ui-surface);
}
.section-heading p,
.workspace-heading p,
.next-step p {
  margin: 0;
  color: var(--ui-muted);
  font-size: 13px;
  line-height: 1.6;
}
.new-work {
  height: 36px;
  flex: none;
}
.image-pane {
  height: auto;
  min-height: 0;
  box-sizing: border-box;
  overflow: visible;
  padding: 12px 16px;
  gap: 0;
}
.ai-pane {
  gap: 0;
}
.work-section {
  min-width: 0;
}
.section-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 16px;
}
.workspace-list-heading {
  align-items: center;
}
.section-heading h2,
.next-step h2 {
  margin: 0 0 3px;
  font-size: 18px;
  line-height: 1.35;
  font-weight: 700;
}
.work-tabs {
  display: flex;
  gap: 16px;
  border-bottom: 1px solid var(--ui-border);
  margin-bottom: 16px;
}
.work-tabs button {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 2px 11px;
  border: 0;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  background: none;
  color: var(--ui-muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.work-tabs button.active {
  border-color: var(--primary-color);
  color: var(--primary-color);
  font-weight: 650;
}
.work-tabs button span {
  padding: 0 6px;
  min-width: 20px;
  border-radius: 8px;
  background: var(--ui-surface-soft);
  font-size: 11px;
  text-align: center;
}
.work-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.work-card {
  min-width: 0;
  overflow: hidden;
  transition:
    border-color var(--ui-motion-fast) var(--ui-ease),
    box-shadow var(--ui-motion-fast) var(--ui-ease);
}
.work-card:hover {
  border-color: color-mix(in srgb, var(--primary-color) 42%, var(--ui-border));
  box-shadow: var(--ui-shadow-card);
}
.work-card-main {
  display: block;
  width: 100%;
  padding: 17px 18px 12px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.work-card-main:hover {
  background: var(--ui-hover);
}
.work-card-main:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
}
.work-card-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}
.work-icon {
  height: 42px;
  width: 42px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  font-size: 20px;
  background: var(--primary-color-1);
  color: var(--primary-color);
}
.work-status {
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--primary-color-1);
  color: var(--primary-color);
  font-size: 11px;
  font-weight: 600;
}
.work-status.paused {
  background: var(--ui-surface-soft);
  color: var(--ui-muted);
}
.work-card-title {
  display: block;
  margin: 14px 0 4px;
  font-size: 16px;
  font-weight: 650;
  overflow-wrap: anywhere;
}
.work-brief {
  display: block;
  margin: 0 0 8px;
  min-height: 18px;
  color: var(--ui-text);
  font-size: 12px;
}
.work-meta {
  display: block;
  font-size: 11px;
  color: var(--ui-muted);
  line-height: 1.5;
}
.work-card-entry {
  display: block;
  margin-top: 14px;
  color: var(--primary-color);
  font-size: 12px;
  font-weight: 650;
}
.work-card-entry span {
  margin-left: 3px;
}
.work-card-bottom {
  min-height: 42px;
  padding: 5px 12px;
  border-top: 1px solid var(--ui-border);
  display: flex;
  align-items: center;
  justify-content: flex-end;
}
.record-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.record-actions button,
.asset-row button {
  border: 0;
  border-radius: 5px;
  padding: 5px 6px;
  background: transparent;
  color: var(--ui-muted);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.record-actions button:hover:not(:disabled),
.asset-row button:hover:not(:disabled) {
  background: var(--ui-hover);
  color: var(--ui-text);
}
.record-actions button.remove:hover:not(:disabled) {
  color: #d44444;
}
.record-actions button:disabled,
.asset-row button:disabled {
  opacity: 0.5;
  cursor: default;
}
.work-empty {
  min-height: 216px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  text-align: center;
  padding: 20px;
}
.empty-illustration {
  width: 68px;
  height: 52px;
  position: relative;
  margin-bottom: 15px;
}
.empty-illustration span {
  position: absolute;
  display: grid;
  place-items: center;
  width: 38px;
  height: 42px;
  border: 1px solid var(--ui-border);
  border-radius: 7px;
  background: var(--ui-surface);
  box-shadow: 0 3px 8px #0000000d;
}
.empty-illustration span:nth-child(1) {
  left: 3px;
  top: 5px;
  transform: rotate(-13deg);
}
.empty-illustration span:nth-child(2) {
  right: 3px;
  top: 5px;
  transform: rotate(13deg);
}
.empty-illustration span:nth-child(3) {
  left: 15px;
  top: 0;
  color: var(--primary-color);
  font-size: 18px;
}
.work-empty strong {
  font-size: 15px;
}
.work-empty p {
  margin: 5px 0 12px;
  color: var(--ui-muted);
  font-size: 12px;
}
.workspace-heading {
  padding: 22px 26px;
  background: linear-gradient(
    115deg,
    color-mix(in srgb, var(--primary-color) 8%, var(--ui-surface)),
    var(--ui-surface) 70%
  );
}
.back-link {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  border: 0;
  background: none;
  color: var(--ui-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  padding: 0;
}
.back-link:hover {
  color: var(--primary-color);
}
.workspace-heading-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 18px;
  margin-top: 17px;
}
.workspace-kicker {
  color: var(--primary-color);
  font-size: 11px;
  font-weight: 650;
}
.workspace-heading h1 {
  margin: 6px 0;
  font-size: 25px;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.workspace-columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
}
.asset-panel {
  padding: 20px;
  min-height: 210px;
}
.asset-panel .section-heading {
  align-items: center;
}
.asset-empty {
  padding: 24px 10px;
  text-align: center;
  color: var(--ui-muted);
  font-size: 12px;
  background: var(--ui-surface-soft);
  border-radius: var(--ui-radius);
}
.asset-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
  max-height: 360px;
  overflow: auto;
}
.asset-row {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  padding: 9px 10px;
  background: var(--ui-surface-soft);
  border-radius: var(--ui-radius-sm);
}
.asset-row > div {
  flex: 1;
  min-width: 0;
}
.asset-row strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.asset-row small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-muted);
  font-size: 10px;
}
.next-step {
  padding: 20px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.material-panel,
.output-panel {
  grid-column: 1/-1;
}
.material-panel .section-heading {
  margin-bottom: 14px;
}
.material-sources {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}
.material-source {
  min-width: 0;
}
.material-source + .material-source {
  padding-left: 18px;
  border-left: 1px solid var(--ui-border);
}
.material-source-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 32px;
  margin-bottom: 10px;
}
.material-source-heading > div {
  display: flex;
  align-items: center;
  gap: 8px;
}
.material-source-heading strong {
  font-size: 12px;
  font-weight: 650;
}
.asset-count {
  display: inline-grid;
  place-items: center;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  vertical-align: middle;
  border-radius: 10px;
  background: var(--ui-surface-soft);
  color: var(--ui-muted);
  font-size: 11px;
  font-weight: 500;
}
.asset-panel .section-heading .ant-btn,
.material-source-heading .ant-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  white-space: nowrap;
}
.artifact-empty {
  display: flex;
  min-height: 130px;
  flex-direction: column;
  justify-content: center;
  padding: 15px 16px;
  border: 1px dashed var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-surface-soft);
}
.artifact-empty strong {
  display: block;
  font-size: 12px;
}
.artifact-empty p {
  margin: 5px 0 0;
  color: var(--ui-muted);
  font-size: 11px;
  line-height: 1.6;
}
.tool-pane {
  gap: 20px;
}
.tool-workspace-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 17px;
}
.tool-workspace-strip > div {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}
.tool-workspace-strip span,
.tool-workspace-strip small {
  color: var(--ui-muted);
  font-size: 11px;
}
.tool-workspace-strip strong {
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tool-hero {
  display: flex;
  align-items: center;
  gap: 20px;
  min-height: 145px;
  padding: 24px 28px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-lg);
  background: linear-gradient(
    112deg,
    color-mix(in srgb, var(--primary-color) 10%, var(--ui-surface)),
    var(--ui-surface) 65%
  );
}
.tool-hero.violet {
  background: linear-gradient(
    112deg,
    color-mix(in srgb, var(--ui-violet) 11%, var(--ui-surface)),
    var(--ui-surface) 65%
  );
}
.tool-hero.amber {
  background: linear-gradient(
    112deg,
    color-mix(in srgb, var(--ui-amber) 11%, var(--ui-surface)),
    var(--ui-surface) 65%
  );
}
.tool-hero.mint {
  background: linear-gradient(
    112deg,
    color-mix(in srgb, var(--ui-mint) 11%, var(--ui-surface)),
    var(--ui-surface) 65%
  );
}
.tool-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 58px;
  height: 58px;
  font-size: 25px;
  border-radius: 16px;
}
.tool-icon.blue {
  background: var(--primary-color-1);
  color: var(--primary-color);
}
.tool-icon.violet {
  background: color-mix(in srgb, var(--ui-violet) 13%, var(--ui-surface));
  color: var(--ui-violet);
}
.tool-icon.amber {
  background: color-mix(in srgb, var(--ui-amber) 13%, var(--ui-surface));
  color: var(--ui-amber);
}
.tool-icon.mint {
  background: color-mix(in srgb, var(--ui-mint) 13%, var(--ui-surface));
  color: var(--ui-mint);
}
.tool-hero-copy {
  flex: 1;
  min-width: 0;
}
.tool-stage {
  color: var(--primary-color);
  font-size: 12px;
  font-weight: 650;
}
.tool-hero h1 {
  margin: 7px 0 5px;
  font-size: 26px;
  line-height: 1.25;
}
.tool-hero p {
  margin: 0;
  color: var(--ui-muted);
  font-size: 13px;
}
.tool-soon {
  align-self: flex-start;
  padding: 6px 10px;
  border: 1px solid var(--ui-border);
  border-radius: 999px;
  background: var(--ui-surface);
  color: var(--ui-muted);
  font-size: 11px;
  white-space: nowrap;
}
.tool-note {
  padding: 20px;
}
.tool-assets {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 14px;
}
.tool-assets strong {
  margin-right: 6px;
  font-size: 12px;
}
.tool-assets span {
  max-width: 170px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--ui-surface-soft);
  color: var(--ui-muted);
  font-size: 11px;
}
.choose-workspace {
  min-height: 145px;
}
.tool-feature-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.tool-feature {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  min-height: 76px;
  padding: 16px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-lg);
  background: var(--ui-surface);
}
.feature-index {
  color: var(--primary-color);
  font-size: 12px;
  font-weight: 700;
}
.tool-feature strong {
  min-width: 0;
  flex: 1;
  font-size: 13px;
  font-weight: 600;
}
.tool-feature > span:last-child {
  color: var(--ui-muted);
  font-size: 11px;
  white-space: nowrap;
}
.cloud-note {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin-top: 12px;
  padding: 12px 14px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-surface-soft);
  color: var(--ui-muted);
  font-size: 12px;
  line-height: 1.55;
}
.cloud-note .anticon {
  color: var(--primary-color);
  margin-top: 2px;
}
.work-form {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 8px 0 4px;
}
.work-form label {
  font-size: 12px;
  font-weight: 600;
}
.work-form :deep(.ant-input) {
  margin-bottom: 8px;
}
.workspace-heading-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}
.asset-row {
  width: 100%;
  border: 1px solid transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: zoom-in;
}
.asset-row:hover {
  border-color: var(--ui-border);
  background: var(--ui-hover);
}
.asset-row:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
}
.asset-row-copy {
  flex: 1;
  min-width: 0;
}
.asset-row-cue {
  flex: none;
  color: var(--primary-color);
  font-size: 11px;
}
.asset-thumb {
  position: relative;
  display: grid;
  place-items: center;
  flex: none;
  width: 64px;
  height: 64px;
  overflow: hidden;
  border-radius: 7px;
  background: var(--ui-accent-soft);
  color: var(--primary-color);
  font-size: 24px;
}
.asset-thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.asset-panel .asset-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 8px;
  max-height: 360px;
}
.asset-panel .asset-row {
  min-height: 62px;
  padding: 6px 8px;
}
.asset-panel .asset-thumb {
  width: 72px;
  height: 72px;
  font-size: 24px;
}
@media (max-width: 900px) {
  .workspace-columns,
  .work-grid {
    grid-template-columns: 1fr;
  }
  .tool-feature-list {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 780px) {
  .workbench-inner {
    padding: 16px;
    gap: 18px;
  }
  .workspace-heading-row,
  .next-step {
    align-items: flex-start;
    flex-direction: column;
  }
  .material-sources {
    grid-template-columns: 1fr;
  }
  .material-source + .material-source {
    padding: 16px 0 0;
    border-left: 0;
    border-top: 1px solid var(--ui-border);
  }
}
@media (max-width: 520px) {
  .workbench-toolbar-heading span {
    display: none;
  }
  .tool-hero {
    padding: 20px;
    gap: 12px;
    flex-wrap: wrap;
  }
  .tool-soon {
    margin-left: auto;
  }
  .work-card-bottom,
  .tool-workspace-strip > div {
    flex-wrap: wrap;
  }
}
</style>
