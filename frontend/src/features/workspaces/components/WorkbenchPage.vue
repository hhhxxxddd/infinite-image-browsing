<script setup lang="ts">
import { getErrorMessage } from '@/shared/lib/errorMessage'
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, provide, ref, watch } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import { message, Modal } from 'ant-design-vue'
import {
  AppstoreOutlined,
  ArrowLeftOutlined,
  AudioOutlined,
  CheckOutlined,
  DownOutlined,
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
  listWorkspaceInputs,
  renameWorkspaceArtifact,
  syncWorkspaceArtifact,
  type WorkspaceArtifact
} from '@/features/workspaces/api/workspaceArtifacts'
import { resolveMediaPaths } from '@/features/media-library/public'
import MediaLibraryPicker from '@/features/media-library/components/MediaLibraryPicker.vue'
import { batchGetFilesInfo, type FileNodeInfo } from '@/features/media-library/public'
import {
  isAudioFile,
  isVideoFile,
  audioCoverUrl,
  toImageThumbnailUrl,
  toVideoCoverUrl
} from '@/features/media-library/public'
import { copy2clipboardI18n } from '@/shared/lib/clipboard'
import { assetPreviewWorkspaceNameKey, openPreviewWithFile } from '@/features/media-preview/public'
import { useApplicationStore } from '@/features/application/public'
import WorkspaceAssetPreview from './WorkspaceAssetPreview.vue'
import WorkspaceMaterialShelf from './WorkspaceMaterialShelf.vue'
import WorkspaceWorksPanel from './WorkspaceWorksPanel.vue'
import WorkspaceHome from './WorkspaceHome.vue'
import WorkProductionDrafts from './WorkProductionDrafts.vue'
import { collectWorkspaceMaterials, collectWorkUsedAssets } from '../model/workspaceMaterialsPool'
import MediaCreationPage from './MediaCreationPage.vue'
import { useWorkspaceWorks } from '../composables/useWorkspaceWorks'
import {
  draftKindLabel,
  draftTool,
  type WorkspaceWork,
  type ProductionDraft,
  type ProductionKind
} from '../model/workspaceWorks'
import { materialKinds, type AICreationSection } from '../model/workspaceMaterials'
import MediaTypeBadge from '@/features/media-library/components/MediaTypeBadge.vue'
import WorkspaceSourceBadge from '@/features/workspaces/components/WorkspaceSourceBadge.vue'
import { workspaceArtifactActionsKey } from '../model/workspaceArtifactActions'
import { fileDisplayName } from '@/shared/lib/fileDisplayName'
import {
  deleteWorkspaceState,
  saveWorkspaceState,
  workspaceStorage,
  workspaceStorageRevision
} from '../services/workspaceStorage'
import { remapWorkspaceRecords, remapWorkspaceDrafts } from '../model/workspaceReferences'
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
const AudioCreationEditor = defineAsyncComponent(
  () => import('../../media-editor/components/AudioCreationEditor.vue')
)

type ToolTab = 'overview' | 'config' | ToolKey
const global = useApplicationStore()
const toolLabels: Record<ToolKey, string> = {
  image: '图片制作',
  media: '音视频制作',
  ai: 'AI 创作'
}
const activeTool = ref<ToolTab>('overview')
const activePage = computed(() => (activeTool.value === 'config' ? 'config' : 'overview'))
const aiSection = ref<AICreationSection>('edit')
const configVisited = ref(false)
const aiPage = ref<InstanceType<typeof AICreationPage>>()
const requestedAIDraftId = ref('')
const configPage = ref<InstanceType<typeof AIWorkflowLibrary>>()
const materialController = computed(() =>
  activeTool.value === 'ai' && ['edit', 'generation'].includes(aiSection.value)
    ? aiPage.value?.materialController
    : undefined
)
const showMaterials = computed(
  () =>
    !!currentWorkspace.value &&
    !!currentWork.value &&
    workDetailOpen.value &&
    activePage.value === 'overview'
)
const allowedMaterialKinds: MediaKind[] = ['image', 'video', 'audio']
function selectMaterial(asset: WorkspaceAsset, event: MouseEvent) {
  if (materialController.value) materialController.value.select(asset, event)
  else void previewAsset(asset)
}
watch(activeTool, (tool) => {
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
provide(
  assetPreviewWorkspaceNameKey,
  computed(() => currentWorkspace.value?.name)
)
const {
  works,
  currentWork,
  currentDraft,
  error: workError,
  ready: worksReady,
  refresh: refreshWorks,
  select: selectWork,
  create: createWork,
  createDraft: createWorkDraft,
  selectDraft,
  updateDraft,
  removeDraft,
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
const view = ref<WorkspaceStatus>('active')
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
      const byId = new Map(media.map((item) => [item.id, item.path]))
      const paths = new Map<string, string>()
      for (const workspace of next)
        for (const asset of [...workspace.assets, ...workspace.outputs]) {
          const path = asset.id === undefined ? undefined : byId.get(asset.id)
          if (path && path !== asset.path) paths.set(asset.path, path)
        }
      if (paths.size && !global.conf.is_readonly)
        for (const workspace of next)
          await saveWorkspaceState(workspace.id, (storage) => remapWorkspaceDrafts(storage, paths))
      next = remapWorkspaceRecords(next, paths)
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
  return toolLabels[key]
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
  if (!global.conf?.is_readonly) {
    const next = records.value.map((row) =>
      row.id === item.id
        ? {
            ...row,
            status: 'active' as const,
            lastOpenedAt: new Date().toISOString(),
            updatedAt: row.status === 'paused' ? new Date().toISOString() : row.updatedAt
          }
        : row
    )
    if (!(await saveRecords(next))) return false
  }
  currentWorkspaceId.value = item.id
  activeTool.value = 'overview'
  return true
}
async function setWorkspaceCover(id: string, version?: string) {
  if (!records.value.some((item) => item.id === id)) return false
  return saveRecords(
    records.value.map((item) => (item.id === id ? { ...item, cover: version } : item))
  )
}
async function resumeWorkspace(item: WorkspaceRecord, workId: string, draftId?: string) {
  if (!(await openWorkspace(item))) return
  await refreshWorks(true)
  if (currentWorkspace.value?.id !== item.id) return
  const work = works.value.find((work) => work.id === workId)
  if (!work) return
  await openWork(work)
  const draft = work.drafts.find((draft) => draft.id === draftId)
  if (draft) await openDraft(draft)
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
      '会一并删除工作区记录、作品及本机制作文件、笔记和工作区产物；引用及已同步到媒体库的文件不会删除。',
    okText: '删除',
    cancelText: '取消',
    okType: 'danger',
    onOk: async () => {
      if (!(await saveRecords(records.value.filter((row) => row.id !== item.id))))
        throw new Error('保存失败')
      if (currentWorkspaceId.value === item.id) await backToList()
      await nextTick()
      try {
        await deleteWorkspaceState(item.id)
      } catch {
        message.warning('工作区已删除，但本机制作文件清理失败')
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
    await updateWork({ ...currentWork.value, lastTool: key })
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
  const keys: ToolTab[] = ['overview', 'config']
  const current = keys.indexOf(activePage.value)
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
function openPicker() {
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
async function removeAsset(path: string) {
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
  if (currentWorkspace.value?.id === workspace.id)
    for (const work of works.value.filter((work) =>
      work.assets.some((asset) => asset.path === path)
    ))
      if (
        !(await updateWork({ ...work, assets: work.assets.filter((asset) => asset.path !== path) }))
      )
        break
}
const mediaAssetInfo = ref<Record<string, FileNodeInfo>>({})
const createdArtifacts = ref<WorkspaceArtifact[]>([])
const inputSnapshots = ref<WorkspaceArtifact[]>([])
const visibleArtifactCount = ref(60)
const createdAssets = computed<WorkspaceAsset[]>(() =>
  createdArtifacts.value.map((item) => ({
    path: `workspace-artifact:${item.id}`,
    name: item.name,
    kind: item.kind
  }))
)
const createdAssetByPath = computed(
  () => new Map(createdAssets.value.map((asset) => [asset.path, asset]))
)
const currentWorkOutputs = computed(() =>
  (currentWork.value?.outputs ?? []).map(
    (asset) => createdAssetByPath.value.get(asset.path) ?? asset
  )
)
const workspaceMaterials = computed(() =>
  collectWorkspaceMaterials(
    currentWorkspace.value ?? { assets: [], outputs: [] },
    works.value,
    createdAssets.value
  )
)
const workUsedAssets = computed(() => {
  void workspaceStorageRevision.value
  const workspaceId = currentWorkspace.value?.id
  if (!worksReady.value || !workspaceId) return {}
  return Object.fromEntries(
    works.value.map((work) => [
      work.id,
      collectWorkUsedAssets(
        currentWorkspace.value?.id ?? '',
        work,
        workspaceStorage(workspaceId),
        workspaceMaterials.value
      )
    ])
  )
})
const currentUsedAssets = computed(() => workUsedAssets.value[currentWork.value?.id ?? ''] ?? [])
const materialView = ref<'all' | 'used'>('all')
const usedAssetPaths = computed(() => new Set(currentUsedAssets.value.map((asset) => asset.path)))
const overviewMaterials = computed(() =>
  materialView.value === 'used'
    ? studioAssets.value.filter((asset) => usedAssetPaths.value.has(asset.path))
    : studioAssets.value
)
watch(
  () => currentWork.value?.id,
  () => {
    materialView.value = 'all'
  }
)
function addOverviewMaterials() {
  materialView.value = 'all'
  openPicker()
}
const studioAssets = computed(() =>
  [
    ...new Map(
      [...workspaceMaterials.value, ...Object.values(workUsedAssets.value).flat()].map((asset) => [
        asset.path,
        asset
      ])
    ).values()
  ].filter(
    (asset) =>
      !asset.path.startsWith('workspace-artifact:') ||
      createdAssetByPath.value.has(asset.path) ||
      inputSnapshots.value.some((item) => asset.path === `workspace-artifact:${item.id}`)
  )
)
const workspaceSourceAssets = computed(() =>
  workspaceMaterials.value.filter((asset) => !asset.path.startsWith('workspace-artifact:'))
)
const aiWorkspace = computed(
  () =>
    currentWorkspace.value && {
      ...currentWorkspace.value,
      assets: [
        ...studioAssets.value,
        ...inputSnapshots.value
          .filter((item) => item.input_owner === currentToolDraft.value?.id)
          .map((item) => ({
            path: `workspace-artifact:${item.id}`,
            name: item.name,
            kind: item.kind
          }))
      ]
    }
)
const assetInfo = computed<Record<string, FileNodeInfo>>(() => {
  const result = { ...mediaAssetInfo.value }
  for (const item of [...createdArtifacts.value, ...inputSnapshots.value]) {
    const path = `workspace-artifact:${item.id}`
    result[path] = {
      workspace_artifact_id: item.id,
      workspace_input_owner: item.input_owner,
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
    inputSnapshots.value = []
    return
  }
  try {
    const [result, inputs] = await Promise.all([
      listWorkspaceArtifacts(id),
      listWorkspaceInputs(id)
    ])
    if (request === artifactRequest) {
      createdArtifacts.value = result
      inputSnapshots.value = inputs
      await refreshWorks(true)
    }
  } catch {
    if (request === artifactRequest) {
      createdArtifacts.value = []
      inputSnapshots.value = []
    }
  }
}
async function openImageAIBranch(id: string) {
  await refreshArtifacts()
  const draft = currentWork.value?.drafts.find((item) => item.id === id && item.kind === 'ai')
  if (draft) await openDraft(draft)
  else message.error('AI 制作文件读取失败，请重新打开作品')
}
async function openAIBranchSource(id: string) {
  const source = currentWork.value?.drafts.find((item) => item.id === id)
  if (!source) return
  editorClosed()
  await nextTick()
  await openDraft(source)
}
watch(
  () => currentWorkspace.value?.id,
  () => {
    visibleArtifactCount.value = 60
    createdArtifacts.value = []
    inputSnapshots.value = []
    void refreshArtifacts()
  },
  { immediate: true }
)
watch(
  () =>
    backgroundTasks.value
      .flatMap((task) => task.results?.map((result) => result.artifact_id) ?? [task.artifact_id])
      .join(','),
  () => {
    void refreshArtifacts()
  }
)
const deletingArtifactId = ref('')
const renamingArtifactId = ref('')
const lastRemovedArtifactId = ref('')
const artifactRenameTarget = ref<WorkspaceArtifact>()
const artifactRenameName = ref('')
const artifactActionBusy = computed(() => !!deletingArtifactId.value || !!renamingArtifactId.value)
let artifactDeleteDialog: ReturnType<typeof Modal.confirm> | undefined
provide(workspaceArtifactActionsKey, {
  busy: artifactActionBusy,
  disabled: computed(() => !!global.conf?.is_readonly || artifactActionBusy.value),
  lastRemovedId: lastRemovedArtifactId,
  resolveFile: (file) => {
    if (file.workspace_input_owner || file.edit_snapshot) return
    if (!createdArtifacts.value.some((item) => item.id === file.workspace_artifact_id)) return
    return assetInfo.value[`workspace-artifact:${file.workspace_artifact_id}`]
  },
  rename: (file) => {
    if (file.workspace_input_owner || file.edit_snapshot) return
    const item = createdArtifacts.value.find((item) => item.id === file.workspace_artifact_id)
    if (!item || global.conf?.is_readonly || artifactActionBusy.value) return
    artifactRenameName.value = fileDisplayName(item.name)
    artifactRenameTarget.value = item
  },
  remove: (file) => {
    if (file.workspace_input_owner || file.edit_snapshot) return
    const item = createdArtifacts.value.find((item) => item.id === file.workspace_artifact_id)
    if (item) removeCreatedArtifact(item)
  }
})
onBeforeUnmount(() => artifactDeleteDialog?.destroy())
async function confirmArtifactRename() {
  const item = artifactRenameTarget.value
  if (
    !item ||
    !artifactRenameName.value.trim() ||
    global.conf?.is_readonly ||
    artifactActionBusy.value ||
    item.workspace_id !== currentWorkspace.value?.id
  )
    return
  renamingArtifactId.value = item.id
  try {
    const { name } = await renameWorkspaceArtifact(item.id, artifactRenameName.value.trim())
    createdArtifacts.value = createdArtifacts.value.map((row) =>
      row.id === item.id ? { ...row, name } : row
    )
    artifactRenameTarget.value = undefined
    message.success('产物已重命名')
  } catch (error) {
    message.error(getErrorMessage(error, '重命名失败，请重试'))
  } finally {
    renamingArtifactId.value = ''
  }
}
function removeCreatedArtifact(item: WorkspaceArtifact) {
  if (global.conf?.is_readonly || artifactActionBusy.value) return
  artifactDeleteDialog?.destroy()
  const workspaceId = currentWorkspace.value?.id
  artifactDeleteDialog = Modal.confirm({
    zIndex: 1220,
    title: `删除产物“${item.name}”？`,
    content:
      '会永久删除这项工作区产物，引用它的制作文件可能显示素材不可用。已同步到媒体库的副本会保留。',
    okText: '删除产物',
    okType: 'danger',
    cancelText: '取消',
    onOk: async () => {
      if (
        global.conf?.is_readonly ||
        artifactActionBusy.value ||
        currentWorkspace.value?.id !== workspaceId
      )
        throw new Error('当前工作区不可删除产物')
      deletingArtifactId.value = item.id
      try {
        await deleteWorkspaceArtifact(item.id)
        lastRemovedArtifactId.value = item.id
        if (assetPreview.value?.workspace_artifact_id === item.id) closeAssetPreview()
        await refreshArtifacts()
        message.success('产物已删除')
      } catch (error) {
        message.error(getErrorMessage(error, '删除产物失败，请重试'))
        throw error
      } finally {
        deletingArtifactId.value = ''
      }
    }
  })
}
const syncingOutputPath = ref('')
const syncedOutputFiles = computed(() =>
  Object.fromEntries(
    createdArtifacts.value.map((artifact) => [
      `workspace-artifact:${artifact.id}`,
      artifact.synced_media ?? []
    ])
  )
)
async function syncWorkOutput(asset: WorkspaceAsset, overwriteMediaId?: number) {
  const work = currentWork.value
  const artifactId = assetInfo.value[asset.path]?.workspace_artifact_id
  if (
    !work ||
    !artifactId ||
    !work.outputs.some((output) => output.path === asset.path) ||
    global.conf?.is_readonly ||
    syncingOutputPath.value
  )
    return
  syncingOutputPath.value = asset.path
  try {
    const directory = overwriteMediaId ? '' : ((await chooseLibraryDirectory()) ?? '')
    if (!directory && !overwriteMediaId) return
    const result = await syncWorkspaceArtifact(artifactId, work.id, directory, overwriteMediaId)
    await refreshArtifacts()
    if (result.collected)
      message.success(result.overwritten ? '已覆盖同步文件' : '成果已同步到媒体库')
    else message.warning('成果已复制到所选目录，但尚未收录到媒体库，请重新扫描该目录')
  } catch (error) {
    message.error(getErrorMessage(error, '同步到媒体库失败'))
    await refreshArtifacts()
  } finally {
    syncingOutputPath.value = ''
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
  if (!info || info.cloud_only || brokenThumbs.value.has(asset.path)) return ''
  return asset.kind === 'image'
    ? toImageThumbnailUrl(info, '256x256')
    : asset.kind === 'video'
      ? toVideoCoverUrl(info)
      : audioCoverUrl(info)
}
function thumbnailFailed(path: string) {
  brokenThumbs.value = new Set([...brokenThumbs.value, path])
}
const assetPreview = ref<FileNodeInfo>()
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
const navigationLevel = computed(() =>
  !currentWorkspace.value ? 0 : workDetailOpen.value && currentWork.value ? 2 : 1
)
const navigationViewKey = computed(() =>
  navigationLevel.value === 0
    ? 'home'
    : navigationLevel.value === 1
      ? `workspace:${currentWorkspace.value?.id}`
      : `work:${currentWorkspace.value?.id}:${currentWork.value?.id}`
)
const navigationTransition = ref('workbench-forward')
watch(navigationLevel, (level, previous) => {
  navigationTransition.value = level < previous ? 'workbench-back' : 'workbench-forward'
})
const workDetailTab = ref<'drafts' | 'outputs'>('drafts')
const currentToolDraft = computed(() =>
  currentDraft.value && draftTool(currentDraft.value.kind) === activeTool.value
    ? currentDraft.value
    : undefined
)
const noteDraft = ref('')
const noteSaving = ref(false)
const toolNoteDirty = computed(() => noteDraft.value !== (currentToolDraft.value?.brief ?? ''))
watch(
  [() => currentToolDraft.value?.id, () => currentToolDraft.value?.brief],
  ([id, brief], previous) => {
    if (!previous || id !== previous[0] || noteDraft.value === (previous[1] ?? ''))
      noteDraft.value = brief ?? ''
  },
  { immediate: true }
)
async function saveToolNote() {
  const work = currentWork.value,
    draft = currentToolDraft.value
  if (!work || !draft || global.conf?.is_readonly || noteSaving.value || !toolNoteDirty.value)
    return
  noteSaving.value = true
  try {
    if (await updateDraft(work, draft, draft.name, noteDraft.value.slice(0, 5000)))
      message.success('制作文件笔记已保存')
    else message.error(workError.value || '笔记保存失败，请重试')
  } finally {
    noteSaving.value = false
  }
}
const workDialogOpen = ref(false),
  editingWorkId = ref(''),
  workName = ref(''),
  workBrief = ref('')
const productionDialogOpen = ref(false),
  editingProductionId = ref(''),
  productionName = ref(''),
  productionBrief = ref(''),
  productionKind = ref<ProductionKind | 'ai-generation'>('image')
const assetChoiceOpen = ref(false),
  assetChoiceWorkId = ref(''),
  assetChoicePaths = ref<string[]>([])
const workKindLabel = (kind: MediaKind) => ({ image: '图片', video: '视频', audio: '音频' })[kind]
function showNewWork() {
  if (!currentWorkspace.value || global.conf?.is_readonly || !worksReady.value || workError.value)
    return
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
  if (saved) await refreshWorks()
  return saved
}
async function openWork(work: WorkspaceWork, entry?: ToolKey) {
  if (work.id !== currentWork.value?.id && !(await leaveAISession())) return
  if (!(await selectWork(work.id))) return
  workDetailOpen.value = true
  workDetailTab.value = 'drafts'
  if (!entry) {
    await activateTool('overview')
    return
  }
  const draft =
    work.drafts.find((item) => item.id === work.activeDraftId) ??
    work.drafts.find((item) => draftTool(item.kind) === entry)
  if (draft) await openDraft(draft)
  else await activateTool('overview')
}
async function openDraft(draft: ProductionDraft) {
  const work = currentWork.value
  if (!work || !work.drafts.some((item) => item.id === draft.id)) return
  if (draft.id !== currentDraft.value?.id && !(await leaveAISession())) return
  if (!(await selectDraft(work, draft))) return
  await activateTool(draftTool(draft.kind))
  if (draft.kind === 'image' && activeTool.value === 'image') {
    requestedDraftId.value = draft.id
    imageOpenRequest.value++
  } else if (draft.kind === 'ai' && activeTool.value === 'ai') {
    requestedAIDraftId.value = draft.id
  }
}
async function imageOpened(id: string) {
  const workId = currentWork.value?.id
  await refreshWorks()
  const work = works.value.find((item) => item.id === workId)
  const draft = work?.drafts.find((item) => item.id === id)
  if (work && draft && work.activeDraftId !== id) selectDraft(work, draft)
}
function editorClosed() {
  activeTool.value = 'overview'
  requestedDraftId.value = ''
  imageOpenRequest.value = 0
  requestedAIDraftId.value = ''
  void refreshWorks()
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
    if (work && (await updateWork({ ...work, name, brief: workBrief.value.trim() })))
      workDialogOpen.value = false
  } else {
    if (!(await leaveAISession())) return
    const work = await createWork(name, workBrief.value.trim())
    if (!work) {
      if (!workError.value) message.warning('作品数量已达到上限')
      return
    }
    workDialogOpen.value = false
    await openWork(work)
  }
}
function showNewDraft(kind: ProductionKind | 'ai-generation') {
  if (!currentWork.value || global.conf?.is_readonly) return
  editingProductionId.value = ''
  productionKind.value = kind
  productionName.value = ''
  productionBrief.value = ''
  productionDialogOpen.value = true
}
function showDraftInfo(draft: ProductionDraft) {
  editingProductionId.value = draft.id
  productionKind.value = draft.aiPurpose === 'image_generation' ? 'ai-generation' : draft.kind
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
      if (!(await updateDraft(work, draft, name, brief))) throw new Error('保存失败')
      refreshWorks()
      imagePage.value?.loadDrafts()
      productionDialogOpen.value = false
    } catch {
      refreshWorks()
      message.error('制作文件信息保存失败')
    }
    return
  }
  if (!(await leaveAISession())) return
  const draft = await createWorkDraft(
    work,
    productionKind.value === 'ai-generation' ? 'ai' : productionKind.value,
    name,
    brief,
    productionKind.value === 'ai-generation' ? 'image_generation' : undefined
  )
  if (!draft) {
    if (!workError.value) message.warning('制作文件数量已达到上限')
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
    title: `删除制作文件“${draft.name}”？`,
    content: '会删除这份本机制作文件。作品、原素材和已保存的成果会保留。',
    okText: '删除制作文件',
    cancelText: '取消',
    okType: 'danger',
    async onOk() {
      if (currentWork.value?.id !== work.id || !(await leaveAISession()))
        throw new Error('未删除制作文件')
      if (!(await removeDraft(work, draft))) throw new Error('删除失败')
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
    content: '会删除此作品和其中所有本机制作文件。引用的媒体和已保存的成果文件不会删除。',
    okText: '删除作品',
    cancelText: '取消',
    okType: 'danger',
    async onOk() {
      if (currentWorkspace.value?.id !== workspaceId || !(await leaveAISession()))
        throw new Error('未删除作品')
      if (!(await removeWork(work))) throw new Error('作品记录删除失败')
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
const workAssetChoices = computed(() => createdAssets.value)
function toggleWorkAsset(path: string) {
  assetChoicePaths.value = assetChoicePaths.value.includes(path)
    ? assetChoicePaths.value.filter((item) => item !== path)
    : [...assetChoicePaths.value, path]
}
async function saveWorkOutputs() {
  const work = works.value.find((item) => item.id === assetChoiceWorkId.value)
  if (!work || global.conf?.is_readonly) return
  const selected = new Set(assetChoicePaths.value)
  const available = new Set(workAssetChoices.value.map((asset) => asset.path))
  if (
    await updateWork({
      ...work,
      outputs: [
        ...work.outputs.filter((asset) => !available.has(asset.path)),
        ...workAssetChoices.value.filter((asset) => selected.has(asset.path))
      ]
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
          ><span v-if="!currentWorkspace">按项目组织创作</span>
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
            :aria-selected="activePage === 'overview'"
            aria-controls="workbench-panel-overview"
            :tabindex="activePage === 'overview' ? 0 : -1"
            :class="{ active: activePage === 'overview' }"
            @click="activateTool('overview')"
          >
            <AppstoreOutlined />工作区
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
      {{ workError }} <a-button size="small" @click="refreshWorks(true)">重试</a-button>
    </p>
    <div
      v-if="
        pendingTasks.length &&
        (!showMaterials || materialView === 'used') &&
        activeTool !== 'config'
      "
      class="workspace-task-list"
      aria-label="后台加工任务"
    >
      <AITaskCard v-for="task in pendingTasks" :key="task.id" :task="task" />
    </div>

    <Transition :name="navigationTransition" mode="out-in">
      <div :key="navigationViewKey" class="workbench-view">
        <div v-if="showMaterials" class="workbench-materials">
          <header class="workbench-materials-heading">
            <button type="button" class="back-link" @click="workDetailOpen = false">
              <ArrowLeftOutlined />{{ currentWorkspace?.name }} / 全部作品
            </button>
            <div class="material-scope-controls" role="group" aria-label="素材范围">
              <button
                type="button"
                :aria-pressed="materialView === 'all'"
                @click="materialView = 'all'"
              >
                全部素材
              </button>
              <button
                type="button"
                :aria-pressed="materialView === 'used'"
                @click="materialView = 'used'"
              >
                已使用 <small>{{ currentUsedAssets.length }}</small>
              </button>
            </div>
          </header>
          <WorkspaceMaterialShelf
            :context-key="`${currentWorkspace?.id}:${currentWork?.id}:overview:${materialView}`"
            :assets="overviewMaterials"
            :empty-state="
              materialView === 'used'
                ? { title: '尚未使用素材', description: '制作文件使用的素材会自动记录在这里。' }
                : undefined
            "
            :asset-info="assetInfo"
            :allowed-kinds="allowedMaterialKinds"
            :tasks="materialView === 'all' ? pendingTasks : []"
            :readonly="global.conf?.is_readonly"
            @select="previewAsset"
            @add="addOverviewMaterials"
          />
        </div>
        <div
          v-show="activePage === 'overview'"
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
                  ><a-button
                    :disabled="global.conf?.is_readonly"
                    @click="showEdit(currentWorkspace)"
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
              :readonly="global.conf?.is_readonly || !!workError || !worksReady"
              @create="showNewWork"
              @open="openWork"
              @rename="showWorkInfo"
              @remove="confirmRemoveWork"
            />
            <template v-if="workDetailOpen && currentWork">
              <section class="business-work-heading">
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
                <div class="business-work-toolbar">
                  <nav class="business-work-tabs" aria-label="作品内容">
                    <button
                      type="button"
                      :class="{ active: workDetailTab === 'drafts' }"
                      @click="workDetailTab = 'drafts'"
                    >
                      制作 <small>{{ currentWork.drafts.length }}</small></button
                    ><button
                      type="button"
                      :class="{ active: workDetailTab === 'outputs' }"
                      @click="workDetailTab = 'outputs'"
                    >
                      成果 <small>{{ currentWork.outputs.length }}</small>
                    </button>
                  </nav>
                  <div class="business-tab-actions">
                    <a-dropdown v-if="workDetailTab === 'drafts'" :trigger="['click']">
                      <a-button :disabled="global.conf?.is_readonly || !!workError">
                        <PlusOutlined />新建
                      </a-button>
                      <template #overlay>
                        <a-menu>
                          <a-menu-item @click="showNewDraft('image')"
                            ><PictureOutlined /> 图片画布</a-menu-item
                          >
                          <a-menu-item @click="showNewDraft('video')"
                            ><VideoCameraOutlined /> 视频剪辑</a-menu-item
                          >
                          <a-menu-item @click="showNewDraft('audio')"
                            ><AudioOutlined /> 音频制作</a-menu-item
                          >
                          <a-menu-item @click="showNewDraft('ai-generation')"
                            ><PictureOutlined /> AI 图片生成</a-menu-item
                          >
                          <a-menu-item @click="showNewDraft('ai')"
                            ><RobotOutlined /> AI 图片编辑</a-menu-item
                          >
                        </a-menu>
                      </template>
                    </a-dropdown>
                    <template v-else>
                      <a-button
                        :disabled="global.conf?.is_readonly || !!workError"
                        @click="chooseWorkOutputs()"
                        >选择产物</a-button
                      >
                    </template>
                  </div>
                </div>
              </section>
              <WorkProductionDrafts
                v-if="workDetailTab === 'drafts'"
                hide-header
                :workspace-id="currentWorkspace.id"
                :work-id="currentWork.id"
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
                @artifacts-changed="refreshArtifacts"
                @publish="(draft) => imagePage?.publishDraft(draft.id)"
              />
              <section v-else class="work-section business-files" aria-label="作品成果">
                <p class="work-choice-hint">选定用于交付或展示的结果，可保留多个版本。</p>
                <div v-if="currentWork.outputs.length" class="business-file-grid">
                  <article v-for="asset in currentWorkOutputs" :key="asset.path">
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
                          alt="" /><AudioOutlined
                          v-else-if="asset.kind === 'audio'" /><PictureOutlined
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
                          ><a-menu-item
                            v-if="
                              assetInfo[asset.path]?.workspace_artifact_id &&
                              !syncedOutputFiles[asset.path]?.length
                            "
                            :disabled="global.conf?.is_readonly || !!syncingOutputPath"
                            @click="syncWorkOutput(asset)"
                            >同步到媒体库</a-menu-item
                          ><template v-for="file in syncedOutputFiles[asset.path]" :key="file.id"
                            ><a-menu-item
                              :title="file.path"
                              @click="
                                previewAsset({
                                  ...asset,
                                  path: file.path,
                                  name: file.name
                                })
                              "
                              >查看媒体库文件<span v-if="syncedOutputFiles[asset.path].length > 1"
                                >：{{ fileDisplayName(file.name) }}</span
                              ></a-menu-item
                            ><a-menu-item
                              :disabled="global.conf?.is_readonly || !!syncingOutputPath"
                              @click="syncWorkOutput(asset, file.id)"
                              >再次同步覆盖<span v-if="syncedOutputFiles[asset.path].length > 1"
                                >：{{ fileDisplayName(file.name) }}</span
                              ></a-menu-item
                            ></template
                          ><a-menu-divider /><a-menu-item
                            :disabled="global.conf?.is_readonly || !!syncingOutputPath"
                            @click="removeWorkOutput(asset.path)"
                            >移出成果</a-menu-item
                          ></a-menu
                        ></template
                      ></a-dropdown
                    >
                    <a-dropdown
                      v-if="syncedOutputFiles[asset.path]?.length"
                      :trigger="['click']"
                      placement="bottomLeft"
                    >
                      <button
                        type="button"
                        class="outcome-sync synced"
                        :aria-label="`已同步：${asset.name}`"
                        :disabled="!!syncingOutputPath"
                      >
                        <CheckOutlined />
                        {{ syncingOutputPath === asset.path ? '正在同步…' : '已同步' }}
                        <DownOutlined />
                      </button>
                      <template #overlay>
                        <a-menu>
                          <template v-for="file in syncedOutputFiles[asset.path]" :key="file.id">
                            <a-menu-item
                              :title="file.path"
                              @click="
                                previewAsset({
                                  ...asset,
                                  path: file.path,
                                  name: file.name
                                })
                              "
                            >
                              查看媒体库文件<span v-if="syncedOutputFiles[asset.path].length > 1"
                                >：{{ fileDisplayName(file.name) }}</span
                              >
                            </a-menu-item>
                            <a-menu-item
                              :title="file.path"
                              :disabled="global.conf?.is_readonly || !!syncingOutputPath"
                              @click="syncWorkOutput(asset, file.id)"
                            >
                              再次同步覆盖<span v-if="syncedOutputFiles[asset.path].length > 1"
                                >：{{ fileDisplayName(file.name) }}</span
                              >
                            </a-menu-item>
                          </template>
                        </a-menu>
                      </template>
                    </a-dropdown>
                    <button
                      v-else-if="assetInfo[asset.path]?.workspace_artifact_id"
                      type="button"
                      class="outcome-sync"
                      :aria-label="`同步成果到媒体库：${asset.name}`"
                      :disabled="global.conf?.is_readonly || !!syncingOutputPath"
                      @click="syncWorkOutput(asset)"
                    >
                      {{ syncingOutputPath === asset.path ? '正在同步…' : '同步到媒体库' }}
                    </button>
                  </article>
                </div>
                <div v-else class="asset-empty">
                  还没有选定成果。从工作区产物中选择后，可将成果同步到媒体库。
                </div>
              </section>
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
                      <a-button :disabled="global.conf?.is_readonly" @click="openPicker()"
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
                              @click="removeAsset(asset.path)"
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
                              v-if="thumbnailFor(createdAssets[index])"
                              :src="thumbnailFor(createdAssets[index])"
                              alt=""
                              @error="thumbnailFailed(createdAssets[index].path)" /><AudioOutlined
                              v-else-if="item.kind === 'audio'" /><VideoCameraOutlined
                              v-else-if="item.kind === 'video'" /><PictureOutlined
                              v-else /><MediaTypeBadge
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
                              v-if="['ai_image_edit', 'ai_image_generation'].includes(item.source)"
                              @click="openPreviewWithFile(assetInfo[createdAssets[index].path])"
                              >编辑素材信息</a-menu-item
                            ><a-menu-divider /><a-menu-item
                              :disabled="global.conf?.is_readonly || !!deletingArtifactId"
                              danger
                              @click="removeCreatedArtifact(item)"
                              >删除产物</a-menu-item
                            ></a-menu
                          ></template
                        >
                      </a-dropdown>
                    </div>
                    <a-button
                      v-if="createdArtifacts.length > visibleArtifactCount"
                      class="artifact-more"
                      @click="visibleArtifactCount += 60"
                      >显示更多素材（{{
                        createdArtifacts.length - visibleArtifactCount
                      }}
                      项）</a-button
                    >
                    <div v-if="!createdArtifacts.length" class="artifact-empty">
                      <strong>暂无这类素材</strong>
                      <p>
                        图片制作、AI
                        创作等工具产生的内容会在这里管理。选为作品成果后，可同步到媒体库。
                      </p>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </template>
          <template v-else>
            <WorkspaceHome
              v-model:view="view"
              :records="records"
              :saving="saving"
              :readonly="!global.conf || global.conf.is_readonly"
              :save-cover="setWorkspaceCover"
              @create="showCreate"
              @open="openWorkspace"
              @resume="resumeWorkspace"
              @edit="showEdit"
              @status="toggleStatus"
              @remove="confirmRemove"
            />
          </template>
        </div>
      </div>
    </Transition>
    <ImageCreationPage
      ref="imagePage"
      v-if="currentWorkspace && currentWork"
      :key="`${currentWorkspace.id}:${currentWork.id}`"
      v-model:note="noteDraft"
      :note-dirty="toolNoteDirty"
      :note-saving="noteSaving"
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
      editor-only
      @new-work="showNewDraft('image')"
      @opened="imageOpened"
      @closed="editorClosed"
      @drafts-changed="refreshWorks"
      @add-assets="openPicker()"
      @save-note="saveToolNote"
      @artifact-saved="refreshArtifacts"
      @branch-opened="openImageAIBranch"
    />
    <AICreationPage
      v-if="currentWork && currentToolDraft?.kind === 'ai'"
      :key="`${currentWorkspace?.id}:${currentWork.id}:${currentToolDraft.id}`"
      ref="aiPage"
      v-model:section="aiSection"
      v-model:note="noteDraft"
      :note-dirty="toolNoteDirty"
      :note-saving="noteSaving"
      :active="activeTool === 'ai'"
      :workspace="aiWorkspace"
      :draft-scope="`${currentWork.id}:${currentToolDraft.id}`"
      :production-id="currentToolDraft.id"
      :production-name="currentToolDraft.name"
      :purpose="currentToolDraft.aiPurpose"
      :artifacts="createdArtifacts"
      :production-source="currentToolDraft.source"
      :source-name="
        currentWork.drafts.find((item) => item.id === currentToolDraft?.source?.documentId)?.name
      "
      :open-requested="requestedAIDraftId === currentToolDraft.id"
      @opened="requestedAIDraftId = ''"
      @closed="editorClosed"
      @open-source="openAIBranchSource"
      :asset-info="assetInfo"
      :readonly="global.conf?.is_readonly"
      @artifact-saved="refreshArtifacts"
      @configure="activateTool('config')"
      @save-note="saveToolNote"
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
          @add="openPicker()"
        />
      </template>
    </AICreationPage>
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
    <AudioCreationEditor
      v-if="
        activeTool === 'media' &&
        currentWorkspace &&
        currentWork &&
        currentToolDraft?.kind === 'audio'
      "
      :key="`${currentWorkspace.id}:${currentToolDraft.id}`"
      :workspace-id="currentWorkspace.id"
      :workspace-name="currentWorkspace.name"
      :work="currentWork"
      :draft="currentToolDraft"
      :assets="studioAssets"
      :asset-info="assetInfo"
      :readonly="global.conf?.is_readonly"
      @closed="editorClosed"
      @artifact-saved="refreshArtifacts"
      @imported="addPicked"
    />
    <a-modal
      :open="activeTool === 'media' && currentToolDraft?.kind === 'video'"
      :title="
        currentToolDraft
          ? `${currentToolDraft.name} · ${draftKindLabel(currentToolDraft.kind)}`
          : ''
      "
      width="min(1200px, calc(100vw - 48px))"
      :style="{ top: '24px' }"
      :body-style="{ maxHeight: 'calc(100dvh - 136px)', overflow: 'auto' }"
      :footer="null"
      :mask-closable="false"
      destroy-on-close
      @cancel="editorClosed"
    >
      <WorkspaceMaterialShelf
        v-if="currentWorkspace && currentWork"
        :context-key="`${currentWorkspace.id}:${currentWork.id}:media`"
        :assets="studioAssets"
        :asset-info="assetInfo"
        :allowed-kinds="allowedMaterialKinds"
        :tasks="pendingTasks"
        :readonly="global.conf?.is_readonly"
        class="media-editor-materials"
        @select="previewAsset"
        @add="openPicker()"
      />
      <MediaCreationPage
        v-if="currentWork && currentToolDraft && ['video', 'audio'].includes(currentToolDraft.kind)"
        :work="currentWork"
        :draft="currentToolDraft"
        :assets="studioAssets"
        :asset-info="assetInfo"
        :readonly="global.conf?.is_readonly"
        @preview="previewAsset"
        @add-assets="openPicker()"
        @edit="showDraftInfo(currentToolDraft)"
      />
    </a-modal>
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
      :title="editingProductionId ? '制作文件信息' : '新建制作文件'"
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
              (['image', 'video', 'audio', 'ai', 'ai-generation'] as const).map((kind) => ({
                value: kind,
                label:
                  kind === 'ai-generation'
                    ? 'AI 图片生成'
                    : kind === 'ai'
                      ? 'AI 图片编辑'
                      : draftKindLabel(kind)
              }))
            " /></template
        ><label for="production-name">制作文件名称</label
        ><a-input
          id="production-name"
          v-model:value="productionName"
          :maxlength="80"
          placeholder="例如：第一集分镜、旁白录音、图生视频参考"
          @press-enter="saveDraftDialog"
        /><label for="production-brief">制作文件笔记（可选）</label
        ><a-textarea
          id="production-brief"
          v-model:value="productionBrief"
          :rows="3"
          :maxlength="5000"
          placeholder="这一步的想法、台词或提示词"
        /><small class="work-form-note"
          >保存在“{{ currentWork?.name }}”中。{{
            productionKind === 'video' ? '视频剪辑功能仍为布局预览。' : ''
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
      :style="{ top: '32px' }"
      :body-style="{ maxHeight: 'calc(100dvh - 180px)', overflow: 'auto' }"
      :ok-button-props="{ disabled: global.conf?.is_readonly || !!workError }"
      @ok="saveWorkOutputs"
      @cancel="assetChoiceOpen = false"
    >
      <p class="work-choice-hint">从工作区产物中选择用于交付或展示的成果，之后可同步到媒体库。</p>
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
      <div v-else class="asset-empty">工作区还没有产物，请先从制作文件导出或完成 AI 加工。</div>
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
      title="从媒体库加入素材"
      :saving="saving"
      :allowed-types="showMaterials ? allowedMaterialKinds : undefined"
      confirm-text="加入工作区"
      @confirm="addPicked"
      @close="pickerOpen = false"
    />
    <WorkspaceAssetPreview
      v-if="assetPreview"
      :file="assetPreview"
      :workspace-name="currentWorkspace?.name"
      @close="closeAssetPreview"
    />
    <a-modal
      :open="!!artifactRenameTarget"
      title="重命名产物"
      :z-index="1220"
      ok-text="保存"
      cancel-text="取消"
      :confirm-loading="!!renamingArtifactId"
      :mask-closable="!artifactActionBusy"
      :keyboard="!artifactActionBusy"
      :closable="!artifactActionBusy"
      :cancel-button-props="{ disabled: artifactActionBusy }"
      :ok-button-props="{
        disabled: !!global.conf?.is_readonly || !artifactRenameName.trim() || !!deletingArtifactId
      }"
      @ok="confirmArtifactRename"
      @cancel="!artifactActionBusy && (artifactRenameTarget = undefined)"
    >
      <label for="workspace-artifact-name">产物名称</label>
      <a-input
        id="workspace-artifact-name"
        v-model:value="artifactRenameName"
        :maxlength="120"
        :disabled="artifactActionBusy || !!global.conf?.is_readonly"
        autofocus
        @press-enter="confirmArtifactRename"
      />
      <p class="artifact-rename-hint">保留原格式，文件扩展名会自动补全。</p>
    </a-modal>
  </div>
</template>

<style scoped>
.artifact-rename-hint {
  color: var(--ui-muted);
  font-size: 12px;
  margin: 12px 0 0;
}
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
.business-work-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 16px;
  border-bottom: 1px solid var(--ui-border);
  margin-top: 24px;
}
.business-work-tabs {
  display: flex;
  gap: 8px;
  flex: none;
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
.business-tab-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-left: auto;
  padding-block: 6px;
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
  top: 10px;
  right: 10px;
  background: var(--ui-surface);
}
.outcome-sync {
  display: block;
  width: 100%;
  margin-top: 10px;
  padding: 5px 8px;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  background: var(--ui-surface);
  color: var(--primary-color);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.outcome-sync:hover:not(:disabled) {
  background: var(--ui-hover);
}
.outcome-sync.synced {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: var(--primary-color-1);
}
.outcome-sync.synced .anticon-down {
  font-size: 10px;
}
.outcome-sync:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}
.outcome-sync:disabled {
  opacity: 0.5;
  cursor: default;
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
.workbench-materials-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
  min-height: 28px;
}
.material-scope-controls {
  display: flex;
  gap: 4px;
}
.material-scope-controls button {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 3px 9px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ui-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.material-scope-controls button:hover {
  background: var(--ui-hover);
  color: var(--ui-text);
}
.material-scope-controls button[aria-pressed='true'] {
  background: color-mix(in srgb, var(--primary-color) 9%, transparent);
  color: var(--primary-color);
}
.material-scope-controls button:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}
.material-scope-controls small {
  font-size: 11px;
  opacity: 0.75;
}
.media-editor-materials {
  margin-bottom: 18px;
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
  min-height: 46px;
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
  overflow: hidden auto;
  background: transparent;
  color: var(--ui-text);
}
.workbench-view {
  width: 100%;
  min-width: 0;
}
.workbench-forward-enter-active,
.workbench-back-enter-active {
  transition:
    opacity 160ms var(--ui-ease),
    transform 160ms var(--ui-ease);
}
.workbench-forward-leave-active,
.workbench-back-leave-active {
  transition:
    opacity 80ms var(--ui-ease),
    transform 80ms var(--ui-ease);
  pointer-events: none;
}
.workbench-forward-enter-from,
.workbench-back-leave-to {
  opacity: 0;
  transform: translateX(10px);
}
.workbench-back-enter-from,
.workbench-forward-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}
@media (prefers-reduced-motion: reduce) {
  .workbench-forward-enter-active,
  .workbench-back-enter-active,
  .workbench-forward-leave-active,
  .workbench-back-leave-active {
    transition: none;
  }
  .workbench-forward-enter-from,
  .workbench-back-enter-from,
  .workbench-forward-leave-to,
  .workbench-back-leave-to {
    transform: none;
  }
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
.tool-note {
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
.section-heading h2,
.next-step h2 {
  margin: 0 0 3px;
  font-size: 18px;
  line-height: 1.35;
  font-weight: 700;
}
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
.asset-row button:hover:not(:disabled) {
  background: var(--ui-hover);
  color: var(--ui-text);
}
.asset-row button:disabled {
  opacity: 0.5;
  cursor: default;
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
  grid-template-columns: repeat(auto-fill, minmax(min(190px, 100%), 1fr));
  gap: 12px;
  max-height: 480px;
  padding: 2px;
}
.asset-panel .asset-row {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  padding: 8px;
  border-color: var(--ui-border);
  background: var(--ui-surface);
}
.asset-panel .asset-row:hover {
  border-color: var(--primary-color);
  box-shadow: var(--ui-shadow-card);
}
.asset-panel .asset-row-copy {
  flex: none;
  padding: 0 2px 2px;
}
.asset-panel .asset-row strong {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  min-height: 36px;
  line-height: 18px;
  white-space: normal;
  overflow-wrap: anywhere;
}
.asset-panel .asset-thumb {
  width: 100%;
  height: 148px;
  font-size: 32px;
}
.asset-panel .asset-thumb img {
  object-fit: contain;
}
@media (max-width: 900px) {
  .workspace-columns {
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
  .tool-workspace-strip > div {
    flex-wrap: wrap;
  }
}
</style>
