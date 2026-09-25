<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { BorderOutlined, CloseOutlined, DeleteOutlined, RedoOutlined, UndoOutlined } from '@ant-design/icons-vue'
import type { FileNodeInfo } from '@/api/files'
import { toImageThumbnailUrl } from '@/util/file'
import { createGuideLayer, createImageLayer, createMaskLayer, createPaintLayer, createStudioDocument,
  readStudioDocument, scaleStudioDocument, studioLayerLocked, studioLayerVisible, studioMaskContainsPoint,
  studioMaskPaintBounds, studioMaskPoint, type StudioDocument, type StudioGuideLayer,
  type StudioImageLayer, type StudioMaskLayer, type StudioPaintLayer, type StudioPoint } from './imageStudioModel'
import { renderStudioDocument, studioImageDimensions } from './imageStudioRender'
import AIImageProcess from './AIImageProcess.vue'
import StudioToolIcon from './StudioToolIcon.vue'
import type { WorkspaceAsset, WorkspaceRecord } from './workspaceModel'

type Tool = 'select' | 'rect' | 'arrow' | 'paint' | 'mask' | 'eraser' | 'crop'
type Gesture = { kind: 'guide'; id: string; start: StudioPoint } |
  { kind: 'stroke'; ids: string[] } | { kind: 'move'; id: string; start: StudioPoint; x: number; y: number;
    bounds?: { x: number; y: number; width: number; height: number } } |
  { kind: 'crop'; start: StudioPoint } |
  { kind: 'none' }
interface EditableReference { path: string; name: string; doc: StudioDocument }
const props = defineProps<{ workspace?: WorkspaceRecord; assetInfo: Record<string, FileNodeInfo>; readonly?: boolean }>()
const emit = defineEmits<{ artifactSaved: [] }>()
const assets = computed(() => {
  const seen = new Set<string>()
  return [...(props.workspace?.assets ?? []), ...(props.workspace?.outputs ?? [])]
    .filter(asset => {
      if (asset.kind !== 'image' || !props.assetInfo[asset.path] || seen.has(asset.path)) return false
      seen.add(asset.path)
      return true
    })
})
const query = ref('')
const filteredAssets = computed(() => assets.value.filter(asset => asset.name.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())))
const assetStrip = ref<HTMLElement>()
const assetGridViewport = ref<HTMLElement>()
const assetSearchInput = ref<HTMLInputElement>()
const assetBrowserOpen = ref(false)
const recentPaths = ref<string[]>([])
const assetGridSize = ref({ width: 700, height: 340 })
const assetGridScrollTop = ref(0)
const ASSET_GRID_ROW_HEIGHT = 130
const assetGridColumns = computed(() => Math.max(1, Math.floor((assetGridSize.value.width + 8) / 136)))
const assetGridRows = computed(() => Math.ceil(filteredAssets.value.length / assetGridColumns.value))
const assetGridStartRow = computed(() => Math.max(0, Math.floor(assetGridScrollTop.value / ASSET_GRID_ROW_HEIGHT) - 2))
const assetGridEndRow = computed(() => Math.min(assetGridRows.value,
  Math.ceil((assetGridScrollTop.value + assetGridSize.value.height) / ASSET_GRID_ROW_HEIGHT) + 2))
const visibleGridAssets = computed(() => filteredAssets.value.slice(assetGridStartRow.value * assetGridColumns.value,
  assetGridEndRow.value * assetGridColumns.value))
const assetMenu = ref<{ asset: WorkspaceAsset; left: number; top: number } | null>(null)
const selectedPath = ref('')
const activeWorkspaceId = ref('')
const doc = ref<StudioDocument | null>(null)
const references = ref<EditableReference[]>([])
const stripAssets = computed(() => {
  const byPath = new Map(assets.value.map(asset => [asset.path, asset]))
  const selected = [selectedPath.value, ...references.value.map(item => item.path)].filter(Boolean)
  const paths = [...new Set([...selected, ...recentPaths.value, ...assets.value.slice(0, 8).map(asset => asset.path)])]
  return paths.flatMap(path => byPath.get(path) ?? []).slice(0, Math.max(8, selected.length))
})
const activeInput = ref('main')
const sourceSizes = ref<Record<string, { width: number; height: number }>>({})
const activeDoc = computed(() => activeInput.value === 'main' ? doc.value : references.value.find(item => item.path === activeInput.value)?.doc ?? doc.value)
const activeImage = computed(() => activeDoc.value?.layers.find((layer): layer is StudioImageLayer => layer.kind === 'image'))
const canvas = ref<HTMLCanvasElement>()
const viewport = ref<HTMLElement>()
const annotationCallout = ref<HTMLElement>()
const viewportSize = ref({ width: 500, height: 460 })
const viewZoom = ref(1)
const cropSelection = ref<{ x: number; y: number; width: number; height: number } | null>(null)
const cropReady = ref(false)
const panning = ref(false)
const fitScale = computed(() => activeDoc.value ? Math.min(((viewportSize.value.width > 28 ? viewportSize.value.width : 500) - 28) / activeDoc.value.width,
  ((viewportSize.value.height > 28 ? viewportSize.value.height : 300) - 28) / activeDoc.value.height) : 1)
const displayWidth = computed(() => Math.max(1, (activeDoc.value?.width ?? 1) * fitScale.value * viewZoom.value))
const displayHeight = computed(() => Math.max(1, (activeDoc.value?.height ?? 1) * fitScale.value * viewZoom.value))
const tool = ref<Tool>('select')
const eraseTarget = ref<'paint' | 'mask'>('paint')
const toolCursorPosition = ref<{ x: number; y: number } | null>(null)
const selectedGuideId = ref('')
const selectedPaintId = ref('')
const selectedMaskId = ref('')
const showAnnotationCallout = ref(false)
const movingSelection = ref(false)
const guideColor = ref('#ef4444'), paintColor = ref('#ef4444')
const guideWidth = ref(4), brushSize = ref(32)
const draftRevision = ref(0)
const loading = ref(false), renderError = ref(''), storageError = ref('')
const hasUnsavedChanges = ref(false), hasSavedDraft = ref(false)
const undoStack = ref<string[]>([]), redoStack = ref<string[]>([])
const selectedGuide = computed(() => doc.value?.layers.find((layer): layer is StudioGuideLayer => layer.kind === 'guide' && layer.id === selectedGuideId.value))
const selectedPaint = computed(() => doc.value?.layers.find((layer): layer is StudioPaintLayer => layer.kind === 'paint' && layer.id === selectedPaintId.value))
const selectedMask = computed(() => doc.value?.layers.find((layer): layer is StudioMaskLayer => layer.kind === 'mask' && layer.id === selectedMaskId.value))
const selectedAnnotationLayer = computed(() => selectedGuide.value ?? selectedPaint.value ?? selectedMask.value)
const brushCursorSize = computed(() => Math.max(2, brushSize.value * displayWidth.value / Math.max(1, activeDoc.value?.width ?? 1)))
const guideCursorStroke = computed(() => Math.max(1, guideWidth.value * displayWidth.value / Math.max(1, activeDoc.value?.width ?? 1)))
const guideCursorExtent = computed(() => Math.max(30, guideCursorStroke.value * 2 + 20))
const toolCursorVisible = computed(() => activeInput.value === 'main' && ['rect', 'arrow', 'paint', 'mask', 'eraser'].includes(tool.value))
const selectedAnnotationId = computed(() => selectedGuideId.value || selectedPaintId.value || selectedMaskId.value)
const selectionFrame = computed(() => {
  if (!doc.value || activeInput.value !== 'main' || tool.value === 'crop') return null
  if (selectedGuide.value) return selectedGuide.value
  const layer = selectedPaint.value ?? selectedMask.value
  const bounds = layer && studioMaskPaintBounds(layer)
  return bounds && layer ? { x: layer.x + bounds.x, y: layer.y + bounds.y, width: bounds.width, height: bounds.height } : null
})
const promptCalloutStyle = computed(() => {
  const frame = selectionFrame.value, current = activeDoc.value
  if (!frame || !current || !selectedAnnotationLayer.value) return null
  const scale = displayWidth.value / current.width
  const start = frame.x * scale, end = (frame.x + frame.width) * scale
  const cardWidth = 216, margin = Math.max(0, (viewportSize.value.width - displayWidth.value) / 2)
  const minLeft = 8 - margin, maxLeft = viewportSize.value.width - margin - cardWidth - 8
  let left = end + 12
  if (left > maxLeft) left = start - cardWidth - 12
  if (left < minLeft) left = Math.max(minLeft, maxLeft)
  const top = Math.max(8, Math.min(displayHeight.value - 96, frame.y * scale))
  return { left: `${left}px`, top: `${top}px` }
})
const promptCalloutOnLeft = computed(() => !!promptCalloutStyle.value && !!selectionFrame.value && !!activeDoc.value &&
  Number.parseFloat(promptCalloutStyle.value.left) < selectionFrame.value.x * displayWidth.value / activeDoc.value.width)
function svgCursor(body: string, x: number, y: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${body}</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, crosshair`
}
const cropCursor = svgCursor('<path d="M5 2v15a2 2 0 0 0 2 2h15M2 5h15a2 2 0 0 1 2 2v15" fill="none" stroke="white" stroke-width="4"/><path d="M5 2v15a2 2 0 0 0 2 2h15M2 5h15a2 2 0 0 1 2 2v15" fill="none" stroke="#26384c" stroke-width="1.7"/>', 5, 5)
const canvasCursor = computed(() => {
  if (movingSelection.value) return 'grabbing'
  switch (tool.value) {
    case 'select': return 'grab'
    case 'rect':
    case 'arrow':
    case 'paint':
    case 'mask':
    case 'eraser': return 'none'
    case 'crop': return cropCursor
    default: return 'crosshair'
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
  if (!toolCursorVisible.value || !canvas.value) { toolCursorPosition.value = null; return }
  const bounds = canvas.value.getBoundingClientRect()
  const x = event.clientX - bounds.left, y = event.clientY - bounds.top
  toolCursorPosition.value = x >= 0 && x <= bounds.width && y >= 0 && y <= bounds.height ? { x, y } : null
}
let gesture: Gesture | null = null
let panGesture: { pointerId: number; clientX: number; clientY: number; scrollLeft: number; scrollTop: number } | null = null
let gestureBefore = ''
let loadVersion = 0, renderVersion = 0
let renderFrame: number | undefined
let rendering = false, renderQueued = false
let disposed = false
let previewBuffer: HTMLCanvasElement | undefined
let resizeObserver: ResizeObserver | undefined
let assetGridObserver: ResizeObserver | undefined
let savedSnapshot = ''
let fieldSnapshots = new WeakMap<HTMLElement, string>()
const snapshot = () => JSON.stringify({ doc: doc.value, references: references.value })
const draftKey = (workspaceId: string, path: string) => `iib-ai-image-edit-v1:${workspaceId}:${encodeURIComponent(path)}`
const lastAssetKey = (workspaceId: string) => `iib-ai-image-edit-asset-v1:${workspaceId}`
const recentAssetKey = (workspaceId: string) => `iib-ai-image-edit-recent-v1:${workspaceId}`
const referenceListKey = (workspaceId: string, path: string) => `iib-ai-image-refs-v1:${workspaceId}:${encodeURIComponent(path)}`
const referenceDraftKey = (workspaceId: string, path: string, referencePath: string) =>
  `iib-ai-image-ref-v1:${workspaceId}:${encodeURIComponent(path)}:${encodeURIComponent(referencePath)}`
function loadRecentAssets(workspaceId: string) {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(recentAssetKey(workspaceId)) || '[]')
    return Array.isArray(stored) ? stored.filter((path): path is string => typeof path === 'string').slice(0, 12) : []
  } catch { return [] }
}
function rememberAsset(path: string, workspaceId: string) {
  recentPaths.value = [path, ...recentPaths.value.filter(item => item !== path)].slice(0, 12)
  try { localStorage.setItem(recentAssetKey(workspaceId), JSON.stringify(recentPaths.value)) }
  catch { /* Recent items still work for this session. */ }
}
async function toggleAssetBrowser() {
  assetBrowserOpen.value = !assetBrowserOpen.value
  assetMenu.value = null
  if (!assetBrowserOpen.value) return
  query.value = ''
  assetGridScrollTop.value = 0
  await nextTick()
  assetSearchInput.value?.focus()
}
function assetRole(path: string) {
  if (doc.value && path === selectedPath.value) return '主图'
  const index = references.value.findIndex(item => item.path === path)
  return index >= 0 ? `参考图 ${index + 1}` : ''
}
function isAssignedAsset(path: string) { return !!assetRole(path) }
function isActiveAsset(path: string) { return isAssignedAsset(path) && (path === selectedPath.value ? activeInput.value === 'main' : activeInput.value === path) }
function switchAsset(asset: WorkspaceAsset) {
  if (!isAssignedAsset(asset.path)) return
  selectInput(asset.path === selectedPath.value ? 'main' : asset.path)
}
function switchBrowserAsset(asset: WorkspaceAsset) {
  if (!isAssignedAsset(asset.path)) return
  switchAsset(asset)
  assetBrowserOpen.value = false
}

function markChanged() { hasUnsavedChanges.value = !!doc.value && snapshot() !== savedSnapshot }
function saveDraft() {
  if (!activeWorkspaceId.value || !selectedPath.value || !doc.value || props.readonly) return
  if (cropReady.value) { message.info('请先应用或取消裁剪'); return }
  try {
    let previousPaths: string[] = []
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(referenceListKey(activeWorkspaceId.value, selectedPath.value)) || '[]')
      if (Array.isArray(stored)) previousPaths = stored.filter((path): path is string => typeof path === 'string')
    }
    catch { /* A damaged list can be replaced. */ }
    localStorage.setItem(draftKey(activeWorkspaceId.value, selectedPath.value), JSON.stringify(doc.value))
    localStorage.setItem(referenceListKey(activeWorkspaceId.value, selectedPath.value), JSON.stringify(references.value.map(item => item.path)))
    for (const reference of references.value) localStorage.setItem(referenceDraftKey(activeWorkspaceId.value, selectedPath.value, reference.path), JSON.stringify(reference.doc))
    for (const path of previousPaths) if (!references.value.some(item => item.path === path))
      localStorage.removeItem(referenceDraftKey(activeWorkspaceId.value, selectedPath.value, path))
    savedSnapshot = snapshot()
    hasSavedDraft.value = true
    hasUnsavedChanges.value = false
    storageError.value = ''
    message.success('编辑草稿已保存到本机')
  }
  catch { storageError.value = '编辑草稿未能保存到本机' }
}
function commit(before: string) {
  if (!doc.value || before === snapshot()) { markChanged(); return }
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
  references.value = (state.references ?? []).flatMap(item => {
    const reference = readStudioDocument(item.doc)
    return reference ? [{ path: item.path, name: item.name, doc: reference }] : []
  })
  if (activeInput.value !== 'main' && !references.value.some(item => item.path === activeInput.value)) activeInput.value = 'main'
  cancelCrop()
  selectAnnotation(); movingSelection.value = false
  fieldSnapshots = new WeakMap<HTMLElement, string>()
}
function undo() {
  if (cropSelection.value) { cancelCrop(); return }
  const previous = undoStack.value.pop()
  if (!previous || !doc.value) return
  redoStack.value.push(snapshot())
  restoreSnapshot(previous)
  draftRevision.value++
  markChanged(); scheduleRender()
}
function redo() {
  const next = redoStack.value.pop()
  if (!next || !doc.value) return
  undoStack.value.push(snapshot())
  restoreSnapshot(next)
  draftRevision.value++
  markChanged(); scheduleRender()
}
function scheduleRender() {
  if (disposed || renderFrame !== undefined) return
  renderFrame = requestAnimationFrame(() => {
    renderFrame = undefined
    if (rendering) renderQueued = true
    else void render()
  })
}
async function render() {
  const current = ++renderVersion, source = activeDoc.value, target = canvas.value
  if (!source || !target) return
  rendering = true
  try {
    const offscreen = previewBuffer ??= document.createElement('canvas')
    const failures = await renderStudioDocument(offscreen, source, props.assetInfo, true, { kind: 'all' }, 1280)
    if (current !== renderVersion || source !== activeDoc.value || target !== canvas.value) return
    target.width = offscreen.width; target.height = offscreen.height
    target.getContext('2d')?.drawImage(offscreen, 0, 0)
    renderError.value = failures.length ? `无法读取图片：${failures.join('、')}` : ''
  } catch { if (current === renderVersion) renderError.value = '图片预览失败' }
  finally {
    rendering = false
    if (renderQueued && !disposed) { renderQueued = false; scheduleRender() }
  }
}
function sourceDocument(asset: WorkspaceAsset, size: { width: number; height: number }): StudioDocument {
  const ratio = Math.min(1, 2048 / Math.max(size.width, size.height))
  const width = Math.max(1, Math.min(2048, Math.round(size.width * ratio)))
  const height = Math.max(1, Math.min(2048, Math.round(size.height * ratio)))
  const fresh = createStudioDocument(asset.name)
  fresh.width = width; fresh.height = height
  const image = createImageLayer(asset.path, { x: 0, y: 0, width, height }, asset.name)
  if (Math.abs(width / height - size.width / size.height) > .01) image.fit = 'contain'
  fresh.layers.push(image)
  return fresh
}
async function referenceDocument(asset: WorkspaceAsset, workspaceId: string, mainPath: string): Promise<EditableReference | null> {
  const file = props.assetInfo[asset.path]
  const size = file && await studioImageDimensions(file)
  if (!size) return null
  sourceSizes.value[asset.path] = size
  let restored: StudioDocument | undefined
  try { restored = readStudioDocument(JSON.parse(localStorage.getItem(referenceDraftKey(workspaceId, mainPath, asset.path)) || 'null')) }
  catch { /* Use the source image. */ }
  return { path: asset.path, name: asset.name,
    doc: restored?.layers.some(layer => layer.kind === 'image' && layer.path === asset.path) ? restored : sourceDocument(asset, size) }
}
async function restoreReferences(workspaceId: string, mainPath: string, loadToken: number) {
  let paths: string[] = []
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(referenceListKey(workspaceId, mainPath)) || '[]')
    if (Array.isArray(stored)) paths = stored.filter((path): path is string => typeof path === 'string').slice(0, 13)
  } catch { /* Start without references. */ }
  for (const path of paths) {
    const asset = assets.value.find(item => item.path === path && item.path !== mainPath)
    if (!asset) continue
    const reference = await referenceDocument(asset, workspaceId, mainPath)
    if (loadToken !== loadVersion || selectedPath.value !== mainPath) return
    if (reference) references.value.push(reference)
  }
}
async function chooseAsset(asset: WorkspaceAsset) {
  if (!props.workspace) return
  if (selectedPath.value === asset.path) { rememberAsset(asset.path, props.workspace.id); selectInput('main'); return }
  if (hasUnsavedChanges.value && !window.confirm('当前图片有未保存的修改，确定放弃并切换主图吗？')) return
  const current = ++loadVersion
  const workspaceId = props.workspace.id
  loading.value = true; renderError.value = ''
  const file = props.assetInfo[asset.path]
  const size = file && await studioImageDimensions(file)
  if (current !== loadVersion || props.workspace?.id !== workspaceId) return
  if (!size) { loading.value = false; message.error('无法读取素材尺寸'); return }
  sourceSizes.value[asset.path] = size
  activeWorkspaceId.value = workspaceId
  selectedPath.value = asset.path
  rememberAsset(asset.path, workspaceId)
  try { localStorage.setItem(lastAssetKey(workspaceId), asset.path) } catch { /* Current selection still works. */ }
  selectAnnotation(); tool.value = 'select'; activeInput.value = 'main'; viewZoom.value = 1
  doc.value = null; references.value = []; cancelCrop()
  undoStack.value = []; redoStack.value = []
  let restored: StudioDocument | undefined
  try { restored = readStudioDocument(JSON.parse(localStorage.getItem(draftKey(workspaceId, asset.path)) || 'null')) }
  catch { /* A damaged draft should not block the source image. */ }
  const nextDoc = restored?.layers.some(layer => layer.kind === 'image' && layer.path === asset.path) ? restored : sourceDocument(asset, size)
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
  if (!selectedPath.value || !activeWorkspaceId.value || references.value.length >= 13 || props.readonly) return
  if (references.value.some(item => item.path === asset.path) || asset.path === selectedPath.value) return
  const before = snapshot()
  const mainPath = selectedPath.value, workspaceId = activeWorkspaceId.value, token = loadVersion
  const reference = await referenceDocument(asset, workspaceId, mainPath)
  if (token !== loadVersion || selectedPath.value !== mainPath) return
  if (!reference) { message.error('无法读取参考图'); return }
  references.value.push(reference)
  rememberAsset(asset.path, workspaceId)
  activeInput.value = asset.path; tool.value = 'crop'; viewZoom.value = 1
  cancelCrop()
  commit(before)
}
function openAssetMenu(event: MouseEvent, asset: WorkspaceAsset) {
  event.preventDefault()
  const strip = assetStrip.value, button = event.currentTarget as HTMLElement
  if (!strip) return
  const stripBounds = strip.getBoundingClientRect(), buttonBounds = button.getBoundingClientRect()
  assetMenu.value = { asset, left: Math.max(8, Math.min(strip.clientWidth - 180, buttonBounds.left - stripBounds.left)),
    top: buttonBounds.bottom - stripBounds.top + 4 }
}
function chooseMenuMain() {
  const asset = assetMenu.value?.asset
  assetMenu.value = null
  if (asset) void chooseAsset(asset).then(() => {
    if (selectedPath.value === asset.path) assetBrowserOpen.value = false
  })
}
function addMenuReference() {
  const asset = assetMenu.value?.asset
  assetMenu.value = null
  if (asset) void addReference(asset).then(() => {
    if (references.value.some(item => item.path === asset.path)) assetBrowserOpen.value = false
  })
}
function removeMenuReference() {
  const asset = assetMenu.value?.asset
  assetMenu.value = null
  if (asset) removeReference(asset.path)
}
function closeAssetMenu(event: PointerEvent) {
  if (!(event.target instanceof Element) || !event.target.closest('.asset-context-menu')) assetMenu.value = null
}
function closeAssetBrowserOutside(event: PointerEvent) {
  if (!assetStrip.value?.contains(event.target as Node)) assetBrowserOpen.value = false
}
function closeAssetMenuOnEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') { assetMenu.value = null; assetBrowserOpen.value = false }
}
function onAssetGridScroll(event: Event) {
  assetGridScrollTop.value = (event.currentTarget as HTMLElement).scrollTop
  assetMenu.value = null
}
function updateAssetGridSize() {
  const element = assetGridViewport.value
  if (element && element.clientWidth > 0 && element.clientHeight > 0)
    assetGridSize.value = { width: element.clientWidth, height: element.clientHeight }
}
function warnBeforeUnload(event: BeforeUnloadEvent) {
  if (!hasUnsavedChanges.value) return
  event.preventDefault()
  event.returnValue = ''
}
function removeReference(path: string) {
  if (props.readonly) return
  const before = snapshot()
  references.value = references.value.filter(item => item.path !== path)
  if (activeInput.value === path) { activeInput.value = 'main'; tool.value = 'select'; viewZoom.value = 1 }
  commit(before)
}
function selectInput(path: string) {
  activeInput.value = path
  cancelCrop(); viewZoom.value = 1
  tool.value = path === 'main' ? 'select' : 'crop'
  scheduleRender()
}
watch(() => props.workspace?.id, () => {
  loadVersion++
  selectedPath.value = ''; doc.value = null; selectAnnotation()
  references.value = []; activeInput.value = 'main'; cancelCrop()
  activeWorkspaceId.value = ''; loading.value = false
  undoStack.value = []; redoStack.value = []
  savedSnapshot = ''; hasUnsavedChanges.value = false; hasSavedDraft.value = false
  query.value = ''
  recentPaths.value = props.workspace ? loadRecentAssets(props.workspace.id) : []
  assetBrowserOpen.value = false
  assetGridScrollTop.value = 0
  assetMenu.value = null
}, { immediate: true })
watch(assets, items => {
  if (selectedPath.value || loading.value || !items.length || !props.workspace) return
  let lastPath = ''
  try { lastPath = localStorage.getItem(lastAssetKey(props.workspace.id)) || '' } catch { /* No prior main image. */ }
  const previousMain = items.find(item => item.path === lastPath)
  if (previousMain) void chooseAsset(previousMain)
}, { immediate: true })
watch(() => props.assetInfo, scheduleRender)
watch(activeDoc, scheduleRender)
watch([query, assetGridColumns, () => filteredAssets.value.length], () => {
  assetGridScrollTop.value = 0
  if (assetGridViewport.value) assetGridViewport.value.scrollTop = 0
})
watch(tool, next => {
  dismissAnnotationCallout()
  if (next !== 'crop') cancelCrop()
  if (!['select', 'rect', 'arrow'].includes(next)) selectedGuideId.value = ''
  if (!['select', 'paint'].includes(next)) selectedPaintId.value = ''
  if (!['select', 'mask'].includes(next)) selectedMaskId.value = ''
})
watch(viewport, (element, previous) => {
  if (previous) resizeObserver?.unobserve(previous)
  if (!element) return
  resizeObserver ??= new ResizeObserver(() => {
    if (element.clientWidth > 28 && element.clientHeight > 28)
      viewportSize.value = { width: element.clientWidth, height: element.clientHeight }
  })
  resizeObserver.observe(element)
  if (element.clientWidth > 28 && element.clientHeight > 28)
    viewportSize.value = { width: element.clientWidth, height: element.clientHeight }
}, { flush: 'post' })
watch(assetGridViewport, (element, previous) => {
  if (previous) assetGridObserver?.unobserve(previous)
  if (!element) return
  assetGridObserver ??= new ResizeObserver(updateAssetGridSize)
  assetGridObserver.observe(element)
  updateAssetGridSize()
}, { flush: 'post' })
onMounted(() => {
  document.addEventListener('pointerdown', closeAssetMenu)
  document.addEventListener('pointerdown', closeAssetBrowserOutside)
  document.addEventListener('pointerdown', closeAnnotationCalloutOutside)
  document.addEventListener('keydown', closeAssetMenuOnEscape)
  window.addEventListener('beforeunload', warnBeforeUnload)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeAssetMenu)
  document.removeEventListener('pointerdown', closeAssetBrowserOutside)
  document.removeEventListener('pointerdown', closeAnnotationCalloutOutside)
  document.removeEventListener('keydown', closeAssetMenuOnEscape)
  window.removeEventListener('beforeunload', warnBeforeUnload)
  disposed = true; renderVersion++; loadVersion++
  resizeObserver?.disconnect()
  assetGridObserver?.disconnect()
  if (renderFrame !== undefined) cancelAnimationFrame(renderFrame)
})

function point(event: PointerEvent): StudioPoint {
  const bounds = canvas.value!.getBoundingClientRect(), current = activeDoc.value!
  return { x: Math.max(0, Math.min(current.width, (event.clientX - bounds.left) * current.width / bounds.width)),
    y: Math.max(0, Math.min(current.height, (event.clientY - bounds.top) * current.height / bounds.height)) }
}
function updateTransform() { cancelCrop(); draftRevision.value++; markChanged(); scheduleRender() }
function beginFieldEdit(event: Event) {
  const field = event.target
  if (!(field instanceof HTMLElement) || !field.matches('input:not([type=number]), select, textarea') || fieldSnapshots.has(field)) return
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
  const resized = scaleStudioDocument(JSON.parse(JSON.stringify(current)),
    which === 'width' ? size : current.width, which === 'height' ? size : current.height)
  if (activeInput.value === 'main') doc.value = resized
  else {
    const reference = references.value.find(item => item.path === activeInput.value)
    if (reference) reference.doc = resized
  }
  commit(before)
}
function setCropEdge(edge: 'left' | 'top' | 'right' | 'bottom', value: number) {
  const layer = activeImage.value
  if (!layer || props.readonly || !Number.isFinite(value)) return
  cancelCrop()
  const before = snapshot()
  const crop = layer.crop, part = Math.max(0, Math.min(1, value / 100))
  if (edge === 'left') { const right = crop.x + crop.width; crop.x = Math.min(part, right - .02); crop.width = right - crop.x }
  if (edge === 'right') crop.width = Math.max(.02, part - crop.x)
  if (edge === 'top') { const bottom = crop.y + crop.height; crop.y = Math.min(part, bottom - .02); crop.height = bottom - crop.y }
  if (edge === 'bottom') crop.height = Math.max(.02, part - crop.y)
  crop.width = Math.min(crop.width, 1 - crop.x); crop.height = Math.min(crop.height, 1 - crop.y)
  commit(before)
}
function resetTransform() {
  const layer = activeImage.value, current = activeDoc.value
  if (!layer || !current || props.readonly) return
  cancelCrop()
  const before = snapshot()
  layer.crop = { x: 0, y: 0, width: 1, height: 1 }
  layer.zoom = 1; layer.focusX = .5; layer.focusY = .5
  const size = sourceSizes.value[layer.path]
  layer.fit = size && Math.abs(current.width / current.height - size.width / size.height) > .01 ? 'contain' : 'cover'
  commit(before)
}
function applyCropSelection(selection: { x: number; y: number; width: number; height: number }) {
  const layer = activeImage.value, size = layer && sourceSizes.value[layer.path]
  if (!layer || !size || !activeDoc.value || selection.width < 10 || selection.height < 10) return
  const crop = layer.crop, sourceWidth = crop.width * size.width, sourceHeight = crop.height * size.height
  const zoom = layer.zoom, base = layer.fit === 'stretch' ? 1 : layer.fit === 'cover'
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
  if (right - left < .02 || bottom - top < .02) return
  layer.crop = { x: crop.x + crop.width * left, y: crop.y + crop.height * top,
    width: crop.width * (right - left), height: crop.height * (bottom - top) }
  layer.zoom = 1; layer.focusX = .5; layer.focusY = .5; layer.fit = 'cover'
  scheduleRender()
}
function confirmCrop() {
  if (!cropReady.value || !cropSelection.value || props.readonly) return
  const before = snapshot()
  applyCropSelection(cropSelection.value)
  cancelCrop()
  commit(before)
}
function cancelCrop() { cropSelection.value = null; cropReady.value = false }
async function wheelZoom(event: WheelEvent) {
  if (!activeDoc.value || !viewport.value || !canvas.value) return
  dismissAnnotationCallout()
  event.preventDefault()
  const before = canvas.value.getBoundingClientRect()
  const x = (event.clientX - before.left) / before.width, y = (event.clientY - before.top) / before.height
  viewZoom.value = Math.max(.25, Math.min(8, viewZoom.value * Math.exp(-Math.max(-120, Math.min(120, event.deltaY)) * .0015)))
  await nextTick()
  const after = canvas.value?.getBoundingClientRect(), area = viewport.value
  if (!after || !area) return
  area.scrollLeft += after.left + x * after.width - event.clientX
  area.scrollTop += after.top + y * after.height - event.clientY
  updateToolCursor(event)
}
function resetView() {
  viewZoom.value = 1
  if (viewport.value) { viewport.value.scrollLeft = 0; viewport.value.scrollTop = 0 }
}
function panDown(event: PointerEvent) {
  if (event.button !== 1 || !viewport.value || !activeDoc.value) return
  dismissAnnotationCallout()
  event.preventDefault()
  event.stopPropagation()
  panGesture = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
    scrollLeft: viewport.value.scrollLeft, scrollTop: viewport.value.scrollTop }
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
  if (viewport.value?.hasPointerCapture(event.pointerId)) viewport.value.releasePointerCapture(event.pointerId)
  panGesture = null
  panning.value = false
}
function strokeLayer(kind: 'paint' | 'mask'): StudioPaintLayer | StudioMaskLayer {
  const current = doc.value!
  if (kind === 'paint') {
    const layer = createPaintLayer(current.width, current.height)
    layer.color = paintColor.value
    const numbers = current.layers.filter(item => item.kind === 'paint').map(item => Number(/^涂抹 (\d+)$/.exec(item.name)?.[1] ?? 0))
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
function hitAnnotation(position: StudioPoint): StudioGuideLayer | StudioPaintLayer | StudioMaskLayer | undefined {
  const current = doc.value
  if (!current) return undefined
  const candidates = [...current.layers.filter(layer => layer.kind === 'guide' || layer.kind === 'paint').reverse(),
    ...current.layers.filter(layer => layer.kind === 'mask').reverse()]
  return candidates.find((layer): layer is StudioGuideLayer | StudioPaintLayer | StudioMaskLayer => {
    if (!studioLayerVisible(current, layer) || studioLayerLocked(current, layer)) return false
    if (layer.kind === 'paint' || layer.kind === 'mask') return studioMaskContainsPoint(layer, position, 5)
    return layer.kind === 'guide' && position.x >= layer.x - 8 && position.x <= layer.x + layer.width + 8 &&
      position.y >= layer.y - 8 && position.y <= layer.y + layer.height + 8
  })
}
function pointerDown(event: PointerEvent) {
  updateToolCursor(event)
  const mainDoc = doc.value
  if (!mainDoc || !activeDoc.value || props.readonly || event.button !== 0 || (activeInput.value !== 'main' && tool.value !== 'crop')) return
  event.preventDefault()
  showAnnotationCallout.value = false
  canvas.value?.setPointerCapture(event.pointerId)
  canvas.value?.focus()
  const start = point(event)
  gestureBefore = snapshot()
  if (tool.value === 'crop') {
    selectAnnotation()
    cropReady.value = false
    cropSelection.value = { x: start.x, y: start.y, width: 0, height: 0 }
    gesture = { kind: 'crop', start }
  } else if (tool.value === 'select') {
    const annotation = hitAnnotation(start)
    selectAnnotation(annotation)
    gesture = annotation ? { kind: 'move', id: annotation.id, start, x: annotation.x, y: annotation.y,
      bounds: annotation.kind === 'paint' || annotation.kind === 'mask' ? studioMaskPaintBounds(annotation) ?? undefined : undefined } : { kind: 'none' }
    movingSelection.value = !!annotation
  } else if (tool.value === 'rect' || tool.value === 'arrow') {
    const guide = createGuideLayer({ x: start.x, y: start.y, width: 1, height: 1 }, tool.value)
    guide.name = `${tool.value === 'rect' ? '提示框' : '箭头'} ${mainDoc.layers.filter(layer => layer.kind === 'guide' && layer.shape === tool.value).length + 1}`
    guide.color = guideColor.value; guide.strokeWidth = guideWidth.value
    mainDoc.layers.push(guide)
    selectAnnotation(guide)
    gesture = { kind: 'guide', id: guide.id, start }
  } else {
    const kind = tool.value === 'eraser' ? eraseTarget.value : tool.value
    const layers = tool.value === 'eraser'
      ? mainDoc.layers.filter((layer): layer is StudioPaintLayer | StudioMaskLayer => layer.kind === kind && layer.strokes.some(stroke => stroke.mode === 'paint'))
      : [strokeLayer(kind as 'paint' | 'mask')]
    const ids: string[] = []
    for (const layer of layers) {
      const local = studioMaskPoint(layer, start)
      if (!local) continue
      layer.strokes.push({ points: [local], size: brushSize.value, mode: tool.value === 'eraser' ? 'erase' : 'paint' })
      ids.push(layer.id)
    }
    const selected = tool.value === 'paint' || tool.value === 'mask'
      ? mainDoc.layers.find(layer => layer.id === ids[0]) : undefined
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
  if (active.kind === 'crop') {
    cropSelection.value = { x: Math.min(active.start.x, current.x), y: Math.min(active.start.y, current.y),
      width: Math.abs(current.x - active.start.x), height: Math.abs(current.y - active.start.y) }
  } else if (active.kind === 'guide') {
    const guide = doc.value.layers.find(layer => layer.id === active.id) as StudioGuideLayer | undefined
    if (!guide) return
    guide.x = Math.min(active.start.x, current.x); guide.y = Math.min(active.start.y, current.y)
    guide.width = Math.max(1, Math.abs(current.x - active.start.x))
    guide.height = Math.max(1, Math.abs(current.y - active.start.y))
    guide.flipX = current.x < active.start.x; guide.flipY = current.y < active.start.y
  } else if (active.kind === 'move') {
    const annotation = doc.value.layers.find(layer => layer.id === active.id)
    if (annotation?.kind !== 'guide' && annotation?.kind !== 'paint' && annotation?.kind !== 'mask') return
    if ((annotation.kind === 'paint' || annotation.kind === 'mask') && active.bounds) {
      annotation.x = Math.max(-active.bounds.x, Math.min(doc.value.width - active.bounds.x - active.bounds.width, active.x + current.x - active.start.x))
      annotation.y = Math.max(-active.bounds.y, Math.min(doc.value.height - active.bounds.y - active.bounds.height, active.y + current.y - active.start.y))
    } else {
      annotation.x = Math.max(0, Math.min(doc.value.width - annotation.width, active.x + current.x - active.start.x))
      annotation.y = Math.max(0, Math.min(doc.value.height - annotation.height, active.y + current.y - active.start.y))
    }
  } else if (active.kind === 'stroke') {
    for (const id of active.ids) {
      const layer = doc.value.layers.find(item => item.id === id) as StudioMaskLayer | StudioPaintLayer | undefined
      const local = layer && studioMaskPoint(layer, current)
      const stroke = layer?.strokes[layer.strokes.length - 1]
      if (!local || !stroke) continue
      const previous = stroke.points[stroke.points.length - 1]
      if (Math.hypot((local.x - previous.x) * layer.width, (local.y - previous.y) * layer.height) < 1) continue
      if (stroke.points.length >= 500) layer.strokes.push({ ...stroke, points: [previous, local] })
      else stroke.points.push(local)
    }
  }
  scheduleRender()
}
function pointerUp(event: PointerEvent) {
  if (!gesture || !doc.value) return
  if (canvas.value?.hasPointerCapture(event.pointerId)) canvas.value.releasePointerCapture(event.pointerId)
  const active = gesture
  movingSelection.value = false
  if (active.kind === 'crop') {
    if (!cropSelection.value || cropSelection.value.width < 10 || cropSelection.value.height < 10) cancelCrop()
    else cropReady.value = true
  } else if (active.kind === 'guide') {
    const guide = doc.value.layers.find(layer => layer.id === active.id) as StudioGuideLayer | undefined
    if (guide && Math.hypot(guide.width, guide.height) < 10) {
      doc.value.layers = doc.value.layers.filter(layer => layer.id !== guide.id)
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
  doc.value.layers = doc.value.layers.filter(layer => layer.id !== id)
  if (selectedAnnotationId.value === id) selectAnnotation()
  commit(before)
}
function updateGuide() { draftRevision.value++; markChanged(); scheduleRender() }
function updatePrompt() { draftRevision.value++; markChanged() }
function keydown(event: KeyboardEvent) {
  const modifier = event.ctrlKey || event.metaKey
  const key = event.key.toLowerCase()
  if (modifier && key === 's') {
    event.preventDefault(); saveDraft(); return
  }
  if (event.key === 'Escape' && cropReady.value) { event.preventDefault(); cancelCrop(); return }
  if (event.key === 'Escape' && showAnnotationCallout.value) {
    event.preventDefault(); event.stopPropagation(); dismissAnnotationCallout(); canvas.value?.focus(); return
  }
  if (event.key === 'Enter' && cropReady.value && !(event.target instanceof HTMLInputElement)) { event.preventDefault(); confirmCrop(); return }
  const target = event.target
  if (!modifier && !event.altKey && key === 'v' && !gesture &&
      !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement ||
        target instanceof HTMLElement && target.isContentEditable)) {
    event.preventDefault()
    event.stopPropagation()
    dismissAnnotationCallout()
    tool.value = 'select'
    canvas.value?.focus()
    return
  }
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement && ['text', 'search'].includes(target.type) ||
      target instanceof HTMLElement && target.isContentEditable) return
  if (modifier && key === 'z') {
    event.preventDefault(); finishFieldEdit(event); if (event.shiftKey) redo(); else undo()
  } else if (modifier && key === 'y') {
    event.preventDefault(); finishFieldEdit(event); redo()
  } else if (event.key === 'Delete' && selectedAnnotationId.value) {
    event.preventDefault(); removeAnnotation(selectedAnnotationId.value)
  }
}
</script>

<template>
  <section class="ai-image-editor" tabindex="0" aria-label="AI 图片编辑工作台" @keydown="keydown">
    <div v-if="!workspace" class="editor-empty"><strong>先打开一项工作区</strong><span>图片编辑会直接使用当前工作区的图片素材。</span></div>
    <template v-else>
      <div ref="assetStrip" class="asset-picker"><div class="field-heading"><strong>素材</strong><span>{{ workspace.name }}</span></div>
          <div v-if="stripAssets.length" class="asset-list" aria-label="已加入和最近使用的素材"><button v-for="asset in stripAssets" :key="asset.path" type="button"
            :class="{ active: isActiveAsset(asset.path), main: doc && selectedPath === asset.path, referenced: references.some(item => item.path === asset.path), unassigned: !isAssignedAsset(asset.path) }"
            :aria-pressed="isAssignedAsset(asset.path) ? isActiveAsset(asset.path) : undefined"
            :title="isAssignedAsset(asset.path) ? `${assetRole(asset.path)}：点击切换，右键修改用途` : `${asset.name}：右键设置为主图或参考图`"
            @click="switchAsset(asset)" @contextmenu="openAssetMenu($event, asset)">
            <img :src="toImageThumbnailUrl(assetInfo[asset.path], '96x96')" alt="" loading="lazy" /><span class="asset-name">{{ asset.name }}</span><small v-if="assetRole(asset.path)" class="asset-role">{{ assetRole(asset.path) }}</small></button></div>
          <p v-else class="muted">当前工作区没有图片素材。</p>
          <button type="button" class="asset-browser-trigger" :aria-expanded="assetBrowserOpen" aria-controls="ai-asset-browser" @click="toggleAssetBrowser">全部素材 <span>{{ assets.length }}</span></button>
          <div v-if="assetBrowserOpen" id="ai-asset-browser" class="asset-browser" role="dialog" aria-label="浏览工作区图片">
            <div class="asset-browser-header"><strong>全部素材</strong><span>{{ filteredAssets.length }} / {{ assets.length }}</span><input ref="assetSearchInput" v-model="query" type="search" aria-label="搜索工作区图片" placeholder="搜索工作区图片" /><button type="button" aria-label="关闭素材浏览" title="关闭" @click="assetBrowserOpen = false">×</button></div>
            <div v-if="filteredAssets.length" ref="assetGridViewport" class="asset-grid-viewport" @scroll="onAssetGridScroll"><div class="asset-grid-spacer" :style="{ height: `${assetGridRows * ASSET_GRID_ROW_HEIGHT}px` }"><div class="asset-grid-window" :style="{ transform: `translateY(${assetGridStartRow * ASSET_GRID_ROW_HEIGHT}px)`, gridTemplateColumns: `repeat(${assetGridColumns}, minmax(0, 1fr))` }">
              <div v-for="asset in visibleGridAssets" :key="asset.path" class="asset-grid-card" :class="{ active: isActiveAsset(asset.path), main: doc && selectedPath === asset.path, referenced: references.some(item => item.path === asset.path), unassigned: !isAssignedAsset(asset.path) }"><button type="button" class="asset-grid-main"
                :title="isAssignedAsset(asset.path) ? `${assetRole(asset.path)}：点击切换，右键修改用途` : `${asset.name}：右键设置为主图或参考图`"
                @click="switchBrowserAsset(asset)" @contextmenu="openAssetMenu($event, asset)"><img :src="toImageThumbnailUrl(assetInfo[asset.path], '96x96')" alt="" loading="lazy" /><span>{{ asset.name }}</span><small v-if="assetRole(asset.path)" class="asset-role">{{ assetRole(asset.path) }}</small></button></div>
            </div></div></div>
            <p v-else class="asset-browser-empty">{{ assets.length ? '没有匹配的图片。' : '当前工作区没有图片素材。' }}</p>
          </div>
          <div v-if="assetMenu" class="asset-context-menu" role="menu" :style="{ left: `${assetMenu.left}px`, top: `${assetMenu.top}px` }">
            <button type="button" role="menuitem" :disabled="selectedPath === assetMenu.asset.path" @click="chooseMenuMain">{{ selectedPath === assetMenu.asset.path ? '当前主图' : '设为主图' }}</button>
            <button v-if="references.some(item => item.path === assetMenu?.asset.path)" type="button" role="menuitem" :disabled="readonly" @click="removeMenuReference">移除参考图</button>
            <button v-else type="button" role="menuitem" :disabled="readonly || !doc || assetMenu.asset.path === selectedPath || references.length >= 13" @click="addMenuReference">添加为参考图</button>
          </div>
      </div>
    <div class="editor-layout">
      <div class="edit-panel">
        <header class="editor-header"><strong>图片编辑</strong><span>{{ activeInput === 'main' ? '主图' : references.find(item => item.path === activeInput)?.name }}</span>
          <span class="save-status" :class="{ unsaved: hasUnsavedChanges }" aria-live="polite">{{ hasUnsavedChanges ? '未保存修改' : hasSavedDraft ? '已保存到本机' : '尚无修改' }}</span>
          <button type="button" class="save-button" title="Ctrl+S" :disabled="readonly || !hasUnsavedChanges || cropReady" @click="saveDraft">保存草稿</button></header>
        <div class="edit-content">
        <template v-if="activeDoc && activeImage">
          <div class="tool-row" role="toolbar" aria-label="图片编辑工具">
            <template v-if="activeInput === 'main'"><button type="button" :class="{ active: tool === 'select' }" title="选择" aria-label="选择" aria-keyshortcuts="V" @click="tool = 'select'"><StudioToolIcon kind="hand" /></button>
              <button type="button" :class="{ active: tool === 'rect' }" title="提示框" aria-label="提示框" @click="tool = 'rect'"><BorderOutlined /></button>
              <button type="button" :class="{ active: tool === 'arrow' }" title="箭头" aria-label="箭头" @click="tool = 'arrow'"><StudioToolIcon kind="arrow" /></button>
              <button type="button" :class="{ active: tool === 'paint' }" title="涂抹" aria-label="涂抹" @click="tool = 'paint'"><StudioToolIcon kind="marker" /></button>
              <button type="button" :class="{ active: tool === 'mask' }" title="遮罩" aria-label="遮罩" @click="tool = 'mask'"><StudioToolIcon kind="mask" /></button>
              <button type="button" :class="{ active: tool === 'eraser' }" title="橡皮擦" aria-label="橡皮擦" @click="tool = 'eraser'"><StudioToolIcon kind="eraser" /></button></template>
            <button type="button" :class="{ active: tool === 'crop' }" title="裁剪" aria-label="裁剪" @click="tool = 'crop'"><StudioToolIcon kind="crop" /></button>
            <span class="tool-spacer" />
            <template v-if="activeInput === 'main'"><button type="button" :disabled="!undoStack.length" title="撤销" aria-label="撤销" @click="undo"><UndoOutlined /></button>
              <button type="button" :disabled="!redoStack.length" title="重做" aria-label="重做" @click="redo"><RedoOutlined /></button></template>
            <button type="button" class="fit-button" title="视图缩放，点击适应窗口；不影响 AI 输入" @click="resetView">视图 {{ Math.round(viewZoom * 100) }}%</button>
          </div>
          <div class="canvas-area">
          <div ref="viewport" class="image-viewport" :class="{ panning }" @wheel="wheelZoom" @pointerdown="panDown" @pointermove="panMove" @pointerup="panUp" @pointercancel="panUp" @auxclick.middle.prevent><div class="viewport-track"><div class="image-surface" :style="{ width: `${displayWidth}px`, height: `${displayHeight}px` }">
            <canvas ref="canvas" tabindex="0" :style="{ width: `${displayWidth}px`, height: `${displayHeight}px`, cursor: canvasCursor }" aria-label="图片编辑区域"
              @pointerdown="pointerDown" @pointerenter="updateToolCursor" @pointermove="pointerMove" @pointerleave="toolCursorPosition = null" @pointerup="pointerUp" @pointercancel="pointerUp" />
            <div v-if="toolCursorVisible && toolCursorPosition && (tool === 'paint' || tool === 'mask' || tool === 'eraser')" class="brush-cursor" :class="`brush-cursor-${tool}`" :style="{ left: `${toolCursorPosition.x}px`, top: `${toolCursorPosition.y}px`, width: `${brushCursorSize}px`, height: `${brushCursorSize}px`, borderColor: tool === 'paint' ? paintColor : undefined }" aria-hidden="true" />
            <svg v-if="toolCursorVisible && toolCursorPosition && (tool === 'rect' || tool === 'arrow')" class="guide-cursor" :style="{ left: `${toolCursorPosition.x}px`, top: `${toolCursorPosition.y}px` }" :width="guideCursorExtent" :height="guideCursorExtent" :viewBox="`0 0 ${guideCursorExtent} ${guideCursorExtent}`" aria-hidden="true">
              <rect v-if="tool === 'rect'" :x="guideCursorStroke / 2 + 3" :y="guideCursorStroke / 2 + 3" :width="guideCursorExtent - guideCursorStroke - 6" :height="guideCursorExtent - guideCursorStroke - 6" fill="none" :stroke="guideColor" :stroke-width="guideCursorStroke" />
              <path v-else :d="`M ${guideCursorExtent * .23} ${guideCursorExtent * .77} L ${guideCursorExtent * .77} ${guideCursorExtent * .23} M ${guideCursorExtent * .48} ${guideCursorExtent * .23} L ${guideCursorExtent * .77} ${guideCursorExtent * .23} L ${guideCursorExtent * .77} ${guideCursorExtent * .52}`" fill="none" :stroke="guideColor" :stroke-width="guideCursorStroke" stroke-linecap="round" stroke-linejoin="round" />
              <circle :cx="guideCursorExtent / 2" :cy="guideCursorExtent / 2" r="2" fill="#fff" stroke="#26384c" stroke-width="1" />
            </svg>
            <div v-if="selectionFrame" class="selection-outline" :style="{ left: `${selectionFrame.x / activeDoc.width * 100}%`, top: `${selectionFrame.y / activeDoc.height * 100}%`, width: `${selectionFrame.width / activeDoc.width * 100}%`, height: `${selectionFrame.height / activeDoc.height * 100}%` }" aria-hidden="true"><i v-for="corner in 4" :key="corner" /></div>
            <div v-if="showAnnotationCallout && selectedAnnotationLayer && promptCalloutStyle" ref="annotationCallout" class="annotation-callout" :class="{ 'on-left': promptCalloutOnLeft }" :style="promptCalloutStyle" @pointerdown.stop @wheel.stop @focusin="beginFieldEdit" @keydown.capture="beginFieldEdit" @change="finishFieldEdit" @focusout="finishFieldEdit">
              <div class="annotation-callout-heading"><strong>{{ selectedAnnotationLayer.kind === 'mask' ? '遮罩' : selectedAnnotationLayer.name }}</strong><div class="annotation-callout-actions"><button type="button" :aria-label="`删除${selectedAnnotationLayer.name}`" title="删除" :disabled="readonly" @click="removeAnnotation(selectedAnnotationLayer.id)"><DeleteOutlined /></button><button type="button" aria-label="收起批注" title="收起批注" @click="dismissAnnotationCallout"><CloseOutlined /></button></div></div>
              <textarea v-if="selectedAnnotationLayer.kind !== 'mask'" v-model="selectedAnnotationLayer.prompt" :aria-label="`${selectedAnnotationLayer.name}的说明`" :disabled="readonly" maxlength="500" rows="3" placeholder="添加说明" @input="updatePrompt" />
              <div class="annotation-callout-fields"><label>颜色 <input v-model="selectedAnnotationLayer.color" type="color" :disabled="readonly" @input="updateGuide" /></label><label v-if="selectedAnnotationLayer.kind === 'guide'">粗细 <input v-model.number="selectedAnnotationLayer.strokeWidth" type="range" min="1" max="24" :disabled="readonly" @input="updateGuide" /><span>{{ selectedAnnotationLayer.strokeWidth }} px</span></label><span v-else>{{ selectedAnnotationLayer.strokes.length }} 笔</span></div>
            </div>
            <div v-if="cropSelection" class="crop-selection" :style="{ left: `${cropSelection.x / activeDoc.width * 100}%`, top: `${cropSelection.y / activeDoc.height * 100}%`, width: `${cropSelection.width / activeDoc.width * 100}%`, height: `${cropSelection.height / activeDoc.height * 100}%` }" />
          </div></div></div>
          <div class="canvas-settings edit-controls" @pointerdown.capture="beginFieldEdit" @focusin="beginFieldEdit" @keydown.capture="beginFieldEdit" @change="finishFieldEdit" @focusout="finishFieldEdit">
            <div class="canvas-settings-heading"><strong>图像设置</strong><button type="button" :disabled="readonly" @click="resetTransform">重置图像</button></div>
            <div class="transform-controls">
              <label>宽 <input type="number" min="1" max="2048" :disabled="readonly" :value="activeDoc.width" @change="resizeActive('width', Number(($event.target as HTMLInputElement).value))" /></label>
              <label>高 <input type="number" min="1" max="2048" :disabled="readonly" :value="activeDoc.height" @change="resizeActive('height', Number(($event.target as HTMLInputElement).value))" /></label>
              <label>填充 <select v-model="activeImage.fit" :disabled="readonly" @change="updateTransform"><option value="cover">铺满</option><option value="contain">完整显示</option><option value="stretch">拉伸</option></select></label>
              <label class="zoom-control" title="改变合成图中的图片大小，影响实际 AI 输入；原始素材不会修改">内容缩放 <input v-model.number="activeImage.zoom" type="range" min="1" max="8" step="0.05" :disabled="readonly" @input="updateTransform" /><span>{{ Math.round(activeImage.zoom * 100) }}%</span></label>
            </div>
            <div class="crop-grid direct-crop"><label>左 <span class="percent-input"><input type="number" min="0" max="98" aria-label="左边界，百分比" :disabled="readonly" :value="Math.round(activeImage.crop.x * 100)" @change="setCropEdge('left', Number(($event.target as HTMLInputElement).value))" /><span aria-hidden="true">%</span></span></label>
              <label>上 <span class="percent-input"><input type="number" min="0" max="98" aria-label="上边界，百分比" :disabled="readonly" :value="Math.round(activeImage.crop.y * 100)" @change="setCropEdge('top', Number(($event.target as HTMLInputElement).value))" /><span aria-hidden="true">%</span></span></label>
              <label>右 <span class="percent-input"><input type="number" min="2" max="100" aria-label="右边界，百分比" :disabled="readonly" :value="Math.round((activeImage.crop.x + activeImage.crop.width) * 100)" @change="setCropEdge('right', Number(($event.target as HTMLInputElement).value))" /><span aria-hidden="true">%</span></span></label>
              <label>下 <span class="percent-input"><input type="number" min="2" max="100" aria-label="下边界，百分比" :disabled="readonly" :value="Math.round((activeImage.crop.y + activeImage.crop.height) * 100)" @change="setCropEdge('bottom', Number(($event.target as HTMLInputElement).value))" /><span aria-hidden="true">%</span></span></label></div>
          </div>
          <div v-if="cropReady || activeImage.zoom > 1 || (activeInput === 'main' && !['select', 'crop'].includes(tool))" class="floating-panels" @pointerdown.capture="beginFieldEdit" @focusin="beginFieldEdit" @keydown.capture="beginFieldEdit" @change="finishFieldEdit" @focusout="finishFieldEdit">
            <div class="tool-settings floating-panel">
              <div v-if="cropReady" class="crop-actions"><strong>裁剪待确认</strong><button type="button" class="apply-crop" :disabled="readonly" @click="confirmCrop">应用裁剪</button><button type="button" @click="cancelCrop">取消</button></div>
              <div v-if="activeImage.zoom > 1" class="context-controls"><label>水平位置 <input v-model.number="activeImage.focusX" type="range" min="0" max="1" step="0.01" :disabled="readonly" @input="updateTransform" /></label>
                <label>垂直位置 <input v-model.number="activeImage.focusY" type="range" min="0" max="1" step="0.01" :disabled="readonly" @input="updateTransform" /></label></div>
              <div v-if="activeInput === 'main' && !['select', 'crop'].includes(tool)" class="context-controls">
                <template v-if="tool === 'rect' || tool === 'arrow'"><label>标注颜色 <input v-model="guideColor" type="color" :disabled="readonly" /></label><label>线条粗细 <input v-model.number="guideWidth" type="range" min="1" max="24" :disabled="readonly" /><span>{{ guideWidth }} px</span></label></template>
                <label v-if="tool === 'paint'">涂抹颜色 <input v-model="paintColor" type="color" :disabled="readonly" /></label>
                <label v-if="tool === 'paint' || tool === 'mask' || tool === 'eraser'">画笔粗细 <input v-model.number="brushSize" type="range" min="2" max="200" :disabled="readonly" /><span>{{ brushSize }} px</span></label>
                <div v-if="tool === 'eraser'" class="erase-target" role="group" aria-label="擦除对象"><span>擦除对象</span><div class="erase-target-toggle"><button type="button" :class="{ active: eraseTarget === 'paint' }" :aria-pressed="eraseTarget === 'paint'" :disabled="readonly" @click="eraseTarget = 'paint'">涂抹</button><button type="button" :class="{ active: eraseTarget === 'mask' }" :aria-pressed="eraseTarget === 'mask'" :disabled="readonly" @click="eraseTarget = 'mask'">遮罩</button></div></div>
              </div>
            </div>
          </div>
          </div>
          <p v-if="storageError" class="editor-error" role="alert">{{ storageError }}</p>
          <p v-if="renderError" class="editor-error" role="alert">{{ renderError }}</p>
        </template>
        <div v-else class="editor-empty"><strong>{{ loading ? '正在载入图片…' : '右键素材并设为主图，开始编辑' }}</strong></div>
        </div>
      </div>
      <AIImageProcess :doc="doc" :reference-inputs="references" :asset-info="assetInfo" :workspace-id="workspace?.id" :render-error="renderError" :revision="draftRevision" :readonly="readonly" @artifact-saved="emit('artifactSaved')" />
    </div>
    </template>
  </section>
</template>

<style scoped>
.ai-image-editor{min-width:0;color:var(--ui-text);outline:none}.editor-layout{display:grid;grid-template-columns:minmax(0,46%) minmax(0,54%);gap:10px}.edit-panel{display:flex;flex-direction:column;min-width:0;height:calc(100vh - 178px);min-height:530px;overflow:hidden;border:1px solid var(--ui-border);border-radius:10px;background:var(--ui-surface)}.edit-scroll{flex:1;min-height:0;overflow-y:auto}.editor-header,.field-heading{display:flex;align-items:baseline;gap:8px}.editor-header{flex:none;padding:14px 16px;border-bottom:1px solid var(--ui-border)}.editor-header strong{font-size:15px}.editor-header span,.field-heading span,.muted,.canvas-help,.editor-empty span{color:var(--ui-muted);font-size:11px}.asset-picker,.edit-settings,.references-panel{padding:12px 15px;border-bottom:1px solid var(--ui-border)}.field-heading strong{font-size:12px}.field-heading button{margin-left:auto;border:0;background:transparent;color:var(--primary-color);cursor:pointer;font-size:11px}.field-heading button:disabled{opacity:.45;cursor:default}.asset-picker>input,.reference-picker>input{width:100%;box-sizing:border-box;margin-top:8px;padding:7px;border:1px solid var(--ui-border);border-radius:6px;background:var(--ui-surface);color:var(--ui-text)}.asset-list{display:flex;gap:6px;overflow-x:auto;margin-top:8px}.asset-list button{display:flex;align-items:center;gap:6px;max-width:150px;flex:none;padding:4px 6px;border:1px solid var(--ui-border);border-radius:6px;background:var(--ui-surface);color:var(--ui-text);text-align:left;cursor:pointer}.asset-list button.active{border-color:var(--primary-color);background:var(--primary-color-1)}.asset-list img,.reference-picker img{width:32px;height:32px;flex:none;object-fit:cover;border-radius:4px}.asset-list span,.reference-picker span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.tool-row{display:flex;align-items:center;gap:4px;padding:8px;border-bottom:1px solid var(--ui-border);overflow-x:auto}.tool-row button{display:grid;place-items:center;min-width:30px;height:30px;flex:none;padding:0 5px;border:1px solid var(--ui-border);border-radius:6px;background:var(--ui-surface);color:var(--ui-text);cursor:pointer;font-size:11px}.tool-row button.active{color:var(--primary-color);border-color:var(--primary-color);background:var(--primary-color-1)}.tool-row button:disabled{opacity:.4;cursor:default}.tool-spacer{flex:1}.tool-row .fit-button{min-width:43px}.image-viewport{height:clamp(300px,50vh,520px);overflow:auto;background:var(--ui-surface-soft);overscroll-behavior:contain}.viewport-track{display:grid;place-items:center;width:max-content;height:max-content;min-width:100%;min-height:100%;padding:14px;box-sizing:border-box}.image-surface{position:relative;flex:none;box-shadow:0 5px 19px #0002}.image-surface canvas{display:block;touch-action:none;cursor:crosshair}.image-surface canvas.movable{cursor:default}.crop-selection{position:absolute;box-sizing:border-box;border:2px dashed #1473c8;background:#1473c822;pointer-events:none}.canvas-help{margin:0;padding:8px 12px;border-bottom:1px solid var(--ui-border);text-align:center}.edit-settings{display:flex;flex-direction:column;gap:10px}.edit-settings label{display:flex;flex-direction:column;gap:5px;min-width:0;color:var(--ui-muted);font-size:11px}.edit-settings label>span{align-self:flex-end}.edit-settings input:not([type=color]):not([type=range]),.edit-settings textarea,.edit-settings select{width:100%;box-sizing:border-box;border:1px solid var(--ui-border);border-radius:6px;background:var(--ui-surface);color:var(--ui-text);padding:7px;font:inherit;font-size:12px}.edit-settings input[type=color]{width:44px;height:28px;padding:2px;border:1px solid var(--ui-border);border-radius:5px;background:var(--ui-surface)}.setting-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.crop-heading{display:flex;align-items:center;justify-content:space-between;padding-top:5px;border-top:1px solid var(--ui-border);font-size:11px}.crop-heading button,.object-settings button{border:1px solid var(--ui-border);border-radius:6px;background:var(--ui-surface);color:var(--ui-text);padding:5px 7px;cursor:pointer;font-size:11px}.crop-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.annotation-heading{padding-top:9px;border-top:1px solid var(--ui-border)}.object-settings{display:flex;flex-direction:column;gap:9px;padding-top:11px;border-top:1px solid var(--ui-border)}.object-settings>strong{font-size:12px}.object-settings>span{color:var(--ui-muted);font-size:11px}.object-settings button{align-self:flex-start}.references-panel{flex:none;border-top:1px solid var(--ui-border);border-bottom:0}.reference-picker{margin-top:9px;padding:8px;border:1px solid var(--ui-border);border-radius:6px}.reference-picker>div{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;max-height:180px;overflow:auto;margin-top:8px}.reference-picker button{display:flex;align-items:center;gap:6px;min-width:0;border:1px solid var(--ui-border);border-radius:5px;background:var(--ui-surface);color:var(--ui-text);padding:4px;cursor:pointer}.editor-empty{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:7px;min-height:240px;text-align:center}.editor-error{margin:8px 0;color:#b42318;font-size:11px}@media(max-width:1020px){.editor-layout{grid-template-columns:1fr}.edit-panel{height:min(760px,calc(100vh - 178px));min-height:480px}.image-viewport{height:440px}}@media(max-width:540px){.image-viewport{height:350px}.crop-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
.edit-panel{min-height:440px}
.asset-picker{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:12px;margin-bottom:10px;padding:10px 14px;border:1px solid var(--ui-border);border-radius:10px;background:var(--ui-surface)}
.asset-list{min-width:0;margin-top:0}
.asset-picker .muted{margin:0}
.editor-layout{grid-template-columns:minmax(0,58fr) minmax(0,42fr)}
.editor-layout .edit-panel{height:calc(100vh - 260px)}
.editor-layout :deep(.ai-image-process){max-height:calc(100vh - 260px)}
.image-viewport{overscroll-behavior:auto}
.image-viewport.panning,.image-viewport.panning canvas{cursor:grabbing!important}
@media(max-width:1020px){.editor-layout{grid-template-columns:1fr}.editor-layout .edit-panel{height:min(760px,calc(100vh - 260px))}.editor-layout :deep(.ai-image-process){max-height:none}}
@media(max-width:850px){.asset-picker{grid-template-columns:minmax(0,1fr) auto}.asset-list,.asset-picker .muted{grid-column:1/-1;grid-row:2}}
.asset-picker{position:relative}
.asset-list button{max-width:190px}
.asset-list .asset-name{flex:1;min-width:0}
.asset-role{flex:none;padding:2px 4px;border-radius:4px;background:var(--primary-color-1);color:var(--primary-color);font-size:10px;white-space:nowrap}
.asset-list button.unassigned,.asset-grid-card.unassigned .asset-grid-main{cursor:context-menu}
.asset-list button.referenced:not(.active){border-color:var(--primary-color);border-style:dashed}
.asset-browser-trigger{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;padding:7px 9px;border:1px solid var(--ui-border);border-radius:6px;background:var(--ui-surface);color:var(--ui-text);cursor:pointer;font-size:11px}
.asset-browser-trigger:hover,.asset-browser-trigger[aria-expanded=true]{border-color:var(--primary-color);color:var(--primary-color);background:var(--primary-color-1)}
.asset-browser-trigger span{color:var(--ui-muted)}
.asset-browser{position:absolute;z-index:25;top:calc(100% + 6px);left:0;right:0;box-sizing:border-box;padding:12px;border:1px solid var(--ui-border);border-radius:10px;background:var(--ui-surface);box-shadow:0 12px 32px #0003}
.asset-browser-header{display:grid;grid-template-columns:auto auto minmax(160px,1fr) auto;align-items:center;gap:10px;margin-bottom:10px}
.asset-browser-header strong{font-size:12px}
.asset-browser-header>span{color:var(--ui-muted);font-size:11px;white-space:nowrap}
.asset-browser-header input{min-width:0;box-sizing:border-box;padding:7px 9px;border:1px solid var(--ui-border);border-radius:6px;background:var(--ui-surface);color:var(--ui-text);font:inherit;font-size:12px}
.asset-browser-header button{width:28px;height:28px;padding:0;border:0;border-radius:5px;background:transparent;color:var(--ui-muted);cursor:pointer;font-size:20px;line-height:1}
.asset-browser-header button:hover{background:var(--primary-color-1);color:var(--primary-color)}
.asset-grid-viewport{height:min(350px,45vh);overflow-y:auto;overscroll-behavior:contain}
.asset-grid-spacer{position:relative;min-height:100%}
.asset-grid-window{position:absolute;top:0;left:0;right:0;display:grid;grid-auto-rows:122px;gap:8px}
.asset-grid-card{display:flex;flex-direction:column;min-width:0;overflow:hidden;border:1px solid var(--ui-border);border-radius:7px;background:var(--ui-surface)}
.asset-grid-card.active{border-color:var(--primary-color);background:var(--primary-color-1)}
.asset-grid-card.referenced:not(.active){border-color:var(--primary-color);border-style:dashed}
.asset-grid-main{display:flex;align-items:center;flex:1;flex-direction:column;gap:5px;min-width:0;padding:6px 6px 3px;border:0;background:transparent;color:var(--ui-text);cursor:pointer}
.asset-grid-main img{width:66px;height:66px;flex:none;object-fit:cover;border-radius:4px}
.asset-grid-main span{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}
.asset-grid-main .asset-role{margin-top:auto}
.asset-browser-empty{margin:0;padding:30px 10px;color:var(--ui-muted);text-align:center;font-size:12px}
@media(max-width:540px){.asset-browser-header{grid-template-columns:auto auto 1fr auto;gap:6px}.asset-browser-header input{grid-column:1/-1;grid-row:2}}
.asset-context-menu{position:absolute;z-index:30;display:flex;flex-direction:column;min-width:164px;padding:4px;border:1px solid var(--ui-border);border-radius:8px;background:var(--ui-surface);box-shadow:0 8px 24px #0002}
.asset-context-menu button{padding:8px 10px;border:0;border-radius:5px;background:transparent;color:var(--ui-text);text-align:left;cursor:pointer;font-size:12px}
.asset-context-menu button:hover:not(:disabled){background:var(--primary-color-1);color:var(--primary-color)}
.asset-context-menu button:disabled{opacity:.45;cursor:default}
.editor-layout .edit-panel{height:auto;min-height:0}
.edit-content{min-width:0}
.editor-header{align-items:center;min-height:50px;box-sizing:border-box;gap:8px;padding:9px 12px}
.editor-header>span:nth-child(2){overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.editor-header .save-status{margin-left:auto;white-space:nowrap;color:#16844a}
.editor-header .save-status.unsaved{color:#b45309}
.editor-header .save-button{flex:none;padding:6px 9px;border:1px solid var(--primary-color);border-radius:6px;background:var(--primary-color);color:#fff;cursor:pointer;font-size:11px}
.editor-header .save-button:disabled{opacity:.45;cursor:default}
.edit-controls{display:flex;flex-direction:column;gap:7px;padding:9px 10px;border-bottom:1px solid var(--ui-border)}
.tool-settings{display:flex;flex-direction:column;gap:7px;max-height:240px;overflow-y:auto;padding:9px 10px}
.tool-settings>.context-controls{min-height:30px}
.crop-actions{display:flex;align-items:center;gap:8px;padding:5px 7px;border:1px solid var(--primary-color);border-radius:6px;background:var(--primary-color-1)}
.crop-actions strong{margin-right:auto;color:var(--primary-color);font-size:11px}
.crop-actions .apply-crop{border-color:var(--primary-color);background:var(--primary-color);color:#fff}
.transform-controls,.context-controls{display:flex;align-items:center;flex-wrap:wrap;gap:7px 12px}
.transform-controls{gap:6px}
.edit-controls label,.tool-settings label{display:inline-flex;align-items:center;gap:5px;min-width:0;color:var(--ui-muted);font-size:11px;white-space:nowrap}
.edit-controls input[type=number],.edit-controls input:not([type=range]):not([type=color]),.edit-controls select,.edit-controls textarea,.tool-settings input[type=number],.tool-settings input:not([type=range]):not([type=color]),.tool-settings select,.tool-settings textarea{box-sizing:border-box;min-width:0;padding:5px 6px;border:1px solid var(--ui-border);border-radius:5px;background:var(--ui-surface);color:var(--ui-text);font:inherit;font-size:11px}
.edit-controls input[type=number],.tool-settings input[type=number]{width:57px}
.edit-controls select,.tool-settings select{max-width:96px}
.edit-controls input[type=range],.tool-settings input[type=range]{width:78px;margin:0;accent-color:var(--primary-color)}
.edit-controls input[type=color],.tool-settings input[type=color]{width:30px;height:25px;padding:2px;border:1px solid var(--ui-border);border-radius:5px;background:var(--ui-surface)}
.edit-controls button,.tool-settings button{flex:none;padding:5px 7px;border:1px solid var(--ui-border);border-radius:5px;background:var(--ui-surface);color:var(--ui-text);cursor:pointer;font-size:11px}
.edit-controls button:disabled,.tool-settings button:disabled{opacity:.45;cursor:default}
.erase-target{display:inline-flex;align-items:center;gap:6px;color:var(--ui-muted);font-size:11px;white-space:nowrap}
.erase-target-toggle{display:inline-flex;align-items:center;gap:2px;padding:2px;border:1px solid var(--ui-border);border-radius:6px;background:var(--ui-surface-soft)}
.tool-settings .erase-target-toggle button{padding:4px 8px;border:0;border-radius:4px;background:transparent}
.tool-settings .erase-target-toggle button.active{background:var(--primary-color);color:#fff}
.direct-crop{gap:6px}
.direct-crop label{min-width:0}
.direct-crop .percent-input{position:relative;display:inline-flex;align-items:center}
.direct-crop .percent-input input{padding-right:30px;appearance:auto}
.direct-crop .percent-input>span{position:absolute;right:20px;color:var(--ui-muted);pointer-events:none;font-size:11px}
.edit-controls .zoom-control span,.context-controls label span{min-width:30px;color:var(--ui-text);text-align:right}
.image-viewport{height:clamp(540px,72vh,900px);overflow:hidden;overscroll-behavior:auto}
.image-viewport:hover{outline:2px solid color-mix(in srgb,var(--primary-color) 38%,transparent);outline-offset:-2px}
.image-viewport:hover .image-surface{box-shadow:0 0 0 2px color-mix(in srgb,var(--primary-color) 30%,transparent),0 5px 19px #0002}
.canvas-area{display:grid;grid-template-rows:auto auto;min-width:0;container-type:inline-size}
.canvas-settings{position:relative;grid-row:1;grid-column:1;box-sizing:border-box;margin:8px 10px 10px;border:1px solid var(--ui-border);border-radius:10px;background:var(--ui-surface)}
.canvas-settings-heading{display:flex;align-items:center;justify-content:space-between;min-height:25px;gap:8px}
.canvas-settings-heading strong{font-size:12px}
.canvas-settings .transform-controls,.canvas-settings .direct-crop{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));align-items:center;gap:6px}
.canvas-settings .transform-controls label,.canvas-settings .direct-crop label{display:flex;width:100%;min-width:0}
.canvas-settings .transform-controls input[type=number],.canvas-settings .transform-controls select,.canvas-settings .transform-controls input[type=range]{width:100%;max-width:none;flex:1}
.canvas-settings .direct-crop .percent-input{flex:1;min-width:0}
.canvas-settings .direct-crop .percent-input input{width:100%}
.canvas-settings .zoom-control span{flex:none}
.canvas-settings .direct-crop{padding-top:6px;border-top:1px solid var(--ui-border)}
.canvas-area>.image-viewport{grid-row:2;grid-column:1;min-width:0}
.canvas-area>.floating-panels{z-index:3;grid-row:2;grid-column:1;align-self:start;justify-self:start;box-sizing:border-box;margin:10px;max-width:calc(100% - 20px);pointer-events:none}
.floating-panel{box-sizing:border-box;max-width:100%;border:1px solid var(--ui-border);border-radius:8px;background:var(--ui-surface);box-shadow:0 8px 24px #0002;pointer-events:auto}
@container (max-width:450px){.canvas-settings .transform-controls,.canvas-settings .direct-crop{grid-template-columns:repeat(2,minmax(0,1fr))}}
.selection-outline{position:absolute;box-sizing:border-box;border:1px solid var(--primary-color);box-shadow:0 0 0 1px #fff;pointer-events:none}
.selection-outline i{position:absolute;width:7px;height:7px;box-sizing:border-box;border:1px solid var(--primary-color);background:#fff}
.selection-outline i:nth-child(1){top:-4px;left:-4px}
.selection-outline i:nth-child(2){top:-4px;right:-4px}
.selection-outline i:nth-child(3){bottom:-4px;right:-4px}
.selection-outline i:nth-child(4){bottom:-4px;left:-4px}
.brush-cursor{position:absolute;z-index:4;box-sizing:border-box;transform:translate(-50%,-50%);border:1.5px solid #555;border-radius:50%;box-shadow:0 0 0 1px #fff,0 0 3px #0008;pointer-events:none}
.guide-cursor{position:absolute;z-index:4;transform:translate(-50%,-50%);filter:drop-shadow(0 0 1px #fff) drop-shadow(0 0 1px #fff);pointer-events:none}
.brush-cursor-mask{border-color:#555;background:#80808022}
.brush-cursor-eraser{border-style:dashed;border-color:#172b41;background:#fff4}
.annotation-callout{position:absolute;z-index:6;display:flex;flex-direction:column;gap:5px;box-sizing:border-box;width:216px;padding:9px;border:1px solid var(--primary-color);border-radius:8px;background:var(--ui-surface);box-shadow:0 6px 20px #0003;color:var(--ui-text);font-size:11px}
.annotation-callout::before{content:'';position:absolute;top:13px;left:-5px;width:8px;height:8px;transform:rotate(45deg);border-left:1px solid var(--primary-color);border-bottom:1px solid var(--primary-color);background:var(--ui-surface)}
.annotation-callout.on-left::before{left:auto;right:-5px;transform:rotate(225deg)}
.annotation-callout strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.annotation-callout textarea{box-sizing:border-box;width:100%;min-height:54px;resize:vertical;padding:6px;border:1px solid var(--ui-border);border-radius:5px;background:var(--ui-surface);color:var(--ui-text);font:inherit;line-height:1.4}
.annotation-callout-heading{display:flex;align-items:center;justify-content:space-between;gap:6px}
.annotation-callout-actions{display:flex;align-items:center;gap:2px}
.annotation-callout-heading button{display:grid;place-items:center;width:22px;height:22px;flex:none;padding:0;border:0;border-radius:4px;background:transparent;color:var(--ui-muted);cursor:pointer}
.annotation-callout-heading button:hover{background:var(--primary-color-1);color:var(--primary-color)}
.annotation-callout-heading button:disabled{opacity:.4;cursor:default}
.annotation-callout-fields{display:flex;align-items:center;gap:8px;color:var(--ui-muted)}
.annotation-callout-fields label{display:flex;align-items:center;gap:5px;white-space:nowrap}
.annotation-callout-fields input[type=color]{width:27px;height:24px;padding:2px;border:1px solid var(--ui-border);border-radius:4px;background:var(--ui-surface)}
.annotation-callout-fields input[type=range]{width:63px;margin:0;accent-color:var(--primary-color)}
.crop-selection{border:2px solid var(--primary-color);background:transparent;box-shadow:0 0 0 100vmax #0005}
.edit-content>.editor-error{padding:0 10px}
.editor-layout{align-items:stretch}
.editor-layout :deep(.ai-image-process){height:100%;min-height:0;max-height:none;box-sizing:border-box}
@media(max-width:1020px){.editor-layout .edit-panel{height:auto}}
@media(max-width:540px){.image-viewport{height:clamp(420px,65vh,650px)}}
</style>
