<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { deleteWorkspaceArtifact } from '@/features/workspaces/public'
import { saveWorkspaceArtifact } from '@/features/workspaces/api/workspaceArtifacts'
import '@/features/image-editor/styles/editorSurface.css'
import {
  mergeMaterialHistory,
  readMaterialHistory,
  writeMaterialHistory
} from '@/features/workspaces/model/workspaceMaterialHistory'
import {
  BorderOutlined,
  CloseOutlined,
  DeleteOutlined,
  RedoOutlined,
  UndoOutlined
} from '@ant-design/icons-vue'
import type { FileNodeInfo } from '@/features/media-library/public'
import { isImageFile } from '@/features/media-library/public'
import WorkspaceAssetPreview from '@/features/workspaces/components/WorkspaceAssetPreview.vue'
import { fileDisplayName as assetDisplayName } from '@/shared/lib/fileDisplayName'
import {
  createGuideLayer,
  createImageLayer,
  createMaskLayer,
  createPaintLayer,
  createStudioDocument,
  readStudioDocument,
  scaleStudioDocument,
  studioLayerLocked,
  studioLayerVisible,
  studioMaskContainsPoint,
  studioMaskPaintBounds,
  studioMaskPoint,
  type StudioDocument,
  type StudioGuideLayer,
  type StudioImageLayer,
  type StudioMaskLayer,
  type StudioPaintLayer,
  type StudioPoint
} from '@/features/image-editor/public'
import { renderStudioDocument, studioImageDimensions } from '@/features/image-editor/public'
import AIImageProcess from './AIImageProcess.vue'
import AICreationTabs from './AICreationTabs.vue'
import {
  aiCreationSections,
  type AICreationSection
} from '@/features/workspaces/model/workspaceMaterials'
import { removeWorkspaceAssetDrafts } from '@/features/workspaces/public'
import StudioToolIcon from '../../image-editor/components/StudioToolIcon.vue'
import type { WorkspaceAsset, WorkspaceRecord } from '@/features/workspaces/public'

import type { MaterialController } from '@/features/workspaces/model/workspaceMaterials'

type Tool = 'select' | 'rect' | 'arrow' | 'paint' | 'mask' | 'eraser' | 'crop'
type Gesture =
  | { kind: 'guide'; id: string; start: StudioPoint }
  | { kind: 'stroke'; ids: string[] }
  | {
      kind: 'move'
      id: string
      start: StudioPoint
      x: number
      y: number
      bounds?: { x: number; y: number; width: number; height: number }
    }
  | { kind: 'crop'; start: StudioPoint }
  | { kind: 'none' }
interface EditableReference {
  path: string
  name: string
  doc: StudioDocument
}
const props = defineProps<{
  workspace?: WorkspaceRecord
  assetInfo: Record<string, FileNodeInfo>
  readonly?: boolean
  active?: boolean
}>()
const emit = defineEmits<{ artifactSaved: []; close: [] }>()
const section = defineModel<AICreationSection>('section', { required: true })
const sectionLabel = computed(
  () => aiCreationSections.find((tab) => tab.id === section.value)?.label
)
const editorRoot = ref<HTMLElement>()
const savingMaterial = ref(false)
function focusEditor() {
  editorRoot.value?.querySelector<HTMLButtonElement>('[aria-label="关闭编辑"]')?.focus()
}
function closeEditor() {
  if (savingMaterial.value) return
  emit('close')
}
const previewAsset = ref<WorkspaceAsset>()
let previewTrigger: HTMLElement | null = null
const previewAssigning = ref(false)
async function assignPreview(role: 'main' | 'reference') {
  const asset = previewAsset.value
  if (!asset || props.readonly || previewAssigning.value) return
  previewAssigning.value = true
  try {
    if (role === 'main') await chooseAsset(asset)
    else await addReference(asset)
    if (
      selectedPath.value === asset.path ||
      references.value.some((item) => item.path === asset.path)
    ) {
      closePreview()
    }
  } finally {
    previewAssigning.value = false
  }
}
function closePreview() {
  previewAsset.value = undefined
  void nextTick(() => {
    if (previewTrigger?.isConnected) previewTrigger.focus()
  })
}
const assets = computed(() => {
  const seen = new Set<string>()
  return [...(props.workspace?.assets ?? []), ...(props.workspace?.outputs ?? [])].filter(
    (asset) => {
      const info = props.assetInfo[asset.path]
      if (asset.kind !== 'image' || !info || !isImageFile(info.name) || seen.has(asset.path))
        return false
      seen.add(asset.path)
      return true
    }
  )
})
function isWorkspaceCreated(asset: WorkspaceAsset) {
  return !!props.assetInfo[asset.path]?.workspace_artifact_id
}
const recentPaths = ref<string[]>([])
const selectedPath = ref('')
const activeWorkspaceId = ref('')
const doc = ref<StudioDocument | null>(null)
const references = ref<EditableReference[]>([])
const activeInput = ref('main')
const sourceSizes = ref<Record<string, { width: number; height: number }>>({})
const activeDoc = computed(() =>
  activeInput.value === 'main'
    ? doc.value
    : (references.value.find((item) => item.path === activeInput.value)?.doc ?? doc.value)
)
const activeImage = computed(() =>
  activeDoc.value?.layers.find((layer): layer is StudioImageLayer => layer.kind === 'image')
)
const canvas = ref<HTMLCanvasElement>()
const viewport = ref<HTMLElement>()
const annotationCallout = ref<HTMLElement>()
const viewportSize = ref({ width: 500, height: 460 })
const viewZoom = ref(1)
const cropSelection = ref<{ x: number; y: number; width: number; height: number } | null>(null)
const cropReady = ref(false)
const panning = ref(false)
const fitScale = computed(() =>
  activeDoc.value
    ? Math.min(
        ((viewportSize.value.width > 28 ? viewportSize.value.width : 500) - 28) /
          activeDoc.value.width,
        ((viewportSize.value.height > 28 ? viewportSize.value.height : 300) - 28) /
          activeDoc.value.height
      )
    : 1
)
const displayWidth = computed(() =>
  Math.max(1, (activeDoc.value?.width ?? 1) * fitScale.value * viewZoom.value)
)
const displayHeight = computed(() =>
  Math.max(1, (activeDoc.value?.height ?? 1) * fitScale.value * viewZoom.value)
)
const tool = ref<Tool>('select')
const eraseTarget = ref<'paint' | 'mask'>('paint')
const toolCursorPosition = ref<{ x: number; y: number } | null>(null)
const selectedGuideId = ref('')
const selectedPaintId = ref('')
const selectedMaskId = ref('')
const showAnnotationCallout = ref(false)
const movingSelection = ref(false)
const guideColor = ref('#ef4444'),
  paintColor = ref('#ef4444')
const guideWidth = ref(4),
  brushSize = ref(32)
const draftRevision = ref(0)
const loading = ref(false),
  renderError = ref(''),
  storageError = ref('')
const hasUnsavedChanges = ref(false),
  hasSavedDraft = ref(false)
const saveBeforeProcessingOpen = ref(false)
let resolveSaveBeforeProcessing: ((saved: boolean) => void) | undefined
const undoStack = ref<string[]>([]),
  redoStack = ref<string[]>([])
const selectedGuide = computed(() =>
  doc.value?.layers.find(
    (layer): layer is StudioGuideLayer =>
      layer.kind === 'guide' && layer.id === selectedGuideId.value
  )
)
const selectedPaint = computed(() =>
  doc.value?.layers.find(
    (layer): layer is StudioPaintLayer =>
      layer.kind === 'paint' && layer.id === selectedPaintId.value
  )
)
const selectedMask = computed(() =>
  doc.value?.layers.find(
    (layer): layer is StudioMaskLayer => layer.kind === 'mask' && layer.id === selectedMaskId.value
  )
)
const selectedAnnotationLayer = computed(
  () => selectedGuide.value ?? selectedPaint.value ?? selectedMask.value
)
const brushCursorSize = computed(() =>
  Math.max(2, (brushSize.value * displayWidth.value) / Math.max(1, activeDoc.value?.width ?? 1))
)
const guideCursorStroke = computed(() =>
  Math.max(1, (guideWidth.value * displayWidth.value) / Math.max(1, activeDoc.value?.width ?? 1))
)
const guideCursorExtent = computed(() => Math.max(30, guideCursorStroke.value * 2 + 20))
const toolCursorVisible = computed(
  () =>
    activeInput.value === 'main' &&
    ['rect', 'arrow', 'paint', 'mask', 'eraser'].includes(tool.value)
)
const selectedAnnotationId = computed(
  () => selectedGuideId.value || selectedPaintId.value || selectedMaskId.value
)
const selectionFrame = computed(() => {
  if (!doc.value || activeInput.value !== 'main' || tool.value === 'crop') return null
  if (selectedGuide.value) return selectedGuide.value
  const layer = selectedPaint.value ?? selectedMask.value
  const bounds = layer && studioMaskPaintBounds(layer)
  return bounds && layer
    ? { x: layer.x + bounds.x, y: layer.y + bounds.y, width: bounds.width, height: bounds.height }
    : null
})
const promptCalloutStyle = computed(() => {
  const frame = selectionFrame.value,
    current = activeDoc.value
  if (!frame || !current || !selectedAnnotationLayer.value) return null
  const scale = displayWidth.value / current.width
  const start = frame.x * scale,
    end = (frame.x + frame.width) * scale
  const cardWidth = 216,
    margin = Math.max(0, (viewportSize.value.width - displayWidth.value) / 2)
  const minLeft = 8 - margin,
    maxLeft = viewportSize.value.width - margin - cardWidth - 8
  let left = end + 12
  if (left > maxLeft) left = start - cardWidth - 12
  if (left < minLeft) left = Math.max(minLeft, maxLeft)
  const top = Math.max(8, Math.min(displayHeight.value - 96, frame.y * scale))
  return { left: `${left}px`, top: `${top}px` }
})
const promptCalloutOnLeft = computed(
  () =>
    !!promptCalloutStyle.value &&
    !!selectionFrame.value &&
    !!activeDoc.value &&
    Number.parseFloat(promptCalloutStyle.value.left) <
      (selectionFrame.value.x * displayWidth.value) / activeDoc.value.width
)
function svgCursor(body: string, x: number, y: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${body}</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, crosshair`
}
const cropCursor = svgCursor(
  '<path d="M5 2v15a2 2 0 0 0 2 2h15M2 5h15a2 2 0 0 1 2 2v15" fill="none" stroke="white" stroke-width="4"/><path d="M5 2v15a2 2 0 0 0 2 2h15M2 5h15a2 2 0 0 1 2 2v15" fill="none" stroke="#26384c" stroke-width="1.7"/>',
  5,
  5
)
const canvasCursor = computed(() => {
  if (movingSelection.value) return 'grabbing'
  switch (tool.value) {
    case 'select':
      return 'grab'
    case 'rect':
    case 'arrow':
    case 'paint':
    case 'mask':
    case 'eraser':
      return 'none'
    case 'crop':
      return cropCursor
    default:
      return 'crosshair'
  }
})
function selectAnnotation(layer?: StudioGuideLayer | StudioPaintLayer | StudioMaskLayer) {
  selectedGuideId.value = layer?.kind === 'guide' ? layer.id : ''
  selectedPaintId.value = layer?.kind === 'paint' ? layer.id : ''
  selectedMaskId.value = layer?.kind === 'mask' ? layer.id : ''
  if (!layer) showAnnotationCallout.value = false
}
function dismissAnnotationCallout() {
  if (!showAnnotationCallout.value) return
  const focused = document.activeElement
  if (focused instanceof HTMLElement && annotationCallout.value?.contains(focused)) focused.blur()
  showAnnotationCallout.value = false
}
function closeAnnotationCalloutOutside(event: PointerEvent) {
  if (!annotationCallout.value?.contains(event.target as Node)) dismissAnnotationCallout()
}
function updateToolCursor(event: MouseEvent) {
  if (!toolCursorVisible.value || !canvas.value) {
    toolCursorPosition.value = null
    return
  }
  const bounds = canvas.value.getBoundingClientRect()
  const x = event.clientX - bounds.left,
    y = event.clientY - bounds.top
  toolCursorPosition.value =
    x >= 0 && x <= bounds.width && y >= 0 && y <= bounds.height ? { x, y } : null
}
let gesture: Gesture | null = null
let panGesture: {
  pointerId: number
  clientX: number
  clientY: number
  scrollLeft: number
  scrollTop: number
} | null = null
let gestureBefore = ''
let loadVersion = 0,
  renderVersion = 0
let renderFrame: number | undefined
let rendering = false,
  renderQueued = false
let disposed = false
let previewBuffer: HTMLCanvasElement | undefined
let resizeObserver: ResizeObserver | undefined
let savedSnapshot = ''
let fieldSnapshots = new WeakMap<HTMLElement, string>()
const snapshot = () => JSON.stringify({ doc: doc.value, references: references.value })
const draftKey = (workspaceId: string, path: string) =>
  `omnigallery:ai-image-edit-v1:${workspaceId}:${encodeURIComponent(path)}`
const lastAssetKey = (workspaceId: string) => `omnigallery:ai-image-edit-asset-v1:${workspaceId}`
const recentAssetKey = (workspaceId: string) => `omnigallery:ai-image-edit-recent-v1:${workspaceId}`
const referenceListKey = (workspaceId: string, path: string) =>
  `omnigallery:ai-image-refs-v1:${workspaceId}:${encodeURIComponent(path)}`
const referenceDraftKey = (workspaceId: string, path: string, referencePath: string) =>
  `omnigallery:ai-image-ref-v1:${workspaceId}:${encodeURIComponent(path)}:${encodeURIComponent(referencePath)}`
function loadRecentAssets(workspaceId: string) {
  return readMaterialHistory(recentAssetKey(workspaceId))
}
function rememberAssets(paths: string[], workspaceId: string) {
  recentPaths.value = mergeMaterialHistory(recentPaths.value, paths)
  writeMaterialHistory(recentAssetKey(workspaceId), recentPaths.value)
}
function rememberAsset(path: string, workspaceId: string) {
  rememberAssets([path], workspaceId)
}
function rememberAssignedAssets(workspaceId: string) {
  rememberAssets(
    [selectedPath.value, ...references.value.map((item) => item.path)].filter(Boolean),
    workspaceId
  )
}
function assetRole(path: string) {
  if (doc.value && path === selectedPath.value) return '主图'
  const index = references.value.findIndex((item) => item.path === path)
  return index >= 0 ? `参考图 ${index + 1}` : ''
}
function isAssignedAsset(path: string) {
  return !!assetRole(path)
}
function switchAsset(asset: WorkspaceAsset, event: MouseEvent) {
  if (!isAssignedAsset(asset.path)) {
    previewTrigger = event.currentTarget as HTMLElement
    previewAsset.value = asset
    return
  }
  selectInput(asset.path === selectedPath.value ? 'main' : asset.path)
}
function markChanged() {
  hasUnsavedChanges.value = !!doc.value && snapshot() !== savedSnapshot
}
function saveDraft(): boolean {
  if (!activeWorkspaceId.value || !selectedPath.value || !doc.value || props.readonly) return false
  if (cropReady.value) {
    message.info('请先应用或取消裁剪')
    return false
  }
  try {
    let previousPaths: string[] = []
    try {
      const stored: unknown = JSON.parse(
        localStorage.getItem(referenceListKey(activeWorkspaceId.value, selectedPath.value)) || '[]'
      )
      if (Array.isArray(stored))
        previousPaths = stored.filter((path): path is string => typeof path === 'string')
    } catch {
      /* A damaged list can be replaced. */
    }
    localStorage.setItem(
      draftKey(activeWorkspaceId.value, selectedPath.value),
      JSON.stringify(doc.value)
    )
    localStorage.setItem(
      referenceListKey(activeWorkspaceId.value, selectedPath.value),
      JSON.stringify(references.value.map((item) => item.path))
    )
    for (const reference of references.value)
      localStorage.setItem(
        referenceDraftKey(activeWorkspaceId.value, selectedPath.value, reference.path),
        JSON.stringify(reference.doc)
      )
    for (const path of previousPaths)
      if (!references.value.some((item) => item.path === path))
        localStorage.removeItem(
          referenceDraftKey(activeWorkspaceId.value, selectedPath.value, path)
        )
    savedSnapshot = snapshot()
    hasSavedDraft.value = true
    hasUnsavedChanges.value = false
    storageError.value = ''
    message.success('编辑草稿已保存到本机')
    return true
  } catch {
    storageError.value = '编辑草稿未能保存到本机'
    return false
  }
}
function finishSaveBeforeProcessing(saved = false) {
  saveBeforeProcessingOpen.value = false
  resolveSaveBeforeProcessing?.(saved)
  resolveSaveBeforeProcessing = undefined
}
function confirmSaveBeforeProcessing(): boolean | Promise<boolean> {
  if (props.readonly || !doc.value) return false
  if (cropReady.value) {
    message.info('请先应用或取消裁剪，再开始加工')
    return false
  }
  markChanged()
  if (hasSavedDraft.value && !hasUnsavedChanges.value) return true
  finishSaveBeforeProcessing()
  saveBeforeProcessingOpen.value = true
  return new Promise((resolve) => {
    resolveSaveBeforeProcessing = resolve
  })
}
function saveAndProcess() {
  if (saveDraft()) finishSaveBeforeProcessing(true)
}
function commit(before: string) {
  if (!doc.value || before === snapshot()) {
    markChanged()
    return
  }
  undoStack.value = [...undoStack.value.slice(-39), before]
  redoStack.value = []
  draftRevision.value++
  markChanged()
  scheduleRender()
}
function restoreSnapshot(value: string) {
  const state = JSON.parse(value) as { doc: StudioDocument; references: EditableReference[] }
  const restored = readStudioDocument(state.doc)
  if (!restored) return
  for (const layer of restored.layers) if (layer.kind === 'mask') layer.name = '遮罩'
  doc.value = restored
  references.value = (state.references ?? []).flatMap((item) => {
    const reference = readStudioDocument(item.doc)
    return reference ? [{ path: item.path, name: item.name, doc: reference }] : []
  })
  if (
    activeInput.value !== 'main' &&
    !references.value.some((item) => item.path === activeInput.value)
  )
    activeInput.value = 'main'
  cancelCrop()
  selectAnnotation()
  movingSelection.value = false
  fieldSnapshots = new WeakMap<HTMLElement, string>()
}
function undo() {
  if (cropSelection.value) {
    cancelCrop()
    return
  }
  const previous = undoStack.value.pop()
  if (!previous || !doc.value) return
  redoStack.value.push(snapshot())
  restoreSnapshot(previous)
  draftRevision.value++
  markChanged()
  scheduleRender()
}
function redo() {
  const next = redoStack.value.pop()
  if (!next || !doc.value) return
  undoStack.value.push(snapshot())
  restoreSnapshot(next)
  draftRevision.value++
  markChanged()
  scheduleRender()
}
function scheduleRender() {
  if (disposed || props.active === false || renderFrame !== undefined) return
  renderFrame = requestAnimationFrame(() => {
    renderFrame = undefined
    if (rendering) renderQueued = true
    else void render()
  })
}
async function render() {
  const current = ++renderVersion,
    source = activeDoc.value,
    target = canvas.value
  if (!source || !target || props.active === false) return
  rendering = true
  try {
    const offscreen = (previewBuffer ??= document.createElement('canvas'))
    const failures = await renderStudioDocument(
      offscreen,
      source,
      props.assetInfo,
      true,
      { kind: 'all' },
      1280
    )
    if (current !== renderVersion || source !== activeDoc.value || target !== canvas.value) return
    target.width = offscreen.width
    target.height = offscreen.height
    target.getContext('2d')?.drawImage(offscreen, 0, 0)
    renderError.value = failures.length ? `无法读取图片：${failures.join('、')}` : ''
  } catch {
    if (current === renderVersion) renderError.value = '图片预览失败'
  } finally {
    rendering = false
    if (renderQueued && !disposed) {
      renderQueued = false
      scheduleRender()
    }
  }
}
function sourceDocument(
  asset: WorkspaceAsset,
  size: { width: number; height: number }
): StudioDocument {
  const ratio = Math.min(1, 2048 / Math.max(size.width, size.height))
  const width = Math.max(1, Math.min(2048, Math.round(size.width * ratio)))
  const height = Math.max(1, Math.min(2048, Math.round(size.height * ratio)))
  const fresh = createStudioDocument(asset.name)
  fresh.width = width
  fresh.height = height
  const image = createImageLayer(asset.path, { x: 0, y: 0, width, height }, asset.name)
  if (Math.abs(width / height - size.width / size.height) > 0.01) image.fit = 'contain'
  fresh.layers.push(image)
  return fresh
}
async function referenceDocument(
  asset: WorkspaceAsset,
  workspaceId: string,
  mainPath: string
): Promise<EditableReference | null> {
  const file = props.assetInfo[asset.path]
  const size = file && (await studioImageDimensions(file))
  if (!size) return null
  sourceSizes.value[asset.path] = size
  let restored: StudioDocument | undefined
  try {
    restored = readStudioDocument(
      JSON.parse(
        localStorage.getItem(referenceDraftKey(workspaceId, mainPath, asset.path)) || 'null'
      )
    )
  } catch {
    /* Use the source image. */
  }
  return {
    path: asset.path,
    name: asset.name,
    doc: restored?.layers.some((layer) => layer.kind === 'image' && layer.path === asset.path)
      ? restored
      : sourceDocument(asset, size)
  }
}
async function restoreReferences(workspaceId: string, mainPath: string, loadToken: number) {
  let paths: string[] = []
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(referenceListKey(workspaceId, mainPath)) || '[]'
    )
    if (Array.isArray(stored))
      paths = stored.filter((path): path is string => typeof path === 'string').slice(0, 13)
  } catch {
    /* Start without references. */
  }
  for (const path of paths) {
    const asset = assets.value.find((item) => item.path === path && item.path !== mainPath)
    if (!asset) continue
    const reference = await referenceDocument(asset, workspaceId, mainPath)
    if (loadToken !== loadVersion || selectedPath.value !== mainPath) return
    if (reference) references.value.push(reference)
  }
  rememberAssignedAssets(workspaceId)
}
async function chooseAsset(asset: WorkspaceAsset) {
  if (!props.workspace) return
  if (selectedPath.value === asset.path) {
    rememberAsset(asset.path, props.workspace.id)
    selectInput('main')
    return
  }
  if (hasUnsavedChanges.value && !window.confirm('当前图片有未保存的修改，确定放弃并切换主图吗？'))
    return
  const current = ++loadVersion
  const workspaceId = props.workspace.id
  loading.value = true
  renderError.value = ''
  const file = props.assetInfo[asset.path]
  const size = file && (await studioImageDimensions(file))
  if (current !== loadVersion || props.workspace?.id !== workspaceId) return
  if (!size) {
    loading.value = false
    message.error('无法读取素材尺寸')
    return
  }
  sourceSizes.value[asset.path] = size
  activeWorkspaceId.value = workspaceId
  selectedPath.value = asset.path
  rememberAsset(asset.path, workspaceId)
  try {
    localStorage.setItem(lastAssetKey(workspaceId), asset.path)
  } catch {
    /* Current selection still works. */
  }
  selectAnnotation()
  tool.value = 'select'
  activeInput.value = 'main'
  viewZoom.value = 1
  doc.value = null
  references.value = []
  cancelCrop()
  undoStack.value = []
  redoStack.value = []
  let restored: StudioDocument | undefined
  try {
    restored = readStudioDocument(
      JSON.parse(localStorage.getItem(draftKey(workspaceId, asset.path)) || 'null')
    )
  } catch {
    /* A damaged draft should not block the source image. */
  }
  const nextDoc = restored?.layers.some(
    (layer) => layer.kind === 'image' && layer.path === asset.path
  )
    ? restored
    : sourceDocument(asset, size)
  for (const layer of nextDoc.layers) if (layer.kind === 'mask') layer.name = '遮罩'
  await restoreReferences(workspaceId, asset.path, current)
  if (current !== loadVersion || props.workspace?.id !== workspaceId) return
  doc.value = nextDoc
  hasSavedDraft.value = !!restored
  savedSnapshot = snapshot()
  hasUnsavedChanges.value = false
  storageError.value = ''
  loading.value = false
  await nextTick()
  scheduleRender()
}
async function addReference(asset: WorkspaceAsset) {
  if (
    !selectedPath.value ||
    !activeWorkspaceId.value ||
    references.value.length >= 13 ||
    props.readonly
  )
    return
  if (
    references.value.some((item) => item.path === asset.path) ||
    asset.path === selectedPath.value
  )
    return
  const before = snapshot()
  const mainPath = selectedPath.value,
    workspaceId = activeWorkspaceId.value,
    token = loadVersion
  const reference = await referenceDocument(asset, workspaceId, mainPath)
  if (token !== loadVersion || selectedPath.value !== mainPath) return
  if (!reference) {
    message.error('无法读取参考图')
    return
  }
  references.value.push(reference)
  rememberAssignedAssets(workspaceId)
  activeInput.value = asset.path
  tool.value = 'crop'
  viewZoom.value = 1
  cancelCrop()
  commit(before)
}
function deleteMaterial(asset: WorkspaceAsset) {
  const workspaceId = props.workspace?.id
  const artifactId = asset && props.assetInfo[asset.path]?.workspace_artifact_id
  if (!asset || !workspaceId || !artifactId || props.readonly) return
  Modal.confirm({
    title: `删除素材“${assetDisplayName(asset.name)}”？`,
    content: '将永久删除工作区中的文件和相关编辑草稿。已同步到媒体库的副本会保留。',
    okText: '删除',
    cancelText: '取消',
    okType: 'danger',
    async onOk() {
      if (props.readonly) return
      await deleteWorkspaceArtifact(artifactId)
      try {
        removeWorkspaceAssetDrafts(localStorage, workspaceId, asset.path)
      } catch {
        storageError.value = '素材已删除，但本机编辑草稿清理失败'
      }
      if (props.workspace?.id === workspaceId) {
        recentPaths.value = recentPaths.value.filter((path) => path !== asset.path)
        if (
          selectedPath.value === asset.path ||
          references.value.some((item) => item.path === asset.path)
        ) {
          loadVersion++
          loading.value = false
          undoStack.value = []
          redoStack.value = []
          cancelCrop()
          selectAnnotation()
          activeInput.value = 'main'
          if (selectedPath.value === asset.path) {
            selectedPath.value = ''
            doc.value = null
            references.value = []
            activeWorkspaceId.value = ''
            savedSnapshot = ''
            hasSavedDraft.value = false
          } else references.value = references.value.filter((item) => item.path !== asset.path)
          draftRevision.value++
          markChanged()
          scheduleRender()
        }
      }
      emit('artifactSaved')
      message.success('素材已删除')
    }
  })
}
function warnBeforeUnload(event: BeforeUnloadEvent) {
  if (!hasUnsavedChanges.value) return
  event.preventDefault()
  event.returnValue = ''
}
function removeReference(path: string) {
  if (props.readonly) return
  const before = snapshot()
  references.value = references.value.filter((item) => item.path !== path)
  if (activeInput.value === path) {
    activeInput.value = 'main'
    tool.value = 'select'
    viewZoom.value = 1
  }
  commit(before)
}
function selectInput(path: string) {
  activeInput.value = path
  cancelCrop()
  viewZoom.value = 1
  tool.value = path === 'main' ? 'select' : 'crop'
  scheduleRender()
}
watch(
  () => props.workspace?.id,
  () => {
    finishSaveBeforeProcessing()
    loadVersion++
    selectedPath.value = ''
    doc.value = null
    selectAnnotation()
    references.value = []
    activeInput.value = 'main'
    cancelCrop()
    activeWorkspaceId.value = ''
    loading.value = false
    undoStack.value = []
    redoStack.value = []
    savedSnapshot = ''
    hasUnsavedChanges.value = false
    hasSavedDraft.value = false
    previewAsset.value = undefined
    recentPaths.value = props.workspace ? loadRecentAssets(props.workspace.id) : []
  },
  { immediate: true }
)
watch(
  assets,
  (items) => {
    if (selectedPath.value || loading.value || !items.length || !props.workspace) return
    let lastPath = ''
    try {
      lastPath = localStorage.getItem(lastAssetKey(props.workspace.id)) || ''
    } catch {
      /* No prior main image. */
    }
    const previousMain = items.find((item) => item.path === lastPath)
    if (previousMain) void chooseAsset(previousMain)
  },
  { immediate: true }
)
watch(() => props.assetInfo, scheduleRender)
watch(activeDoc, scheduleRender)
watch(tool, (next) => {
  dismissAnnotationCallout()
  if (next !== 'crop') cancelCrop()
  if (!['select', 'rect', 'arrow'].includes(next)) selectedGuideId.value = ''
  if (!['select', 'paint'].includes(next)) selectedPaintId.value = ''
  if (!['select', 'mask'].includes(next)) selectedMaskId.value = ''
})
watch(
  viewport,
  (element, previous) => {
    if (previous) resizeObserver?.unobserve(previous)
    if (!element) return
    resizeObserver ??= new ResizeObserver(() => {
      if (element.clientWidth > 28 && element.clientHeight > 28)
        viewportSize.value = { width: element.clientWidth, height: element.clientHeight }
    })
    resizeObserver.observe(element)
    if (element.clientWidth > 28 && element.clientHeight > 28)
      viewportSize.value = { width: element.clientWidth, height: element.clientHeight }
  },
  { flush: 'post' }
)
onMounted(() => {
  document.addEventListener('pointerdown', closeAnnotationCalloutOutside)
  window.addEventListener('beforeunload', warnBeforeUnload)
})
onBeforeUnmount(() => {
  finishSaveBeforeProcessing()
  document.removeEventListener('pointerdown', closeAnnotationCalloutOutside)
  window.removeEventListener('beforeunload', warnBeforeUnload)
  disposed = true
  renderVersion++
  loadVersion++
  resizeObserver?.disconnect()
  if (renderFrame !== undefined) cancelAnimationFrame(renderFrame)
})

function point(event: PointerEvent): StudioPoint | undefined {
  const surface = canvas.value,
    current = activeDoc.value
  if (!surface || !current) return
  const bounds = surface.getBoundingClientRect()
  if (!bounds.width || !bounds.height) return
  return {
    x: Math.max(
      0,
      Math.min(current.width, ((event.clientX - bounds.left) * current.width) / bounds.width)
    ),
    y: Math.max(
      0,
      Math.min(current.height, ((event.clientY - bounds.top) * current.height) / bounds.height)
    )
  }
}
function updateTransform() {
  cancelCrop()
  draftRevision.value++
  markChanged()
  scheduleRender()
}
function beginFieldEdit(event: Event) {
  const field = event.target
  if (
    !(field instanceof HTMLElement) ||
    !field.matches('input:not([type=number]), select, textarea') ||
    fieldSnapshots.has(field)
  )
    return
  fieldSnapshots.set(field, snapshot())
}
function finishFieldEdit(event: Event) {
  const field = event.target
  if (!(field instanceof HTMLElement)) return
  const before = fieldSnapshots.get(field)
  if (before === undefined) return
  fieldSnapshots.delete(field)
  commit(before)
}
function resizeActive(which: 'width' | 'height', value: number) {
  const current = activeDoc.value
  if (!current || props.readonly || !Number.isFinite(value)) return
  cancelCrop()
  const before = snapshot()
  const size = Math.max(1, Math.min(2048, Math.round(value)))
  const resized = scaleStudioDocument(
    JSON.parse(JSON.stringify(current)),
    which === 'width' ? size : current.width,
    which === 'height' ? size : current.height
  )
  if (activeInput.value === 'main') doc.value = resized
  else {
    const reference = references.value.find((item) => item.path === activeInput.value)
    if (reference) reference.doc = resized
  }
  commit(before)
}
function setCropEdge(edge: 'left' | 'top' | 'right' | 'bottom', value: number) {
  const layer = activeImage.value
  if (!layer || props.readonly || !Number.isFinite(value)) return
  cancelCrop()
  const before = snapshot()
  const crop = layer.crop,
    part = Math.max(0, Math.min(1, value / 100))
  if (edge === 'left') {
    const right = crop.x + crop.width
    crop.x = Math.min(part, right - 0.02)
    crop.width = right - crop.x
  }
  if (edge === 'right') crop.width = Math.max(0.02, part - crop.x)
  if (edge === 'top') {
    const bottom = crop.y + crop.height
    crop.y = Math.min(part, bottom - 0.02)
    crop.height = bottom - crop.y
  }
  if (edge === 'bottom') crop.height = Math.max(0.02, part - crop.y)
  crop.width = Math.min(crop.width, 1 - crop.x)
  crop.height = Math.min(crop.height, 1 - crop.y)
  commit(before)
}
function resetTransform() {
  const layer = activeImage.value,
    current = activeDoc.value
  if (!layer || !current || props.readonly) return
  cancelCrop()
  const before = snapshot()
  layer.crop = { x: 0, y: 0, width: 1, height: 1 }
  layer.zoom = 1
  layer.focusX = 0.5
  layer.focusY = 0.5
  const size = sourceSizes.value[layer.path]
  layer.fit =
    size && Math.abs(current.width / current.height - size.width / size.height) > 0.01
      ? 'contain'
      : 'cover'
  commit(before)
}
function applyCropSelection(selection: { x: number; y: number; width: number; height: number }) {
  const layer = activeImage.value,
    size = layer && sourceSizes.value[layer.path]
  if (!layer || !size || !activeDoc.value || selection.width < 10 || selection.height < 10) return
  const crop = layer.crop,
    sourceWidth = crop.width * size.width,
    sourceHeight = crop.height * size.height
  const zoom = layer.zoom,
    base =
      layer.fit === 'stretch'
        ? 1
        : layer.fit === 'cover'
          ? Math.max(layer.width / sourceWidth, layer.height / sourceHeight)
          : Math.min(layer.width / sourceWidth, layer.height / sourceHeight)
  const drawnWidth = layer.fit === 'stretch' ? layer.width * zoom : sourceWidth * base * zoom
  const drawnHeight = layer.fit === 'stretch' ? layer.height * zoom : sourceHeight * base * zoom
  const drawnX = layer.x + (layer.width - drawnWidth) * layer.focusX
  const drawnY = layer.y + (layer.height - drawnHeight) * layer.focusY
  const left = Math.max(0, Math.min(1, (selection.x - drawnX) / drawnWidth))
  const top = Math.max(0, Math.min(1, (selection.y - drawnY) / drawnHeight))
  const right = Math.max(0, Math.min(1, (selection.x + selection.width - drawnX) / drawnWidth))
  const bottom = Math.max(0, Math.min(1, (selection.y + selection.height - drawnY) / drawnHeight))
  if (right - left < 0.02 || bottom - top < 0.02) return
  layer.crop = {
    x: crop.x + crop.width * left,
    y: crop.y + crop.height * top,
    width: crop.width * (right - left),
    height: crop.height * (bottom - top)
  }
  layer.zoom = 1
  layer.focusX = 0.5
  layer.focusY = 0.5
  layer.fit = 'cover'
  scheduleRender()
}
function confirmCrop() {
  if (!cropReady.value || !cropSelection.value || props.readonly) return
  const before = snapshot()
  applyCropSelection(cropSelection.value)
  cancelCrop()
  commit(before)
}
function cancelCrop() {
  cropSelection.value = null
  cropReady.value = false
}
async function wheelZoom(event: WheelEvent) {
  if (!activeDoc.value || !viewport.value || !canvas.value) return
  dismissAnnotationCallout()
  event.preventDefault()
  const before = canvas.value.getBoundingClientRect()
  const x = (event.clientX - before.left) / before.width,
    y = (event.clientY - before.top) / before.height
  viewZoom.value = Math.max(
    0.25,
    Math.min(8, viewZoom.value * Math.exp(-Math.max(-120, Math.min(120, event.deltaY)) * 0.0015))
  )
  await nextTick()
  const after = canvas.value?.getBoundingClientRect(),
    area = viewport.value
  if (!after || !area) return
  area.scrollLeft += after.left + x * after.width - event.clientX
  area.scrollTop += after.top + y * after.height - event.clientY
  updateToolCursor(event)
}
function resetView() {
  viewZoom.value = 1
  if (viewport.value) {
    viewport.value.scrollLeft = 0
    viewport.value.scrollTop = 0
  }
}
function panDown(event: PointerEvent) {
  if (event.button !== 1 || !viewport.value || !activeDoc.value) return
  dismissAnnotationCallout()
  event.preventDefault()
  event.stopPropagation()
  panGesture = {
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    scrollLeft: viewport.value.scrollLeft,
    scrollTop: viewport.value.scrollTop
  }
  panning.value = true
  viewport.value.setPointerCapture(event.pointerId)
}
function panMove(event: PointerEvent) {
  if (!panGesture || panGesture.pointerId !== event.pointerId || !viewport.value) return
  viewport.value.scrollLeft = panGesture.scrollLeft + panGesture.clientX - event.clientX
  viewport.value.scrollTop = panGesture.scrollTop + panGesture.clientY - event.clientY
}
function panUp(event: PointerEvent) {
  if (!panGesture || panGesture.pointerId !== event.pointerId) return
  if (viewport.value?.hasPointerCapture(event.pointerId))
    viewport.value.releasePointerCapture(event.pointerId)
  panGesture = null
  panning.value = false
}
function strokeLayer(
  current: StudioDocument,
  kind: 'paint' | 'mask'
): StudioPaintLayer | StudioMaskLayer {
  if (kind === 'paint') {
    const layer = createPaintLayer(current.width, current.height)
    layer.color = paintColor.value
    const numbers = current.layers
      .filter((item) => item.kind === 'paint')
      .map((item) => Number(/^涂抹 (\d+)$/.exec(item.name)?.[1] ?? 0))
    layer.name = `涂抹 ${Math.max(0, ...numbers) + 1}`
    current.layers.push(layer)
    return layer
  }
  let layer = current.layers.find((item): item is StudioMaskLayer => item.kind === 'mask')
  if (!layer) {
    layer = createMaskLayer(current.width, current.height)
    current.layers.push(layer)
  }
  layer.name = '遮罩'
  return layer
}
function hitAnnotation(
  position: StudioPoint
): StudioGuideLayer | StudioPaintLayer | StudioMaskLayer | undefined {
  const current = doc.value
  if (!current) return undefined
  const candidates = [
    ...current.layers.filter((layer) => layer.kind === 'guide' || layer.kind === 'paint').reverse(),
    ...current.layers.filter((layer) => layer.kind === 'mask').reverse()
  ]
  return candidates.find(
    (layer): layer is StudioGuideLayer | StudioPaintLayer | StudioMaskLayer => {
      if (!studioLayerVisible(current, layer) || studioLayerLocked(current, layer)) return false
      if (layer.kind === 'paint' || layer.kind === 'mask')
        return studioMaskContainsPoint(layer, position, 5)
      return (
        layer.kind === 'guide' &&
        position.x >= layer.x - 8 &&
        position.x <= layer.x + layer.width + 8 &&
        position.y >= layer.y - 8 &&
        position.y <= layer.y + layer.height + 8
      )
    }
  )
}
function pointerDown(event: PointerEvent) {
  updateToolCursor(event)
  const mainDoc = doc.value
  if (
    !mainDoc ||
    !activeDoc.value ||
    props.readonly ||
    event.button !== 0 ||
    (activeInput.value !== 'main' && tool.value !== 'crop')
  )
    return
  event.preventDefault()
  showAnnotationCallout.value = false
  canvas.value?.setPointerCapture(event.pointerId)
  canvas.value?.focus()
  const start = point(event)
  if (!start) return
  gestureBefore = snapshot()
  if (tool.value === 'crop') {
    selectAnnotation()
    cropReady.value = false
    cropSelection.value = { x: start.x, y: start.y, width: 0, height: 0 }
    gesture = { kind: 'crop', start }
  } else if (tool.value === 'select') {
    const annotation = hitAnnotation(start)
    selectAnnotation(annotation)
    gesture = annotation
      ? {
          kind: 'move',
          id: annotation.id,
          start,
          x: annotation.x,
          y: annotation.y,
          bounds:
            annotation.kind === 'paint' || annotation.kind === 'mask'
              ? (studioMaskPaintBounds(annotation) ?? undefined)
              : undefined
        }
      : { kind: 'none' }
    movingSelection.value = !!annotation
  } else if (tool.value === 'rect' || tool.value === 'arrow') {
    const guide = createGuideLayer({ x: start.x, y: start.y, width: 1, height: 1 }, tool.value)
    guide.name = `${tool.value === 'rect' ? '提示框' : '箭头'} ${mainDoc.layers.filter((layer) => layer.kind === 'guide' && layer.shape === tool.value).length + 1}`
    guide.color = guideColor.value
    guide.strokeWidth = guideWidth.value
    mainDoc.layers.push(guide)
    selectAnnotation(guide)
    gesture = { kind: 'guide', id: guide.id, start }
  } else {
    const kind = tool.value === 'eraser' ? eraseTarget.value : tool.value
    const layers =
      tool.value === 'eraser'
        ? mainDoc.layers.filter(
            (layer): layer is StudioPaintLayer | StudioMaskLayer =>
              layer.kind === kind && layer.strokes.some((stroke) => stroke.mode === 'paint')
          )
        : [strokeLayer(mainDoc, kind as 'paint' | 'mask')]
    const ids: string[] = []
    for (const layer of layers) {
      const local = studioMaskPoint(layer, start)
      if (!local) continue
      layer.strokes.push({
        points: [local],
        size: brushSize.value,
        mode: tool.value === 'eraser' ? 'erase' : 'paint'
      })
      ids.push(layer.id)
    }
    const selected =
      tool.value === 'paint' || tool.value === 'mask'
        ? mainDoc.layers.find((layer) => layer.id === ids[0])
        : undefined
    selectAnnotation(selected?.kind === 'paint' || selected?.kind === 'mask' ? selected : undefined)
    gesture = ids.length ? { kind: 'stroke', ids } : { kind: 'none' }
  }
  scheduleRender()
}
function pointerMove(event: PointerEvent) {
  updateToolCursor(event)
  if (!gesture || !activeDoc.value || !doc.value) return
  const active = gesture
  const current = point(event)
  if (!current) return
  if (active.kind === 'crop') {
    cropSelection.value = {
      x: Math.min(active.start.x, current.x),
      y: Math.min(active.start.y, current.y),
      width: Math.abs(current.x - active.start.x),
      height: Math.abs(current.y - active.start.y)
    }
  } else if (active.kind === 'guide') {
    const guide = doc.value.layers.find((layer) => layer.id === active.id) as
      StudioGuideLayer | undefined
    if (!guide) return
    guide.x = Math.min(active.start.x, current.x)
    guide.y = Math.min(active.start.y, current.y)
    guide.width = Math.max(1, Math.abs(current.x - active.start.x))
    guide.height = Math.max(1, Math.abs(current.y - active.start.y))
    guide.flipX = current.x < active.start.x
    guide.flipY = current.y < active.start.y
  } else if (active.kind === 'move') {
    const annotation = doc.value.layers.find((layer) => layer.id === active.id)
    if (annotation?.kind !== 'guide' && annotation?.kind !== 'paint' && annotation?.kind !== 'mask')
      return
    if ((annotation.kind === 'paint' || annotation.kind === 'mask') && active.bounds) {
      annotation.x = Math.max(
        -active.bounds.x,
        Math.min(
          doc.value.width - active.bounds.x - active.bounds.width,
          active.x + current.x - active.start.x
        )
      )
      annotation.y = Math.max(
        -active.bounds.y,
        Math.min(
          doc.value.height - active.bounds.y - active.bounds.height,
          active.y + current.y - active.start.y
        )
      )
    } else {
      annotation.x = Math.max(
        0,
        Math.min(doc.value.width - annotation.width, active.x + current.x - active.start.x)
      )
      annotation.y = Math.max(
        0,
        Math.min(doc.value.height - annotation.height, active.y + current.y - active.start.y)
      )
    }
  } else if (active.kind === 'stroke') {
    for (const id of active.ids) {
      const layer = doc.value.layers.find((item) => item.id === id) as
        StudioMaskLayer | StudioPaintLayer | undefined
      const local = layer && studioMaskPoint(layer, current)
      const stroke = layer?.strokes[layer.strokes.length - 1]
      if (!local || !stroke) continue
      const previous = stroke.points[stroke.points.length - 1]
      if (
        Math.hypot((local.x - previous.x) * layer.width, (local.y - previous.y) * layer.height) < 1
      )
        continue
      if (stroke.points.length >= 500) layer.strokes.push({ ...stroke, points: [previous, local] })
      else stroke.points.push(local)
    }
  }
  scheduleRender()
}
function pointerUp(event: PointerEvent) {
  if (!gesture || !doc.value) return
  if (canvas.value?.hasPointerCapture(event.pointerId))
    canvas.value.releasePointerCapture(event.pointerId)
  const active = gesture
  movingSelection.value = false
  if (active.kind === 'crop') {
    if (!cropSelection.value || cropSelection.value.width < 10 || cropSelection.value.height < 10)
      cancelCrop()
    else cropReady.value = true
  } else if (active.kind === 'guide') {
    const guide = doc.value.layers.find((layer) => layer.id === active.id) as
      StudioGuideLayer | undefined
    if (guide && Math.hypot(guide.width, guide.height) < 10) {
      doc.value.layers = doc.value.layers.filter((layer) => layer.id !== guide.id)
      selectedGuideId.value = ''
    }
  }
  gesture = null
  if (active.kind !== 'crop') commit(gestureBefore)
  showAnnotationCallout.value = !!selectedAnnotationLayer.value
}
function removeAnnotation(id: string) {
  if (!doc.value || props.readonly) return
  const before = snapshot()
  doc.value.layers = doc.value.layers.filter((layer) => layer.id !== id)
  if (selectedAnnotationId.value === id) selectAnnotation()
  commit(before)
}
function updateGuide() {
  draftRevision.value++
  markChanged()
  scheduleRender()
}
function updatePrompt() {
  draftRevision.value++
  markChanged()
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Tab') {
    const elements = Array.from(
      editorRoot.value?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]'
      ) ?? []
    ).filter((el) => el.getClientRects().length)
    const first = elements[0],
      last = elements[elements.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  if (section.value !== 'edit') return
  const modifier = event.ctrlKey || event.metaKey
  const key = event.key.toLowerCase()
  if (modifier && key === 's') {
    event.preventDefault()
    saveDraft()
    return
  }
  if (event.key === 'Escape' && cropReady.value) {
    event.preventDefault()
    cancelCrop()
    return
  }
  if (event.key === 'Escape' && showAnnotationCallout.value) {
    event.preventDefault()
    event.stopPropagation()
    dismissAnnotationCallout()
    canvas.value?.focus()
    return
  }
  if (event.key === 'Enter' && cropReady.value && !(event.target instanceof HTMLInputElement)) {
    event.preventDefault()
    confirmCrop()
    return
  }
  const target = event.target
  if (
    !modifier &&
    !event.altKey &&
    key === 'v' &&
    !gesture &&
    !(
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    )
  ) {
    event.preventDefault()
    event.stopPropagation()
    dismissAnnotationCallout()
    tool.value = 'select'
    canvas.value?.focus()
    return
  }
  if (
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement && ['text', 'search'].includes(target.type)) ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
    return
  if (modifier && key === 'z') {
    event.preventDefault()
    finishFieldEdit(event)
    if (event.shiftKey) redo()
    else undo()
  } else if (modifier && key === 'y') {
    event.preventDefault()
    finishFieldEdit(event)
    redo()
  } else if (event.key === 'Delete' && selectedAnnotationId.value) {
    event.preventDefault()
    removeAnnotation(selectedAnnotationId.value)
  }
}
const materialController = computed<MaterialController>(() => ({
  assets: assets.value,
  roles: Object.fromEntries(
    assets.value.map((asset) => [asset.path, assetRole(asset.path)]).filter(([, role]) => role)
  ),
  activePath: activeInput.value === 'main' ? selectedPath.value : activeInput.value,
  recentPaths: recentPaths.value,
  select: switchAsset,
  actions: (asset) => [
    {
      key: 'main',
      label: selectedPath.value === asset.path ? '当前主图' : '设为主图',
      disabled: props.readonly || selectedPath.value === asset.path
    },
    references.value.some((item) => item.path === asset.path)
      ? { key: 'remove-reference', label: '移除参考图', disabled: props.readonly }
      : {
          key: 'reference',
          label: '添加为参考图',
          disabled:
            props.readonly ||
            !doc.value ||
            selectedPath.value === asset.path ||
            references.value.length >= 13
        },
    ...(isWorkspaceCreated(asset)
      ? [{ key: 'delete', label: '删除素材', danger: true, disabled: props.readonly }]
      : [])
  ],
  runAction: (asset, key) => {
    if (props.readonly) return
    if (key === 'main') void chooseAsset(asset)
    else if (key === 'reference') void addReference(asset)
    else if (key === 'remove-reference') removeReference(asset.path)
    else if (key === 'delete') deleteMaterial(asset)
  }
}))
watch(
  () => props.active,
  (active) => {
    if (active) void nextTick(scheduleRender)
    else {
      renderVersion++
      closePreview()
      dismissAnnotationCallout()
    }
  }
)
async function saveMaterial() {
  if (
    !activeDoc.value ||
    !props.workspace ||
    props.readonly ||
    savingMaterial.value ||
    cropReady.value
  )
    return
  const workspaceId = props.workspace.id
  const document = JSON.parse(JSON.stringify(activeDoc.value)) as StudioDocument
  const files = { ...props.assetInfo }
  savingMaterial.value = true
  try {
    const output = window.document.createElement('canvas')
    const failures = await renderStudioDocument(
      output,
      document,
      files,
      false,
      { kind: 'all' },
      undefined,
      true
    )
    if (failures.length) throw new Error('素材未完整载入')
    await saveWorkspaceArtifact(
      workspaceId,
      document.name || 'AI 编辑图片',
      'png',
      output.toDataURL('image/png'),
      'ai_image_edit'
    )
    emit('artifactSaved')
    message.success('已保存为工作区素材')
  } catch {
    message.error('保存素材失败，请确认图片已完整载入后重试')
  } finally {
    savingMaterial.value = false
  }
}
defineExpose({ materialController, focusEditor })
</script>

<template>
  <section
    ref="editorRoot"
    class="ai-image-editor"
    :class="{ 'is-placeholder': section !== 'edit' }"
    tabindex="-1"
    role="dialog"
    aria-modal="true"
    :aria-label="`AI 创作 · ${sectionLabel}`"
    @keydown="keydown"
  >
    <header v-show="section === 'edit'" class="editor-header">
      <span class="editor-context"
        >AI 图片编辑 · {{ activeInput === 'main' ? '主图' : '参考图' }}</span
      >
      <span class="save-status" :class="{ unsaved: hasUnsavedChanges }" aria-live="polite">{{
        hasUnsavedChanges ? '未保存修改' : hasSavedDraft ? '已保存到本机' : '尚无修改'
      }}</span>
      <button
        type="button"
        class="save-button"
        title="Ctrl+S"
        :disabled="readonly || !hasUnsavedChanges || cropReady || savingMaterial"
        @click="saveDraft"
      >
        保存草稿
      </button>
      <button
        type="button"
        class="save-button"
        :disabled="readonly || !activeDoc || cropReady || savingMaterial || !!renderError"
        @click="saveMaterial"
      >
        {{ savingMaterial ? '正在保存…' : '保存为素材' }}
      </button>
    </header>
    <div class="editor-navigation">
      <AICreationTabs v-model="section" :disabled="savingMaterial" />
      <button
        class="editor-close"
        type="button"
        aria-label="关闭编辑"
        title="返回工作台，保留当前编辑会话"
        :disabled="savingMaterial"
        @click="closeEditor"
      >
        <CloseOutlined />
      </button>
    </div>
    <template v-if="section === 'edit' && activeDoc && activeImage">
      <div class="tool-row" role="toolbar" aria-label="图片编辑工具">
        <template v-if="activeInput === 'main'"
          ><button
            type="button"
            :class="{ active: tool === 'select' }"
            title="选择"
            aria-label="选择"
            aria-keyshortcuts="V"
            @click="tool = 'select'"
          >
            <StudioToolIcon kind="hand" />
          </button>
          <button
            type="button"
            :class="{ active: tool === 'rect' }"
            title="提示框"
            aria-label="提示框"
            @click="tool = 'rect'"
          >
            <BorderOutlined />
          </button>
          <button
            type="button"
            :class="{ active: tool === 'arrow' }"
            title="箭头"
            aria-label="箭头"
            @click="tool = 'arrow'"
          >
            <StudioToolIcon kind="arrow" />
          </button>
          <button
            type="button"
            :class="{ active: tool === 'paint' }"
            title="涂抹"
            aria-label="涂抹"
            @click="tool = 'paint'"
          >
            <StudioToolIcon kind="marker" />
          </button>
          <button
            type="button"
            :class="{ active: tool === 'mask' }"
            title="遮罩"
            aria-label="遮罩"
            @click="tool = 'mask'"
          >
            <StudioToolIcon kind="mask" />
          </button>
          <button
            type="button"
            :class="{ active: tool === 'eraser' }"
            title="橡皮擦"
            aria-label="橡皮擦"
            @click="tool = 'eraser'"
          >
            <StudioToolIcon kind="eraser" /></button
        ></template>
        <button
          type="button"
          :class="{ active: tool === 'crop' }"
          title="裁剪"
          aria-label="裁剪"
          @click="tool = 'crop'"
        >
          <StudioToolIcon kind="crop" />
        </button>
        <span class="tool-spacer" />
        <template v-if="activeInput === 'main'"
          ><button
            type="button"
            :disabled="!undoStack.length"
            title="撤销"
            aria-label="撤销"
            @click="undo"
          >
            <UndoOutlined />
          </button>
          <button
            type="button"
            :disabled="!redoStack.length"
            title="重做"
            aria-label="重做"
            @click="redo"
          >
            <RedoOutlined /></button
        ></template>
        <button
          type="button"
          class="fit-button"
          title="视图缩放，点击适应窗口；不影响 AI 输入"
          @click="resetView"
        >
          视图 {{ Math.round(viewZoom * 100) }}%
        </button>
      </div>
    </template>
    <main v-show="section === 'edit'" class="editor-stage">
      <template v-if="activeDoc && activeImage">
        <div class="canvas-area">
          <div
            ref="viewport"
            class="image-viewport"
            :class="{ panning }"
            @wheel="wheelZoom"
            @pointerdown="panDown"
            @pointermove="panMove"
            @pointerup="panUp"
            @pointercancel="panUp"
            @auxclick.middle.prevent
          >
            <div class="viewport-track">
              <div
                class="image-surface"
                :style="{ width: `${displayWidth}px`, height: `${displayHeight}px` }"
              >
                <canvas
                  ref="canvas"
                  tabindex="0"
                  :style="{
                    width: `${displayWidth}px`,
                    height: `${displayHeight}px`,
                    cursor: canvasCursor
                  }"
                  aria-label="图片编辑区域"
                  @pointerdown="pointerDown"
                  @pointerenter="updateToolCursor"
                  @pointermove="pointerMove"
                  @pointerleave="toolCursorPosition = null"
                  @pointerup="pointerUp"
                  @pointercancel="pointerUp"
                />
                <div
                  v-if="
                    toolCursorVisible &&
                    toolCursorPosition &&
                    (tool === 'paint' || tool === 'mask' || tool === 'eraser')
                  "
                  class="brush-cursor"
                  :class="`brush-cursor-${tool}`"
                  :style="{
                    left: `${toolCursorPosition.x}px`,
                    top: `${toolCursorPosition.y}px`,
                    width: `${brushCursorSize}px`,
                    height: `${brushCursorSize}px`,
                    borderColor: tool === 'paint' ? paintColor : undefined
                  }"
                  aria-hidden="true"
                />
                <svg
                  v-if="
                    toolCursorVisible && toolCursorPosition && (tool === 'rect' || tool === 'arrow')
                  "
                  class="guide-cursor"
                  :style="{
                    left: `${toolCursorPosition.x}px`,
                    top: `${toolCursorPosition.y}px`
                  }"
                  :width="guideCursorExtent"
                  :height="guideCursorExtent"
                  :viewBox="`0 0 ${guideCursorExtent} ${guideCursorExtent}`"
                  aria-hidden="true"
                >
                  <rect
                    v-if="tool === 'rect'"
                    :x="guideCursorStroke / 2 + 3"
                    :y="guideCursorStroke / 2 + 3"
                    :width="guideCursorExtent - guideCursorStroke - 6"
                    :height="guideCursorExtent - guideCursorStroke - 6"
                    fill="none"
                    :stroke="guideColor"
                    :stroke-width="guideCursorStroke"
                  />
                  <path
                    v-else
                    :d="`M ${guideCursorExtent * 0.23} ${guideCursorExtent * 0.77} L ${guideCursorExtent * 0.77} ${guideCursorExtent * 0.23} M ${guideCursorExtent * 0.48} ${guideCursorExtent * 0.23} L ${guideCursorExtent * 0.77} ${guideCursorExtent * 0.23} L ${guideCursorExtent * 0.77} ${guideCursorExtent * 0.52}`"
                    fill="none"
                    :stroke="guideColor"
                    :stroke-width="guideCursorStroke"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                  <circle
                    :cx="guideCursorExtent / 2"
                    :cy="guideCursorExtent / 2"
                    r="2"
                    fill="#fff"
                    stroke="#26384c"
                    stroke-width="1"
                  />
                </svg>
                <div
                  v-if="selectionFrame"
                  class="selection-outline"
                  :style="{
                    left: `${(selectionFrame.x / activeDoc.width) * 100}%`,
                    top: `${(selectionFrame.y / activeDoc.height) * 100}%`,
                    width: `${(selectionFrame.width / activeDoc.width) * 100}%`,
                    height: `${(selectionFrame.height / activeDoc.height) * 100}%`
                  }"
                  aria-hidden="true"
                >
                  <i v-for="corner in 4" :key="corner" />
                </div>
                <div
                  v-if="showAnnotationCallout && selectedAnnotationLayer && promptCalloutStyle"
                  ref="annotationCallout"
                  class="annotation-callout"
                  :class="{ 'on-left': promptCalloutOnLeft }"
                  :style="promptCalloutStyle"
                  @pointerdown.stop
                  @wheel.stop
                  @focusin="beginFieldEdit"
                  @keydown.capture="beginFieldEdit"
                  @change="finishFieldEdit"
                  @focusout="finishFieldEdit"
                >
                  <div class="annotation-callout-heading">
                    <strong>{{
                      selectedAnnotationLayer.kind === 'mask'
                        ? '遮罩'
                        : selectedAnnotationLayer.name
                    }}</strong>
                    <div class="annotation-callout-actions">
                      <button
                        type="button"
                        :aria-label="`删除${selectedAnnotationLayer.name}`"
                        title="删除"
                        :disabled="readonly"
                        @click="removeAnnotation(selectedAnnotationLayer.id)"
                      >
                        <DeleteOutlined /></button
                      ><button
                        type="button"
                        aria-label="收起批注"
                        title="收起批注"
                        @click="dismissAnnotationCallout"
                      >
                        <CloseOutlined />
                      </button>
                    </div>
                  </div>
                  <textarea
                    v-if="selectedAnnotationLayer.kind !== 'mask'"
                    v-model="selectedAnnotationLayer.prompt"
                    :aria-label="`${selectedAnnotationLayer.name}的说明`"
                    :disabled="readonly"
                    maxlength="500"
                    rows="3"
                    placeholder="添加说明"
                    @input="updatePrompt"
                  />
                  <div class="annotation-callout-fields">
                    <label
                      >颜色
                      <input
                        v-model="selectedAnnotationLayer.color"
                        type="color"
                        :disabled="readonly"
                        @input="updateGuide" /></label
                    ><label v-if="selectedAnnotationLayer.kind === 'guide'"
                      >粗细
                      <input
                        v-model.number="selectedAnnotationLayer.strokeWidth"
                        type="range"
                        min="1"
                        max="24"
                        :disabled="readonly"
                        @input="updateGuide"
                      /><span>{{ selectedAnnotationLayer.strokeWidth }} px</span></label
                    ><span v-else>{{ selectedAnnotationLayer.strokes.length }} 笔</span>
                  </div>
                </div>
                <div
                  v-if="cropSelection"
                  class="crop-selection"
                  :style="{
                    left: `${(cropSelection.x / activeDoc.width) * 100}%`,
                    top: `${(cropSelection.y / activeDoc.height) * 100}%`,
                    width: `${(cropSelection.width / activeDoc.width) * 100}%`,
                    height: `${(cropSelection.height / activeDoc.height) * 100}%`
                  }"
                />
              </div>
            </div>
          </div>

          <div
            v-if="
              cropReady ||
              activeImage.zoom > 1 ||
              (activeInput === 'main' && !['select', 'crop'].includes(tool))
            "
            class="floating-panels"
            @pointerdown.capture="beginFieldEdit"
            @focusin="beginFieldEdit"
            @keydown.capture="beginFieldEdit"
            @change="finishFieldEdit"
            @focusout="finishFieldEdit"
          >
            <div class="tool-settings floating-panel">
              <div v-if="cropReady" class="crop-actions">
                <strong>裁剪待确认</strong
                ><button type="button" class="apply-crop" :disabled="readonly" @click="confirmCrop">
                  应用裁剪</button
                ><button type="button" @click="cancelCrop">取消</button>
              </div>
              <div v-if="activeImage.zoom > 1" class="context-controls">
                <label
                  >水平位置
                  <input
                    v-model.number="activeImage.focusX"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    :disabled="readonly"
                    @input="updateTransform"
                /></label>
                <label
                  >垂直位置
                  <input
                    v-model.number="activeImage.focusY"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    :disabled="readonly"
                    @input="updateTransform"
                /></label>
              </div>
              <div
                v-if="activeInput === 'main' && !['select', 'crop'].includes(tool)"
                class="context-controls"
              >
                <template v-if="tool === 'rect' || tool === 'arrow'"
                  ><label
                    >标注颜色
                    <input v-model="guideColor" type="color" :disabled="readonly" /></label
                  ><label
                    >线条粗细
                    <input
                      v-model.number="guideWidth"
                      type="range"
                      min="1"
                      max="24"
                      :disabled="readonly"
                    /><span>{{ guideWidth }} px</span></label
                  ></template
                >
                <label v-if="tool === 'paint'"
                  >涂抹颜色 <input v-model="paintColor" type="color" :disabled="readonly"
                /></label>
                <label v-if="tool === 'paint' || tool === 'mask' || tool === 'eraser'"
                  >画笔粗细
                  <input
                    v-model.number="brushSize"
                    type="range"
                    min="2"
                    max="200"
                    :disabled="readonly"
                  /><span>{{ brushSize }} px</span></label
                >
                <div
                  v-if="tool === 'eraser'"
                  class="erase-target"
                  role="group"
                  aria-label="擦除对象"
                >
                  <span>擦除对象</span>
                  <div class="erase-target-toggle">
                    <button
                      type="button"
                      :class="{ active: eraseTarget === 'paint' }"
                      :aria-pressed="eraseTarget === 'paint'"
                      :disabled="readonly"
                      @click="eraseTarget = 'paint'"
                    >
                      涂抹</button
                    ><button
                      type="button"
                      :class="{ active: eraseTarget === 'mask' }"
                      :aria-pressed="eraseTarget === 'mask'"
                      :disabled="readonly"
                      @click="eraseTarget = 'mask'"
                    >
                      遮罩
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
      <div v-else class="editor-empty">
        <strong>{{
          !workspace
            ? '先打开一项工作区'
            : loading
              ? '正在载入图片…'
              : '右键底部素材并设为主图，开始编辑'
        }}</strong>
      </div>
      <p v-if="storageError || renderError" class="editor-error" role="alert">
        {{ storageError || renderError }}
      </p>
    </main>
    <main
      v-if="section !== 'edit'"
      class="creation-coming-soon"
      role="tabpanel"
      :aria-label="sectionLabel"
    >
      <strong>{{ sectionLabel }}</strong>
      <p>功能待接入</p>
    </main>
    <aside v-show="section === 'edit'" class="editor-inspector" aria-label="图片设置与 AI 加工">
      <details v-if="activeDoc && activeImage" class="image-settings-section">
        <summary>
          图像设置 <span>{{ activeDoc.width }} × {{ activeDoc.height }}</span>
        </summary>
        <div
          class="canvas-settings edit-controls"
          @pointerdown.capture="beginFieldEdit"
          @focusin="beginFieldEdit"
          @keydown.capture="beginFieldEdit"
          @change="finishFieldEdit"
          @focusout="finishFieldEdit"
        >
          <div class="canvas-settings-heading">
            <button type="button" :disabled="readonly" @click="resetTransform">重置图像</button>
          </div>
          <div class="transform-controls">
            <label
              >宽
              <input
                type="number"
                min="1"
                max="2048"
                :disabled="readonly"
                :value="activeDoc.width"
                @change="resizeActive('width', Number(($event.target as HTMLInputElement).value))"
            /></label>
            <label
              >高
              <input
                type="number"
                min="1"
                max="2048"
                :disabled="readonly"
                :value="activeDoc.height"
                @change="resizeActive('height', Number(($event.target as HTMLInputElement).value))"
            /></label>
            <label
              >填充
              <select v-model="activeImage.fit" :disabled="readonly" @change="updateTransform">
                <option value="cover">铺满</option>
                <option value="contain">完整显示</option>
                <option value="stretch">拉伸</option>
              </select></label
            >
            <label
              class="zoom-control"
              title="改变合成图中的图片大小，影响实际 AI 输入；原始素材不会修改"
              >内容缩放
              <input
                v-model.number="activeImage.zoom"
                type="range"
                min="1"
                max="8"
                step="0.05"
                :disabled="readonly"
                @input="updateTransform"
              /><span>{{ Math.round(activeImage.zoom * 100) }}%</span></label
            >
          </div>
          <div class="crop-grid direct-crop">
            <label
              >左
              <span class="percent-input"
                ><input
                  type="number"
                  min="0"
                  max="98"
                  aria-label="左边界，百分比"
                  :disabled="readonly"
                  :value="Math.round(activeImage.crop.x * 100)"
                  @change="setCropEdge('left', Number(($event.target as HTMLInputElement).value))"
                /><span aria-hidden="true">%</span></span
              ></label
            >
            <label
              >上
              <span class="percent-input"
                ><input
                  type="number"
                  min="0"
                  max="98"
                  aria-label="上边界，百分比"
                  :disabled="readonly"
                  :value="Math.round(activeImage.crop.y * 100)"
                  @change="setCropEdge('top', Number(($event.target as HTMLInputElement).value))"
                /><span aria-hidden="true">%</span></span
              ></label
            >
            <label
              >右
              <span class="percent-input"
                ><input
                  type="number"
                  min="2"
                  max="100"
                  aria-label="右边界，百分比"
                  :disabled="readonly"
                  :value="Math.round((activeImage.crop.x + activeImage.crop.width) * 100)"
                  @change="setCropEdge('right', Number(($event.target as HTMLInputElement).value))"
                /><span aria-hidden="true">%</span></span
              ></label
            >
            <label
              >下
              <span class="percent-input"
                ><input
                  type="number"
                  min="2"
                  max="100"
                  aria-label="下边界，百分比"
                  :disabled="readonly"
                  :value="Math.round((activeImage.crop.y + activeImage.crop.height) * 100)"
                  @change="setCropEdge('bottom', Number(($event.target as HTMLInputElement).value))"
                /><span aria-hidden="true">%</span></span
              ></label
            >
          </div>
        </div>
      </details>
      <AIImageProcess
        :doc="doc"
        :reference-inputs="references"
        :asset-info="assetInfo"
        :workspace-id="workspace?.id"
        :render-error="renderError"
        :revision="draftRevision"
        :readonly="readonly"
        :before-submit="confirmSaveBeforeProcessing"
      />
    </aside>
    <div class="editor-materials"><slot name="materials" /></div>
    <Modal
      :open="saveBeforeProcessingOpen"
      title="保存草稿后开始加工"
      ok-text="保存并开始加工"
      cancel-text="返回编辑"
      :mask-closable="false"
      @ok="saveAndProcess"
      @cancel="finishSaveBeforeProcessing()"
    >
      <p>草稿未保存，保存后开始加工。</p>
      <p v-if="storageError" class="editor-error" role="alert">保存失败，未开始加工，请重试。</p>
    </Modal>
    <WorkspaceAssetPreview
      v-if="previewAsset && assetInfo[previewAsset.path]"
      :key="previewAsset.path"
      :file="assetInfo[previewAsset.path]"
      :workspace-name="workspace?.name"
      @close="closePreview"
    >
      <template #actions>
        <a-button
          type="primary"
          :disabled="readonly || previewAssigning"
          :loading="previewAssigning"
          @click="assignPreview('main')"
          >设为主图</a-button
        >
        <a-button
          :disabled="readonly || previewAssigning || !selectedPath || references.length >= 13"
          @click="assignPreview('reference')"
          >添加为参考图</a-button
        >
      </template>
    </WorkspaceAssetPreview>
  </section>
</template>

<style scoped>
.ai-image-editor {
  min-width: 0;
  color: var(--ui-text);
  outline: none;
}
.editor-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.editor-header {
  flex: none;
  padding: 14px 16px;
  border-bottom: 1px solid var(--ui-border);
}
.editor-header strong {
  font-size: 15px;
}
.editor-header span,
.editor-empty span {
  color: var(--ui-muted);
  font-size: 11px;
}
.tool-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px;
  border-bottom: 1px solid var(--ui-border);
  overflow-x: auto;
}
.tool-row button {
  display: grid;
  place-items: center;
  min-width: 30px;
  height: 30px;
  flex: none;
  padding: 0 5px;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  background: var(--ui-surface);
  color: var(--ui-text);
  cursor: pointer;
  font-size: 11px;
}
.tool-row button.active {
  color: var(--primary-color);
  border-color: var(--primary-color);
  background: var(--primary-color-1);
}
.tool-row button:disabled {
  opacity: 0.4;
  cursor: default;
}
.tool-spacer {
  flex: 1;
}
.tool-row .fit-button {
  min-width: 43px;
}
.image-viewport {
  height: clamp(300px, 50vh, 520px);
  overflow: auto;
  background: var(--ui-surface-soft);
  overscroll-behavior: contain;
}
.viewport-track {
  display: grid;
  place-items: center;
  width: max-content;
  height: max-content;
  min-width: 100%;
  min-height: 100%;
  padding: 14px;
  box-sizing: border-box;
}
.image-surface {
  position: relative;
  flex: none;
  box-shadow: 0 5px 19px #0002;
}
.image-surface canvas {
  display: block;
  touch-action: none;
  cursor: crosshair;
}
.image-surface canvas.movable {
  cursor: default;
}
.crop-selection {
  position: absolute;
  box-sizing: border-box;
  border: 2px dashed #1473c8;
  background: #1473c822;
  pointer-events: none;
}
.editor-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 7px;
  min-height: 240px;
  text-align: center;
}
.editor-error {
  margin: 8px 0;
  color: #b42318;
  font-size: 11px;
}
@media (max-width: 1020px) {
  .image-viewport {
    height: 440px;
  }
}
@media (max-width: 540px) {
  .image-viewport {
    height: 350px;
  }
}
.image-viewport {
  overscroll-behavior: auto;
}
.image-viewport.panning,
.image-viewport.panning canvas {
  cursor: grabbing !important;
}
.editor-header {
  align-items: center;
  min-height: 50px;
  box-sizing: border-box;
  gap: 8px;
  padding: 9px 12px;
}
.editor-header > span:nth-child(2) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.editor-header .save-status {
  margin-left: auto;
  white-space: nowrap;
  color: #16844a;
}
.editor-header .save-status.unsaved {
  color: #b45309;
}
.editor-header .save-button {
  flex: none;
  padding: 6px 9px;
  border: 1px solid var(--primary-color);
  border-radius: 6px;
  background: var(--primary-color);
  color: #fff;
  cursor: pointer;
  font-size: 11px;
}
.editor-header .save-button:disabled {
  opacity: 0.45;
  cursor: default;
}
.edit-controls {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 9px 10px;
  border-bottom: 1px solid var(--ui-border);
}
.tool-settings {
  display: flex;
  flex-direction: column;
  gap: 7px;
  max-height: 240px;
  overflow-y: auto;
  padding: 9px 10px;
}
.tool-settings > .context-controls {
  min-height: 30px;
}
.crop-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 7px;
  border: 1px solid var(--primary-color);
  border-radius: 6px;
  background: var(--primary-color-1);
}
.crop-actions strong {
  margin-right: auto;
  color: var(--primary-color);
  font-size: 11px;
}
.crop-actions .apply-crop {
  border-color: var(--primary-color);
  background: var(--primary-color);
  color: #fff;
}
.transform-controls,
.context-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px 12px;
}
.transform-controls {
  gap: 6px;
}
.edit-controls label,
.tool-settings label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  color: var(--ui-muted);
  font-size: 11px;
  white-space: nowrap;
}
.edit-controls input[type='number'],
.edit-controls input:not([type='range']):not([type='color']),
.edit-controls select,
.edit-controls textarea,
.tool-settings input[type='number'],
.tool-settings input:not([type='range']):not([type='color']),
.tool-settings select,
.tool-settings textarea {
  box-sizing: border-box;
  min-width: 0;
  padding: 5px 6px;
  border: 1px solid var(--ui-border);
  border-radius: 5px;
  background: var(--ui-surface);
  color: var(--ui-text);
  font: inherit;
  font-size: 11px;
}
.edit-controls input[type='number'],
.tool-settings input[type='number'] {
  width: 57px;
}
.edit-controls select,
.tool-settings select {
  max-width: 96px;
}
.edit-controls input[type='range'],
.tool-settings input[type='range'] {
  width: 78px;
  margin: 0;
  accent-color: var(--primary-color);
}
.edit-controls input[type='color'],
.tool-settings input[type='color'] {
  width: 30px;
  height: 25px;
  padding: 2px;
  border: 1px solid var(--ui-border);
  border-radius: 5px;
  background: var(--ui-surface);
}
.edit-controls button,
.tool-settings button {
  flex: none;
  padding: 5px 7px;
  border: 1px solid var(--ui-border);
  border-radius: 5px;
  background: var(--ui-surface);
  color: var(--ui-text);
  cursor: pointer;
  font-size: 11px;
}
.edit-controls button:disabled,
.tool-settings button:disabled {
  opacity: 0.45;
  cursor: default;
}
.erase-target {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--ui-muted);
  font-size: 11px;
  white-space: nowrap;
}
.erase-target-toggle {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  background: var(--ui-surface-soft);
}
.tool-settings .erase-target-toggle button {
  padding: 4px 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
}
.tool-settings .erase-target-toggle button.active {
  background: var(--primary-color);
  color: #fff;
}
.direct-crop {
  gap: 6px;
}
.direct-crop label {
  min-width: 0;
}
.direct-crop .percent-input {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.direct-crop .percent-input input {
  padding-right: 30px;
  appearance: auto;
}
.direct-crop .percent-input > span {
  position: absolute;
  right: 20px;
  color: var(--ui-muted);
  pointer-events: none;
  font-size: 11px;
}
.edit-controls .zoom-control span,
.context-controls label span {
  min-width: 30px;
  color: var(--ui-text);
  text-align: right;
}
.image-viewport {
  height: clamp(540px, 72vh, 900px);
  overflow: hidden;
  overscroll-behavior: auto;
}
.image-viewport:hover {
  outline: 2px solid color-mix(in srgb, var(--primary-color) 38%, transparent);
  outline-offset: -2px;
}
.image-viewport:hover .image-surface {
  box-shadow:
    0 0 0 2px color-mix(in srgb, var(--primary-color) 30%, transparent),
    0 5px 19px #0002;
}
.canvas-area {
  display: grid;
  grid-template-rows: auto auto;
  min-width: 0;
  container-type: inline-size;
}
.canvas-settings {
  position: relative;
  grid-row: 1;
  grid-column: 1;
  box-sizing: border-box;
  margin: 8px 10px 10px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: var(--ui-surface);
}
.canvas-settings-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 25px;
  gap: 8px;
}
.canvas-settings-heading strong {
  font-size: 12px;
}
.canvas-settings .transform-controls,
.canvas-settings .direct-crop {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  align-items: center;
  gap: 6px;
}
.canvas-settings .transform-controls label,
.canvas-settings .direct-crop label {
  display: flex;
  width: 100%;
  min-width: 0;
}
.canvas-settings .transform-controls input[type='number'],
.canvas-settings .transform-controls select,
.canvas-settings .transform-controls input[type='range'] {
  width: 100%;
  max-width: none;
  flex: 1;
}
.canvas-settings .direct-crop .percent-input {
  flex: 1;
  min-width: 0;
}
.canvas-settings .direct-crop .percent-input input {
  width: 100%;
}
.canvas-settings .zoom-control span {
  flex: none;
}
.canvas-settings .direct-crop {
  padding-top: 6px;
  border-top: 1px solid var(--ui-border);
}
.canvas-area > .image-viewport {
  grid-row: 2;
  grid-column: 1;
  min-width: 0;
}
.canvas-area > .floating-panels {
  z-index: 3;
  grid-row: 2;
  grid-column: 1;
  align-self: start;
  justify-self: start;
  box-sizing: border-box;
  margin: 10px;
  max-width: calc(100% - 20px);
  pointer-events: none;
}
.floating-panel {
  box-sizing: border-box;
  max-width: 100%;
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  background: var(--ui-surface);
  box-shadow: 0 8px 24px #0002;
  pointer-events: auto;
}
@container (max-width:450px) {
  .canvas-settings .transform-controls,
  .canvas-settings .direct-crop {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.selection-outline {
  position: absolute;
  box-sizing: border-box;
  border: 1px solid var(--primary-color);
  box-shadow: 0 0 0 1px #fff;
  pointer-events: none;
}
.selection-outline i {
  position: absolute;
  width: 7px;
  height: 7px;
  box-sizing: border-box;
  border: 1px solid var(--primary-color);
  background: #fff;
}
.selection-outline i:nth-child(1) {
  top: -4px;
  left: -4px;
}
.selection-outline i:nth-child(2) {
  top: -4px;
  right: -4px;
}
.selection-outline i:nth-child(3) {
  bottom: -4px;
  right: -4px;
}
.selection-outline i:nth-child(4) {
  bottom: -4px;
  left: -4px;
}
.brush-cursor {
  position: absolute;
  z-index: 4;
  box-sizing: border-box;
  transform: translate(-50%, -50%);
  border: 1.5px solid #555;
  border-radius: 50%;
  box-shadow:
    0 0 0 1px #fff,
    0 0 3px #0008;
  pointer-events: none;
}
.guide-cursor {
  position: absolute;
  z-index: 4;
  transform: translate(-50%, -50%);
  filter: drop-shadow(0 0 1px #fff) drop-shadow(0 0 1px #fff);
  pointer-events: none;
}
.brush-cursor-mask {
  border-color: #555;
  background: #80808022;
}
.brush-cursor-eraser {
  border-style: dashed;
  border-color: #172b41;
  background: #fff4;
}
.annotation-callout {
  position: absolute;
  z-index: 6;
  display: flex;
  flex-direction: column;
  gap: 5px;
  box-sizing: border-box;
  width: 216px;
  padding: 9px;
  border: 1px solid var(--primary-color);
  border-radius: 8px;
  background: var(--ui-surface);
  box-shadow: 0 6px 20px #0003;
  color: var(--ui-text);
  font-size: 11px;
}
.annotation-callout::before {
  content: '';
  position: absolute;
  top: 13px;
  left: -5px;
  width: 8px;
  height: 8px;
  transform: rotate(45deg);
  border-left: 1px solid var(--primary-color);
  border-bottom: 1px solid var(--primary-color);
  background: var(--ui-surface);
}
.annotation-callout.on-left::before {
  left: auto;
  right: -5px;
  transform: rotate(225deg);
}
.annotation-callout strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.annotation-callout textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 54px;
  resize: vertical;
  padding: 6px;
  border: 1px solid var(--ui-border);
  border-radius: 5px;
  background: var(--ui-surface);
  color: var(--ui-text);
  font: inherit;
  line-height: 1.4;
}
.annotation-callout-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.annotation-callout-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
.annotation-callout-heading button {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  flex: none;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--ui-muted);
  cursor: pointer;
}
.annotation-callout-heading button:hover {
  background: var(--primary-color-1);
  color: var(--primary-color);
}
.annotation-callout-heading button:disabled {
  opacity: 0.4;
  cursor: default;
}
.annotation-callout-fields {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ui-muted);
}
.annotation-callout-fields label {
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.annotation-callout-fields input[type='color'] {
  width: 27px;
  height: 24px;
  padding: 2px;
  border: 1px solid var(--ui-border);
  border-radius: 4px;
  background: var(--ui-surface);
}
.annotation-callout-fields input[type='range'] {
  width: 63px;
  margin: 0;
  accent-color: var(--primary-color);
}
.crop-selection {
  border: 2px solid var(--primary-color);
  background: transparent;
  box-shadow: 0 0 0 100vmax #0005;
}
@media (max-width: 540px) {
  .image-viewport {
    height: clamp(420px, 65vh, 650px);
  }
}
</style>

<style scoped src="./aiImageEditorShell.css"></style>
