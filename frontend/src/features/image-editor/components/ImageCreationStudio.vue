<script setup lang="ts">
import { useStudioLayerDrag } from '../composables/useStudioLayerDrag'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { message, Modal } from 'ant-design-vue'
import {
  BorderOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  FolderOutlined,
  LockOutlined,
  UnlockOutlined,
  MoreOutlined,
  PictureOutlined,
  FontSizeOutlined,
  FolderAddOutlined,
  UndoOutlined,
  RedoOutlined,
  FileTextOutlined,
  BoldOutlined,
  AlignLeftOutlined,
  AlignCenterOutlined,
  AlignRightOutlined,
  EditOutlined,
  RobotOutlined,
  ControlOutlined,
  CloseOutlined,
  ArrowLeftOutlined,
  ScissorOutlined,
  DragOutlined,
  ExpandOutlined
} from '@ant-design/icons-vue'
import { type FileNodeInfo, type ImageEditRecord } from '@/features/media-library/public'
import { toImageThumbnailUrl } from '@/features/media-library/public'
import { useApplicationStore } from '@/features/application/public'

import { aspectRatioPresets } from '@/shared/lib/aspectRatioPresets'

import { imageLayouts, type ImageLayout } from '../model/imageCreationModel'
import {
  applyStudioTemplate,
  cropStudioImage,
  createImageLayer,
  createStudioDocument,
  createStudioGroup,
  createTextLayer,
  moveStudioLayerToGroup,
  moveStudioLayersToGroup,
  dropStudioItem,
  resizeStudioCanvas,
  studioGroupBounds,
  studioLayerLocked,
  studioLayerVisible,
  resizeStudioFrame,
  type StudioCrop,
  type StudioDocument,
  type StudioDocumentIndex,
  type StudioGroup,
  type StudioImageLayer,
  type StudioLayer,
  type StudioTextLayer
} from '../model/imageStudioModel'
import {
  clearStudioImageCache,
  renderStudioDocument,
  studioImageDimensions,
  type StudioRenderScope
} from '../model/imageStudioRender'
import { studioFontFamily, studioFonts } from '../model/imageStudioFonts.ts'
import { layoutStudioText } from '../model/imageStudioText.ts'
import MediaLibraryPicker from '@/features/media-library/components/MediaLibraryPicker.vue'
import StudioRangeControl from './StudioRangeControl.vue'
import StudioLayersIcon from './StudioLayersIcon.vue'
import type { ImageEditorProps } from '../model/imageEditorContract'
import type { StudioDraftRepository } from '../model/studioDraftRepository'
import { useStudioOutput } from '../composables/useStudioOutput'

const props = defineProps<ImageEditorProps>()
const global = useApplicationStore()
const studioRoot = ref<HTMLElement>()
const note = defineModel<string>('note', { required: true })
const emit = defineEmits<{
  addAssets: []
  saveNote: []
  artifactSaved: []
  exit: []
  mediaSaved: [file: FileNodeInfo, overwrite: boolean, record: ImageEditRecord]
  libraryImagePicked: [file: FileNodeInfo]
}>()
const imageAssets = computed(() => props.assets.filter((asset) => asset.kind === 'image'))
const docs = ref<StudioDocumentIndex['docs']>([])
const draft = ref<StudioDocument>(createStudioDocument())
const originalDocument = ref<StudioDocument>(createStudioDocument())
const comparing = ref(false)
const backgroundMode = computed(() =>
  draft.value.background !== 'transparent'
    ? 'solid'
    : draft.value.backgroundView === 'checkerboard'
      ? 'checkerboard'
      : 'transparent'
)
const solidBackground = ref('#ffffff')
watch(
  () => draft.value.background,
  (value) => {
    if (value !== 'transparent') solidBackground.value = value
  },
  { immediate: true }
)
function setBackground(mode: string) {
  change(() => {
    if (draft.value.background !== 'transparent') solidBackground.value = draft.value.background
    draft.value.background = mode === 'solid' ? solidBackground.value : 'transparent'
    if (mode === 'checkerboard') draft.value.backgroundView = 'checkerboard'
    else delete draft.value.backgroundView
  })
}

const exitConfirmOpen = ref(false)
const mediaDirty = computed(
  () => JSON.stringify(draft.value) !== JSON.stringify(originalDocument.value)
)
const selectedId = ref('')
const selectedIds = ref<string[]>([])
const selectedGroupId = ref('')
const selected = computed(() => draft.value.layers.find((layer) => layer.id === selectedId.value))
const selectedGroup = computed(() =>
  draft.value.groups.find((group) => group.id === selectedGroupId.value)
)
const imageLayer = computed(() => (selected.value?.kind === 'image' ? selected.value : undefined))
const canAdjustImage = computed(
  () =>
    !props.readonly &&
    !comparing.value &&
    !selectedGroupId.value &&
    selectedIds.value.length === 1 &&
    !!imageLayer.value?.path &&
    studioLayerVisible(draft.value, imageLayer.value) &&
    !studioLayerLocked(draft.value, imageLayer.value)
)
const textLayer = computed(() => (selected.value?.kind === 'text' ? selected.value : undefined))
const selectedGroupLayerCount = computed(() => {
  const group = selectedGroup.value
  return group ? draft.value.layers.filter((layer) => layer.groupId === group.id).length : 0
})
function updateTextStyle(patch: Partial<Pick<StudioTextLayer, 'bold' | 'align'>>) {
  const layer = textLayer.value
  if (layer) change(() => Object.assign(layer, patch))
}
function updateImageFit(fit: StudioImageLayer['fit']) {
  const layer = imageLayer.value
  if (layer)
    change(() => {
      layer.fit = fit
    })
}
const panning = ref(false)
const inspectorTab = ref<'properties' | 'notes'>('properties')
const inspectorOpen = ref(!!props.standalone)
const layersOpen = ref(false)
const layerPanelPercent = ref(32)
let resizingPanels = false
function resizePanels(event: PointerEvent) {
  if (!resizingPanels) return
  const grid = (event.currentTarget as HTMLElement).parentElement?.getBoundingClientRect()
  if (!grid) return
  layerPanelPercent.value = Math.max(
    20,
    Math.min(55, ((event.clientY - grid.top - 12) / grid.height) * 100)
  )
}
function startPanelResize(event: PointerEvent) {
  resizingPanels = true
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function endPanelResize() {
  resizingPanels = false
}
function stepPanelResize(amount: number) {
  layerPanelPercent.value = Math.max(20, Math.min(55, layerPanelPercent.value + amount))
}
const renameGroupOpen = ref(false)
const renameGroupId = ref('')
const renameGroupName = ref('')
const renameDraftOpen = ref(false)
const renameDraftName = ref('')
const renameDraftInput = ref<HTMLInputElement>()
const createGroupOpen = ref(false)
const createGroupName = ref('')
let layerClipboard: { workspaceId: string; layers: StudioLayer[]; group?: StudioGroup } | undefined
const canvasPresets = aspectRatioPresets.map((preset) => ({
  ...preset,
  canvasWidth:
    preset.width < preset.height ? 1080 : Math.round((1080 * preset.width) / preset.height),
  canvasHeight:
    preset.width < preset.height ? Math.round((1080 * preset.height) / preset.width) : 1080
}))
const canvas = ref<HTMLCanvasElement>()
const viewport = ref<HTMLElement>()
const board = ref<HTMLElement>()
const boardSize = ref({ width: 700, height: 600 })
const viewZoom = ref(1)
const displayDocument = computed(() => (comparing.value ? originalDocument.value : draft.value))
const fitScale = computed(() =>
  Math.min(
    1,
    (boardSize.value.width - 48) / displayDocument.value.width,
    (boardSize.value.height - (props.standalone ? 120 : 48)) / displayDocument.value.height
  )
)
const scale = computed(() => Math.max(0.03, fitScale.value * viewZoom.value))
const panOffset = ref({ x: 0, y: 0 })
const boardStyle = computed(() => ({
  width: displayDocument.value.width * scale.value + 'px',
  height: displayDocument.value.height * scale.value + 'px',
  transform: `translate(${panOffset.value.x}px, ${panOffset.value.y}px)`
}))
const {
  format,
  exportArea,
  exporting,
  saveArtifactOpen,
  savingArtifact,
  artifactName,
  syncToLibrary,
  syncDirectory,
  exportImage,
  saveMedia,
  openSaveArtifact,
  browseSyncDirectory,
  saveArtifact
} = useStudioOutput({
  props,
  draft,
  flush: () => flush(),
  snapshot: () => snapshot(),
  isAdjusting: () => cropMode.value || !!editingText.value,
  artifactSaved: () => emit('artifactSaved'),
  mediaSaved(file, overwrite, savedRecord) {
    draft.value = savedRecord.document
    histories.delete(draft.value.id)
    refreshHistory()
    originalDocument.value = JSON.parse(snapshot())
    mediaSaved.value = true
    emit('mediaSaved', file, overwrite, savedRecord)
  }
})
const aiOpen = ref(false)
const aiSnapshot = ref<StudioDocument | null>(null)
const aiScope = ref<StudioRenderScope>({ kind: 'all' })
const renderError = ref('')
const storageError = ref('')
const saveState = ref<'saving' | 'saved' | 'error'>('saving')
const savedAt = ref<number>()
const mediaSaved = ref(false)
const saveLabel = computed(() =>
  props.mediaFile
    ? savingArtifact.value
      ? '正在保存图片'
      : mediaDirty.value
        ? '修改未保存'
        : mediaSaved.value
          ? '已保存'
          : props.editRevision
            ? '已恢复编辑'
            : '未修改'
    : saveState.value === 'saving'
      ? '正在保存草稿'
      : saveState.value === 'error'
        ? '草稿未保存'
        : `草稿已保存到本机${savedAt.value ? ` · ${new Date(savedAt.value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : ''}`
)
const picker = ref(false)
const pickerMode = ref<'add' | 'replace'>('add')
const query = ref('')
const filteredAssets = computed(() =>
  imageAssets.value.filter((asset) => asset.name.toLowerCase().includes(query.value.toLowerCase()))
)
const menu = ref<{
  x: number
  y: number
  kind: 'layer' | 'group' | 'blank' | 'asset'
  id?: string
  path?: string
}>()
const contextGroup = computed(() =>
  menu.value?.kind === 'group'
    ? draft.value.groups.find((group) => group.id === menu.value?.id)
    : undefined
)
const cropMode = ref(false)
const transformMode = ref<'crop' | 'resize'>('crop')
const resizingImage = computed(() => cropMode.value && transformMode.value === 'resize')
function setTransformMode(mode: 'crop' | 'resize') {
  if (mode === transformMode.value) return
  // Mode switches start from the same pre-adjustment image; Apply commits one transaction.
  restoreAdjustment()
  cropSelection.value = { x: 0, y: 0, width: 1, height: 1 }
  cropRatio.value = mode === 'resize' ? 'original' : 'free'
  transformMode.value = mode
  if (mode === 'resize') cropLock.value = true
}
const cropSelection = ref<StudioCrop>({ x: 0, y: 0, width: 1, height: 1 })
const cropBefore = ref('')
const cropRatio = ref('free')
const cropOutput = ref({ width: 1, height: 1 })
const cropLock = ref(true)
const cropRatioChoices = ['free', 'original', '1:1', '4:3', '3:4', '16:9', '9:16']
function setCropRatio(value: string) {
  cropRatio.value = value
  const layer = imageLayer.value
  if (!layer) return
  if (resizingImage.value) {
    cropLock.value = value !== 'free'
    if (value === 'free') return
    const initial: StudioDocument = JSON.parse(cropBefore.value)
    const original = initial.layers.find((item) => item.id === layer.id) ?? layer
    const [w, h] =
      value === 'original' ? [original.width, original.height] : value.split(':').map(Number)
    const ratio = w / h
    const width = Math.max(1, Math.min(layer.width, 16384, 16384 * ratio))
    if (Math.abs(width / Math.round(width / ratio) - layer.width / layer.height) > 0.001)
      layer.fit = 'stretch'
    layer.width = Math.round(width)
    layer.height = Math.max(1, Math.round(width / ratio))
    return
  }
  if (value === 'free' || value === 'original') {
    cropSelection.value = { x: 0, y: 0, width: 1, height: 1 }
    return
  }
  const [w, h] = value.split(':').map(Number)
  const ratio = ((w / h) * layer.height) / layer.width
  const width = Math.min(1, ratio),
    height = Math.min(1, 1 / ratio)
  cropSelection.value = { x: (1 - width) / 2, y: (1 - height) / 2, width, height }
}
watch(
  () =>
    [
      imageLayer.value?.id,
      imageLayer.value?.width,
      imageLayer.value?.height,
      cropSelection.value.width,
      cropSelection.value.height
    ].join(':'),
  () => {
    const crop = cropSelection.value
    const layer = imageLayer.value
    if (!layer) return
    cropOutput.value = {
      width: Math.max(1, Math.round(layer.width * crop.width)),
      height: Math.max(1, Math.round(layer.height * crop.height))
    }
  }
)
function setCropOutput(axis: 'width' | 'height', value: number) {
  if (!Number.isFinite(value)) return
  const size = Math.max(1, Math.min(16384, Math.round(value)))
  const layer = imageLayer.value
  if (!layer) return
  const ratio =
    (layer.width * cropSelection.value.width) / (layer.height * cropSelection.value.height)
  cropOutput.value[axis] = size
  if (cropLock.value)
    cropOutput.value[axis === 'width' ? 'height' : 'width'] = Math.max(
      1,
      Math.min(16384, Math.round(axis === 'width' ? size / ratio : size * ratio))
    )
  if (resizingImage.value) {
    if (!cropLock.value && size !== layer[axis]) layer.fit = 'stretch'
    layer.width = cropOutput.value.width
    layer.height = cropOutput.value.height
  }
}
function openCropTool(mode: 'crop' | 'resize') {
  if (!canAdjustImage.value) return
  if (cropMode.value) {
    if (transformMode.value === mode) cancelCrop()
    else setTransformMode(mode)
    return
  }
  layersOpen.value = false
  inspectorOpen.value = true
  beginCrop(mode)
}
function openProperties() {
  layersOpen.value = false
  inspectorOpen.value = true
  inspectorTab.value = 'properties'
}

const editingText = ref(false)
const textInput = ref('')
const textArea = ref<HTMLTextAreaElement>()
const histories = new Map<string, { undo: string[]; redo: string[] }>()
const canUndo = ref(false),
  canRedo = ref(false)
let saveTimer: ReturnType<typeof setTimeout> | undefined
let previewFrame: number | undefined
let previewRunning = false
let previewQueued = false
let previewDisposed = false
let observer: ResizeObserver | undefined
let inspectorBefore = ''
let restoring = false
let activeDraftRepository: StudioDraftRepository | undefined
const snapshot = () => JSON.stringify(draft.value)
function withoutOldMarks(doc: StudioDocument) {
  const removedGroups = new Set(
    doc.layers
      .filter((layer) => layer.kind !== 'image' && layer.kind !== 'text')
      .map((layer) => layer.groupId)
      .filter((id): id is string => !!id)
  )
  doc.layers = doc.layers.filter((layer) => layer.kind === 'image' || layer.kind === 'text')
  const retainedGroups = new Set(doc.layers.map((layer) => layer.groupId))
  doc.groups = doc.groups.filter(
    (group) => !removedGroups.has(group.id) || retainedGroups.has(group.id)
  )
  return doc
}
function history() {
  let item = histories.get(draft.value.id)
  if (!item) {
    item = { undo: [], redo: [] }
    histories.set(draft.value.id, item)
  }
  return item
}
function refreshHistory() {
  canUndo.value = !!history().undo.length
  canRedo.value = !!history().redo.length
}
function record(before: string) {
  if (before === snapshot()) return
  const item = history()
  item.undo.push(before)
  if (item.undo.length > 40) item.undo.shift()
  item.redo = []
  refreshHistory()
}
function change(fn: () => void) {
  if (props.readonly || savingArtifact.value || comparing.value) return
  const before = snapshot()
  fn()
  record(before)
}
watch(
  selectedId,
  (id) => {
    selectedIds.value = id ? [id] : []
  },
  { flush: 'sync' }
)
function undo() {
  const item = history(),
    old = item.undo.pop()
  if (!old) return
  item.redo.push(snapshot())
  draft.value = withoutOldMarks(JSON.parse(old))
  refreshHistory()
}
function redo() {
  const item = history(),
    next = item.redo.pop()
  if (!next) return
  item.undo.push(snapshot())
  draft.value = withoutOldMarks(JSON.parse(next))
  refreshHistory()
}
function persist() {
  const repository = activeDraftRepository
  if (!repository || restoring) return
  try {
    const updatedAt = new Date().toISOString()
    const meta = { id: draft.value.id, name: draft.value.name, updatedAt }
    docs.value = docs.value.some((item) => item.id === meta.id)
      ? docs.value.map((item) => (item.id === meta.id ? meta : item))
      : [...docs.value, meta]
    repository.save(
      { ...draft.value, updatedAt },
      { version: 2, activeId: draft.value.id, docs: docs.value }
    )
    storageError.value = ''
    savedAt.value = Date.now()
    saveState.value = 'saved'
  } catch {
    storageError.value = '本机草稿保存失败，请检查可用空间。'
    saveState.value = 'error'
  }
}
function flush() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = undefined
  persist()
}
function schedule() {
  if (restoring || !activeDraftRepository) return
  saveState.value = 'saving'
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(flush, 250)
}
function restore() {
  restoring = true
  histories.clear()
  selectedId.value = ''
  selectedGroupId.value = ''
  cropMode.value = false
  panOffset.value = { x: 0, y: 0 }
  try {
    const index = activeDraftRepository?.loadIndex()
    const available = index?.docs.map((meta) => activeDraftRepository?.loadDocument(meta.id)) ?? []
    const current =
      available.find((item) => item?.id === index?.activeId) ?? available.find(Boolean)
    if (current && index) {
      draft.value = withoutOldMarks(current)
      docs.value = index.docs.filter((meta) => available.some((item) => item?.id === meta.id))
    } else {
      draft.value = createStudioDocument()
      docs.value = [
        { id: draft.value.id, name: draft.value.name, updatedAt: draft.value.updatedAt }
      ]
    }
  } catch {
    draft.value = createStudioDocument()
    docs.value = [{ id: draft.value.id, name: draft.value.name, updatedAt: draft.value.updatedAt }]
  }
  restoring = false
  refreshHistory()
  schedule()
  schedulePreview()
}
watch(
  () => props.draftRepository,
  (repository) => {
    // Flush while the old host binding is still active, before accepting the new workspace.
    flush()
    activeDraftRepository = repository
    if (props.mediaFile && props.initialDocument) {
      draft.value = JSON.parse(JSON.stringify(props.initialDocument))
      originalDocument.value = JSON.parse(snapshot())
      selectedId.value = draft.value.layers[0]?.id || ''
      schedulePreview()
      return
    }
    restore()
    if (props.initialDraftId) switchDraft(props.initialDraftId)
    else if (props.createNew) createDraft()
    originalDocument.value = JSON.parse(snapshot())
  },
  { immediate: true }
)
watch(comparing, schedulePreview)
watch(
  () => draft.value.id,
  () => {
    originalDocument.value = JSON.parse(snapshot())
    comparing.value = false
  }
)
watch(
  draft,
  () => {
    const lockedGroup =
      selected.value?.groupId &&
      draft.value.groups.find((group) => group.id === selected.value?.groupId && group.locked)
    if (lockedGroup) {
      selectedId.value = ''
      selectedGroupId.value = lockedGroup.id
    }
    if (selectedIds.value.some((id) => !draft.value.layers.some((layer) => layer.id === id))) {
      const ids = selectedIds.value.filter((id) =>
        draft.value.layers.some((layer) => layer.id === id)
      )
      selectedId.value = ids[ids.length - 1] ?? ''
      selectedIds.value = ids
    }
    schedule()
    schedulePreview()
  },
  { deep: true }
)
watch(
  () => props.assetInfo,
  () => {
    clearStudioImageCache()
    schedulePreview()
  }
)
watch(
  () => global.computedTheme,
  () => schedulePreview(),
  { flush: 'post' }
)
watch(scale, () => schedulePreview())
function beforeUnload(event: BeforeUnloadEvent) {
  if (props.mediaFile && mediaDirty.value) {
    event.preventDefault()
    event.returnValue = ''
  }
}
function visibility() {
  if (document.visibilityState === 'hidden') flush()
}
onMounted(() => {
  observer = new ResizeObserver(() => {
    if (viewport.value)
      boardSize.value = { width: viewport.value.clientWidth, height: viewport.value.clientHeight }
  })
  if (viewport.value) observer.observe(viewport.value)
  window.addEventListener('beforeunload', beforeUnload)
  document.addEventListener('visibilitychange', visibility)
  window.addEventListener('keydown', keydown)
  window.addEventListener('keyup', keyup)
  schedulePreview()
})
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', beforeUnload)
  previewDisposed = true
  flush()
  observer?.disconnect()
  document.removeEventListener('visibilitychange', visibility)
  if (previewFrame !== undefined) cancelAnimationFrame(previewFrame)
  window.removeEventListener('keydown', keydown)
  window.removeEventListener('keyup', keyup)
})
function schedulePreview() {
  if (previewDisposed) return
  if (previewRunning) {
    previewQueued = true
    return
  }
  if (previewFrame !== undefined) return
  previewFrame = requestAnimationFrame(() => {
    previewFrame = undefined
    void preview()
  })
}
function createDraft() {
  if (docs.value.length >= 100) return
  flush()
  draft.value = createStudioDocument('未命名图片 ' + (docs.value.length + 1))
  panOffset.value = { x: 0, y: 0 }
  selectedId.value = ''
  selectedGroupId.value = ''
  docs.value.push({ id: draft.value.id, name: draft.value.name, updatedAt: draft.value.updatedAt })
  refreshHistory()
  persist()
}
function switchDraft(id: string) {
  if (draft.value.id === id) return
  flush()
  try {
    const item = activeDraftRepository?.loadDocument(id)
    if (!item) throw new Error()
    draft.value = item
    selectedId.value = ''
    selectedGroupId.value = ''
    cropMode.value = false
    panOffset.value = { x: 0, y: 0 }
    refreshHistory()
    persist()
  } catch {
    message.error('草稿无法打开')
  }
}
function renameDraft() {
  renameDraftName.value = draft.value.name
  renameDraftOpen.value = true
  void nextTick(() => {
    renameDraftInput.value?.focus()
    renameDraftInput.value?.select()
  })
}
function exitStudio() {
  if (savingArtifact.value || exporting.value) return
  if (editingText.value) {
    message.info('请先完成文字输入')
    return
  }
  if (cropMode.value) {
    message.info('请先完成或取消裁剪')
    return
  }
  if (props.mediaFile) {
    if (!mediaDirty.value) {
      emit('exit')
      return
    }
    if (exitConfirmOpen.value) return
    exitConfirmOpen.value = true
    Modal.confirm({
      title: '修改尚未保存',
      content: '离开后，本次调整不会保留。',
      okText: '放弃修改并返回',
      cancelText: '继续调整',
      onOk: () => {
        exitConfirmOpen.value = false
        emit('exit')
      },
      onCancel: () => {
        exitConfirmOpen.value = false
      }
    })
    return
  }
  flush()
  if (saveState.value === 'error') {
    message.error('草稿未保存，请处理后再返回')
    return
  }
  emit('exit')
}
function confirmRenameDraft() {
  const name = renameDraftName.value.trim()
  if (!name) {
    message.warning('请输入草稿名称')
    renameDraftInput.value?.focus()
    return
  }
  if (name !== draft.value.name)
    change(() => {
      draft.value.name = name.slice(0, 80)
    })
  renameDraftOpen.value = false
}
function deleteDraft() {
  const repository = activeDraftRepository
  const deletedId = draft.value.id
  if (!repository) return
  Modal.confirm({
    title: '删除草稿“' + draft.value.name + '”？',
    content: '本机图层草稿会删除，引用的素材文件不会删除。',
    okText: '删除草稿',
    okType: 'danger',
    onOk: () => {
      if (activeDraftRepository !== repository || draft.value.id !== deletedId) return
      // Remove persisted content before changing the visible session; failed removal remains retryable.
      repository.remove(deletedId)
      const previousIndex = docs.value.findIndex((item) => item.id === deletedId)
      const remaining = docs.value.filter((item) => item.id !== deletedId)
      const available = remaining
        .map((meta) => repository.loadDocument(meta.id))
        .filter((doc): doc is StudioDocument => !!doc)
      const nextId = remaining[Math.max(0, previousIndex - 1)]?.id
      draft.value =
        available.find((doc) => doc.id === nextId) ?? available[0] ?? createStudioDocument()
      docs.value = available.length
        ? remaining.filter((meta) => available.some((doc) => doc.id === meta.id))
        : [{ id: draft.value.id, name: draft.value.name, updatedAt: draft.value.updatedAt }]
      panOffset.value = { x: 0, y: 0 }
      selectedId.value = ''
      selectedGroupId.value = ''
      cropMode.value = false
      histories.delete(deletedId)
      refreshHistory()
      persist()
    }
  })
}
async function preview() {
  if (previewRunning) {
    previewQueued = true
    return
  }
  previewRunning = true
  const renderedDoc = comparing.value ? originalDocument.value : draft.value
  try {
    await nextTick()
    if (!canvas.value || previewDisposed) return
    const target = document.createElement('canvas')
    const displaySize = Math.max(renderedDoc.width, renderedDoc.height) * scale.value
    const maxDimension = Math.min(
      1200,
      Math.max(512, Math.ceil(displaySize * Math.min(window.devicePixelRatio || 1, 2)))
    )
    const failures = await renderStudioDocument(
      target,
      renderedDoc,
      props.assetInfo,
      true,
      { kind: 'all' },
      maxDimension
    )
    if (
      renderedDoc === (comparing.value ? originalDocument.value : draft.value) &&
      canvas.value &&
      !previewDisposed
    ) {
      canvas.value.width = target.width
      canvas.value.height = target.height
      canvas.value.getContext('2d')?.drawImage(target, 0, 0)
      renderError.value = failures.length ? '无法读取图层：' + failures.join('、') : ''
    }
  } catch {
    if (
      renderedDoc === (comparing.value ? originalDocument.value : draft.value) &&
      !previewDisposed
    )
      renderError.value = '画布预览失败'
  } finally {
    previewRunning = false
    if (previewQueued && !previewDisposed) {
      previewQueued = false
      schedulePreview()
    }
  }
}
function addImage(path: string, replace = false) {
  const asset = imageAssets.value.find((item) => item.path === path)
  if (!asset) return
  if (replace && !imageLayer.value) return
  change(() => {
    if (replace && imageLayer.value) {
      imageLayer.value.path = path
      imageLayer.value.name = asset.name
      imageLayer.value.crop = { x: 0, y: 0, width: 1, height: 1 }
      imageLayer.value.zoom = 1
    } else {
      const size = Math.min(draft.value.width, draft.value.height) * 0.62
      const layer = createImageLayer(
        path,
        {
          x: (draft.value.width - size) / 2,
          y: (draft.value.height - size) / 2,
          width: size,
          height: size
        },
        asset.name
      )
      draft.value.layers.push(layer)
      selectedId.value = layer.id
      selectedGroupId.value = ''
    }
  })
  picker.value = false
  menu.value = undefined
}
async function pickLibraryImage(file: FileNodeInfo) {
  emit('libraryImagePicked', file)
  await nextTick()
  addImage(file.fullpath, pickerMode.value === 'replace')
}
function openImagePicker(mode: 'add' | 'replace' = 'add') {
  if (mode === 'replace' && !imageLayer.value) return
  pickerMode.value = mode
  picker.value = true
}
function addText() {
  change(() => {
    const layer = createTextLayer({
      x: draft.value.width * 0.15,
      y: draft.value.height * 0.43,
      width: draft.value.width * 0.7,
      height: 130
    })
    draft.value.layers.push(layer)
    selectedId.value = layer.id
    selectedGroupId.value = ''
  })
  menu.value = undefined
}
function addGroup() {
  change(() => {
    const group = createStudioGroup(`分组 ${draft.value.groups.length + 1}`)
    draft.value.groups.push(group)
    if (selected.value)
      draft.value = moveStudioLayerToGroup(JSON.parse(snapshot()), selected.value.id, group.id)
    selectedId.value = ''
    selectedGroupId.value = group.id
  })
}
function beginGroupSelection() {
  if (props.readonly || selectedIds.value.length < 2) return
  createGroupName.value = `分组 ${draft.value.groups.length + 1}`
  createGroupOpen.value = true
}
function confirmGroupSelection() {
  const name = createGroupName.value.trim()
  if (!name) {
    message.warning('请输入分组名称')
    return
  }
  const ids = selectedIds.value.filter((id) =>
    draft.value.layers.some((layer) => layer.id === id && !studioLayerLocked(draft.value, layer))
  )
  if (props.readonly || ids.length < 2) {
    createGroupOpen.value = false
    return
  }
  change(() => {
    const group = createStudioGroup(name.slice(0, 80))
    draft.value.groups.push(group)
    draft.value = moveStudioLayersToGroup(JSON.parse(snapshot()), ids, group.id)
    selectedId.value = ''
    selectedGroupId.value = group.id
  })
  createGroupOpen.value = false
}
function dissolveGroup(id: string) {
  change(() => {
    draft.value.layers.forEach((layer) => {
      if (layer.groupId === id) layer.groupId = undefined
    })
    draft.value.groups = draft.value.groups.filter((group) => group.id !== id)
    selectedGroupId.value = ''
  })
}
function removeGroup(id: string) {
  const group = draft.value.groups.find((item) => item.id === id)
  if (!group || props.readonly) return
  const count = draft.value.layers.filter((layer) => layer.groupId === id).length
  Modal.confirm({
    title: `删除分组“${group.name}”？`,
    content: `分组及其中 ${count} 个图层将从当前草稿移除。可使用撤销恢复；素材文件不会删除。`,
    okText: '删除分组及图层',
    okType: 'danger',
    onOk: () =>
      change(() => {
        draft.value.layers = draft.value.layers.filter((layer) => layer.groupId !== id)
        draft.value.groups = draft.value.groups.filter((item) => item.id !== id)
        selectedId.value = ''
        selectedGroupId.value = ''
      })
  })
}
function renameGroup(id: string) {
  const group = draft.value.groups.find((item) => item.id === id)
  if (!group || props.readonly) return
  renameGroupId.value = id
  renameGroupName.value = group.name
  renameGroupOpen.value = true
}
function confirmRenameGroup() {
  const group = draft.value.groups.find((item) => item.id === renameGroupId.value)
  const name = renameGroupName.value.trim()
  if (!group || props.readonly) {
    renameGroupOpen.value = false
    return
  }
  if (!name) {
    message.warning('请输入分组名称')
    return
  }
  if (name !== group.name)
    change(() => {
      group.name = name.slice(0, 80)
    })
  renameGroupOpen.value = false
}
function moveLayerToGroup(id: string, groupId?: string) {
  change(() => {
    draft.value = moveStudioLayerToGroup(JSON.parse(snapshot()), id, groupId)
  })
}
function toggleGroup(id: string, key: 'visible' | 'locked' | 'collapsed') {
  change(() => {
    const group = draft.value.groups.find((item) => item.id === id)
    if (group) {
      group[key] = !group[key]
      if (key === 'locked' && group.locked && selected.value?.groupId === id) {
        selectedId.value = ''
        selectedGroupId.value = id
      }
    }
  })
}
function showNotes() {
  layersOpen.value = false
  showInspector('notes')
}
function showInspector(tab: 'properties' | 'notes' = 'properties') {
  inspectorTab.value = tab
  inspectorOpen.value = true
  layersOpen.value = false
}
function openAIDialog(scope: StudioRenderScope) {
  if (props.mediaFile) return
  aiSnapshot.value = JSON.parse(snapshot()) as StudioDocument
  aiScope.value = scope
  aiOpen.value = true
}
function template(layout: ImageLayout) {
  change(() => {
    draft.value = applyStudioTemplate(JSON.parse(snapshot()), layout)
  })
}
function resizeCanvas(width: number, height: number) {
  change(() => {
    draft.value = resizeStudioCanvas(JSON.parse(snapshot()), width, height)
  })
}
function dimension(which: 'width' | 'height', raw: string) {
  const size = Math.round(Math.min(16384, Math.max(1, Number(raw) || 1080)))
  resizeCanvas(
    which === 'width' ? size : draft.value.width,
    which === 'height' ? size : draft.value.height
  )
}
function fieldFocus() {
  if (!inspectorBefore) inspectorBefore = snapshot()
}
function fieldChange() {
  if (inspectorBefore) record(inspectorBefore)
  inspectorBefore = ''
}
function resetSlider(
  which: 'rotation' | 'opacity' | 'zoom' | 'brightness' | 'contrast' | 'radius'
) {
  const layer = selected.value
  if (!layer) return
  fieldChange()
  change(() => {
    if (which === 'rotation') layer.rotation = 0
    else if (which === 'opacity') layer.opacity = 1
    else if (layer.kind === 'image') {
      if (which === 'zoom') layer.zoom = 1
      else if (which === 'brightness') layer.brightness = 100
      else if (which === 'contrast') layer.contrast = 100
      else layer.radius = 0
    }
  })
}
function frameChange(which: 'x' | 'y' | 'width' | 'height', event: Event) {
  const layer = selected.value,
    input = event.target as HTMLInputElement
  if (!layer) return
  const value = input.valueAsNumber
  if (Number.isFinite(value))
    layer[which] =
      which === 'width' || which === 'height' ? Math.max(16, Math.round(value)) : Math.round(value)
  input.value = String(Math.round(layer[which]))
  fieldChange()
}
const textContentExpanded = ref(false)
const layerTextId = useId()
watch(selectedId, () => {
  textContentExpanded.value = false
})
function appearanceChange(which: 'rotation' | 'opacity', event: Event) {
  const layer = selected.value,
    input = event.target as HTMLInputElement
  if (!layer) return
  const value = input.valueAsNumber
  if (Number.isFinite(value))
    layer[which] =
      which === 'opacity'
        ? Math.min(100, Math.max(0, value)) / 100
        : Math.min(180, Math.max(-180, value))
  input.value = String(which === 'opacity' ? Math.round(layer.opacity * 100) : layer.rotation)
  fieldChange()
}
function duplicate() {
  const source = selected.value
  if (!source) return
  change(() => {
    const copy = JSON.parse(JSON.stringify(source)) as StudioLayer
    copy.id = crypto.randomUUID()
    copy.name += ' 副本'
    copy.x += 24
    copy.y += 24
    draft.value.layers.splice(draft.value.layers.indexOf(source) + 1, 0, copy)
    selectedId.value = copy.id
  })
}
function copySelection() {
  const group = selectedGroup.value
  const layers = group
    ? draft.value.layers.filter((layer) => layer.groupId === group.id)
    : draft.value.layers.filter((layer) => selectedIds.value.includes(layer.id))
  if (!group && !layers.length) return
  layerClipboard = {
    workspaceId: props.workspaceId,
    layers: JSON.parse(JSON.stringify(layers)) as StudioLayer[],
    ...(group ? { group: JSON.parse(JSON.stringify(group)) as StudioGroup } : {})
  }
  message.success(group ? '已复制分组' : `已复制 ${layers.length} 个图层`)
}
function pasteSelection() {
  if (!layerClipboard) {
    message.info('请先选中图层并按 Ctrl+C 复制')
    return
  }
  if (layerClipboard.workspaceId !== props.workspaceId) {
    message.info('请在同一工作区内粘贴图层')
    return
  }
  if (props.readonly) return
  const copied = layerClipboard
  change(() => {
    const sourceIds = new Set(copied.layers.map((layer) => layer.id))
    let sourceTop = -1
    draft.value.layers.forEach((layer, index) => {
      if (sourceIds.has(layer.id)) sourceTop = index
    })
    const copies = copied.layers.map((layer) => ({
      ...(JSON.parse(JSON.stringify(layer)) as StudioLayer),
      id: crypto.randomUUID(),
      name: `${layer.name} 副本`,
      x: layer.x + 24,
      y: layer.y + 24
    }))
    let newGroup: StudioGroup | undefined
    if (copied.group) {
      newGroup = { ...copied.group, id: crypto.randomUUID(), name: `${copied.group.name} 副本` }
      draft.value.groups.push(newGroup)
      for (const layer of copies) layer.groupId = newGroup.id
    } else {
      const groupId = copies[0]?.groupId
      const sameGroup =
        groupId &&
        copies.every((layer) => layer.groupId === groupId) &&
        draft.value.groups.some((group) => group.id === groupId && !group.locked)
      if (!sameGroup)
        copies.forEach((layer) => {
          layer.groupId = undefined
        })
    }
    let insertion = sourceTop < 0 ? draft.value.layers.length : sourceTop + 1
    const sourceGroupId = sourceTop >= 0 ? draft.value.layers[sourceTop].groupId : undefined
    if (sourceGroupId && (!copies[0]?.groupId || newGroup)) {
      draft.value.layers.forEach((layer, index) => {
        if (layer.groupId === sourceGroupId) insertion = index + 1
      })
    }
    draft.value.layers.splice(insertion, 0, ...copies)
    if (newGroup) {
      selectedId.value = ''
      selectedGroupId.value = newGroup.id
    } else {
      selectedId.value = copies[copies.length - 1]?.id ?? ''
      selectedIds.value = copies.map((layer) => layer.id)
      selectedGroupId.value = ''
    }
  })
}
function moveLayer(where: 'front' | 'back') {
  const source = selected.value
  if (!source) return
  change(() => {
    const index = draft.value.layers.indexOf(source),
      [layer] = draft.value.layers.splice(index, 1)
    draft.value.layers.splice(where === 'front' ? draft.value.layers.length : 0, 0, layer)
  })
}
function removeLayer() {
  if (props.readonly || cropMode.value) return
  const ids = new Set(
    selectedIds.value.filter((id) => {
      const layer = draft.value.layers.find((item) => item.id === id)
      return layer && !studioLayerLocked(draft.value, layer)
    })
  )
  if (!ids.size) return
  change(() => {
    draft.value.layers = draft.value.layers.filter((item) => !ids.has(item.id))
    selectedId.value = ''
    selectedIds.value = []
  })
}
function fillCanvas() {
  const layer = imageLayer.value
  if (!layer || props.readonly || studioLayerLocked(draft.value, layer)) return
  change(() =>
    Object.assign(layer, {
      x: 0,
      y: 0,
      width: draft.value.width,
      height: draft.value.height,
      rotation: 0,
      fit: 'stretch',
      zoom: 1,
      focusX: 0.5,
      focusY: 0.5
    })
  )
}
function toggle(id: string, key: 'visible' | 'locked') {
  change(() => {
    const layer = draft.value.layers.find((item) => item.id === id)
    if (layer) layer[key] = !layer[key]
  })
}
const {
  layerRows,
  dragItem,
  dropTarget,
  dragZonesVisible,
  startDrag,
  endDrag,
  dragOver,
  dropItem,
  dropClass
} = useStudioLayerDrag({
  draft,
  isDisabled: () => !!props.readonly || cropMode.value || savingArtifact.value,
  applyDrop: (source, target) =>
    change(() => {
      draft.value = dropStudioItem(JSON.parse(snapshot()), source, target)
    })
})
function layerStyle(layer: StudioLayer) {
  return {
    left: layer.x * scale.value + 'px',
    top: layer.y * scale.value + 'px',
    width: layer.width * scale.value + 'px',
    height: layer.height * scale.value + 'px',
    transform: `rotate(${layer.rotation}deg)`
  }
}
const selectedGroupBounds = computed(() =>
  selectedGroup.value?.visible ? studioGroupBounds(draft.value, selectedGroup.value.id) : null
)
const selectedGroupStyle = computed(() =>
  selectedGroupBounds.value
    ? {
        left: selectedGroupBounds.value.x * scale.value + 'px',
        top: selectedGroupBounds.value.y * scale.value + 'px',
        width: selectedGroupBounds.value.width * scale.value + 'px',
        height: selectedGroupBounds.value.height * scale.value + 'px'
      }
    : {}
)
function lockedGroupFor(layer?: StudioLayer) {
  return layer?.groupId
    ? draft.value.groups.find((group) => group.id === layer.groupId && group.locked)
    : undefined
}
function point(event: MouseEvent | PointerEvent) {
  const rect = board.value?.getBoundingClientRect()
  if (!rect) return { x: 0, y: 0 }
  return {
    x: (event.clientX - rect.left) / scale.value,
    y: (event.clientY - rect.top) / scale.value
  }
}
function localPoint(layer: StudioLayer, p: { x: number; y: number }) {
  const dx = p.x - layer.x - layer.width / 2,
    dy = p.y - layer.y - layer.height / 2
  const a = (-layer.rotation * Math.PI) / 180
  return {
    x: (dx * Math.cos(a) - dy * Math.sin(a)) / layer.width + 0.5,
    y: (dx * Math.sin(a) + dy * Math.cos(a)) / layer.height + 0.5
  }
}
function hit(p: { x: number; y: number }) {
  return [...draft.value.layers].reverse().find((layer) => {
    if (!studioLayerVisible(draft.value, layer)) return false
    const q = localPoint(layer, p)
    return q.x >= 0 && q.x <= 1 && q.y >= 0 && q.y <= 1
  })
}
function rotatedDelta(dx: number, dy: number, angle: number) {
  const a = (-angle * Math.PI) / 180
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) }
}
type Gesture = {
  mode: 'move' | 'group-move' | 'resize' | 'rotate' | 'crop-edge' | 'crop-pan' | 'pan'
  before: string
  start: { x: number; y: number }
  frame?: { x: number; y: number; width: number; height: number; rotation: number }
  handle?: string
  crop?: StudioCrop
  focus?: { x: number; y: number }
  scroll?: { x: number; y: number }
  panStart?: { x: number; y: number }
  panScrollable?: { x: boolean; y: boolean }
  groupFrames?: { id: string; x: number; y: number }[]
}
let gesture: Gesture | undefined,
  space = false
function beginPan(event: PointerEvent) {
  const area = viewport.value
  if (!area) return
  gesture = {
    mode: 'pan',
    before: '',
    start: { x: event.clientX, y: event.clientY },
    scroll: { x: area.scrollLeft, y: area.scrollTop },
    panStart: { ...panOffset.value },
    panScrollable: {
      x: draft.value.width * scale.value + 48 > area.clientWidth,
      y: draft.value.height * scale.value + 48 > area.clientHeight
    }
  }
  panning.value = true
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  event.preventDefault()
}
function viewportPointerDown(event: PointerEvent) {
  if (event.button === 1 || (event.button === 0 && space)) beginPan(event)
}
function pointerDown(event: PointerEvent) {
  if (event.button === 1 || (event.button === 0 && space)) {
    beginPan(event)
    return
  }
  if (event.button !== 0 || editingText.value) return
  menu.value = undefined
  const p = point(event)
  const handle = (event.target as HTMLElement).closest<HTMLElement>('[data-handle]')?.dataset.handle
  const layer = handle ? selected.value : hit(p)
  if (cropMode.value && layer?.id !== selectedId.value) return
  const lockedGroup = !cropMode.value ? lockedGroupFor(layer) : undefined
  const selectedGroupHit =
    !cropMode.value &&
    !event.ctrlKey &&
    !event.metaKey &&
    selectedGroupBounds.value &&
    selectedGroup.value &&
    p.x >= selectedGroupBounds.value.x &&
    p.x <= selectedGroupBounds.value.x + selectedGroupBounds.value.width &&
    p.y >= selectedGroupBounds.value.y &&
    p.y <= selectedGroupBounds.value.y + selectedGroupBounds.value.height
      ? selectedGroup.value
      : undefined
  const requestedGroup =
    !cropMode.value && event.altKey && layer?.groupId
      ? draft.value.groups.find((item) => item.id === layer.groupId)
      : undefined
  const group = lockedGroup ?? requestedGroup ?? selectedGroupHit
  if (group) {
    selectedId.value = ''
    selectedGroupId.value = group.id
    if (!props.readonly) {
      gesture = {
        mode: 'group-move',
        before: snapshot(),
        start: p,
        groupFrames: draft.value.layers
          .filter((item) => item.groupId === group.id)
          .map((item) => ({ id: item.id, x: item.x, y: item.y }))
      }
      board.value?.setPointerCapture(event.pointerId)
      event.preventDefault()
    }
    return
  }
  if (!layer) {
    selectedId.value = ''
    selectedGroupId.value = ''
    return
  }
  if (event.ctrlKey || event.metaKey) {
    toggleLayerSelection(layer.id)
    event.preventDefault()
    return
  }
  selectedId.value = layer.id
  selectedGroupId.value = ''
  if (studioLayerLocked(draft.value, layer) || props.readonly) return
  gesture = {
    mode: resizingImage.value
      ? handle
        ? 'resize'
        : 'move'
      : cropMode.value
        ? handle?.startsWith('crop-')
          ? 'crop-edge'
          : 'crop-pan'
        : handle === 'rotate'
          ? 'rotate'
          : handle
            ? 'resize'
            : 'move',
    before: snapshot(),
    start: p,
    handle,
    frame: {
      x: layer.x,
      y: layer.y,
      width: layer.width,
      height: layer.height,
      rotation: layer.rotation
    },
    crop: { ...cropSelection.value },
    focus: layer.kind === 'image' ? { x: layer.focusX, y: layer.focusY } : undefined
  }
  board.value?.setPointerCapture(event.pointerId)
  event.preventDefault()
}
function pointerMove(event: PointerEvent) {
  if (gesture?.mode === 'pan') {
    const area = viewport.value,
      scroll = gesture.scroll,
      panStart = gesture.panStart
    if (!area || !scroll || !panStart) return
    const dx = event.clientX - gesture.start.x,
      dy = event.clientY - gesture.start.y
    if (gesture.panScrollable?.x) area.scrollLeft = scroll.x - dx
    if (gesture.panScrollable?.y) area.scrollTop = scroll.y - dy
    panOffset.value = {
      x: gesture.panScrollable?.x ? panStart.x : panStart.x + dx,
      y: gesture.panScrollable?.y ? panStart.y : panStart.y + dy
    }
    return
  }
  if (!gesture) return
  const p = point(event)
  if (gesture.mode === 'group-move') {
    const dx = p.x - gesture.start.x,
      dy = p.y - gesture.start.y
    for (const frame of gesture.groupFrames ?? []) {
      const layer = draft.value.layers.find((item) => item.id === frame.id)
      if (layer) {
        layer.x = frame.x + dx
        layer.y = frame.y + dy
      }
    }
    return
  }
  const layer = selected.value,
    frame = gesture.frame
  if (!layer || !frame) return
  const dx = p.x - gesture.start.x,
    dy = p.y - gesture.start.y
  if (gesture.mode === 'move') {
    layer.x = frame.x + dx
    layer.y = frame.y + dy
  }
  if (gesture.mode === 'rotate') {
    const cx = frame.x + frame.width / 2,
      cy = frame.y + frame.height / 2
    layer.rotation =
      frame.rotation +
      ((Math.atan2(p.y - cy, p.x - cx) - Math.atan2(gesture.start.y - cy, gesture.start.x - cx)) *
        180) /
        Math.PI
  }
  if (gesture.mode === 'resize') {
    const side = gesture.handle || ''
    if (resizingImage.value) {
      if (!cropLock.value && layer.kind === 'image' && (dx || dy)) layer.fit = 'stretch'
      Object.assign(layer, resizeStudioFrame(frame, side, dx, dy, cropLock.value))
      return
    }
    const delta = rotatedDelta(dx, dy, frame.rotation)
    if (side.includes('e')) layer.width = Math.max(16, frame.width + delta.x)
    if (side.includes('s')) layer.height = Math.max(16, frame.height + delta.y)
    if (side.includes('w')) {
      layer.width = Math.max(16, frame.width - delta.x)
      layer.x = frame.x + frame.width - layer.width
    }
    if (side.includes('n')) {
      layer.height = Math.max(16, frame.height - delta.y)
      layer.y = frame.y + frame.height - layer.height
    }
  }
  if (gesture.mode === 'crop-edge' && gesture.crop && gesture.handle) {
    const edge = gesture.handle.slice(5),
      crop = { ...gesture.crop }
    const delta = rotatedDelta(dx, dy, frame.rotation)
    if (edge.includes('e'))
      crop.width = Math.max(0.02, Math.min(1 - crop.x, gesture.crop.width + delta.x / layer.width))
    if (edge.includes('s'))
      crop.height = Math.max(
        0.02,
        Math.min(1 - crop.y, gesture.crop.height + delta.y / layer.height)
      )
    if (edge.includes('w')) {
      crop.x = Math.max(
        0,
        Math.min(gesture.crop.x + gesture.crop.width - 0.02, gesture.crop.x + delta.x / layer.width)
      )
      crop.width = gesture.crop.x + gesture.crop.width - crop.x
    }
    if (edge.includes('n')) {
      crop.y = Math.max(
        0,
        Math.min(
          gesture.crop.y + gesture.crop.height - 0.02,
          gesture.crop.y + delta.y / layer.height
        )
      )
      crop.height = gesture.crop.y + gesture.crop.height - crop.y
    }
    if (cropRatio.value !== 'free') {
      const parts = cropRatio.value.split(':').map(Number)
      const ratio =
        cropRatio.value === 'original' ? 1 : ((parts[0] / parts[1]) * layer.height) / layer.width
      const anchorX = edge.includes('w') ? gesture.crop.x + gesture.crop.width : gesture.crop.x
      const anchorY = edge.includes('n') ? gesture.crop.y + gesture.crop.height : gesture.crop.y
      const maxWidth = edge.includes('w') ? anchorX : 1 - anchorX
      const maxHeight = edge.includes('n') ? anchorY : 1 - anchorY
      crop.width = Math.min(crop.width, maxWidth, maxHeight * ratio)
      crop.height = crop.width / ratio
      crop.x = edge.includes('w') ? anchorX - crop.width : anchorX
      crop.y = edge.includes('n') ? anchorY - crop.height : anchorY
    }
    cropSelection.value = crop
  }
  if (gesture.mode === 'crop-pan' && gesture.crop) {
    const delta = rotatedDelta(dx, dy, frame.rotation)
    cropSelection.value = {
      ...gesture.crop,
      x: Math.max(0, Math.min(1 - gesture.crop.width, gesture.crop.x + delta.x / layer.width)),
      y: Math.max(0, Math.min(1 - gesture.crop.height, gesture.crop.y + delta.y / layer.height))
    }
  }
}
function pointerUp() {
  if (!gesture) return
  if (gesture.mode === 'pan') panning.value = false
  if (gesture.mode !== 'pan' && !cropMode.value) record(gesture.before)
  gesture = undefined
}
async function wheel(event: WheelEvent) {
  const area = viewport.value,
    surface = board.value
  if (!area || !surface) return
  event.preventDefault()
  const before = surface.getBoundingClientRect()
  const x = (event.clientX - before.left) / before.width
  const y = (event.clientY - before.top) / before.height
  viewZoom.value = Math.max(
    0.3,
    Math.min(4, viewZoom.value * Math.exp(-Math.max(-120, Math.min(120, event.deltaY)) * 0.0015))
  )
  await nextTick()
  const after = surface.getBoundingClientRect()
  area.scrollLeft += after.left + x * after.width - event.clientX
  area.scrollTop += after.top + y * after.height - event.clientY
}
function zoomTo(value: number) {
  panOffset.value = { x: 0, y: 0 }
  viewZoom.value = Math.max(0.3, Math.min(4, value))
}
function beginCrop(mode: 'crop' | 'resize' = 'crop') {
  if (cropMode.value || !canAdjustImage.value) return
  transformMode.value = mode
  cropRatio.value = mode === 'resize' ? 'original' : 'free'
  openProperties()
  cropBefore.value = snapshot()
  cropSelection.value = { x: 0, y: 0, width: 1, height: 1 }
  cropMode.value = true
  if (mode === 'resize') cropLock.value = true
}
async function finishCrop() {
  if (!imageLayer.value) return
  const selection = cropSelection.value
  if (
    snapshot() === cropBefore.value &&
    selection.x === 0 &&
    selection.y === 0 &&
    selection.width === 1 &&
    selection.height === 1 &&
    cropOutput.value.width === Math.round(imageLayer.value.width) &&
    cropOutput.value.height === Math.round(imageLayer.value.height)
  ) {
    cropMode.value = false
    return
  }
  const layer = imageLayer.value,
    file = props.assetInfo[layer.path]
  const docId = draft.value.id
  const size = file ? await studioImageDimensions(file) : null
  if (draft.value.id !== docId || selectedId.value !== layer.id || !cropMode.value) return
  if (!size) {
    message.error('无法读取原图，暂时不能完成裁剪')
    return
  }
  const next = resizingImage.value
    ? JSON.parse(JSON.stringify(layer))
    : cropStudioImage(
        JSON.parse(JSON.stringify(layer)),
        cropSelection.value,
        size.width,
        size.height
      )
  const index = draft.value.layers.findIndex((item) => item.id === layer.id)
  if (index < 0) return
  const before: StudioDocument = JSON.parse(cropBefore.value)
  const initial = before.layers.find((item) => item.id === layer.id)
  const fillsCanvas =
    before.layers.length === 1 &&
    initial?.rotation === 0 &&
    initial.x === 0 &&
    initial.y === 0 &&
    initial.width === before.width &&
    initial.height === before.height
  next.width = cropOutput.value.width
  next.height = cropOutput.value.height
  draft.value.layers[index] = next
  if (fillsCanvas) {
    draft.value.width = Math.max(1, Math.round(next.width))
    draft.value.height = Math.max(1, Math.round(next.height))
    next.x = 0
    next.y = 0
    next.width = draft.value.width
    next.height = draft.value.height
  }
  cropMode.value = false
  record(cropBefore.value)
}
function restoreAdjustment() {
  // This is an internal snapshot, not imported data: restore it without normalizing layers.
  if (cropBefore.value && snapshot() !== cropBefore.value)
    draft.value = JSON.parse(cropBefore.value)
}
function cancelCrop() {
  restoreAdjustment()
  cropMode.value = false
}
function beginTextEdit() {
  if (!textLayer.value || textLayer.value.locked) return
  inspectorBefore = snapshot()
  textInput.value = textLayer.value.text
  editingText.value = true
  void nextTick(() => textArea.value?.focus())
}
function finishTextEdit(commit = true) {
  if (!editingText.value) return
  if (commit && textLayer.value) {
    textLayer.value.text = textInput.value
    record(inspectorBefore)
  }
  inspectorBefore = ''
  editingText.value = false
}
let textMeasureContext: CanvasRenderingContext2D | null = null
function inlineTextStyle(layer: StudioTextLayer) {
  textMeasureContext ??= document.createElement('canvas').getContext('2d')
  const layout = textMeasureContext
    ? layoutStudioText(textMeasureContext, layer, textInput.value)
    : null
  const size = layout?.fontSize ?? layer.fontSize
  const top = layout ? Math.max(4, (layer.height - layout.lines.length * layout.lineHeight) / 2) : 4
  return {
    fontSize: size * scale.value + 'px',
    lineHeight: `${size * 1.24 * scale.value}px`,
    paddingTop: top * scale.value + 'px',
    color: layer.color,
    textAlign: layer.align,
    fontFamily: studioFontFamily(layer.font),
    fontWeight: layer.bold ? 700 : 400,
    opacity: layer.opacity
  }
}
function selectCanvas() {
  if (cropMode.value) cancelCrop()
  if (editingText.value) finishTextEdit()
  selectedId.value = ''
  selectedIds.value = []
  selectedGroupId.value = ''
  showInspector()
  menu.value = undefined
}
function toggleLayerSelection(id: string) {
  const ids = selectedIds.value.includes(id)
    ? selectedIds.value.filter((value) => value !== id)
    : [...selectedIds.value, id]
  selectedId.value = ids[ids.length - 1] ?? ''
  selectedIds.value = ids
  selectedGroupId.value = ''
  showInspector()
}
function selectLayer(id: string, event?: MouseEvent) {
  const layer = draft.value.layers.find((item) => item.id === id)
  const group = lockedGroupFor(layer)
  if (group) {
    selectGroup(group.id)
    return
  }
  if (event?.ctrlKey || event?.metaKey) {
    toggleLayerSelection(id)
    return
  }
  selectedIds.value = [id]
  if (id === selectedId.value && inspectorTab.value === 'properties') {
    showInspector()
    return
  }
  if (cropMode.value) cancelCrop()
  if (editingText.value) finishTextEdit()
  selectedId.value = id
  selectedGroupId.value = ''
  showInspector()
}
function selectGroup(id: string) {
  if (cropMode.value) cancelCrop()
  if (editingText.value) finishTextEdit()
  selectedId.value = ''
  selectedIds.value = []
  selectedGroupId.value = id
  showInspector()
}
function doubleClick(event: MouseEvent) {
  const layer = hit(point(event))
  if (!layer) return
  const group = lockedGroupFor(layer)
  if (group) {
    selectGroup(group.id)
    return
  }
  selectedId.value = layer.id
  if (layer.kind === 'image') beginCrop()
  else if (layer.kind === 'text') beginTextEdit()
}
function showMenu(
  x: number,
  y: number,
  kind: 'layer' | 'group' | 'blank' | 'asset',
  id?: string,
  path?: string
) {
  if (kind === 'layer' && id) {
    const group = lockedGroupFor(draft.value.layers.find((layer) => layer.id === id))
    if (group) {
      kind = 'group'
      id = group.id
    }
  }
  if (kind === 'layer' && id) {
    selectedId.value = id
    selectedIds.value = [id]
    selectedGroupId.value = ''
  }
  if (kind === 'group' && id) {
    selectedId.value = ''
    selectedIds.value = []
    selectedGroupId.value = id
  }
  const imageMenu =
    kind === 'layer' &&
    draft.value.layers.some((layer) => layer.id === id && layer.kind === 'image')
  const menuHeight = kind === 'group' ? 390 : imageMenu ? 430 : 350
  menu.value = {
    x: Math.max(8, Math.min(x, innerWidth - 200)),
    y: Math.max(8, Math.min(y, innerHeight - menuHeight)),
    kind,
    id,
    path
  }
}
function openGroupMenu(event: MouseEvent, id: string) {
  const anchor = (event.currentTarget as HTMLElement).getBoundingClientRect()
  showMenu(event.clientX || anchor.right, event.clientY || anchor.bottom, 'group', id)
}
function openLayerMenu(event: MouseEvent, id: string) {
  const anchor = (event.currentTarget as HTMLElement).getBoundingClientRect()
  showMenu(event.clientX || anchor.right, event.clientY || anchor.bottom, 'layer', id)
}
function context(event: MouseEvent) {
  event.preventDefault()
  const layer = hit(point(event))
  if (layer) showMenu(event.clientX, event.clientY, 'layer', layer.id)
  else showMenu(event.clientX, event.clientY, 'blank')
}
function action(name: string) {
  const current = menu.value
  if (!current) return
  menu.value = undefined
  if (current.kind === 'group' && current.id) {
    const id = current.id
    selectedId.value = ''
    selectedGroupId.value = id
    switch (name) {
      case 'rename-group':
        renameGroup(id)
        break
      case 'collapse-group':
        toggleGroup(id, 'collapsed')
        break
      case 'visibility-group':
        toggleGroup(id, 'visible')
        break
      case 'lock-group':
        toggleGroup(id, 'locked')
        break
      case 'preview-group':
        openAIDialog({ kind: 'group', id })
        break
      case 'copy-group':
        copySelection()
        break
      case 'paste':
        pasteSelection()
        break
      case 'dissolve-group':
        dissolveGroup(id)
        break
      case 'delete-group':
        removeGroup(id)
        break
    }
    return
  }
  if (current.id) selectedId.value = current.id
  switch (name) {
    case 'add-image':
      openImagePicker()
      break
    case 'replace-image':
      openImagePicker('replace')
      break
    case 'fill-canvas':
      fillCanvas()
      break
    case 'ai-layer':
      if (current.id) openAIDialog({ kind: 'layer', id: current.id })
      break
    case 'add-text':
      addText()
      break
    case 'asset-add':
      if (current.path) addImage(current.path)
      break
    case 'asset-replace':
      if (current.path) addImage(current.path, true)
      break
    case 'edit':
      beginTextEdit()
      break
    case 'duplicate':
      duplicate()
      break
    case 'copy':
      copySelection()
      break
    case 'paste':
      pasteSelection()
      break
    case 'front':
      moveLayer('front')
      break
    case 'back':
      moveLayer('back')
      break
    case 'visibility':
      if (selected.value) toggle(selected.value.id, 'visible')
      break
    case 'lock':
      if (selected.value) toggle(selected.value.id, 'locked')
      break
    case 'delete':
      removeLayer()
      break
  }
}
function keydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement
  const dialog = target?.closest('[role="dialog"]')
  if (comparing.value && event.key === 'Escape') {
    comparing.value = false
    event.preventDefault()
    return
  }
  if (
    savingArtifact.value ||
    exitConfirmOpen.value ||
    comparing.value ||
    event.defaultPrevented ||
    event.isComposing ||
    picker.value ||
    saveArtifactOpen.value ||
    renameDraftOpen.value ||
    renameGroupOpen.value ||
    createGroupOpen.value ||
    aiOpen.value ||
    target?.closest('input,textarea,select,[contenteditable],[role="textbox"]') ||
    (dialog && (!studioRoot.value || !dialog.contains(studioRoot.value)))
  )
    return
  if (event.code === 'Space') {
    space = true
    return
  }
  if (event.key === 'Escape') {
    if (cropMode.value) cancelCrop()
    else if (menu.value) menu.value = undefined
    else if (!picker.value && (selected.value || selectedGroup.value)) selectCanvas()
    else if (props.standalone) {
      event.preventDefault()
      exitStudio()
    }
    return
  }
  if (cropMode.value || editingText.value) return
  if (event.ctrlKey || event.metaKey) {
    const key = event.key.toLowerCase()
    if (key === 'z' && !props.readonly) {
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
      return
    }
    if (key === 'y' && !props.readonly) {
      event.preventDefault()
      redo()
      return
    }
    if (key === 'c' && (selectedGroup.value || selectedIds.value.length)) {
      event.preventDefault()
      copySelection()
      return
    }
    if (key === 'v' && !props.readonly) {
      event.preventDefault()
      pasteSelection()
      return
    }
    if (key === 'g' && !props.readonly) {
      if (selectedGroup.value) {
        event.preventDefault()
        dissolveGroup(selectedGroup.value.id)
        return
      }
      if (selectedIds.value.length > 1) {
        event.preventDefault()
        beginGroupSelection()
        return
      }
    }
    return
  }
  if (event.altKey) return
  if (event.key === 'Delete' && selectedIds.value.length && !props.readonly) {
    event.preventDefault()
    removeLayer()
    return
  }
  const step = event.shiftKey ? 10 : 1
  const motions: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step]
  }
  if (motions[event.key] && selectedGroup.value?.locked && !props.readonly) {
    event.preventDefault()
    change(() => {
      for (const layer of draft.value.layers)
        if (layer.groupId === selectedGroupId.value) {
          layer.x += motions[event.key][0]
          layer.y += motions[event.key][1]
        }
    })
    return
  }
  const current = selected.value
  if (
    motions[event.key] &&
    current &&
    !studioLayerLocked(draft.value, current) &&
    !props.readonly
  ) {
    event.preventDefault()
    change(() => {
      current.x += motions[event.key][0]
      current.y += motions[event.key][1]
    })
  }
}
function keyup(event: KeyboardEvent) {
  if (event.code === 'Space') space = false
}
defineExpose({ requestExit: exitStudio, saving: savingArtifact })

function closeSidePanels() {
  inspectorOpen.value = false
  layersOpen.value = false
}
function addTextAndOpenProperties() {
  addText()
  openProperties()
}
function toggleLayersPanel() {
  layersOpen.value = !layersOpen.value
  inspectorOpen.value = false
}
function togglePropertiesPanel() {
  inspectorOpen.value = !inspectorOpen.value
  layersOpen.value = false
  inspectorTab.value = 'properties'
}
function setBackgroundColor(event: Event) {
  if (!(event.target instanceof HTMLInputElement)) return
  draft.value.background = event.target.value
  solidBackground.value = draft.value.background
}
</script>

<template>
  <div
    ref="studioRoot"
    class="image-studio"
    :class="{ 'image-studio--standalone': standalone }"
    @click="menu = undefined"
  >
    <nav
      v-if="standalone"
      class="studio-tool-rail"
      :inert="savingArtifact || exporting"
      aria-label="图片编辑工具"
    >
      <button
        type="button"
        title="选择与移动"
        aria-label="选择与移动"
        :class="{ active: !cropMode && !layersOpen }"
        :disabled="comparing"
        @click="cropMode ? cancelCrop() : openProperties()"
      >
        <DragOutlined />
      </button>
      <button
        type="button"
        :title="cropMode && !resizingImage ? '取消裁剪' : '裁剪'"
        aria-label="裁剪"
        :aria-pressed="cropMode && !resizingImage"
        :class="{ active: cropMode && !resizingImage }"
        :disabled="!canAdjustImage"
        @click="openCropTool('crop')"
      >
        <ScissorOutlined />
      </button>
      <button
        type="button"
        :title="resizingImage ? '取消缩放' : '缩放'"
        aria-label="缩放"
        :aria-pressed="resizingImage"
        :class="{ active: resizingImage }"
        :disabled="!canAdjustImage"
        @click="openCropTool('resize')"
      >
        <ExpandOutlined />
      </button>
      <span class="rail-divider" aria-hidden="true" />
      <button
        type="button"
        aria-label="撤销"
        title="撤销 Ctrl+Z"
        :disabled="!canUndo || cropMode || readonly || comparing || savingArtifact"
        @click="undo"
      >
        <UndoOutlined />
      </button>
      <button
        type="button"
        aria-label="重做"
        title="重做 Ctrl+Y"
        :disabled="!canRedo || cropMode || readonly || comparing || savingArtifact"
        @click="redo"
      >
        <RedoOutlined />
      </button>
      <button
        type="button"
        :aria-label="mediaFile ? '原图对比' : '调整前对比'"
        :title="mediaFile ? '原图对比' : '调整前对比'"
        :aria-pressed="comparing"
        :disabled="cropMode || editingText || savingArtifact"
        @click="comparing = !comparing"
      >
        <EyeOutlined />
      </button>
      <button
        v-if="!mediaFile"
        type="button"
        title="制作笔记"
        aria-label="制作笔记"
        @click="showNotes"
      >
        <FileTextOutlined />
      </button>
    </nav>
    <div
      v-if="standalone && !mediaFile"
      class="studio-preview-actions"
      :inert="savingArtifact || exporting"
      role="toolbar"
      aria-label="作品操作"
    >
      <button
        type="button"
        title="重命名作品"
        aria-label="重命名作品"
        :disabled="readonly"
        @click="renameDraft"
      >
        <EditOutlined />
      </button>
      <button
        type="button"
        title="合成 / AI 加工"
        aria-label="合成 / AI 加工"
        @click="openAIDialog({ kind: 'all' })"
      >
        <RobotOutlined />
      </button>
      <button
        type="button"
        title="关闭编辑"
        aria-label="关闭编辑"
        :disabled="savingArtifact || exporting"
        @click="exitStudio"
      >
        <CloseOutlined />
      </button>
    </div>
    <div class="studio-command-bar">
      <div v-if="standalone" class="studio-document-heading">
        <button
          type="button"
          class="studio-back"
          :aria-label="mediaFile ? '返回预览' : '返回图片制作'"
          :disabled="savingArtifact || exporting"
          @click="exitStudio"
        >
          <ArrowLeftOutlined />
        </button>
        <div>
          <small>{{ mediaFile ? '媒体库 / 调整图片' : workspaceName + ' / 图片制作' }}</small
          ><button type="button" :disabled="readonly" title="重命名作品" @click="renameDraft">
            {{ draft.name }}
          </button>
        </div>
        <a-dropdown v-if="!mediaFile" :disabled="readonly" :trigger="['click']"
          ><button
            type="button"
            class="studio-document-more"
            :disabled="readonly"
            aria-label="作品操作"
          >
            <MoreOutlined /></button
          ><template #overlay
            ><a-menu
              ><a-menu-item @click="renameDraft">重命名作品</a-menu-item
              ><a-menu-item danger @click="deleteDraft">删除作品草稿</a-menu-item></a-menu
            ></template
          ></a-dropdown
        >
      </div>
      <nav v-else class="draft-tabs" aria-label="图片草稿">
        <button
          v-for="item in docs"
          :key="item.id"
          type="button"
          class="draft-tab"
          :class="{ active: item.id === draft.id }"
          :aria-current="item.id === draft.id ? 'page' : undefined"
          @click="switchDraft(item.id)"
        >
          {{ item.name }}
        </button>
        <button type="button" class="add-draft" :disabled="readonly" @click="createDraft">
          ＋ 新建草稿
        </button>
        <a-dropdown :disabled="readonly" :trigger="['click']"
          ><button
            type="button"
            class="draft-more icon-button"
            :disabled="readonly"
            title="当前草稿操作"
            aria-label="当前草稿操作"
          >
            <MoreOutlined /></button
          ><template #overlay
            ><a-menu
              ><a-menu-item @click="renameDraft">重命名草稿</a-menu-item
              ><a-menu-item danger @click="deleteDraft">删除草稿</a-menu-item></a-menu
            ></template
          ></a-dropdown
        >
      </nav>
      <div v-if="!standalone" class="studio-history">
        <button
          type="button"
          class="history-button"
          :disabled="!canUndo || readonly || cropMode || editingText || savingArtifact || comparing"
          title="撤销 Ctrl+Z"
          aria-label="撤销"
          @click="undo"
        >
          <UndoOutlined />
        </button>
        <button
          type="button"
          class="history-button"
          :disabled="!canRedo || readonly || cropMode || editingText || savingArtifact || comparing"
          title="重做 Ctrl+Y"
          aria-label="重做"
          @click="redo"
        >
          <RedoOutlined />
        </button>
        <button
          type="button"
          :disabled="cropMode || editingText || savingArtifact"
          :aria-pressed="comparing"
          @click="comparing = !comparing"
        >
          <EyeOutlined />{{ comparing ? '返回调整' : mediaFile ? '原图对比' : '调整前对比' }}
        </button>
      </div>
      <div v-show="!cropMode" class="studio-command-actions" role="group" aria-label="保存图片">
        <div class="export-area" role="radiogroup" aria-label="保存范围">
          <span>保存范围</span
          ><button
            v-for="area in ['content', 'canvas'] as const"
            :key="area"
            type="button"
            role="radio"
            :aria-checked="exportArea === area"
            :class="{ active: exportArea === area }"
            :disabled="savingArtifact || exporting"
            @click="exportArea = area"
          >
            {{ area === 'content' ? '内容区' : '整个画布' }}
          </button>
        </div>
        <span
          v-if="!cropMode"
          class="save-indicator"
          :title="
            editSavedAt ? `编辑记录保存于 ${new Date(editSavedAt).toLocaleString()}` : undefined
          "
          :class="
            mediaFile
              ? savingArtifact
                ? 'saving'
                : mediaDirty
                  ? 'unsaved'
                  : 'unchanged'
              : saveState
          "
          role="status"
          aria-live="polite"
          ><i />{{ saveLabel }}</span
        >
        <div v-if="!cropMode" class="studio-export">
          <button
            v-if="!mediaFile"
            type="button"
            class="note-entry"
            :class="{ active: inspectorTab === 'notes' }"
            @click="showInspector('notes')"
          >
            <FileTextOutlined />制作笔记<i v-if="noteDirty" aria-label="笔记未保存" />
          </button>
          <select v-if="!mediaFile" v-model="format" aria-label="导出格式">
            <option value="png">PNG</option>
            <option value="jpeg">JPG</option>
          </select>
          <button
            v-if="!mediaFile"
            type="button"
            class="studio-ai-entry"
            @click="openAIDialog({ kind: 'all' })"
          >
            合成 / AI 加工
          </button>
          <template v-if="mediaFile">
            <a-button
              type="primary"
              :loading="savingArtifact"
              :disabled="readonly || cropMode || editingText"
              @click="saveMedia(false)"
              >保存副本</a-button
            >
            <a-button
              class="overwrite-image"
              danger
              :disabled="readonly || savingArtifact || cropMode || editingText"
              @click="saveMedia(true)"
              >覆盖原图</a-button
            >
          </template>
          <template v-else
            ><a-button
              type="primary"
              :disabled="readonly || savingArtifact || cropMode || editingText"
              @click="openSaveArtifact"
              >保存图片</a-button
            >
            <a-button
              :loading="exporting"
              :disabled="savingArtifact || cropMode || editingText"
              @click="exportImage"
              >下载图片</a-button
            >
          </template>
        </div>
      </div>
    </div>
    <div v-if="storageError" class="studio-alert" role="alert">{{ storageError }}</div>
    <div
      class="studio-grid"
      :style="{
        '--studio-layers-height': `clamp(140px, ${layerPanelPercent}%, calc(100% - 320px))`
      }"
      :inert="savingArtifact || comparing"
      :class="{
        'inspector-open': inspectorOpen,
        'layers-open': layersOpen,
        'is-comparing': comparing,
        'is-cropping': cropMode
      }"
    >
      <button
        v-if="!standalone && (inspectorOpen || layersOpen)"
        type="button"
        class="dock-backdrop"
        aria-label="关闭侧面板"
        @click="closeSidePanels"
      />
      <aside
        class="studio-side studio-layers"
        :inert="cropMode"
        :class="{ 'layers-disabled': cropMode }"
      >
        <div class="panel-heading">
          <strong
            ><StudioLayersIcon v-if="standalone" />图层
            <small v-if="standalone">{{ draft.layers.length }}</small></strong
          ><span v-if="!standalone"
            >{{ selectedIds.length > 1 ? `${selectedIds.length} 层已选 · ` : ''
            }}{{ draft.layers.length }} 层 · {{ draft.groups.length }} 组</span
          >
        </div>
        <button
          type="button"
          class="canvas-row"
          :class="{ active: !selected && !selectedGroup }"
          :aria-pressed="!selected && !selectedGroup"
          @click="selectCanvas"
        >
          <BorderOutlined /><span>画布</span><small>{{ draft.width }} × {{ draft.height }}</small>
        </button>
        <div class="layer-section-label"><span>添加</span></div>
        <div class="layer-actions" role="group" aria-label="添加图层或分组">
          <button
            type="button"
            title="添加图片"
            aria-label="添加图片"
            :disabled="readonly || cropMode"
            @click="openImagePicker()"
          >
            <PictureOutlined />
          </button>
          <button
            type="button"
            title="添加文字"
            aria-label="添加文字"
            :disabled="readonly || cropMode"
            @click="addTextAndOpenProperties"
          >
            <FontSizeOutlined />
          </button>
          <button
            type="button"
            title="新建分组"
            aria-label="新建分组"
            :disabled="readonly || cropMode"
            @click="addGroup"
          >
            <FolderAddOutlined />
          </button>
        </div>
        <div class="layer-list-shell">
          <div
            class="layer-drop-top"
            :class="{ 'is-visible': dragZonesVisible, 'drop-target': dropTarget?.kind === 'top' }"
            :aria-hidden="!dragZonesVisible"
            @dragover.prevent.stop="dragOver($event, 'top')"
            @drop.prevent.stop="dropItem"
            aria-label="移到图层顶部"
          >
            拖动到此
          </div>
          <div
            class="layer-list-area"
            :class="{ 'is-dragging': dragItem }"
            aria-label="图层管理区域"
          >
            <p v-if="!draft.layers.length" class="empty">
              从工作区素材添加图片，或在画布中添加文字。
            </p>
            <template
              v-for="row in layerRows"
              :key="row.kind === 'group' ? row.group.id : row.layer.id"
            >
              <div
                v-if="row.kind === 'group'"
                class="group-row"
                :class="{
                  active: selectedGroupId === row.group.id,
                  faded: !row.group.visible,
                  dragging: dragItem?.kind === 'group' && dragItem.id === row.group.id,
                  [dropClass(row)]: true
                }"
                role="button"
                tabindex="0"
                :aria-label="`分组 ${row.group.name}`"
                @click="selectGroup(row.group.id)"
                @keydown.enter.self="selectGroup(row.group.id)"
                @keydown.space.self.prevent="selectGroup(row.group.id)"
                @contextmenu.prevent.stop="openGroupMenu($event, row.group.id)"
                :draggable="!readonly && !row.group.locked"
                @dragstart.stop="startDrag($event, 'group', row.group.id)"
                @dragend="endDrag"
                @dragover.prevent.stop="dragOver($event, 'group', row.group.id)"
                @drop.prevent.stop="dropItem"
              >
                <button
                  type="button"
                  :aria-label="row.group.collapsed ? '展开分组' : '收起分组'"
                  @click.stop="toggleGroup(row.group.id, 'collapsed')"
                >
                  {{ row.group.collapsed ? '▸' : '▾' }}
                </button>
                <FolderOutlined /><span class="group-name-count"
                  ><span class="layer-name" :title="row.group.name">{{ row.group.name }}</span
                  ><small title="图层数量">{{
                    draft.layers.filter((layer) => layer.groupId === row.group.id).length
                  }}</small></span
                >
                <button
                  type="button"
                  :aria-label="row.group.visible ? '隐藏分组' : '显示分组'"
                  :title="row.group.visible ? '隐藏分组' : '显示分组'"
                  :disabled="readonly"
                  @click.stop="toggleGroup(row.group.id, 'visible')"
                >
                  <EyeOutlined v-if="row.group.visible" /><EyeInvisibleOutlined v-else />
                </button>
                <button
                  type="button"
                  :aria-label="row.group.locked ? '解锁分组' : '锁定分组'"
                  :title="row.group.locked ? '解锁分组' : '锁定分组'"
                  :disabled="readonly"
                  @click.stop="toggleGroup(row.group.id, 'locked')"
                >
                  <LockOutlined v-if="row.group.locked" /><UnlockOutlined v-else />
                </button>
                <button
                  type="button"
                  :aria-label="'更多分组操作：' + row.group.name"
                  title="更多分组操作"
                  @click.stop="openGroupMenu($event, row.group.id)"
                >
                  <MoreOutlined />
                </button>
              </div>
              <div
                v-else
                class="layer-row"
                :class="{
                  active: selectedIds.includes(row.layer.id),
                  faded: !studioLayerVisible(draft, row.layer),
                  'group-child': !!row.layer.groupId,
                  dragging: dragItem?.kind === 'layer' && dragItem.id === row.layer.id,
                  [dropClass(row)]: true
                }"
                :draggable="!readonly && !studioLayerLocked(draft, row.layer)"
                @dragstart.stop="startDrag($event, 'layer', row.layer.id)"
                @dragend="endDrag"
                @dragover.prevent.stop="dragOver($event, 'layer', row.layer.id)"
                @drop.prevent.stop="dropItem"
                @click="selectLayer(row.layer.id, $event)"
                @contextmenu.prevent.stop="
                  showMenu($event.clientX, $event.clientY, 'layer', row.layer.id)
                "
              >
                <img
                  v-if="row.layer.kind === 'image' && assetInfo[row.layer.path]"
                  :src="toImageThumbnailUrl(assetInfo[row.layer.path], '96x96')"
                  alt=""
                  draggable="false"
                />
                <span v-else class="layer-symbol"
                  ><PictureOutlined v-if="row.layer.kind === 'image'" /> <FontSizeOutlined v-else
                /></span>
                <span class="layer-name" :title="row.layer.name">{{ row.layer.name }}</span>
                <button
                  type="button"
                  :aria-label="row.layer.visible ? '隐藏图层' : '显示图层'"
                  :title="row.layer.visible ? '隐藏' : '显示'"
                  :disabled="!!lockedGroupFor(row.layer)"
                  @click.stop="toggle(row.layer.id, 'visible')"
                >
                  <EyeOutlined v-if="row.layer.visible" /><EyeInvisibleOutlined v-else />
                </button>
                <button
                  type="button"
                  :aria-label="row.layer.locked ? '解锁图层' : '锁定图层'"
                  :title="row.layer.locked ? '解锁' : '锁定'"
                  :disabled="!!lockedGroupFor(row.layer)"
                  @click.stop="toggle(row.layer.id, 'locked')"
                >
                  <LockOutlined v-if="row.layer.locked" /><UnlockOutlined v-else />
                </button>
                <button
                  type="button"
                  :aria-label="'更多操作：' + row.layer.name"
                  title="更多操作"
                  @click.stop="openLayerMenu($event, row.layer.id)"
                >
                  <MoreOutlined />
                </button>
              </div>
            </template>
          </div>
          <div
            class="layer-drop-outside"
            :class="{
              'is-visible': dragZonesVisible,
              'drop-target': dropTarget?.kind === 'bottom'
            }"
            :aria-hidden="!dragZonesVisible"
            :aria-label="dragItem?.kind === 'layer' ? '移出分组并放到底部' : '分组移到底部'"
            @dragover.prevent.stop="dragOver($event, 'bottom')"
            @drop.prevent.stop="dropItem"
          >
            拖动到此
          </div>
        </div>
      </aside>
      <div
        v-if="standalone"
        class="studio-panel-splitter"
        role="separator"
        tabindex="0"
        aria-label="调整图层区域高度"
        aria-orientation="horizontal"
        :aria-valuenow="Math.round(layerPanelPercent)"
        :aria-valuemin="20"
        :aria-valuemax="55"
        @pointerdown.prevent="startPanelResize"
        @pointermove="resizePanels"
        @pointerup="endPanelResize"
        @pointercancel="endPanelResize"
        @lostpointercapture="endPanelResize"
        @keydown.up.prevent="stepPanelResize(-3)"
        @keydown.down.prevent="stepPanelResize(3)"
      >
        <span />
      </div>
      <main class="studio-stage">
        <div class="stage-toolbar">
          <template v-if="cropMode"
            ><strong class="crop-title">裁剪图片</strong
            ><span class="crop-actions"
              ><button type="button" @click="cancelCrop">取消</button
              ><button type="button" class="primary" @click="finishCrop">完成</button></span
            ></template
          >
          <div v-else class="studio-toolstrip" role="toolbar" aria-label="画布工具">
            <button
              type="button"
              class="dock-toggle"
              title="打开图层"
              aria-label="打开图层"
              :aria-expanded="layersOpen"
              @click="toggleLayersPanel"
            >
              <StudioLayersIcon />
            </button>
            <span class="tool-caption">选择图层并拖动排版</span>
          </div>
          <span v-if="!cropMode" class="zoom-actions">
            <button
              type="button"
              class="dock-toggle"
              title="打开属性"
              aria-label="打开属性"
              :aria-expanded="inspectorOpen"
              @click="togglePropertiesPanel"
            >
              <ControlOutlined />
            </button>
            <button type="button" title="缩小画布" @click="zoomTo(viewZoom / 1.2)">−</button>
            <button type="button" title="适应窗口" @click="zoomTo(1)">
              {{ Math.round(viewZoom * 100) }}%
            </button>
            <button type="button" title="放大画布" @click="zoomTo(viewZoom * 1.2)">＋</button>
          </span>
        </div>
        <div
          ref="viewport"
          class="stage-viewport"
          :class="{ panning }"
          @pointerdown.self="viewportPointerDown"
          @pointermove.self="pointerMove"
          @pointerup.self="pointerUp"
          @pointercancel.self="pointerUp"
          @auxclick.middle.prevent
          @wheel="wheel"
        >
          <div
            ref="board"
            class="artboard"
            :class="{
              'checkerboard-background':
                displayDocument.background === 'transparent' &&
                displayDocument.backgroundView === 'checkerboard'
            }"
            :style="boardStyle"
            tabindex="0"
            aria-label="图片画布"
            @pointerdown="pointerDown"
            @pointermove="pointerMove"
            @pointerup="pointerUp"
            @pointercancel="pointerUp"
            @dblclick="doubleClick"
            @contextmenu="context"
          >
            <canvas ref="canvas" />
            <template v-for="layer in draft.layers" :key="layer.id">
              <div
                v-if="selectedIds.includes(layer.id) && studioLayerVisible(draft, layer)"
                class="selection"
                :class="{
                  locked: studioLayerLocked(draft, layer),
                  secondary: selectedIds.length > 1
                }"
                :style="layerStyle(layer)"
              >
                <template
                  v-if="
                    selectedIds.length === 1 &&
                    !studioLayerLocked(draft, layer) &&
                    (!cropMode || resizingImage)
                  "
                >
                  <i
                    v-for="handle in ['nw', 'ne', 'se', 'sw']"
                    :key="handle"
                    :class="'handle ' + handle"
                    :data-handle="handle"
                  />
                  <template v-if="!cropMode"
                    ><i class="rotation-stem" /><i
                      class="handle rotate"
                      data-handle="rotate"
                      title="旋转"
                  /></template>
                </template>
                <div
                  v-if="cropMode && !resizingImage && layer.kind === 'image'"
                  class="crop-box"
                  :style="{
                    left: cropSelection.x * 100 + '%',
                    top: cropSelection.y * 100 + '%',
                    width: cropSelection.width * 100 + '%',
                    height: cropSelection.height * 100 + '%'
                  }"
                >
                  <i
                    v-for="handle in ['nw', 'ne', 'se', 'sw']"
                    :key="handle"
                    :class="'handle ' + handle"
                    :data-handle="'crop-' + handle"
                  />
                </div>
                <textarea
                  v-if="editingText && layer.kind === 'text'"
                  ref="textArea"
                  v-model="textInput"
                  class="inline-text"
                  :style="inlineTextStyle(layer)"
                  @pointerdown.stop
                  @dblclick.stop
                  @keydown.esc.stop.prevent="finishTextEdit(false)"
                  @keydown.ctrl.enter.stop.prevent="finishTextEdit()"
                  @blur="finishTextEdit()"
                />
              </div>
            </template>
            <div
              v-if="selectedGroupBounds && !cropMode"
              class="selection group-selection"
              :style="selectedGroupStyle"
            >
              <span>{{ selectedGroup?.name }} · 拖动整组</span>
            </div>
          </div>
        </div>
        <div class="stage-foot">
          <span v-if="renderError" class="render-error" role="alert">{{ renderError }}</span>
          <span v-else>{{
            cropMode
              ? '拖动边界裁剪；拖动图片调整取景。滚轮只缩放视图。'
              : selectedGroup
                ? '拖动虚线框移动整组；Ctrl+G 解散，Alt+点击可选分组。'
                : selectedIds.length > 1
                  ? `已选 ${selectedIds.length} 层 · Ctrl+G 编组，Ctrl+C 复制。`
                  : '双击图片裁剪，双击文字编辑；中键拖动画布，滚轮缩放视图。'
          }}</span>
        </div>
      </main>
      <aside class="studio-side studio-inspector">
        <template v-if="cropMode">
          <div class="floating-panel-heading">
            <strong
              ><ExpandOutlined v-if="resizingImage" /><ScissorOutlined v-else />{{
                resizingImage ? '缩放' : '裁剪'
              }}</strong
            ><button
              type="button"
              :aria-label="resizingImage ? '取消缩放' : '取消裁剪'"
              @click="cancelCrop"
            >
              <CloseOutlined />
            </button>
          </div>
          <div class="inspector-scroll crop-settings">
            <section>
              <div class="crop-section-heading">
                <strong>画面比例</strong
                ><button type="button" @click="setCropRatio(resizingImage ? 'original' : 'free')">
                  重置
                </button>
              </div>
              <div class="floating-ratios">
                <button
                  v-for="ratio in cropRatioChoices"
                  :key="ratio"
                  type="button"
                  :class="{ active: cropRatio === ratio }"
                  :aria-pressed="cropRatio === ratio"
                  @click="setCropRatio(ratio)"
                >
                  <i
                    :style="{
                      aspectRatio:
                        ratio === 'free' || ratio === 'original' ? '1.4' : ratio.replace(':', '/')
                    }"
                    :class="{ free: ratio === 'free' }"
                  />{{ ratio === 'free' ? '自由' : ratio === 'original' ? '原比例' : ratio }}
                </button>
              </div>
            </section>
            <section>
              <div class="crop-section-heading">
                <strong>输出尺寸</strong
                ><label class="floating-aspect"
                  >保持比例<a-switch v-model:checked="cropLock" size="small"
                /></label>
              </div>
              <div class="floating-dimensions">
                <label v-for="axis in ['width', 'height'] as const" :key="axis"
                  >{{ axis === 'width' ? '宽度' : '高度'
                  }}<span
                    ><button
                      type="button"
                      :aria-label="axis === 'width' ? '减小宽度' : '减小高度'"
                      @click="setCropOutput(axis, cropOutput[axis] - 1)"
                    >
                      −</button
                    ><input
                      type="number"
                      min="1"
                      max="16384"
                      :aria-label="axis === 'width' ? '输出宽度' : '输出高度'"
                      :value="cropOutput[axis]"
                      @input="
                        setCropOutput(axis, Number(($event.target as HTMLInputElement).value))
                      "
                    /><button
                      type="button"
                      :aria-label="axis === 'width' ? '增大宽度' : '增大高度'"
                      @click="setCropOutput(axis, cropOutput[axis] + 1)"
                    >
                      ＋
                    </button></span
                  ></label
                >
              </div>
            </section>
          </div>
          <div class="floating-crop-actions" role="group" aria-label="应用图片调整">
            <button type="button" @click="cancelCrop">取消</button
            ><button type="button" class="primary" @click="finishCrop">应用调整</button>
          </div>
        </template>
        <template v-else>
          <div
            v-if="
              standalone &&
              (inspectorTab === 'notes' || (!imageLayer && !textLayer && !selectedGroup))
            "
            class="floating-panel-heading"
          >
            <strong
              ><ControlOutlined />{{
                inspectorTab === 'notes' ? '制作笔记' : selected ? '图层属性' : '画布设置'
              }}</strong
            >
          </div>
          <div
            v-else-if="!standalone"
            class="inspector-tabs"
            role="tablist"
            aria-label="编辑侧面板"
          >
            <button
              type="button"
              role="tab"
              :aria-selected="inspectorTab === 'properties'"
              :class="{ active: inspectorTab === 'properties' }"
              @click="inspectorTab = 'properties'"
            >
              属性
            </button>
            <button
              v-if="!mediaFile"
              type="button"
              role="tab"
              :aria-selected="inspectorTab === 'notes'"
              :class="{ active: inspectorTab === 'notes' }"
              @click="inspectorTab = 'notes'"
            >
              <FileTextOutlined />笔记<i v-if="noteDirty" aria-label="未保存" />
            </button>
            <button
              type="button"
              class="dock-close"
              title="关闭侧面板"
              aria-label="关闭侧面板"
              @click="inspectorOpen = false"
            >
              <CloseOutlined />
            </button>
          </div>
          <div v-if="inspectorTab === 'notes'" class="inspector-scroll studio-note">
            <strong>制作笔记</strong>
            <p>记录当前工作区的图片制作想法，在草稿之间共用。</p>
            <textarea
              v-model="note"
              maxlength="5000"
              :disabled="readonly"
              placeholder="例如：封面用竖版，标题放在底部"
              aria-label="制作笔记"
            />
            <div class="note-actions">
              <span role="status">{{ noteDirty ? '有未保存的笔记修改' : '笔记已保存' }}</span>
              <button
                type="button"
                :disabled="readonly || noteSaving || !noteDirty"
                @click="emit('saveNote')"
              >
                {{ noteSaving ? '保存中…' : '保存笔记' }}
              </button>
            </div>
          </div>
          <div v-else class="inspector-scroll">
            <div
              v-if="!imageLayer && !textLayer && !selectedGroup"
              class="panel-heading inspector-heading"
            >
              <strong>画布属性</strong>
            </div>
            <div v-if="selected" class="compact-layer-properties">
              <template v-if="selected.kind === 'image' || selected.kind === 'text'">
                <div class="layer-property-header">
                  <PictureOutlined v-if="imageLayer" /><FontSizeOutlined v-else />
                  <input
                    v-model="selected.name"
                    aria-label="名称"
                    title="点击修改图层名称"
                    :disabled="readonly"
                    @focus="fieldFocus"
                    @change="fieldChange"
                    @blur="fieldChange"
                    @keydown.enter="($event.target as HTMLInputElement).blur()"
                  />
                  <button
                    v-if="imageLayer"
                    type="button"
                    class="replace-image-action"
                    :disabled="readonly"
                    @click="openImagePicker('replace')"
                  >
                    替换图片
                  </button>
                </div>
                <label class="compact-group-field"
                  ><span>所属分组</span
                  ><select
                    aria-label="所属分组"
                    :value="selected.groupId || ''"
                    :disabled="readonly"
                    @change="
                      selected &&
                      moveLayerToGroup(
                        selected.id,
                        ($event.target as HTMLSelectElement).value || undefined
                      )
                    "
                  >
                    <option value="">未分组</option>
                    <option v-for="group in draft.groups" :key="group.id" :value="group.id">
                      {{ group.name }}
                    </option>
                  </select></label
                >
              </template>
              <section v-if="textLayer" class="compact-text-content" aria-label="文字排版">
                <div class="compact-section-heading">
                  <label :for="layerTextId">内容</label
                  ><button
                    type="button"
                    :aria-expanded="textContentExpanded"
                    @click="textContentExpanded = !textContentExpanded"
                  >
                    {{ textContentExpanded ? '收起' : '展开' }}
                  </button>
                </div>
                <textarea
                  :id="layerTextId"
                  v-model="textLayer.text"
                  :rows="textContentExpanded ? 6 : 2"
                  :disabled="readonly"
                  @focus="fieldFocus"
                  @change="fieldChange"
                />
                <div class="compact-font-fields">
                  <label class="compact-value-field"
                    ><span>字体</span
                    ><select
                      v-model="textLayer.font"
                      aria-label="字体"
                      :disabled="readonly"
                      @focus="fieldFocus"
                      @change="fieldChange"
                    >
                      <option v-for="font in studioFonts" :key="font.value" :value="font.value">
                        {{ font.label }}
                      </option>
                    </select></label
                  >
                  <label class="compact-value-field"
                    ><span>字号</span
                    ><input
                      v-model.number="textLayer.fontSize"
                      aria-label="字号"
                      type="number"
                      min="12"
                      max="400"
                      :disabled="readonly"
                      @focus="fieldFocus"
                      @change="fieldChange"
                  /></label>
                </div>
                <div class="compact-text-tools" role="group" aria-label="文字样式">
                  <button
                    type="button"
                    aria-label="粗体"
                    title="粗体"
                    :aria-pressed="textLayer.bold"
                    :class="{ active: textLayer.bold }"
                    :disabled="readonly"
                    @click="textLayer && updateTextStyle({ bold: !textLayer.bold })"
                  >
                    <BoldOutlined />
                  </button>
                  <span class="text-tools-divider" />
                  <button
                    v-for="option in [
                      { value: 'left', label: '居左', icon: AlignLeftOutlined },
                      { value: 'center', label: '居中', icon: AlignCenterOutlined },
                      { value: 'right', label: '居右', icon: AlignRightOutlined }
                    ] as const"
                    :key="option.value"
                    type="button"
                    :aria-label="option.label"
                    :title="option.label"
                    :aria-pressed="textLayer.align === option.value"
                    :class="{ active: textLayer.align === option.value }"
                    :disabled="readonly"
                    @click="updateTextStyle({ align: option.value })"
                  >
                    <component :is="option.icon" />
                  </button>
                  <label class="compact-color-field" title="文字颜色"
                    ><span>颜色</span
                    ><input
                      v-model="textLayer.color"
                      aria-label="颜色"
                      type="color"
                      :disabled="readonly"
                      @focus="fieldFocus"
                      @change="fieldChange"
                  /></label>
                </div>
              </section>
              <div
                v-if="selected.kind === 'image' || selected.kind === 'text'"
                class="compact-geometry"
                role="group"
                aria-label="位置与尺寸"
              >
                <label class="compact-value-field"
                  ><span>X</span
                  ><input
                    aria-label="X"
                    :value="Math.round(selected.x)"
                    type="number"
                    step="1"
                    :disabled="readonly"
                    @focus="fieldFocus"
                    @change="frameChange('x', $event)"
                /></label>
                <label class="compact-value-field"
                  ><span>Y</span
                  ><input
                    aria-label="Y"
                    :value="Math.round(selected.y)"
                    type="number"
                    step="1"
                    :disabled="readonly"
                    @focus="fieldFocus"
                    @change="frameChange('y', $event)"
                /></label>
                <label class="compact-value-field"
                  ><span>宽</span
                  ><input
                    aria-label="宽"
                    :value="Math.round(selected.width)"
                    type="number"
                    min="16"
                    step="1"
                    :disabled="readonly"
                    @focus="fieldFocus"
                    @change="frameChange('width', $event)"
                /></label>
                <label class="compact-value-field"
                  ><span>高</span
                  ><input
                    aria-label="高"
                    :value="Math.round(selected.height)"
                    type="number"
                    min="16"
                    step="1"
                    :disabled="readonly"
                    @focus="fieldFocus"
                    @change="frameChange('height', $event)"
                /></label>
                <label class="compact-value-field"
                  ><span>旋转</span
                  ><input
                    aria-label="旋转"
                    :value="selected.rotation"
                    type="number"
                    min="-180"
                    max="180"
                    :disabled="readonly || selected.locked"
                    @focus="fieldFocus"
                    @change="appearanceChange('rotation', $event)"
                  /><span>°</span></label
                >
                <label class="compact-value-field"
                  ><span>透明度</span
                  ><input
                    aria-label="透明度"
                    :value="Math.round(selected.opacity * 100)"
                    type="number"
                    min="0"
                    max="100"
                    :disabled="readonly"
                    @focus="fieldFocus"
                    @change="appearanceChange('opacity', $event)"
                  /><span>%</span></label
                >
              </div>
              <section v-if="imageLayer" class="compact-image-appearance" aria-label="图片外观">
                <div class="crop-fit-segments" role="radiogroup" aria-label="图片填充">
                  <button
                    v-for="option in [
                      { value: 'cover', label: '填满', hint: '保持比例填满图层，超出部分不显示' },
                      {
                        value: 'contain',
                        label: '完整显示',
                        hint: '保持比例显示整张图片，可能留白'
                      },
                      { value: 'stretch', label: '拉伸', hint: '按图层宽高拉伸图片，可能变形' }
                    ] as const"
                    :key="option.value"
                    type="button"
                    role="radio"
                    :title="option.hint"
                    :aria-checked="imageLayer.fit === option.value"
                    :class="{ active: imageLayer.fit === option.value }"
                    :disabled="readonly || imageLayer.locked"
                    @click="updateImageFit(option.value)"
                  >
                    {{ option.label }}
                  </button>
                </div>
                <StudioRangeControl
                  label="内容放大"
                  :value="imageLayer.zoom"
                  :display="`${imageLayer.zoom.toFixed(1)}×`"
                  :min="1"
                  :max="8"
                  :step="0.05"
                  :default-value="1"
                  :disabled="readonly || imageLayer.locked"
                  @begin="fieldFocus"
                  @input="imageLayer.zoom = $event"
                  @finish="fieldChange"
                  @reset="resetSlider('zoom')"
                />
                <StudioRangeControl
                  label="亮度"
                  :value="imageLayer.brightness"
                  :display="`${Math.round(imageLayer.brightness)}%`"
                  :min="20"
                  :max="200"
                  :default-value="100"
                  :disabled="readonly"
                  @begin="fieldFocus"
                  @input="imageLayer.brightness = $event"
                  @finish="fieldChange"
                  @reset="resetSlider('brightness')"
                />
                <StudioRangeControl
                  label="对比度"
                  :value="imageLayer.contrast"
                  :display="`${Math.round(imageLayer.contrast)}%`"
                  :min="20"
                  :max="200"
                  :default-value="100"
                  :disabled="readonly"
                  @begin="fieldFocus"
                  @input="imageLayer.contrast = $event"
                  @finish="fieldChange"
                  @reset="resetSlider('contrast')"
                />
                <StudioRangeControl
                  label="圆角"
                  :value="imageLayer.radius"
                  :display="`${Math.round(imageLayer.radius)} px`"
                  :min="0"
                  :max="200"
                  :default-value="0"
                  :disabled="readonly"
                  @begin="fieldFocus"
                  @input="imageLayer.radius = $event"
                  @finish="fieldChange"
                  @reset="resetSlider('radius')"
                />
              </section>
              <button
                v-if="imageLayer && !mediaFile"
                type="button"
                class="wide-action"
                @click="openAIDialog({ kind: 'layer', id: imageLayer.id })"
              >
                AI 加工
              </button>
            </div>
            <div
              v-else-if="selectedGroup"
              class="compact-layer-properties compact-group-properties"
            >
              <div class="layer-property-header">
                <FolderOutlined /><input
                  v-model="selectedGroup.name"
                  aria-label="分组名称"
                  title="点击修改分组名称"
                  :disabled="readonly"
                  @focus="fieldFocus"
                  @change="fieldChange"
                  @blur="fieldChange"
                  @keydown.enter="($event.target as HTMLInputElement).blur()"
                />
                <small>{{ selectedGroupLayerCount }} 个图层</small>
              </div>
              <div class="group-property-actions" role="group" aria-label="分组状态">
                <button
                  type="button"
                  :aria-label="selectedGroup.visible ? '隐藏分组' : '显示分组'"
                  :aria-pressed="!selectedGroup.visible"
                  :class="{ active: !selectedGroup.visible }"
                  :disabled="readonly"
                  @click="selectedGroup && toggleGroup(selectedGroup.id, 'visible')"
                >
                  <EyeOutlined v-if="selectedGroup.visible" /><EyeInvisibleOutlined v-else />{{
                    selectedGroup.visible ? '隐藏' : '显示'
                  }}
                </button>
                <button
                  type="button"
                  :aria-label="selectedGroup.locked ? '解锁分组' : '锁定分组'"
                  :aria-pressed="selectedGroup.locked"
                  :class="{ active: selectedGroup.locked }"
                  :disabled="readonly"
                  @click="selectedGroup && toggleGroup(selectedGroup.id, 'locked')"
                >
                  <LockOutlined v-if="selectedGroup.locked" /><UnlockOutlined v-else />{{
                    selectedGroup.locked ? '解锁' : '锁定'
                  }}
                </button>
              </div>
              <div class="group-property-footer">
                <button
                  v-if="!mediaFile"
                  type="button"
                  class="wide-action"
                  @click="selectedGroup && openAIDialog({ kind: 'group', id: selectedGroup.id })"
                >
                  合成预览 / AI 加工
                </button>
                <button
                  type="button"
                  class="wide-action dissolve-group-action"
                  :disabled="readonly"
                  @click="selectedGroup && dissolveGroup(selectedGroup.id)"
                >
                  解散分组<span>保留图层</span>
                </button>
              </div>
            </div>
            <template v-else>
              <div class="canvas-presets" aria-label="画布比例预设">
                <button
                  v-for="preset in canvasPresets"
                  :key="preset.label"
                  type="button"
                  :class="{ active: draft.width * preset.height === draft.height * preset.width }"
                  :aria-pressed="draft.width * preset.height === draft.height * preset.width"
                  :disabled="readonly"
                  @click="resizeCanvas(preset.canvasWidth, preset.canvasHeight)"
                >
                  {{ preset.label }}
                </button>
              </div>
              <div class="two-fields">
                <label class="field"
                  >宽<input
                    :value="draft.width"
                    type="number"
                    min="1"
                    max="16384"
                    :disabled="readonly"
                    @change="dimension('width', ($event.target as HTMLInputElement).value)"
                /></label>
                <label class="field"
                  >高<input
                    :value="draft.height"
                    type="number"
                    min="1"
                    max="16384"
                    :disabled="readonly"
                    @change="dimension('height', ($event.target as HTMLInputElement).value)"
                /></label>
              </div>
              <div class="canvas-background-controls">
                <h3>画布背景</h3>
                <div class="background-segments" role="radiogroup" aria-label="画布背景">
                  <button
                    v-for="option in [
                      { value: 'checkerboard', label: '棋盘格' },
                      { value: 'transparent', label: '透明' },
                      { value: 'solid', label: '纯色' }
                    ]"
                    :key="option.value"
                    type="button"
                    role="radio"
                    :aria-checked="backgroundMode === option.value"
                    :class="{ active: backgroundMode === option.value }"
                    :disabled="readonly"
                    @click="setBackground(option.value)"
                  >
                    <i
                      :class="'background-swatch ' + option.value"
                      :style="
                        option.value === 'solid' ? { background: solidBackground } : undefined
                      "
                    />{{ option.label }}
                  </button>
                </div>
                <label v-if="backgroundMode === 'solid'" class="solid-background-picker"
                  >背景颜色<input
                    :value="draft.background"
                    type="color"
                    aria-label="背景颜色"
                    :disabled="readonly"
                    @focus="fieldFocus"
                    @input="setBackgroundColor"
                    @change="fieldChange"
                  /><span>{{ draft.background.toUpperCase() }}</span></label
                >
                <p v-else class="inspector-note">
                  {{
                    backgroundMode === 'checkerboard'
                      ? '棋盘格仅用于预览，PNG 保持透明。'
                      : '透明区域直接显示画布底色。'
                  }}
                </p>
              </div>
              <h3>版式模板</h3>
              <div class="template-grid">
                <button
                  v-for="layout in imageLayouts"
                  :key="layout.key"
                  type="button"
                  :disabled="readonly"
                  @click="template(layout.key)"
                >
                  {{ layout.label }}
                </button>
              </div>
            </template>
          </div>
        </template>
      </aside>
    </div>
    <a-modal
      v-model:open="saveArtifactOpen"
      title="保存为素材"
      ok-text="保存"
      :confirm-loading="savingArtifact"
      @ok="saveArtifact"
    >
      <div class="artifact-save-form">
        <label>素材名称<a-input v-model:value="artifactName" :maxlength="120" /></label>
        <a-checkbox v-model:checked="syncToLibrary">同时同步到媒体库</a-checkbox>
        <label v-if="syncToLibrary"
          >媒体库目录
          <div class="artifact-directory">
            <a-input
              v-model:value="syncDirectory"
              placeholder="选择媒体库扫描目录中的文件夹"
            /><a-button @click="browseSyncDirectory">选择目录</a-button>
          </div></label
        >
      </div>
    </a-modal>
    <MediaLibraryPicker
      v-if="picker && mediaFile"
      images-only
      :title="pickerMode === 'replace' ? '替换当前图片图层' : '从媒体库添加图片'"
      @select="pickLibraryImage"
      @close="picker = false"
    />
    <a-modal
      v-if="!mediaFile"
      v-model:open="picker"
      :title="
        pickerMode === 'replace'
          ? '替换当前图片图层'
          : mediaFile
            ? '从媒体库添加图片'
            : '从工作区添加图片'
      "
      :footer="null"
      width="620px"
    >
      <div class="asset-picker-head">
        <input
          v-model="query"
          placeholder="搜索素材"
          :aria-label="mediaFile ? '搜索媒体库图片' : '搜索工作区图片'"
        />
        <a-button v-if="!mediaFile" @click="emit('addAssets')">从媒体库加入素材</a-button>
      </div>
      <p v-if="!imageAssets.length" class="empty">没有找到图片素材。</p>
      <div class="asset-grid">
        <div
          v-for="asset in filteredAssets"
          :key="asset.path"
          class="asset-tile"
          @contextmenu.prevent="
            showMenu($event.clientX, $event.clientY, 'asset', undefined, asset.path)
          "
        >
          <button type="button" @click="addImage(asset.path, pickerMode === 'replace')">
            <img
              v-if="assetInfo[asset.path]"
              :src="toImageThumbnailUrl(assetInfo[asset.path], '256x256')"
              alt=""
            />
            <span v-else class="asset-placeholder">无法预览</span><span>{{ asset.name }}</span>
          </button>
          <button
            type="button"
            class="asset-more"
            :aria-label="'更多操作：' + asset.name"
            @click="showMenu($event.clientX, $event.clientY, 'asset', undefined, asset.path)"
          >
            ⋯
          </button>
        </div>
      </div>
    </a-modal>
    <a-modal
      v-model:open="renameDraftOpen"
      title="重命名草稿"
      ok-text="保存"
      @ok="confirmRenameDraft"
    >
      <label class="rename-group-field"
        >草稿名称
        <input
          ref="renameDraftInput"
          v-model="renameDraftName"
          maxlength="80"
          aria-label="草稿名称"
          @keyup.enter="confirmRenameDraft"
        />
      </label>
    </a-modal>
    <a-modal
      v-model:open="renameGroupOpen"
      title="重命名分组"
      ok-text="保存"
      @ok="confirmRenameGroup"
    >
      <label class="rename-group-field"
        >分组名称
        <input
          v-model="renameGroupName"
          maxlength="80"
          aria-label="分组名称"
          @keyup.enter="confirmRenameGroup"
        />
      </label>
    </a-modal>
    <a-modal
      v-model:open="createGroupOpen"
      title="将选中图层编组"
      ok-text="创建分组"
      @ok="confirmGroupSelection"
    >
      <label class="rename-group-field"
        >分组名称
        <input
          v-model="createGroupName"
          maxlength="80"
          aria-label="新分组名称"
          @keyup.enter="confirmGroupSelection"
        />
      </label>
      <p class="inspector-note">选中的图层会移入新分组；原分组保留，其余图层不变。</p>
    </a-modal>
    <slot
      v-if="!mediaFile"
      name="ai"
      :open="aiOpen"
      :set-open="(value: boolean) => (aiOpen = value)"
      :doc="aiSnapshot"
      :scope="aiScope"
    />
    <Teleport to="body">
      <div v-if="menu" class="studio-menu-mask" @pointerdown="menu = undefined">
        <div
          class="studio-menu"
          role="menu"
          :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
          @pointerdown.stop
        >
          <template v-if="menu.kind === 'blank'">
            <button role="menuitem" @click="action('add-image')">添加图片</button
            ><button role="menuitem" @click="action('add-text')">添加文字</button>
            <button
              v-if="layerClipboard"
              role="menuitem"
              :disabled="readonly"
              @click="action('paste')"
            >
              粘贴图层 / 分组
            </button>
          </template>
          <template v-else-if="menu.kind === 'asset'">
            <button role="menuitem" @click="action('asset-add')">作为新图层加入</button>
            <button role="menuitem" :disabled="!imageLayer" @click="action('asset-replace')">
              替换选中的图片
            </button>
          </template>
          <template v-else-if="menu.kind === 'group'">
            <button role="menuitem" :disabled="readonly" @click="action('rename-group')">
              重命名分组
            </button>
            <button role="menuitem" @click="action('collapse-group')">
              {{ contextGroup?.collapsed ? '展开分组' : '收起分组' }}
            </button>
            <button role="menuitem" :disabled="readonly" @click="action('visibility-group')">
              {{ contextGroup?.visible ? '隐藏分组' : '显示分组' }}
            </button>
            <button role="menuitem" :disabled="readonly" @click="action('lock-group')">
              {{ contextGroup?.locked ? '解锁分组' : '锁定分组' }}
            </button>
            <button v-if="!mediaFile" role="menuitem" @click="action('preview-group')">
              合成预览 / AI 加工
            </button>
            <button role="menuitem" @click="action('copy-group')">复制分组</button>
            <button
              v-if="layerClipboard"
              role="menuitem"
              :disabled="readonly"
              @click="action('paste')"
            >
              粘贴图层 / 分组
            </button>
            <div class="menu-separator" role="separator" />
            <button role="menuitem" :disabled="readonly" @click="action('dissolve-group')">
              解散分组（保留图层）
            </button>
            <button
              role="menuitem"
              class="danger"
              :disabled="readonly"
              @click="action('delete-group')"
            >
              删除分组及图层
            </button>
          </template>
          <template v-else>
            <button v-if="selected?.kind === 'text'" role="menuitem" @click="action('edit')">
              编辑文字
            </button>
            <button
              v-if="selected?.kind === 'image'"
              role="menuitem"
              :disabled="readonly"
              @click="action('replace-image')"
            >
              替换图片
            </button>
            <button
              v-if="imageLayer"
              role="menuitem"
              :disabled="readonly || studioLayerLocked(draft, imageLayer)"
              @click="action('fill-canvas')"
            >
              铺满画布
            </button>
            <button
              v-if="!mediaFile && selected?.kind === 'image'"
              role="menuitem"
              @click="action('ai-layer')"
            >
              AI 加工
            </button>
            <button role="menuitem" @click="action('duplicate')">复制图层</button>
            <button role="menuitem" @click="action('copy')">复制到剪贴板</button>
            <button
              v-if="layerClipboard"
              role="menuitem"
              :disabled="readonly"
              @click="action('paste')"
            >
              粘贴图层 / 分组
            </button>
            <button role="menuitem" @click="action('front')">移到最上层</button
            ><button role="menuitem" @click="action('back')">移到最下层</button>
            <button role="menuitem" @click="action('visibility')">
              {{ selected?.visible ? '隐藏' : '显示' }}
            </button>
            <button role="menuitem" @click="action('lock')">
              {{ selected?.locked ? '解锁' : '锁定' }}
            </button>
            <button role="menuitem" class="danger" @click="action('delete')">删除图层</button>
          </template>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.image-studio {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  min-width: 0;
  color: var(--ui-text);
  container-type: inline-size;
}
.studio-command-bar,
.studio-side,
.studio-stage {
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-lg);
  background: var(--ui-surface);
}
.studio-command-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px 12px;
  min-height: 42px;
  box-sizing: border-box;
  padding: 5px 8px;
}
.studio-command-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 7px;
  margin-left: auto;
  min-width: 0;
}
.panel-heading span,
.layer-footer,
.stage-foot,
.inspector-note {
  font-size: 11px;
  color: var(--ui-muted);
}
.save-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  padding: 3px 7px;
  border-radius: 99px;
  background: var(--ui-surface-soft);
  white-space: nowrap;
  font-size: 10px;
  color: var(--ui-muted);
}
.save-indicator i {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: var(--ui-muted);
}
.save-indicator.saving i {
  background: var(--primary-color);
  animation: save-pulse 1s ease-in-out infinite;
}
.save-indicator.saved i {
  background: #23966b;
}
.save-indicator.error {
  color: var(--ui-danger, #b63b3b);
}
.save-indicator.error i {
  background: currentColor;
}
@keyframes save-pulse {
  50% {
    opacity: 0.35;
  }
}
.studio-export,
.draft-tabs,
.layer-actions,
.inspector-actions,
.zoom-actions,
.crop-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
button,
select,
input,
textarea {
  font: inherit;
}
.studio-export > button,
.studio-export select,
.draft-tabs button,
.layer-actions button,
.stage-toolbar button,
.inspector-actions button,
.wide-action,
.template-grid button {
  border: 1px solid var(--ui-border);
  border-radius: 7px;
  background: var(--ui-surface-soft);
  color: var(--ui-text);
  cursor: pointer;
  padding: 5px 9px;
  font-size: 12px;
}
.studio-export .icon-button,
.draft-tabs .icon-button {
  width: 30px;
  height: 30px;
  display: inline-grid;
  place-items: center;
  padding: 0;
  font-size: 14px;
}
button:hover:not(:disabled) {
  border-color: var(--primary-color);
  color: var(--primary-color);
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
.studio-export select {
  height: 30px;
}
.draft-tabs {
  flex: 1 1 250px;
  min-width: 0;
  overflow-x: auto;
  white-space: nowrap;
}
.draft-tabs button {
  flex: none;
  border-color: transparent;
  background: transparent;
}
.draft-tabs .active {
  border-color: var(--ui-border);
  background: var(--primary-color-1);
  color: var(--primary-color);
  font-weight: 650;
}
.draft-tabs .add-draft {
  margin-left: 6px;
  border-style: dashed;
  border-color: var(--ui-border);
}
.studio-export :deep(.ant-btn-primary) {
  border-color: var(--primary-color);
  background: var(--primary-color);
  color: #fff;
  font-weight: 600;
}
.studio-export :deep(.ant-btn-primary:hover:not(:disabled)) {
  color: #fff;
}
.studio-alert {
  padding: 10px 13px;
  border-radius: 8px;
  background: #fff2c9;
  color: #795313;
}
.studio-grid {
  position: relative;
  isolation: isolate;
  display: grid;
  flex: 1;
  min-height: 800px;
  grid-template-columns: 210px minmax(0, 1fr) 268px;
  grid-template-rows: minmax(0, 1fr);
  gap: 0;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-lg);
  background: var(--ui-surface);
  align-items: stretch;
}
.studio-grid > .studio-side,
.studio-grid > .studio-stage {
  border: 0;
  border-radius: 0;
}
.studio-side {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.studio-layers {
  display: flex;
  flex-direction: column;
  padding: 12px 12px 0;
  border-right: 1px solid var(--ui-border);
}
.studio-inspector {
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--ui-border);
}
.layer-list-area {
  flex: 1;
  min-height: 0;
  overflow: auto;
  margin: 0 -12px;
  padding: 11px 12px 16px;
  border-top: 1px solid var(--ui-border);
  background: color-mix(in srgb, var(--ui-surface) 94%, var(--ui-text) 6%);
}
.panel-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}
.panel-heading strong {
  font-size: 14px;
}
.layer-section-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 6px;
  color: var(--ui-muted);
  font-size: 11px;
}
.layer-section-label:after {
  content: '';
  height: 1px;
  flex: 1;
  background: var(--ui-border);
}
.layer-actions {
  margin-bottom: 12px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.layer-actions button {
  min-width: 0;
  height: 34px;
  padding: 5px;
  font-size: 16px;
  background: var(--ui-surface);
}
.canvas-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-bottom: 12px;
  padding: 8px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: var(--ui-surface);
  color: var(--ui-text);
  text-align: left;
  cursor: pointer;
  font-size: 12px;
}
.canvas-row > .anticon {
  font-size: 16px;
  color: var(--primary-color);
}
.canvas-row span {
  font-weight: 600;
}
.canvas-row small {
  margin-left: auto;
  color: var(--ui-muted);
  font-size: 11px;
}
.canvas-row:hover,
.canvas-row.active {
  border-color: var(--primary-color);
  background: var(--primary-color-1);
}
.canvas-row:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}
.inspector-heading {
  gap: 8px;
}
.empty {
  padding: 16px 10px;
  background: var(--ui-surface-soft);
  border-radius: 7px;
  color: var(--ui-muted);
  font-size: 12px;
  line-height: 1.5;
}
.layer-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  min-height: 42px;
  padding: 4px;
  border: 1px solid transparent;
  border-radius: 7px;
  cursor: pointer;
}
.layer-row.group-child {
  margin-left: 14px;
}
.group-row {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 35px;
  padding: 3px 4px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: var(--ui-surface-soft);
  cursor: grab;
  color: var(--ui-text);
  font-size: 11px;
}
.group-row > .anticon {
  color: var(--primary-color);
}
.group-row > .group-status {
  color: var(--ui-muted);
}
.group-row small {
  color: var(--ui-muted);
}
.group-row button {
  flex: none;
  border: 0;
  background: transparent;
  color: var(--ui-muted);
  padding: 2px;
  cursor: pointer;
}
.group-row:hover,
.group-row.active {
  border-color: var(--primary-color);
  background: var(--primary-color-1);
}
.group-row.faded {
  opacity: 0.5;
}
.group-row:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}
.group-name-count {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}
.group-name-count .layer-name {
  flex: 0 1 auto;
}
.group-name-count small {
  flex: none;
}
.group-row {
  min-width: 0;
}
.group-row > button {
  font-size: 13px;
}
.group-row.dragging,
.layer-row.dragging {
  opacity: 0.45;
}
.group-row,
.layer-row {
  position: relative;
}
.layer-list-area.is-dragging .layer-row,
.layer-list-area.is-dragging .group-row {
  border-color: transparent;
  background: transparent;
}
.layer-list-area.is-dragging .drop-target {
  border-color: var(--primary-color, #91b9ee);
  background: var(--primary-color-1);
}
/* Keep a compact top slot so its drop zone never covers the first row or shifts it on dragstart. */
.layer-list-shell {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding-top: 24px;
  box-sizing: border-box;
}
.layer-list-shell::before {
  content: '';
  position: absolute;
  top: 0;
  left: -12px;
  right: -12px;
  height: 1px;
  background: var(--ui-border);
  pointer-events: none;
}
.layer-list-shell > .layer-list-area {
  border-top: 0;
}
.layer-drop-top,
.layer-drop-outside {
  position: absolute;
  left: 0;
  right: 0;
  z-index: 3;
  height: 20px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  line-height: 1;
  color: #c5dcfa;
  user-select: none;
  visibility: hidden;
  pointer-events: none;
  border: 1px solid #91b9ee85;
  border-radius: 5px;
  background: #344b68;
  box-shadow: 0 2px 8px #0003;
  transition:
    background 0.12s,
    border-color 0.12s,
    box-shadow 0.12s;
}
.layer-drop-top {
  top: 2px;
}
.layer-drop-outside {
  bottom: 4px;
}
.layer-drop-top::before,
.layer-drop-outside::before {
  content: '';
  position: absolute;
  inset: -6px 0;
}
.layer-drop-top.is-visible,
.layer-drop-outside.is-visible {
  visibility: visible;
  pointer-events: auto;
}
.layer-drop-top.drop-target,
.layer-drop-outside.drop-target {
  background: #526f95;
  border-color: #b7d5ff;
  box-shadow: 0 0 0 2px #91b9ee25;
}
.layer-row:hover,
.layer-row.active {
  background: var(--primary-color-1);
}
.layer-row.active {
  border-color: var(--primary-color);
}
.layer-row.faded {
  opacity: 0.5;
}
.layer-row img {
  width: 30px;
  height: 30px;
  object-fit: cover;
  border-radius: 5px;
  background: var(--ui-surface-soft);
  flex: none;
}
.layer-symbol {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: none;
  color: var(--ui-muted);
}
.layer-symbol > .anticon {
  font-size: 17px;
}
.layer-row.active .layer-symbol {
  color: var(--primary-color);
}
.layer-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
}
.layer-row button {
  border: 0;
  background: transparent;
  color: var(--ui-muted);
  cursor: pointer;
  font-size: 13px;
  padding: 2px;
}
.layer-footer {
  margin-top: 12px;
}
.studio-stage {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
  background: var(--ui-surface-soft);
}
.stage-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 44px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--ui-border);
  background: var(--ui-surface);
  font-size: 11px;
}
.tool-caption {
  color: var(--ui-muted);
  font-size: 11px;
}
.studio-toolstrip {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow-x: auto;
  white-space: nowrap;
}
.studio-toolstrip button {
  flex: none;
  width: 31px;
  height: 29px;
  display: grid;
  place-items: center;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  background: var(--ui-surface-soft);
  color: var(--ui-text);
  padding: 0;
  cursor: pointer;
  font-size: 15px;
}
.stage-toolbar .primary {
  background: var(--primary-color);
  color: #fff;
  border-color: var(--primary-color);
}
.crop-title {
  color: var(--primary-color);
  font-size: 12px;
}
.zoom-actions {
  margin-left: auto;
  flex: none;
}
.zoom-actions .history-button {
  width: 30px;
  height: 30px;
  display: inline-grid;
  place-items: center;
  padding: 0;
  font-size: 14px;
}
.zoom-actions .history-button:nth-of-type(3) {
  margin-right: 5px;
}
.artifact-save-form {
  display: grid;
  gap: 16px;
}
.artifact-save-form label {
  display: grid;
  gap: 6px;
  font-size: 12px;
  color: var(--ui-muted);
}
.artifact-directory {
  display: flex;
  gap: 8px;
}
.artifact-directory :deep(.ant-input) {
  min-width: 0;
}
.stage-viewport {
  display: flex;
  align-items: stretch;
  justify-content: flex-start;
  flex: 1;
  min-height: 0;
  padding: 24px;
  overflow: auto;
  overscroll-behavior: contain;
  background: repeating-conic-gradient(
      color-mix(in srgb, var(--ui-border) 42%, transparent) 0 25%,
      transparent 0 50%
    )
    50%/20px 20px;
}
.stage-viewport:hover {
  outline: 2px solid color-mix(in srgb, var(--primary-color) 38%, transparent);
  outline-offset: -2px;
}
.stage-viewport:hover .artboard {
  box-shadow:
    0 0 0 2px color-mix(in srgb, var(--primary-color) 30%, transparent),
    0 10px 32px #0003;
}
.stage-viewport.panning,
.stage-viewport.panning .artboard {
  cursor: grabbing !important;
}
.artboard {
  position: relative;
  flex: none;
  margin: auto;
  background: #fff;
  box-shadow: 0 10px 32px #0003;
  touch-action: none;
  outline: none;
}
.artboard canvas {
  width: 100%;
  height: 100%;
  display: block;
}
.selection {
  position: absolute;
  box-sizing: border-box;
  border: 2px solid var(--primary-color);
  pointer-events: none;
}
.selection.locked {
  border-style: dashed;
}
.group-selection {
  z-index: 3;
  border-style: dashed;
  box-shadow: 0 0 0 1px #fff9;
}
.group-selection > span {
  position: absolute;
  left: -2px;
  bottom: calc(100% + 4px);
  max-width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 3px 6px;
  border-radius: 4px;
  background: var(--primary-color);
  color: #fff;
  font-size: 10px;
  line-height: 1.2;
}
.handle {
  position: absolute;
  display: block;
  width: 11px;
  height: 11px;
  box-sizing: border-box;
  border: 2px solid var(--primary-color);
  border-radius: 3px;
  background: #fff;
  pointer-events: auto;
}
.handle.nw {
  left: -6px;
  top: -6px;
  cursor: nwse-resize;
}
.handle.ne {
  right: -6px;
  top: -6px;
  cursor: nesw-resize;
}
.handle.se {
  right: -6px;
  bottom: -6px;
  cursor: nwse-resize;
}
.handle.sw {
  left: -6px;
  bottom: -6px;
  cursor: nesw-resize;
}
.rotation-stem {
  position: absolute;
  left: 50%;
  top: -24px;
  height: 22px;
  border-left: 1px solid var(--primary-color);
}
.handle.rotate {
  left: calc(50% - 7px);
  top: -36px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  cursor: grab;
}
.crop-box {
  position: absolute;
  box-sizing: border-box;
  border: 2px dashed #fff;
  box-shadow: 0 0 0 1px #202530b0;
  pointer-events: none;
}
.crop-box .handle {
  background: #fff;
}
.inline-text {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding-right: 4px;
  padding-left: 4px;
  pointer-events: auto;
  background: #ffffffd9;
  border: 0;
  resize: none;
  outline: 2px solid var(--primary-color);
}
.stage-foot {
  min-height: 30px;
  padding: 8px 12px;
  text-align: center;
  background: var(--ui-surface);
}
.render-error {
  color: #b44d30;
}
.studio-inspector .field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 7px 0;
  color: var(--ui-muted);
  font-size: 11px;
}
.field > span {
  float: right;
}
.field input:not([type='range']),
.field select,
.field textarea {
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  padding: 5px 6px;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  background: var(--ui-surface-soft);
  color: var(--ui-text);
  font-size: 12px;
}
.field input[type='range'] {
  width: 100%;
  accent-color: var(--primary-color);
}
.field input[type='color'] {
  height: 31px;
  padding: 2px;
}
.two-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 8px;
}
.compact-layer-properties {
  font-size: 12px;
  min-width: 0;
}
.layer-property-header {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  margin-bottom: 8px;
}
.layer-property-header > .anticon {
  flex: none;
  color: var(--primary-color);
  font-size: 16px;
}
.compact-layer-properties input:not([type='range']):not([type='color']),
.compact-layer-properties select,
.compact-layer-properties textarea {
  box-sizing: border-box;
  min-width: 0;
  font: inherit;
  color: var(--ui-text);
  caret-color: var(--ui-text);
}
.layer-property-header > input {
  flex: 1;
  width: 0;
  height: 30px;
  padding: 4px 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  font-weight: 600 !important;
  text-overflow: ellipsis;
}
.layer-property-header > input:hover {
  background: var(--ui-hover);
}
.layer-property-header > input:focus {
  outline: none;
  border-color: var(--primary-color);
  background: var(--ui-surface-soft);
}
.layer-property-header > .replace-image-action {
  flex: none;
  height: 28px;
  padding: 3px 8px;
  font-size: 11px;
  border: 1px solid var(--ui-border);
  border-radius: 7px;
  color: var(--ui-muted);
  background: var(--ui-surface-soft);
}
.compact-group-field {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  color: var(--ui-muted);
  font-size: 11px;
}
.compact-group-field > span {
  flex: none;
}
.compact-group-field > select {
  flex: 1;
  width: 0;
  height: 30px;
  padding: 4px 8px;
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  background: var(--ui-surface-soft);
}
.compact-geometry {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.compact-value-field {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 30px;
  padding: 0 8px;
  box-sizing: border-box;
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  background: var(--ui-surface-soft);
}
.compact-value-field > span {
  flex: none;
  color: var(--ui-muted);
  font-size: 11px;
}
.compact-value-field > input,
.compact-value-field > select {
  flex: 1;
  width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  outline: none;
  font-variant-numeric: tabular-nums;
}
.compact-value-field:focus-within {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 1px var(--primary-color);
}
.compact-group-field > select:focus-visible,
.compact-text-content > textarea:focus-visible {
  outline: 1px solid var(--primary-color);
  outline-offset: 1px;
}
.compact-image-appearance {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--ui-border);
}
.compact-image-appearance > .crop-fit-segments {
  margin: 0 0 8px;
}
.compact-image-appearance > .crop-fit-segments button {
  padding: 5px 3px;
}
.compact-image-appearance :deep(.range-field) {
  min-height: 28px;
  margin: 2px 0;
  grid-template-columns: 48px minmax(0, 1fr) 42px;
}
.compact-text-content {
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--ui-border);
}
.compact-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 5px;
  color: var(--ui-muted);
  font-size: 11px;
}
.compact-section-heading > button {
  padding: 0;
  border: 0;
  background: none;
  color: var(--ui-muted);
  font-size: 11px;
  cursor: pointer;
}
.compact-text-content > textarea {
  display: block;
  width: 100%;
  padding: 6px 8px;
  line-height: 1.5;
  resize: vertical;
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  background: var(--ui-surface-soft);
}
.compact-font-fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 96px;
  gap: 8px;
  margin-top: 8px;
}
.compact-text-tools {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
}
.compact-text-tools > button {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: none;
  padding: 0;
  border: 1px solid var(--ui-border);
  border-radius: 7px;
  background: var(--ui-surface-soft);
  color: var(--ui-muted);
  font-size: 14px;
}
.compact-text-tools > button.active {
  background: var(--primary-color-1);
  border-color: var(--primary-color);
  color: var(--primary-color);
}
.text-tools-divider {
  height: 16px;
  width: 1px;
  margin: 0 2px;
  background: var(--ui-border);
}
.compact-color-field {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  color: var(--ui-muted);
  font-size: 11px;
}
.compact-color-field > input {
  width: 30px;
  height: 28px;
  padding: 3px;
  border: 1px solid var(--ui-border);
  border-radius: 7px;
  background: var(--ui-surface-soft);
  cursor: pointer;
}
.layer-property-header > small {
  flex: none;
  color: var(--ui-muted);
  font-size: 11px;
  white-space: nowrap;
}
.group-property-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.group-property-actions > button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 32px;
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  background: var(--ui-surface-soft);
  color: var(--ui-text);
  font: inherit;
  cursor: pointer;
}
.group-property-actions > button.active {
  background: var(--primary-color-1);
  border-color: var(--primary-color);
  color: var(--primary-color);
}
.group-property-footer {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--ui-border);
}
.group-property-footer > .wide-action {
  min-height: 32px;
  border-radius: 8px;
  font-size: 12px;
}
.group-property-footer > .dissolve-group-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 9px;
  background: transparent;
  color: var(--ui-text);
}
.dissolve-group-action > span {
  font-size: 11px;
  color: var(--ui-muted);
}
.inspector-actions {
  flex-wrap: wrap;
  margin: 8px 0;
}
.inspector-actions button {
  flex: 1;
  min-width: 0;
}
.inspector-actions button.active {
  background: var(--primary-color-1);
  color: var(--primary-color);
}
.canvas-presets {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
  margin: 8px 0;
}
.canvas-presets button {
  min-width: 0;
  padding: 5px 3px;
  border: 1px solid var(--ui-border);
  border-radius: 7px;
  background: var(--ui-surface-soft);
  color: var(--ui-text);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.canvas-presets button.active {
  border-color: var(--primary-color);
  background: var(--primary-color-1);
  color: var(--primary-color);
  font-weight: 650;
}
.canvas-presets button:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}
.studio-inspector h3 {
  margin: 11px 0 6px;
  font-size: 12px;
}
.template-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
}
.template-grid button {
  padding: 6px 3px;
}
.inspector-note {
  line-height: 1.5;
  margin: 9px 0;
}
.wide-action {
  display: block;
  width: 100%;
}
.wide-action + .wide-action {
  margin-top: 6px;
}
.studio-grid > .studio-layers {
  border-right: 1px solid var(--ui-border);
}
.studio-grid > .studio-inspector {
  border-left: 1px solid var(--ui-border);
}
.studio-export .note-entry {
  display: none;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.note-entry.active {
  border-color: var(--primary-color);
  color: var(--primary-color);
}
.note-entry i,
.inspector-tabs i {
  display: inline-block;
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: var(--ui-amber, #d58b18);
}
.inspector-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
  height: 38px;
  padding: 3px 10px;
  border-bottom: 1px solid var(--ui-border);
}
.inspector-tabs button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ui-muted);
  padding: 6px 9px;
  cursor: pointer;
  font-size: 12px;
}
.inspector-tabs button.active {
  background: var(--primary-color-1);
  color: var(--primary-color);
  font-weight: 650;
}
.inspector-tabs .dock-close {
  display: none;
  margin-left: auto;
  padding: 6px;
}
.inspector-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px 12px;
}
.inspector-scroll .panel-heading {
  margin-bottom: 6px;
}
.studio-note {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.studio-note strong {
  font-size: 13px;
}
.studio-note p {
  margin: 0;
  color: var(--ui-muted);
  font-size: 11px;
  line-height: 1.5;
}
.studio-note textarea {
  flex: 1;
  min-height: 170px;
  width: 100%;
  box-sizing: border-box;
  resize: none;
  border: 1px solid var(--ui-border);
  border-radius: 7px;
  background: var(--ui-surface-soft);
  color: var(--ui-text);
  padding: 9px;
  font: inherit;
  font-size: 12px;
  line-height: 1.6;
}
.note-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.note-actions span {
  color: var(--ui-muted);
  font-size: 10px;
}
.note-actions button {
  flex: none;
  border: 1px solid var(--primary-color);
  border-radius: 6px;
  background: var(--primary-color);
  color: #fff;
  padding: 6px 9px;
  cursor: pointer;
  font-size: 11px;
}
.note-actions button:disabled {
  opacity: 0.5;
  cursor: default;
}
.studio-toolstrip .dock-toggle,
.zoom-actions .dock-toggle,
.dock-backdrop {
  display: none;
}
.asset-picker-head {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}
.asset-picker-head input {
  flex: 1;
  min-width: 0;
  padding: 7px;
  border: 1px solid var(--ui-border);
  border-radius: 7px;
}
.asset-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  max-height: 430px;
  overflow: auto;
}
.asset-tile {
  position: relative;
  min-width: 0;
}
.asset-tile > button:first-child {
  display: flex;
  flex-direction: column;
  width: 100%;
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  background: var(--ui-surface-soft);
  color: var(--ui-text);
  padding: 5px;
  text-align: left;
  cursor: pointer;
}
.asset-tile img,
.asset-placeholder {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 5px;
  background: var(--ui-hover);
}
.asset-placeholder {
  display: grid;
  place-items: center;
}
.asset-tile span:last-child {
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  padding-top: 5px;
}
.asset-more {
  position: absolute;
  right: 8px;
  top: 8px;
  border: 0;
  border-radius: 5px;
  background: #1e293bcc;
  color: #fff;
  cursor: pointer;
}
.rename-group-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--ui-muted);
  font-size: 12px;
}
.rename-group-field input {
  padding: 8px 10px;
  border: 1px solid var(--ui-border);
  border-radius: 7px;
  background: var(--ui-surface);
  color: var(--ui-text);
}
.studio-menu-mask {
  position: fixed;
  inset: 0;
  z-index: 1500;
}
.studio-menu {
  position: fixed;
  display: flex;
  flex-direction: column;
  min-width: 185px;
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  padding: 5px;
  border: 1px solid var(--ui-border);
  border-radius: 9px;
  background: var(--ui-surface);
  box-shadow: 0 15px 35px #0004;
}
.studio-menu button {
  width: 100%;
  border: 0;
  border-radius: 5px;
  background: none;
  color: var(--ui-text);
  padding: 7px 11px;
  text-align: left;
  cursor: pointer;
  font-size: 12px;
}
.studio-menu button:hover {
  background: var(--primary-color-1);
}
.studio-menu button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.studio-menu .danger {
  color: #c34444;
}
.menu-separator {
  height: 1px;
  margin: 4px 6px;
  background: var(--ui-border);
}
@container (max-width:960px) {
  .studio-export .note-entry {
    display: inline-flex;
  }
  .studio-grid {
    min-height: 700px;
    grid-template-columns: 190px minmax(0, 1fr);
  }
  .studio-grid > .studio-inspector {
    position: absolute;
    z-index: 4;
    inset: 0 0 0 auto;
    width: min(306px, calc(100% - 45px));
    box-sizing: border-box;
    background: var(--ui-surface);
    box-shadow: -12px 0 32px #0003;
    transform: translateX(101%);
    visibility: hidden;
    pointer-events: none;
    transition:
      transform var(--ui-motion-normal, 180ms) var(--ui-ease, ease),
      visibility 0s linear var(--ui-motion-normal, 180ms);
  }
  .studio-grid.inspector-open > .studio-inspector {
    transform: none;
    visibility: visible;
    pointer-events: auto;
    transition: transform var(--ui-motion-normal, 180ms) var(--ui-ease, ease);
  }
  .studio-grid.inspector-open > .dock-backdrop {
    display: block;
    position: absolute;
    z-index: 3;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
    border-radius: 0;
    background: #091d2b55;
    cursor: default;
  }
  .studio-inspector .dock-close,
  .zoom-actions .dock-toggle {
    display: inline-grid;
  }
  .stage-toolbar {
    flex-wrap: wrap;
  }
  .studio-toolstrip {
    flex-wrap: wrap;
    overflow: visible;
    white-space: normal;
  }
}
@container (max-width:690px) {
  .draft-tabs {
    flex-basis: 100%;
  }
  .studio-command-actions {
    width: 100%;
    justify-content: flex-end;
  }
  .studio-export {
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .studio-grid {
    min-height: 640px;
    grid-template-columns: minmax(0, 1fr);
  }
  .studio-grid > .studio-layers {
    position: absolute;
    z-index: 4;
    inset: 0 auto 0 0;
    width: min(248px, calc(100% - 45px));
    box-sizing: border-box;
    background: var(--ui-surface);
    box-shadow: 12px 0 32px #0003;
    transform: translateX(-101%);
    visibility: hidden;
    pointer-events: none;
    transition:
      transform var(--ui-motion-normal, 180ms) var(--ui-ease, ease),
      visibility 0s linear var(--ui-motion-normal, 180ms);
  }
  .studio-grid.layers-open > .studio-layers {
    transform: none;
    visibility: visible;
    pointer-events: auto;
    transition: transform var(--ui-motion-normal, 180ms) var(--ui-ease, ease);
  }
  .studio-grid.layers-open > .dock-backdrop {
    display: block;
    position: absolute;
    z-index: 3;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
    border-radius: 0;
    background: #091d2b55;
    cursor: default;
  }
  .studio-toolstrip .dock-toggle {
    display: inline-grid;
  }
  .asset-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@media (prefers-reduced-motion: reduce) {
  .save-indicator.saving i {
    animation: none;
  }
  .studio-grid > .studio-layers,
  .studio-grid > .studio-inspector {
    transition: none !important;
  }
}
</style>
