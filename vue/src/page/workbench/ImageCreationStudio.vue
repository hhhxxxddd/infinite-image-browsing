<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { BorderOutlined, EyeOutlined, EyeInvisibleOutlined, FolderOutlined, LockOutlined,
  UnlockOutlined, MoreOutlined, PictureOutlined, FontSizeOutlined, FolderAddOutlined,
  UndoOutlined, RedoOutlined, FileTextOutlined, UnorderedListOutlined,
  ControlOutlined, CloseOutlined } from '@ant-design/icons-vue'
import type { FileNodeInfo } from '@/api/files'
import { toImageThumbnailUrl } from '@/util/file'
import { useGlobalStore } from '@/store/useGlobalStore'
import { chooseLocalDirectory } from '@/api'
import { saveWorkspaceArtifact, syncWorkspaceArtifact } from '@/api/workspaceArtifacts'
import { aspectRatioPresets } from '@/util/aspectRatioPresets'
import type { WorkspaceAsset } from './workspaceModel'
import { imageLayouts, type ImageLayout } from './imageCreationModel'
import { applyStudioTemplate, cropStudioImage, createImageLayer,
  createStudioDocument, createStudioGroup, createTextLayer, legacyStudioKey, migrateImageDraft,
  moveStudioLayerToGroup, moveStudioLayersToGroup, readStudioDocument, readStudioIndex, reorderStudioGroup, reorderStudioLayer, scaleStudioDocument,
  studioDocumentKey, studioGroupBounds, studioIndexKey, studioLayerLocked, studioLayerVisible,
  type StudioCrop,
  type StudioDocument, type StudioDocumentIndex, type StudioGroup, type StudioLayer,
  type StudioTextLayer } from './imageStudioModel'
import { clearStudioImageCache, renderStudioDocument, studioImageDimensions,
  type StudioRenderScope } from './imageStudioRender'
import { studioFontFamily, studioFonts } from './imageStudioFonts.ts'
import { layoutStudioText } from './imageStudioText.ts'
import StudioRangeControl from './StudioRangeControl.vue'
import StudioAIHandoff from './StudioAIHandoff.vue'

const props = defineProps<{ workspaceId: string; workspaceName: string; assets: WorkspaceAsset[];
  assetInfo: Record<string, FileNodeInfo>; readonly?: boolean; noteDirty: boolean; noteSaving: boolean }>()
const global = useGlobalStore()
const note = defineModel<string>('note', { required: true })
const emit = defineEmits<{ addAssets: []; saveNote: []; artifactSaved: [] }>()
const imageAssets = computed(() => props.assets.filter(asset => asset.kind === 'image'))
const docs = ref<StudioDocumentIndex['docs']>([])
const draft = ref<StudioDocument>(createStudioDocument())
const selectedId = ref('')
const selectedIds = ref<string[]>([])
const selectedGroupId = ref('')
const selected = computed(() => draft.value.layers.find(layer => layer.id === selectedId.value))
const selectedGroup = computed(() => draft.value.groups.find(group => group.id === selectedGroupId.value))
const imageLayer = computed(() => selected.value?.kind === 'image' ? selected.value : undefined)
const textLayer = computed(() => selected.value?.kind === 'text' ? selected.value : undefined)
const panning = ref(false)
const inspectorTab = ref<'properties' | 'notes'>('properties')
const inspectorOpen = ref(false)
const layersOpen = ref(false)
const renameGroupOpen = ref(false)
const renameGroupId = ref('')
const renameGroupName = ref('')
const renameDraftOpen = ref(false)
const renameDraftName = ref('')
const renameDraftInput = ref<HTMLInputElement>()
const createGroupOpen = ref(false)
const createGroupName = ref('')
let layerClipboard: { workspaceId: string; layers: StudioLayer[]; group?: StudioGroup } | undefined
const canvasPresets = aspectRatioPresets.map(preset => ({ ...preset,
  canvasWidth: preset.width < preset.height ? 1080 : Math.round(1080 * preset.width / preset.height),
  canvasHeight: preset.width < preset.height ? Math.round(1080 * preset.height / preset.width) : 1080 }))
const canvas = ref<HTMLCanvasElement>()
const viewport = ref<HTMLElement>()
const board = ref<HTMLElement>()
const boardSize = ref({ width: 700, height: 600 })
const viewZoom = ref(1)
const fitScale = computed(() => Math.min(1, (boardSize.value.width - 48) / draft.value.width,
  (boardSize.value.height - 48) / draft.value.height))
const scale = computed(() => Math.max(.03, fitScale.value * viewZoom.value))
const panOffset = ref({ x: 0, y: 0 })
const boardStyle = computed(() => ({ width: draft.value.width * scale.value + 'px',
  height: draft.value.height * scale.value + 'px', transform: `translate(${panOffset.value.x}px, ${panOffset.value.y}px)` }))
const format = ref<'png' | 'jpeg'>('png')
const exporting = ref(false)
const saveArtifactOpen = ref(false)
const savingArtifact = ref(false)
const artifactName = ref('')
const syncToLibrary = ref(false)
const syncDirectory = ref('')
const aiOpen = ref(false)
const aiSnapshot = ref<StudioDocument | null>(null)
const aiScope = ref<StudioRenderScope>({ kind: 'all' })
const renderError = ref('')
const storageError = ref('')
const saveState = ref<'saving' | 'saved' | 'error'>('saving')
const savedAt = ref<number>()
const saveLabel = computed(() => saveState.value === 'saving' ? '正在保存草稿' :
  saveState.value === 'error' ? '草稿未保存' :
    `已保存到本机${savedAt.value ? ` · ${new Date(savedAt.value).toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit'})}` : ''}`)
const picker = ref(false)
const pickerMode = ref<'add' | 'replace'>('add')
const query = ref('')
const filteredAssets = computed(() => imageAssets.value.filter(asset => asset.name.toLowerCase().includes(query.value.toLowerCase())))
const menu = ref<{ x: number; y: number; kind: 'layer' | 'group' | 'blank' | 'asset'; id?: string; path?: string }>()
const contextGroup = computed(() => menu.value?.kind === 'group' ? draft.value.groups.find(group => group.id === menu.value?.id) : undefined)
const cropMode = ref(false)
const cropSelection = ref<StudioCrop>({ x: 0, y: 0, width: 1, height: 1 })
const cropBefore = ref('')
const editingText = ref(false)
const textInput = ref('')
const textArea = ref<HTMLTextAreaElement>()
const histories = new Map<string, { undo: string[]; redo: string[] }>()
const canUndo = ref(false), canRedo = ref(false)
let saveTimer: ReturnType<typeof setTimeout> | undefined
let previewFrame: number | undefined
let previewRunning = false
let previewQueued = false
let previewDisposed = false
let observer: ResizeObserver | undefined
let inspectorBefore = ''
let restoring = false
const snapshot = () => JSON.stringify(draft.value)
function withoutOldMarks(doc: StudioDocument) {
  const removedGroups = new Set(doc.layers.filter(layer => layer.kind !== 'image' && layer.kind !== 'text')
    .map(layer => layer.groupId).filter((id): id is string => !!id))
  doc.layers = doc.layers.filter(layer => layer.kind === 'image' || layer.kind === 'text')
  const retainedGroups = new Set(doc.layers.map(layer => layer.groupId))
  doc.groups = doc.groups.filter(group => !removedGroups.has(group.id) || retainedGroups.has(group.id))
  return doc
}
function history() {
  let item = histories.get(draft.value.id)
  if (!item) { item = { undo: [], redo: [] }; histories.set(draft.value.id, item) }
  return item
}
function refreshHistory() { canUndo.value = !!history().undo.length; canRedo.value = !!history().redo.length }
function record(before: string) {
  if (before === snapshot()) return
  const item = history(); item.undo.push(before); if (item.undo.length > 40) item.undo.shift()
  item.redo = []; refreshHistory()
}
function change(fn: () => void) { if (props.readonly) return; const before = snapshot(); fn(); record(before) }
watch(selectedId, id => { selectedIds.value = id ? [id] : [] }, { flush: 'sync' })
function undo() { const item = history(), old = item.undo.pop(); if (!old) return
  item.redo.push(snapshot()); draft.value = withoutOldMarks(readStudioDocument(JSON.parse(old)) ?? draft.value); refreshHistory() }
function redo() { const item = history(), next = item.redo.pop(); if (!next) return
  item.undo.push(snapshot()); draft.value = withoutOldMarks(readStudioDocument(JSON.parse(next)) ?? draft.value); refreshHistory() }
function persist() {
  if (!props.workspaceId || restoring) return
  try {
    const updatedAt = new Date().toISOString()
    const meta = { id: draft.value.id, name: draft.value.name, updatedAt }
    docs.value = docs.value.some(item => item.id === meta.id) ? docs.value.map(item => item.id === meta.id ? meta : item) : [...docs.value, meta]
    localStorage.setItem(studioDocumentKey(props.workspaceId, draft.value.id), JSON.stringify({ ...draft.value, updatedAt }))
    localStorage.setItem(studioIndexKey(props.workspaceId), JSON.stringify({ version: 2, activeId: draft.value.id, docs: docs.value }))
    storageError.value = ''
    savedAt.value = Date.now()
    saveState.value = 'saved'
  } catch { storageError.value = '本机草稿保存失败，请检查可用空间。'; saveState.value = 'error' }
}
function flush() { if (saveTimer) clearTimeout(saveTimer); saveTimer = undefined; persist() }
function schedule() { if (restoring) return; saveState.value = 'saving'; if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(flush, 250) }
function restore(id: string) {
  restoring = true; histories.clear(); selectedId.value = ''; selectedGroupId.value = ''; cropMode.value = false
  panOffset.value = { x: 0, y: 0 }
  try {
    const index = readStudioIndex(JSON.parse(localStorage.getItem(studioIndexKey(id)) || 'null'))
    const available = index?.docs.map(meta => {
      try { return readStudioDocument(JSON.parse(localStorage.getItem(studioDocumentKey(id, meta.id)) || 'null')) }
      catch { return undefined }
    }) ?? []
    const current = available.find(item => item?.id === index?.activeId) ?? available.find(Boolean)
    if (current) { draft.value = withoutOldMarks(current); docs.value = index!.docs.filter(meta => available.some(item => item?.id === meta.id)) }
    else {
      const legacy = localStorage.getItem(legacyStudioKey(id))
      draft.value = legacy ? migrateImageDraft(JSON.parse(legacy)) : createStudioDocument()
      docs.value = [{ id: draft.value.id, name: draft.value.name, updatedAt: draft.value.updatedAt }]
    }
  } catch { draft.value = createStudioDocument(); docs.value = [{ id: draft.value.id, name: draft.value.name, updatedAt: draft.value.updatedAt }] }
  restoring = false; refreshHistory(); schedule(); schedulePreview()
}
watch(() => props.workspaceId, (id, old) => { if (old) flush(); restore(id) }, { immediate: true })
watch(draft, () => {
  const lockedGroup = selected.value?.groupId && draft.value.groups.find(group => group.id === selected.value?.groupId && group.locked)
  if (lockedGroup) { selectedId.value = ''; selectedGroupId.value = lockedGroup.id }
  if (selectedIds.value.some(id => !draft.value.layers.some(layer => layer.id === id))) {
    const ids = selectedIds.value.filter(id => draft.value.layers.some(layer => layer.id === id))
    selectedId.value = ids[ids.length - 1] ?? ''; selectedIds.value = ids
  }
  schedule(); schedulePreview()
}, { deep: true })
watch(() => props.assetInfo, () => { clearStudioImageCache(); schedulePreview() })
watch(() => global.computedTheme, () => schedulePreview(), { flush: 'post' })
watch(scale, () => schedulePreview())
function visibility() { if (document.visibilityState === 'hidden') flush() }
onMounted(() => {
  observer = new ResizeObserver(() => { if (viewport.value) boardSize.value = { width: viewport.value.clientWidth, height: viewport.value.clientHeight } })
  if (viewport.value) observer.observe(viewport.value)
  document.addEventListener('visibilitychange', visibility)
  window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup)
  schedulePreview()
})
onBeforeUnmount(() => { previewDisposed = true; flush(); observer?.disconnect(); document.removeEventListener('visibilitychange', visibility)
  if (previewFrame !== undefined) cancelAnimationFrame(previewFrame)
  window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup) })
function schedulePreview() { if (previewDisposed) return
  if (previewRunning) { previewQueued = true; return }
  if (previewFrame !== undefined) return
  previewFrame = requestAnimationFrame(() => { previewFrame = undefined; void preview() }) }
function createDraft() {
  if (docs.value.length >= 100) return
  flush(); draft.value = createStudioDocument('未命名图片 ' + (docs.value.length + 1))
  panOffset.value = { x: 0, y: 0 }
  selectedId.value = ''; selectedGroupId.value = ''; docs.value.push({ id: draft.value.id, name: draft.value.name, updatedAt: draft.value.updatedAt }); refreshHistory(); persist()
}
function switchDraft(id: string) {
  if (draft.value.id === id) return
  flush()
  try { const item = readStudioDocument(JSON.parse(localStorage.getItem(studioDocumentKey(props.workspaceId, id)) || 'null'))
    if (!item) throw new Error(); draft.value = item; selectedId.value = ''; selectedGroupId.value = ''; cropMode.value = false; panOffset.value = { x: 0, y: 0 }; refreshHistory(); persist()
  } catch { message.error('草稿无法打开') }
}
function renameDraft() {
  renameDraftName.value = draft.value.name
  renameDraftOpen.value = true
  void nextTick(() => { renameDraftInput.value?.focus(); renameDraftInput.value?.select() })
}
function confirmRenameDraft() {
  const name = renameDraftName.value.trim()
  if (!name) { message.warning('请输入草稿名称'); renameDraftInput.value?.focus(); return }
  if (name !== draft.value.name) change(() => { draft.value.name = name.slice(0, 80) })
  renameDraftOpen.value = false
}
function deleteDraft() {
  Modal.confirm({ title: '删除草稿“' + draft.value.name + '”？', content: '本机图层草稿会删除，引用的素材文件不会删除。',
    okText: '删除草稿', okType: 'danger', onOk: () => {
      const id = draft.value.id, index = docs.value.findIndex(item => item.id === id)
      panOffset.value = { x: 0, y: 0 }
      docs.value = docs.value.filter(item => item.id !== id)
      localStorage.removeItem(studioDocumentKey(props.workspaceId, id)); histories.delete(id)
      if (docs.value.length) {
        const nextId = docs.value[Math.max(0, index - 1)].id
        const item = readStudioDocument(JSON.parse(localStorage.getItem(studioDocumentKey(props.workspaceId, nextId)) || 'null'))
        if (item) { draft.value = item; selectedId.value = ''; selectedGroupId.value = ''; refreshHistory(); persist() }
      }
      else { draft.value = createStudioDocument(); docs.value = [{ id: draft.value.id, name: draft.value.name, updatedAt: draft.value.updatedAt }]; persist() }
    } })
}
async function preview() {
  if (previewRunning) { previewQueued = true; return }
  previewRunning = true
  const renderedDoc = draft.value
  try {
    await nextTick()
    if (!canvas.value || previewDisposed) return
    const target = document.createElement('canvas')
    const displaySize = Math.max(renderedDoc.width, renderedDoc.height) * scale.value
    const maxDimension = Math.min(1200, Math.max(512, Math.ceil(displaySize * Math.min(window.devicePixelRatio || 1, 2))))
    const failures = await renderStudioDocument(target, renderedDoc, props.assetInfo, true, { kind: 'all' }, maxDimension)
    if (renderedDoc === draft.value && canvas.value && !previewDisposed) {
      canvas.value.width = target.width; canvas.value.height = target.height
      canvas.value.getContext('2d')?.drawImage(target, 0, 0)
      renderError.value = failures.length ? '无法读取图层：' + failures.join('、') : ''
    }
  } catch { if (renderedDoc === draft.value && !previewDisposed) renderError.value = '画布预览失败' }
  finally {
    previewRunning = false
    if (previewQueued && !previewDisposed) { previewQueued = false; schedulePreview() }
  }
}
async function exportBlob(): Promise<Blob> {
  flush()
  const target = document.createElement('canvas')
  const failures = await renderStudioDocument(target, JSON.parse(snapshot()), props.assetInfo, false)
  if (failures.length) throw new Error('无法读取图层：' + failures.join('、'))
  const blob = await new Promise<Blob | null>(resolve => target.toBlob(resolve, format.value === 'jpeg' ? 'image/jpeg' : 'image/png', .93))
  if (!blob) throw new Error('导出失败，请缩小画布尺寸')
  return blob
}
async function exportImage() {
  if (exporting.value) return
  exporting.value = true
  try {
    const blob = await exportBlob()
    const url = URL.createObjectURL(blob), link = document.createElement('a')
    link.href = url; link.download = draft.value.name.replace(/[\\/:*?"<>|]/g, '_') + (format.value === 'jpeg' ? '.jpg' : '.png')
    document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000)
    message.success('图片已下载')
  } catch (error) { message.error(error instanceof Error ? error.message : '导出失败') }
  finally { exporting.value = false }
}
function openSaveArtifact() {
  artifactName.value = draft.value.name + (format.value === 'jpeg' ? '.jpg' : '.png')
  syncToLibrary.value = false
  syncDirectory.value = ''
  saveArtifactOpen.value = true
}
async function browseSyncDirectory() {
  try {
    const selected = await chooseLocalDirectory()
    if (selected) syncDirectory.value = selected
  } catch { message.error('无法选择文件夹，请手动输入目录') }
}
async function saveArtifact() {
  if (savingArtifact.value) return
  if (!artifactName.value.trim()) { message.warning('请输入素材名称'); return }
  if (syncToLibrary.value && !syncDirectory.value.trim()) { message.warning('请选择媒体库目录'); return }
  savingArtifact.value = true
  try {
    const blob = await exportBlob()
    const imageBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
      reader.onerror = () => reject(new Error('无法读取合成图片'))
      reader.readAsDataURL(blob)
    })
    const saved = await saveWorkspaceArtifact(props.workspaceId, artifactName.value.trim(), format.value, imageBase64)
    emit('artifactSaved')
    saveArtifactOpen.value = false
    if (syncToLibrary.value) {
      try {
        await syncWorkspaceArtifact(saved.id, syncDirectory.value.trim())
        message.success('已保存到工作区素材，并同步到媒体库')
      } catch (error: any) {
        message.warning(error?.response?.data?.detail || '已保存到工作区素材，但未能同步到媒体库')
      }
    } else message.success('已保存到工作区素材')
  } catch (error: any) { message.error(error?.response?.data?.detail || (error instanceof Error ? error.message : '保存素材失败')) }
  finally { savingArtifact.value = false }
}
function addImage(path: string, replace = false) {
  const asset = imageAssets.value.find(item => item.path === path); if (!asset) return
  if (replace && !imageLayer.value) return
  change(() => {
    if (replace && imageLayer.value) { imageLayer.value.path = path; imageLayer.value.name = asset.name
      imageLayer.value.crop = { x: 0, y: 0, width: 1, height: 1 }; imageLayer.value.zoom = 1 }
    else { const size = Math.min(draft.value.width, draft.value.height) * .62
      const layer = createImageLayer(path, { x: (draft.value.width - size) / 2, y: (draft.value.height - size) / 2, width: size, height: size }, asset.name)
      draft.value.layers.push(layer); selectedId.value = layer.id; selectedGroupId.value = '' }
  })
  picker.value = false; menu.value = undefined
}
function openImagePicker(mode: 'add' | 'replace' = 'add') {
  if (mode === 'replace' && !imageLayer.value) return
  pickerMode.value = mode
  picker.value = true
}
function addText() { change(() => { const layer = createTextLayer({ x: draft.value.width * .15, y: draft.value.height * .43,
  width: draft.value.width * .7, height: 130 }); draft.value.layers.push(layer); selectedId.value = layer.id; selectedGroupId.value = '' }); menu.value = undefined }
function addGroup() { change(() => {
  const group = createStudioGroup(`分组 ${draft.value.groups.length + 1}`)
  draft.value.groups.push(group)
  if (selected.value) draft.value = moveStudioLayerToGroup(JSON.parse(snapshot()), selected.value.id, group.id)
  selectedId.value = ''; selectedGroupId.value = group.id
}) }
function beginGroupSelection() {
  if (props.readonly || selectedIds.value.length < 2) return
  createGroupName.value = `分组 ${draft.value.groups.length + 1}`
  createGroupOpen.value = true
}
function confirmGroupSelection() {
  const name = createGroupName.value.trim()
  if (!name) { message.warning('请输入分组名称'); return }
  const ids = selectedIds.value.filter(id => draft.value.layers.some(layer => layer.id === id && !studioLayerLocked(draft.value, layer)))
  if (props.readonly || ids.length < 2) { createGroupOpen.value = false; return }
  change(() => {
    const group = createStudioGroup(name.slice(0, 80))
    draft.value.groups.push(group)
    draft.value = moveStudioLayersToGroup(JSON.parse(snapshot()), ids, group.id)
    selectedId.value = ''; selectedGroupId.value = group.id
  })
  createGroupOpen.value = false
}
function dissolveGroup(id: string) { change(() => {
  draft.value.layers.forEach(layer => { if (layer.groupId === id) layer.groupId = undefined })
  draft.value.groups = draft.value.groups.filter(group => group.id !== id)
  selectedGroupId.value = ''
}) }
function removeGroup(id: string) {
  const group = draft.value.groups.find(item => item.id === id)
  if (!group || props.readonly) return
  const count = draft.value.layers.filter(layer => layer.groupId === id).length
  Modal.confirm({ title: `删除分组“${group.name}”？`,
    content: `分组及其中 ${count} 个图层将从当前草稿移除。可使用撤销恢复；素材文件不会删除。`,
    okText: '删除分组及图层', okType: 'danger', onOk: () => change(() => {
      draft.value.layers = draft.value.layers.filter(layer => layer.groupId !== id)
      draft.value.groups = draft.value.groups.filter(item => item.id !== id)
      selectedId.value = ''; selectedGroupId.value = ''
    }) })
}
function renameGroup(id: string) {
  const group = draft.value.groups.find(item => item.id === id)
  if (!group || props.readonly) return
  renameGroupId.value = id
  renameGroupName.value = group.name
  renameGroupOpen.value = true
}
function confirmRenameGroup() {
  const group = draft.value.groups.find(item => item.id === renameGroupId.value)
  const name = renameGroupName.value.trim()
  if (!group || props.readonly) { renameGroupOpen.value = false; return }
  if (!name) { message.warning('请输入分组名称'); return }
  if (name !== group.name) change(() => { group.name = name.slice(0, 80) })
  renameGroupOpen.value = false
}
function moveLayerToGroup(id: string, groupId?: string) { change(() => {
  draft.value = moveStudioLayerToGroup(JSON.parse(snapshot()), id, groupId)
}) }
function toggleGroup(id: string, key: 'visible' | 'locked' | 'collapsed') { change(() => {
  const group = draft.value.groups.find(item => item.id === id)
  if (group) {
    group[key] = !group[key]
    if (key === 'locked' && group.locked && selected.value?.groupId === id) {
      selectedId.value = ''; selectedGroupId.value = id
    }
  }
}) }
function showInspector(tab: 'properties' | 'notes' = 'properties') {
  inspectorTab.value = tab
  inspectorOpen.value = true
  layersOpen.value = false
}
function openAIDialog(scope: StudioRenderScope) {
  aiSnapshot.value = JSON.parse(snapshot()) as StudioDocument
  aiScope.value = scope
  aiOpen.value = true
}
function template(layout: ImageLayout) { change(() => { draft.value = applyStudioTemplate(JSON.parse(snapshot()), layout) }) }
function resizeCanvas(width: number, height: number) { change(() => { draft.value = scaleStudioDocument(JSON.parse(snapshot()), width, height) }) }
function dimension(which: 'width' | 'height', raw: string) { const size = Math.round(Math.min(4096, Math.max(320, Number(raw) || 1080)))
  resizeCanvas(which === 'width' ? size : draft.value.width, which === 'height' ? size : draft.value.height) }
function fieldFocus() { if (!inspectorBefore) inspectorBefore = snapshot() }
function fieldChange() { if (inspectorBefore) record(inspectorBefore); inspectorBefore = '' }
function resetSlider(which: 'rotation' | 'opacity' | 'zoom' | 'brightness' | 'contrast' | 'radius') {
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
  const layer = selected.value, input = event.target as HTMLInputElement
  if (!layer) return
  const value = input.valueAsNumber
  if (Number.isFinite(value)) layer[which] = which === 'width' || which === 'height' ? Math.max(16, Math.round(value)) : Math.round(value)
  input.value = String(Math.round(layer[which]))
  fieldChange()
}
function duplicate() { if (!selected.value) return; change(() => { const copy = JSON.parse(JSON.stringify(selected.value)) as StudioLayer
  copy.id = crypto.randomUUID(); copy.name += ' 副本'; copy.x += 24; copy.y += 24
  draft.value.layers.splice(draft.value.layers.indexOf(selected.value!) + 1, 0, copy); selectedId.value = copy.id }) }
function copySelection() {
  const group = selectedGroup.value
  const layers = group ? draft.value.layers.filter(layer => layer.groupId === group.id)
    : draft.value.layers.filter(layer => selectedIds.value.includes(layer.id))
  if (!group && !layers.length) return
  layerClipboard = { workspaceId: props.workspaceId, layers: JSON.parse(JSON.stringify(layers)) as StudioLayer[],
    ...(group ? { group: JSON.parse(JSON.stringify(group)) as StudioGroup } : {}) }
  message.success(group ? '已复制分组' : `已复制 ${layers.length} 个图层`)
}
function pasteSelection() {
  if (!layerClipboard) { message.info('请先选中图层并按 Ctrl+C 复制'); return }
  if (layerClipboard.workspaceId !== props.workspaceId) { message.info('请在同一工作区内粘贴图层'); return }
  if (props.readonly) return
  const copied = layerClipboard
  change(() => {
    const sourceIds = new Set(copied.layers.map(layer => layer.id))
    let sourceTop = -1
    draft.value.layers.forEach((layer, index) => { if (sourceIds.has(layer.id)) sourceTop = index })
    const copies = copied.layers.map(layer => ({ ...JSON.parse(JSON.stringify(layer)) as StudioLayer,
      id: crypto.randomUUID(), name: `${layer.name} 副本`, x: layer.x + 24, y: layer.y + 24 }))
    let newGroup: StudioGroup | undefined
    if (copied.group) {
      newGroup = { ...copied.group, id: crypto.randomUUID(), name: `${copied.group.name} 副本` }
      draft.value.groups.push(newGroup)
      copies.forEach(layer => { layer.groupId = newGroup!.id })
    } else {
      const groupId = copies[0]?.groupId
      const sameGroup = groupId && copies.every(layer => layer.groupId === groupId) &&
        draft.value.groups.some(group => group.id === groupId && !group.locked)
      if (!sameGroup) copies.forEach(layer => { layer.groupId = undefined })
    }
    let insertion = sourceTop < 0 ? draft.value.layers.length : sourceTop + 1
    const sourceGroupId = sourceTop >= 0 ? draft.value.layers[sourceTop].groupId : undefined
    if (sourceGroupId && (!copies[0]?.groupId || newGroup)) {
      draft.value.layers.forEach((layer, index) => { if (layer.groupId === sourceGroupId) insertion = index + 1 })
    }
    draft.value.layers.splice(insertion, 0, ...copies)
    if (newGroup) { selectedId.value = ''; selectedGroupId.value = newGroup.id }
    else { selectedId.value = copies[copies.length - 1]?.id ?? ''; selectedIds.value = copies.map(layer => layer.id); selectedGroupId.value = '' }
  })
}
function moveLayer(where: 'front' | 'back') { if (!selected.value) return; change(() => {
  const index = draft.value.layers.indexOf(selected.value!), [layer] = draft.value.layers.splice(index, 1)
  draft.value.layers.splice(where === 'front' ? draft.value.layers.length : 0, 0, layer) }) }
function removeLayer() { if (!selected.value) return; change(() => { draft.value.layers = draft.value.layers.filter(item => item.id !== selectedId.value); selectedId.value = '' }) }
function resetCrop() { if (imageLayer.value) change(() => { imageLayer.value!.crop = { x: 0, y: 0, width: 1, height: 1 }
  imageLayer.value!.zoom = 1; imageLayer.value!.focusX = .5; imageLayer.value!.focusY = .5 }) }
function toggle(id: string, key: 'visible' | 'locked') { change(() => { const layer = draft.value.layers.find(item => item.id === id); if (layer) layer[key] = !layer[key] }) }
const orderedLayers = computed(() => [...draft.value.layers].reverse())
type LayerRow = { kind: 'group'; group: StudioGroup } | { kind: 'layer'; layer: StudioLayer }
const layerRows = computed<LayerRow[]>(() => {
  const rows: LayerRow[] = [], shown = new Set<string>()
  for (const group of draft.value.groups) if (!draft.value.layers.some(layer => layer.groupId === group.id)) {
    rows.push({ kind: 'group', group }); shown.add(group.id)
  }
  for (const layer of orderedLayers.value) {
    const group = layer.groupId ? draft.value.groups.find(item => item.id === layer.groupId) : undefined
    if (group && !shown.has(group.id)) { rows.push({ kind: 'group', group }); shown.add(group.id) }
    if (!group || !group.collapsed) rows.push({ kind: 'layer', layer })
  }
  return rows
})
type DragItem = { kind: 'layer' | 'group'; id: string }
const dragItem = ref<DragItem>()
const dropTarget = ref<{ kind: 'layer' | 'group' | 'bottom'; id?: string }>()
function startDrag(event: DragEvent, kind: DragItem['kind'], id: string) {
  dragItem.value = { kind, id }
  event.dataTransfer?.setData('text/plain', id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function endDrag() { dragItem.value = undefined; dropTarget.value = undefined }
function dragOver(event: DragEvent, kind: 'layer' | 'group' | 'bottom', id?: string) {
  if (!dragItem.value || (kind === 'group' && dragItem.value.kind === 'group' && dragItem.value.id === id) ||
    (kind === 'layer' && dragItem.value.kind === 'group' && draft.value.layers.some(layer => layer.id === id && layer.groupId === dragItem.value?.id))) {
    dropTarget.value = undefined; return
  }
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dropTarget.value = { kind, id }
}
function dropOnLayer(to: string) {
  const source = dragItem.value
  if (!source || source.id === to) { endDrag(); return }
  if (source.kind === 'group' && draft.value.layers.some(layer => layer.id === to && layer.groupId === source.id)) { endDrag(); return }
  if (source.kind === 'group') change(() => { draft.value = reorderStudioGroup(JSON.parse(snapshot()), source.id, { kind: 'layer', id: to }) })
  else change(() => {
    const target = draft.value.layers.find(layer => layer.id === to)
    const grouped = moveStudioLayerToGroup(JSON.parse(snapshot()), source.id, target?.groupId)
    draft.value = reorderStudioLayer(grouped, source.id, to)
  })
  endDrag()
}
function dropOnGroup(id: string) {
  const source = dragItem.value
  if (!source || source.id === id) { endDrag(); return }
  if (source.kind === 'group') change(() => { draft.value = reorderStudioGroup(JSON.parse(snapshot()), source.id, { kind: 'group', id }) })
  else moveLayerToGroup(source.id, id)
  endDrag()
}
function dropUngrouped() {
  const source = dragItem.value
  if (source?.kind === 'group') change(() => { draft.value = reorderStudioGroup(JSON.parse(snapshot()), source.id, { kind: 'bottom' }) })
  else if (source) moveLayerToGroup(source.id)
  endDrag()
}
function layerStyle(layer: StudioLayer) { return { left: layer.x * scale.value + 'px', top: layer.y * scale.value + 'px',
  width: layer.width * scale.value + 'px', height: layer.height * scale.value + 'px', transform: `rotate(${layer.rotation}deg)` } }
const selectedGroupBounds = computed(() => selectedGroup.value?.visible
  ? studioGroupBounds(draft.value, selectedGroup.value.id) : null)
const selectedGroupStyle = computed(() => selectedGroupBounds.value ? {
  left: selectedGroupBounds.value.x * scale.value + 'px', top: selectedGroupBounds.value.y * scale.value + 'px',
  width: selectedGroupBounds.value.width * scale.value + 'px', height: selectedGroupBounds.value.height * scale.value + 'px',
} : {})
function lockedGroupFor(layer?: StudioLayer) {
  return layer?.groupId ? draft.value.groups.find(group => group.id === layer.groupId && group.locked) : undefined
}
function point(event: MouseEvent | PointerEvent) { const rect = board.value!.getBoundingClientRect()
  return { x: (event.clientX - rect.left) / scale.value, y: (event.clientY - rect.top) / scale.value } }
function localPoint(layer: StudioLayer, p: { x: number; y: number }) {
  const dx = p.x - layer.x - layer.width / 2, dy = p.y - layer.y - layer.height / 2
  const a = -layer.rotation * Math.PI / 180
  return { x: (dx * Math.cos(a) - dy * Math.sin(a)) / layer.width + .5,
    y: (dx * Math.sin(a) + dy * Math.cos(a)) / layer.height + .5 }
}
function hit(p: { x: number; y: number }) { return [...draft.value.layers].reverse().find(layer => {
  if (!studioLayerVisible(draft.value, layer)) return false
  const q = localPoint(layer, p); return q.x >= 0 && q.x <= 1 && q.y >= 0 && q.y <= 1
}) }
function rotatedDelta(dx: number, dy: number, angle: number) {
  const a = -angle * Math.PI / 180
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) }
}
type Gesture = { mode: 'move' | 'group-move' | 'resize' | 'rotate' | 'crop-edge' | 'crop-pan' | 'pan'; before: string;
  start: { x: number; y: number }; frame?: { x: number; y: number; width: number; height: number; rotation: number };
  handle?: string; crop?: StudioCrop; focus?: { x: number; y: number }; scroll?: { x: number; y: number };
  panStart?: { x: number; y: number }; panScrollable?: { x: boolean; y: boolean };
  groupFrames?: { id: string; x: number; y: number }[] }
let gesture: Gesture | undefined, space = false
function beginPan(event: PointerEvent) {
  const area = viewport.value!
  gesture = { mode: 'pan', before: '', start: { x: event.clientX, y: event.clientY },
    scroll: { x: area.scrollLeft, y: area.scrollTop }, panStart: { ...panOffset.value },
    panScrollable: { x: draft.value.width * scale.value + 48 > area.clientWidth,
      y: draft.value.height * scale.value + 48 > area.clientHeight } }
  panning.value = true
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture(event.pointerId)
  event.preventDefault()
}
function viewportPointerDown(event: PointerEvent) {
  if (event.button === 1 || (event.button === 0 && space)) beginPan(event)
}
function pointerDown(event: PointerEvent) {
  if (event.button === 1 || (event.button === 0 && space)) { beginPan(event); return }
  if (event.button !== 0 || editingText.value) return
  menu.value = undefined
  const p = point(event)
  const handle = (event.target as HTMLElement).closest<HTMLElement>('[data-handle]')?.dataset.handle
  const layer = handle ? selected.value : hit(p)
  if (cropMode.value && layer?.id !== selectedId.value) return
  const lockedGroup = !cropMode.value ? lockedGroupFor(layer) : undefined
  const selectedGroupHit = !cropMode.value && !event.ctrlKey && !event.metaKey && selectedGroupBounds.value && selectedGroup.value &&
    p.x >= selectedGroupBounds.value.x && p.x <= selectedGroupBounds.value.x + selectedGroupBounds.value.width &&
    p.y >= selectedGroupBounds.value.y && p.y <= selectedGroupBounds.value.y + selectedGroupBounds.value.height
    ? selectedGroup.value : undefined
  const requestedGroup = !cropMode.value && event.altKey && layer?.groupId
    ? draft.value.groups.find(item => item.id === layer.groupId) : undefined
  const group = lockedGroup ?? requestedGroup ?? selectedGroupHit
  if (group) {
    selectedId.value = ''; selectedGroupId.value = group.id
    if (!props.readonly) {
      gesture = { mode: 'group-move', before: snapshot(), start: p,
        groupFrames: draft.value.layers.filter(item => item.groupId === group.id).map(item => ({ id: item.id, x: item.x, y: item.y })) }
      board.value?.setPointerCapture(event.pointerId); event.preventDefault()
    }
    return
  }
  if (!layer) { selectedId.value = ''; selectedGroupId.value = ''; return }
  if (event.ctrlKey || event.metaKey) { toggleLayerSelection(layer.id); event.preventDefault(); return }
  selectedId.value = layer.id; selectedGroupId.value = ''
  if (studioLayerLocked(draft.value, layer) || props.readonly) return
  gesture = { mode: cropMode.value ? (handle?.startsWith('crop-') ? 'crop-edge' : 'crop-pan') :
    handle === 'rotate' ? 'rotate' : handle ? 'resize' : 'move',
    before: snapshot(), start: p, handle,
    frame: { x: layer.x, y: layer.y, width: layer.width, height: layer.height, rotation: layer.rotation },
    crop: { ...cropSelection.value }, focus: layer.kind === 'image' ? { x: layer.focusX, y: layer.focusY } : undefined }
  board.value?.setPointerCapture(event.pointerId); event.preventDefault()
}
function pointerMove(event: PointerEvent) {
  if (gesture?.mode === 'pan') {
    const dx = event.clientX - gesture.start.x, dy = event.clientY - gesture.start.y
    if (gesture.panScrollable?.x) viewport.value!.scrollLeft = gesture.scroll!.x - dx
    if (gesture.panScrollable?.y) viewport.value!.scrollTop = gesture.scroll!.y - dy
    panOffset.value = { x: gesture.panScrollable?.x ? gesture.panStart!.x : gesture.panStart!.x + dx,
      y: gesture.panScrollable?.y ? gesture.panStart!.y : gesture.panStart!.y + dy }
    return
  }
  if (!gesture) return
  const p = point(event)
  if (gesture.mode === 'group-move') {
    const dx = p.x - gesture.start.x, dy = p.y - gesture.start.y
    for (const frame of gesture.groupFrames ?? []) {
      const layer = draft.value.layers.find(item => item.id === frame.id)
      if (layer) { layer.x = frame.x + dx; layer.y = frame.y + dy }
    }
    return
  }
  const layer = selected.value, frame = gesture.frame
  if (!layer || !frame) return
  const dx = p.x - gesture.start.x, dy = p.y - gesture.start.y
  if (gesture.mode === 'move') { layer.x = frame.x + dx; layer.y = frame.y + dy }
  if (gesture.mode === 'rotate') {
    const cx = frame.x + frame.width / 2, cy = frame.y + frame.height / 2
    layer.rotation = frame.rotation + (Math.atan2(p.y - cy, p.x - cx) - Math.atan2(gesture.start.y - cy, gesture.start.x - cx)) * 180 / Math.PI
  }
  if (gesture.mode === 'resize') {
    const side = gesture.handle || ''
    const delta = rotatedDelta(dx, dy, frame.rotation)
    if (side.includes('e')) layer.width = Math.max(16, frame.width + delta.x)
    if (side.includes('s')) layer.height = Math.max(16, frame.height + delta.y)
    if (side.includes('w')) { layer.width = Math.max(16, frame.width - delta.x); layer.x = frame.x + frame.width - layer.width }
    if (side.includes('n')) { layer.height = Math.max(16, frame.height - delta.y); layer.y = frame.y + frame.height - layer.height }
  }
  if (gesture.mode === 'crop-edge' && gesture.crop) {
    const edge = gesture.handle!.slice(5), crop = { ...gesture.crop }
    const delta = rotatedDelta(dx, dy, frame.rotation)
    if (edge.includes('e')) crop.width = Math.max(.02, Math.min(1 - crop.x, gesture.crop.width + delta.x / layer.width))
    if (edge.includes('s')) crop.height = Math.max(.02, Math.min(1 - crop.y, gesture.crop.height + delta.y / layer.height))
    if (edge.includes('w')) { crop.x = Math.max(0, Math.min(gesture.crop.x + gesture.crop.width - .02, gesture.crop.x + delta.x / layer.width)); crop.width = gesture.crop.x + gesture.crop.width - crop.x }
    if (edge.includes('n')) { crop.y = Math.max(0, Math.min(gesture.crop.y + gesture.crop.height - .02, gesture.crop.y + delta.y / layer.height)); crop.height = gesture.crop.y + gesture.crop.height - crop.y }
    cropSelection.value = crop
  }
  if (gesture.mode === 'crop-pan' && layer.kind === 'image' && gesture.focus) {
    layer.focusX = Math.max(0, Math.min(1, gesture.focus.x + dx / layer.width))
    layer.focusY = Math.max(0, Math.min(1, gesture.focus.y + dy / layer.height))
  }
}
function pointerUp() { if (!gesture) return
  if (gesture.mode === 'pan') panning.value = false
  if (gesture.mode !== 'pan' && !cropMode.value) record(gesture.before)
  gesture = undefined
}
async function wheel(event: WheelEvent) {
  const area = viewport.value, surface = board.value
  if (!area || !surface) return
  event.preventDefault()
  const before = surface.getBoundingClientRect()
  const x = (event.clientX - before.left) / before.width
  const y = (event.clientY - before.top) / before.height
  viewZoom.value = Math.max(.3, Math.min(4, viewZoom.value * Math.exp(-Math.max(-120, Math.min(120, event.deltaY)) * .0015)))
  await nextTick()
  const after = surface.getBoundingClientRect()
  area.scrollLeft += after.left + x * after.width - event.clientX
  area.scrollTop += after.top + y * after.height - event.clientY
}
function zoomTo(value: number) { panOffset.value = { x: 0, y: 0 }; viewZoom.value = Math.max(.3, Math.min(4, value)) }
function beginCrop() { if (!imageLayer.value?.path || imageLayer.value.locked) return
  cropBefore.value = snapshot(); cropSelection.value = { x: 0, y: 0, width: 1, height: 1 }; cropMode.value = true }
async function finishCrop() {
  if (!imageLayer.value) return
  const layer = imageLayer.value, file = props.assetInfo[layer.path]
  const docId = draft.value.id
  const size = file ? await studioImageDimensions(file) : null
  if (draft.value.id !== docId || selectedId.value !== layer.id || !cropMode.value) return
  if (!size) { message.error('无法读取原图，暂时不能完成裁剪'); return }
  const next = cropStudioImage(JSON.parse(JSON.stringify(layer)), cropSelection.value, size.width, size.height)
  const index = draft.value.layers.findIndex(item => item.id === layer.id)
  if (index < 0) return
  draft.value.layers[index] = next
  cropMode.value = false; record(cropBefore.value)
}
function cancelCrop() { if (cropBefore.value) draft.value = readStudioDocument(JSON.parse(cropBefore.value)) ?? draft.value; cropMode.value = false }
function beginTextEdit() { if (!textLayer.value || textLayer.value.locked) return
  inspectorBefore = snapshot(); textInput.value = textLayer.value.text; editingText.value = true; void nextTick(() => textArea.value?.focus()) }
function finishTextEdit(commit = true) { if (!editingText.value) return
  if (commit && textLayer.value) { textLayer.value.text = textInput.value; record(inspectorBefore) }
  inspectorBefore = ''; editingText.value = false }
let textMeasureContext: CanvasRenderingContext2D | null = null
function inlineTextStyle(layer: StudioTextLayer) {
  textMeasureContext ??= document.createElement('canvas').getContext('2d')
  const layout = textMeasureContext ? layoutStudioText(textMeasureContext, layer, textInput.value) : null
  const size = layout?.fontSize ?? layer.fontSize
  const top = layout ? Math.max(4, (layer.height - layout.lines.length * layout.lineHeight) / 2) : 4
  return { fontSize: size * scale.value + 'px', lineHeight: `${size * 1.24 * scale.value}px`,
    paddingTop: top * scale.value + 'px', color: layer.color, textAlign: layer.align,
    fontFamily: studioFontFamily(layer.font), fontWeight: layer.bold ? 700 : 400, opacity: layer.opacity }
}
function selectCanvas() {
  if (cropMode.value) cancelCrop()
  if (editingText.value) finishTextEdit()
  selectedId.value = ''; selectedIds.value = []; selectedGroupId.value = ''
  showInspector()
  menu.value = undefined
}
function toggleLayerSelection(id: string) {
  const ids = selectedIds.value.includes(id) ? selectedIds.value.filter(value => value !== id) : [...selectedIds.value, id]
  selectedId.value = ids[ids.length - 1] ?? ''
  selectedIds.value = ids
  selectedGroupId.value = ''
  showInspector()
}
function selectLayer(id: string, event?: MouseEvent) {
  const layer = draft.value.layers.find(item => item.id === id)
  const group = lockedGroupFor(layer)
  if (group) { selectGroup(group.id); return }
  if (event?.ctrlKey || event?.metaKey) { toggleLayerSelection(id); return }
  selectedIds.value = [id]
  if (id === selectedId.value && inspectorTab.value === 'properties') {
    showInspector()
    return
  }
  if (cropMode.value) cancelCrop()
  if (editingText.value) finishTextEdit()
  selectedId.value = id; selectedGroupId.value = ''
  showInspector()
}
function selectGroup(id: string) {
  if (cropMode.value) cancelCrop()
  if (editingText.value) finishTextEdit()
  selectedId.value = ''; selectedIds.value = []; selectedGroupId.value = id
  showInspector()
}
function doubleClick(event: MouseEvent) { const layer = hit(point(event)); if (!layer) return
  if (lockedGroupFor(layer)) { selectGroup(layer.groupId!); return }
  selectedId.value = layer.id; if (layer.kind === 'image') beginCrop(); else if (layer.kind === 'text') beginTextEdit() }
function showMenu(x: number, y: number, kind: 'layer' | 'group' | 'blank' | 'asset', id?: string, path?: string) {
  if (kind === 'layer' && id) {
    const group = lockedGroupFor(draft.value.layers.find(layer => layer.id === id))
    if (group) { kind = 'group'; id = group.id }
  }
  if (kind === 'layer' && id) { selectedId.value = id; selectedGroupId.value = '' }
  if (kind === 'group' && id) { selectedId.value = ''; selectedGroupId.value = id }
  const imageMenu = kind === 'layer' && draft.value.layers.some(layer => layer.id === id && layer.kind === 'image')
  const menuHeight = kind === 'group' ? 390 : imageMenu ? 430 : 350
  menu.value = { x: Math.max(8, Math.min(x, innerWidth - 200)), y: Math.max(8, Math.min(y, innerHeight - menuHeight)), kind, id, path }
}
function openGroupMenu(event: MouseEvent, id: string) {
  selectGroup(id)
  const anchor = (event.currentTarget as HTMLElement).getBoundingClientRect()
  showMenu(event.clientX || anchor.right, event.clientY || anchor.bottom, 'group', id)
}
function context(event: MouseEvent) { event.preventDefault(); const layer = hit(point(event))
  if (layer) showMenu(event.clientX, event.clientY, 'layer', layer.id)
  else showMenu(event.clientX, event.clientY, 'blank') }
function action(name: string) {
  const current = menu.value; if (!current) return
  menu.value = undefined
  if (current.kind === 'group' && current.id) {
    const id = current.id
    selectedId.value = ''; selectedGroupId.value = id
    switch (name) {
      case 'rename-group': renameGroup(id); break
      case 'collapse-group': toggleGroup(id, 'collapsed'); break
      case 'visibility-group': toggleGroup(id, 'visible'); break
      case 'lock-group': toggleGroup(id, 'locked'); break
      case 'preview-group': openAIDialog({ kind: 'group', id }); break
      case 'copy-group': copySelection(); break
      case 'paste': pasteSelection(); break
      case 'dissolve-group': dissolveGroup(id); break
      case 'delete-group': removeGroup(id); break
    }
    return
  }
  if (current.id) selectedId.value = current.id
  switch (name) {
    case 'add-image': openImagePicker(); break
    case 'replace-image': openImagePicker('replace'); break
    case 'ai-layer': if (current.id) openAIDialog({ kind: 'layer', id: current.id }); break
    case 'add-text': addText(); break
    case 'asset-add': if (current.path) addImage(current.path); break
    case 'asset-replace': if (current.path) addImage(current.path, true); break
    case 'edit': beginTextEdit(); break
    case 'crop': beginCrop(); break
    case 'duplicate': duplicate(); break
    case 'copy': copySelection(); break
    case 'paste': pasteSelection(); break
    case 'front': moveLayer('front'); break
    case 'back': moveLayer('back'); break
    case 'reset': resetCrop(); break
    case 'visibility': if (selected.value) toggle(selected.value.id, 'visible'); break
    case 'lock': if (selected.value) toggle(selected.value.id, 'locked'); break
    case 'delete': removeLayer(); break
  }
}
function keydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement
  if (event.defaultPrevented || event.isComposing || picker.value || renameDraftOpen.value || renameGroupOpen.value || createGroupOpen.value || aiOpen.value ||
    target?.closest('input,textarea,select,[contenteditable],[role="textbox"],[role="dialog"]')) return
  if (event.code === 'Space') { space = true; return }
  if (event.key === 'Escape') {
    if (cropMode.value) cancelCrop()
    else if (menu.value) menu.value = undefined
    else if (!picker.value && (selected.value || selectedGroup.value)) selectCanvas()
    return
  }
  if (event.ctrlKey || event.metaKey) {
    const key = event.key.toLowerCase()
    if (key === 'z' && !props.readonly) { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return }
    if (key === 'y' && !props.readonly) { event.preventDefault(); redo(); return }
    if (key === 'c' && (selectedGroup.value || selectedIds.value.length)) { event.preventDefault(); copySelection(); return }
    if (key === 'v' && !props.readonly) { event.preventDefault(); pasteSelection(); return }
    if (key === 'g' && !props.readonly) {
      if (selectedGroup.value) { event.preventDefault(); dissolveGroup(selectedGroup.value.id); return }
      if (selectedIds.value.length > 1) { event.preventDefault(); beginGroupSelection(); return }
    }
    return
  }
  if (event.altKey) return
  if (event.key === 'Delete' && selected.value && !props.readonly) { event.preventDefault(); removeLayer(); return }
  const step = event.shiftKey ? 10 : 1
  const motions: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
  if (motions[event.key] && selectedGroup.value?.locked && !props.readonly) { event.preventDefault()
    change(() => { for (const layer of draft.value.layers) if (layer.groupId === selectedGroupId.value) {
      layer.x += motions[event.key][0]; layer.y += motions[event.key][1]
    } }); return }
  if (motions[event.key] && selected.value && !studioLayerLocked(draft.value, selected.value) && !props.readonly) { event.preventDefault()
    change(() => { selected.value!.x += motions[event.key][0]; selected.value!.y += motions[event.key][1] }) }
}
function keyup(event: KeyboardEvent) { if (event.code === 'Space') space = false }
</script>

<template>
  <div class="image-studio" @click="menu = undefined">
    <div class="studio-command-bar">
      <nav class="draft-tabs" aria-label="图片草稿">
        <button v-for="item in docs" :key="item.id" type="button" class="draft-tab"
          :class="{ active: item.id === draft.id }" :aria-current="item.id === draft.id ? 'page' : undefined"
          @click="switchDraft(item.id)">{{ item.name }}</button>
        <button type="button" class="add-draft" :disabled="readonly" @click="createDraft">＋ 新建草稿</button>
        <a-dropdown :disabled="readonly" :trigger="['click']"><button type="button" class="draft-more icon-button" :disabled="readonly" title="当前草稿操作" aria-label="当前草稿操作"><MoreOutlined /></button><template #overlay><a-menu><a-menu-item @click="renameDraft">重命名草稿</a-menu-item><a-menu-item danger @click="deleteDraft">删除草稿</a-menu-item></a-menu></template></a-dropdown>
      </nav>
      <div class="studio-command-actions">
        <span class="save-indicator" :class="saveState" role="status" aria-live="polite"><i />{{ saveLabel }}</span>
        <div class="studio-export">
          <button type="button" class="note-entry" :class="{ active: inspectorTab === 'notes' }" @click="showInspector('notes')">
            <FileTextOutlined />制作笔记<i v-if="noteDirty" aria-label="笔记未保存" /></button>
          <select v-model="format" aria-label="导出格式"><option value="png">PNG</option><option value="jpeg">JPG</option></select>
          <button type="button" @click="openAIDialog({ kind: 'all' })">合成 / AI 加工</button>
          <button type="button" :disabled="readonly || savingArtifact" @click="openSaveArtifact">保存为素材</button>
          <a-button type="primary" :loading="exporting" @click="exportImage">下载图片</a-button>
        </div>
      </div>
    </div>
    <div v-if="storageError" class="studio-alert" role="alert">{{ storageError }}</div>
    <div class="studio-grid" :class="{ 'inspector-open': inspectorOpen, 'layers-open': layersOpen }">
      <button v-if="inspectorOpen || layersOpen" type="button" class="dock-backdrop" aria-label="关闭侧面板"
        @click="inspectorOpen = false; layersOpen = false" />
      <aside class="studio-side studio-layers">
        <div class="panel-heading"><strong>图层</strong><span>{{ selectedIds.length > 1 ? `${selectedIds.length} 层已选 · ` : '' }}{{ draft.layers.length }} 层 · {{ draft.groups.length }} 组</span></div>
        <button type="button" class="canvas-row" :class="{ active: !selected && !selectedGroup }" :aria-pressed="!selected && !selectedGroup"
          @click="selectCanvas"><BorderOutlined /><span>画布</span><small>{{ draft.width }} × {{ draft.height }}</small></button>
        <div class="layer-section-label"><span>添加</span></div>
        <div class="layer-actions" role="group" aria-label="添加图层或分组">
          <button type="button" title="添加图片" aria-label="添加图片" :disabled="readonly" @click="openImagePicker()"><PictureOutlined /></button>
          <button type="button" title="添加文字" aria-label="添加文字" :disabled="readonly" @click="addText"><FontSizeOutlined /></button>
          <button type="button" title="新建分组" aria-label="新建分组" :disabled="readonly" @click="addGroup"><FolderAddOutlined /></button>
        </div>
        <div class="layer-list-area" aria-label="图层管理区域">
        <p v-if="!draft.layers.length" class="empty">从工作区素材添加图片，或在画布中添加文字。</p>
        <template v-for="row in layerRows" :key="row.kind === 'group' ? row.group.id : row.layer.id">
          <div v-if="row.kind === 'group'" class="group-row" :class="{ active: selectedGroupId === row.group.id, faded: !row.group.visible,
            dragging: dragItem?.kind === 'group' && dragItem.id === row.group.id,
            'drop-target': dropTarget?.kind === 'group' && dropTarget.id === row.group.id }"
            role="button" tabindex="0" :aria-label="`分组 ${row.group.name}`" @click="selectGroup(row.group.id)"
            @keydown.enter="selectGroup(row.group.id)" @keydown.space.prevent="selectGroup(row.group.id)"
            @contextmenu.prevent.stop="openGroupMenu($event, row.group.id)"
            :draggable="!readonly" @dragstart="startDrag($event, 'group', row.group.id)" @dragend="endDrag"
            @dragover.prevent="dragOver($event, 'group', row.group.id)" @drop.prevent="dropOnGroup(row.group.id)">
            <button type="button" :aria-label="row.group.collapsed ? '展开分组' : '收起分组'"
              @click.stop="toggleGroup(row.group.id, 'collapsed')">{{ row.group.collapsed ? '▸' : '▾' }}</button>
            <FolderOutlined /><span class="layer-name" :title="row.group.name">{{ row.group.name }}</span>
            <small>{{ draft.layers.filter(layer => layer.groupId === row.group.id).length }}</small>
            <EyeInvisibleOutlined v-if="!row.group.visible" class="group-status" aria-label="已隐藏" />
            <LockOutlined v-if="row.group.locked" class="group-status" aria-label="已锁定" />
            <button type="button" :aria-label="'更多分组操作：' + row.group.name" title="更多分组操作"
              @click.stop="openGroupMenu($event, row.group.id)"><MoreOutlined /></button>
          </div>
          <div v-else class="layer-row" :class="{ active: selectedIds.includes(row.layer.id),
            faded: !studioLayerVisible(draft, row.layer),
            'group-child': !!row.layer.groupId, dragging: dragItem?.kind === 'layer' && dragItem.id === row.layer.id,
            'drop-target': dropTarget?.kind === 'layer' && dropTarget.id === row.layer.id }"
            :draggable="!readonly && !lockedGroupFor(row.layer)" @dragstart="startDrag($event, 'layer', row.layer.id)" @dragend="endDrag"
            @dragover.prevent="dragOver($event, 'layer', row.layer.id)" @drop.prevent="dropOnLayer(row.layer.id)" @click="selectLayer(row.layer.id, $event)"
            @contextmenu.prevent.stop="showMenu($event.clientX, $event.clientY, 'layer', row.layer.id)">
            <img v-if="row.layer.kind === 'image' && assetInfo[row.layer.path]" :src="toImageThumbnailUrl(assetInfo[row.layer.path], '96x96')" alt="" />
            <span v-else class="layer-symbol"><PictureOutlined v-if="row.layer.kind === 'image'" />
              <FontSizeOutlined v-else /></span>
            <span class="layer-name" :title="row.layer.name">{{ row.layer.name }}</span>
            <button type="button" :aria-label="row.layer.visible ? '隐藏图层' : '显示图层'" :title="row.layer.visible ? '隐藏' : '显示'"
              :disabled="!!lockedGroupFor(row.layer)" @click.stop="toggle(row.layer.id, 'visible')"><EyeOutlined v-if="row.layer.visible" /><EyeInvisibleOutlined v-else /></button>
            <button type="button" :aria-label="row.layer.locked ? '解锁图层' : '锁定图层'" :title="row.layer.locked ? '解锁' : '锁定'"
              :disabled="!!lockedGroupFor(row.layer)" @click.stop="toggle(row.layer.id, 'locked')"><LockOutlined v-if="row.layer.locked" /><UnlockOutlined v-else /></button>
            <button type="button" :aria-label="'更多操作：' + row.layer.name" title="更多操作"
              @click.stop="selectLayer(row.layer.id); showMenu($event.clientX, $event.clientY, 'layer', row.layer.id)"><MoreOutlined /></button>
          </div>
        </template>
        <div class="layer-footer" :class="{ 'drop-target': dropTarget?.kind === 'bottom' }"
          @dragover.prevent="dragOver($event, 'bottom')" @drop.prevent="dropUngrouped">拖动调整顺序；拖到这里可移出图层或将分组置底</div>
        </div>
      </aside>
      <main class="studio-stage">
        <div class="stage-toolbar">
          <template v-if="cropMode"><strong class="crop-title">裁剪图片</strong><span class="crop-actions"><button type="button" @click="cancelCrop">取消</button><button type="button" class="primary" @click="finishCrop">完成</button></span></template>
          <div v-else class="studio-toolstrip" role="toolbar" aria-label="画布工具">
            <button type="button" class="dock-toggle" title="打开图层" aria-label="打开图层" :aria-expanded="layersOpen" @click="layersOpen = !layersOpen; inspectorOpen = false"><UnorderedListOutlined /></button>
            <span class="tool-caption">选择图层并拖动排版</span>
          </div>
          <span v-if="!cropMode" class="zoom-actions">
            <button type="button" class="dock-toggle" title="打开属性" aria-label="打开属性" :aria-expanded="inspectorOpen" @click="inspectorOpen = !inspectorOpen; layersOpen = false; inspectorTab = 'properties'"><ControlOutlined /></button>
            <button type="button" class="history-button" :disabled="!canUndo || readonly" title="撤销 Ctrl+Z" aria-label="撤销" @click="undo"><UndoOutlined /></button>
            <button type="button" class="history-button" :disabled="!canRedo || readonly" title="重做 Ctrl+Y" aria-label="重做" @click="redo"><RedoOutlined /></button>
            <button type="button" title="缩小画布" @click="zoomTo(viewZoom / 1.2)">−</button>
            <button type="button" title="适应窗口" @click="zoomTo(1)">{{ Math.round(viewZoom * 100) }}%</button>
            <button type="button" title="放大画布" @click="zoomTo(viewZoom * 1.2)">＋</button>
          </span>
        </div>
        <div ref="viewport" class="stage-viewport" :class="{ panning }"
          @pointerdown.self="viewportPointerDown" @pointermove.self="pointerMove" @pointerup.self="pointerUp" @pointercancel.self="pointerUp" @auxclick.middle.prevent @wheel="wheel">
          <div ref="board" class="artboard" :style="boardStyle" tabindex="0" aria-label="图片画布"
            @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerUp"
            @dblclick="doubleClick" @contextmenu="context">
            <canvas ref="canvas" />
            <template v-for="layer in draft.layers" :key="layer.id">
              <div v-if="selectedIds.includes(layer.id) && studioLayerVisible(draft, layer)" class="selection" :class="{ locked: studioLayerLocked(draft, layer), secondary: selectedIds.length > 1 }" :style="layerStyle(layer)">
                <template v-if="selectedIds.length === 1 && !studioLayerLocked(draft, layer) && !cropMode">
                  <i v-for="handle in ['nw','ne','se','sw']" :key="handle" :class="'handle ' + handle" :data-handle="handle" />
                  <i class="rotation-stem" /><i class="handle rotate" data-handle="rotate" title="旋转" />
                </template>
                <div v-if="cropMode && layer.kind === 'image'" class="crop-box"
                  :style="{ left: cropSelection.x * 100 + '%', top: cropSelection.y * 100 + '%',
                    width: cropSelection.width * 100 + '%', height: cropSelection.height * 100 + '%' }">
                  <i v-for="handle in ['nw','ne','se','sw']" :key="handle" :class="'handle ' + handle" :data-handle="'crop-' + handle" />
                </div>
                <textarea v-if="editingText && layer.kind === 'text'" ref="textArea" v-model="textInput"
                  class="inline-text" :style="inlineTextStyle(layer)"
                  @pointerdown.stop @dblclick.stop @keydown.esc.stop.prevent="finishTextEdit(false)"
                  @keydown.ctrl.enter.stop.prevent="finishTextEdit()" @blur="finishTextEdit()" />
              </div>
            </template>
            <div v-if="selectedGroupBounds && !cropMode" class="selection group-selection" :style="selectedGroupStyle">
              <span>{{ selectedGroup?.name }} · 拖动整组</span>
            </div>
          </div>
        </div>
        <div class="stage-foot">
          <span v-if="renderError" class="render-error" role="alert">{{ renderError }}</span>
          <span v-else>{{ cropMode ? '拖动边界裁剪；拖动图片调整取景。滚轮只缩放视图。' : selectedGroup ? '拖动虚线框移动整组；Ctrl+G 解散，Alt+点击可选分组。' : selectedIds.length > 1 ? `已选 ${selectedIds.length} 层 · Ctrl+G 编组，Ctrl+C 复制。` : '双击图片裁剪，双击文字编辑；中键拖动画布，滚轮缩放视图。' }}</span>
        </div>
      </main>
      <aside class="studio-side studio-inspector">
        <div class="inspector-tabs" role="tablist" aria-label="编辑侧面板">
          <button type="button" role="tab" :aria-selected="inspectorTab === 'properties'" :class="{ active: inspectorTab === 'properties' }" @click="inspectorTab = 'properties'">属性</button>
          <button type="button" role="tab" :aria-selected="inspectorTab === 'notes'" :class="{ active: inspectorTab === 'notes' }" @click="inspectorTab = 'notes'"><FileTextOutlined />笔记<i v-if="noteDirty" aria-label="未保存" /></button>
          <button type="button" class="dock-close" title="关闭侧面板" aria-label="关闭侧面板" @click="inspectorOpen = false"><CloseOutlined /></button>
        </div>
        <div v-if="inspectorTab === 'notes'" class="inspector-scroll studio-note">
          <strong>制作笔记</strong><p>记录当前工作区的图片制作想法，在草稿之间共用。</p>
          <textarea v-model="note" maxlength="5000" :disabled="readonly" placeholder="例如：封面用竖版，标题放在底部" aria-label="制作笔记" />
          <div class="note-actions"><span role="status">{{ noteDirty ? '有未保存的笔记修改' : '笔记已保存' }}</span>
            <button type="button" :disabled="readonly || noteSaving || !noteDirty" @click="emit('saveNote')">{{ noteSaving ? '保存中…' : '保存笔记' }}</button></div>
        </div>
        <div v-else class="inspector-scroll">
        <div class="panel-heading inspector-heading"><strong>{{ selectedGroup ? '分组属性' : selected?.kind === 'image' ? '图片属性' : selected?.kind === 'text' ? '文字属性' : '画布属性' }}</strong></div>
        <template v-if="selected">
          <template v-if="selected.kind === 'image' || selected.kind === 'text'">
          <label class="field">名称<input v-model="selected.name" :disabled="readonly" @focus="fieldFocus" @change="fieldChange" /></label>
          <label class="field">所属分组<select :value="selected.groupId || ''" :disabled="readonly" @change="moveLayerToGroup(selected!.id, ($event.target as HTMLSelectElement).value || undefined)">
            <option value="">未分组</option><option v-for="group in draft.groups" :key="group.id" :value="group.id">{{ group.name }}</option></select></label>
          <div class="two-fields">
            <label class="field">X<input :value="Math.round(selected.x)" type="number" step="1" :disabled="readonly" @focus="fieldFocus" @change="frameChange('x', $event)" /></label>
            <label class="field">Y<input :value="Math.round(selected.y)" type="number" step="1" :disabled="readonly" @focus="fieldFocus" @change="frameChange('y', $event)" /></label>
            <label class="field">宽<input :value="Math.round(selected.width)" type="number" min="16" step="1" :disabled="readonly" @focus="fieldFocus" @change="frameChange('width', $event)" /></label>
            <label class="field">高<input :value="Math.round(selected.height)" type="number" min="16" step="1" :disabled="readonly" @focus="fieldFocus" @change="frameChange('height', $event)" /></label>
          </div>
          <StudioRangeControl label="旋转" :value="selected.rotation" :display="`${Math.round(selected.rotation)}°`"
            :min="-180" :max="180" :default-value="0" :disabled="readonly || selected.locked"
            @begin="fieldFocus" @input="selected.rotation = $event" @finish="fieldChange" @reset="resetSlider('rotation')" />
          <StudioRangeControl label="透明度" :value="selected.opacity" :display="`${Math.round(selected.opacity * 100)}%`"
            :min="0" :max="1" :step=".01" :default-value="1" :disabled="readonly"
            @begin="fieldFocus" @input="selected.opacity = $event" @finish="fieldChange" @reset="resetSlider('opacity')" />
          </template>
          <template v-if="imageLayer">
            <div class="inspector-actions"><button type="button" :disabled="readonly" @click="beginCrop">裁剪图片</button>
              <button type="button" :disabled="readonly" @click="resetCrop">重置裁剪</button></div>
            <label class="field">填充方式<select v-model="imageLayer.fit" :disabled="readonly" @focus="fieldFocus" @change="fieldChange">
              <option value="cover">填满</option><option value="contain">完整</option></select></label>
            <StudioRangeControl label="缩放" :value="imageLayer.zoom" :display="`${imageLayer.zoom.toFixed(1)}×`"
              :min="1" :max="8" :step=".05" :default-value="1" :disabled="readonly"
              @begin="fieldFocus" @input="imageLayer.zoom = $event" @finish="fieldChange" @reset="resetSlider('zoom')" />
            <StudioRangeControl label="亮度" :value="imageLayer.brightness" :display="`${Math.round(imageLayer.brightness)}%`"
              :min="20" :max="200" :default-value="100" :disabled="readonly"
              @begin="fieldFocus" @input="imageLayer.brightness = $event" @finish="fieldChange" @reset="resetSlider('brightness')" />
            <StudioRangeControl label="对比度" :value="imageLayer.contrast" :display="`${Math.round(imageLayer.contrast)}%`"
              :min="20" :max="200" :default-value="100" :disabled="readonly"
              @begin="fieldFocus" @input="imageLayer.contrast = $event" @finish="fieldChange" @reset="resetSlider('contrast')" />
            <StudioRangeControl label="圆角" :value="imageLayer.radius" :display="`${Math.round(imageLayer.radius)} px`"
              :min="0" :max="200" :default-value="0" :disabled="readonly"
              @begin="fieldFocus" @input="imageLayer.radius = $event" @finish="fieldChange" @reset="resetSlider('radius')" />
            <button type="button" class="wide-action" :disabled="readonly" @click="openImagePicker('replace')">替换图片</button>
          </template>
          <template v-if="textLayer">
            <label class="field">内容<textarea v-model="textLayer.text" rows="3" :disabled="readonly" @focus="fieldFocus" @change="fieldChange" /></label>
            <label class="field">字体<select v-model="textLayer.font" :disabled="readonly" @focus="fieldFocus" @change="fieldChange">
              <option v-for="font in studioFonts" :key="font.value" :value="font.value">{{ font.label }}</option></select></label>
            <label class="field">字号<input v-model.number="textLayer.fontSize" type="number" min="12" max="400" :disabled="readonly" @focus="fieldFocus" @change="fieldChange" /></label>
            <div class="inspector-actions"><button type="button" :class="{ active: textLayer.bold }" :disabled="readonly"
              @click="change(() => { textLayer!.bold = !textLayer!.bold })">粗体</button>
              <button v-for="align in ['left','center','right'] as const" :key="align" type="button"
                :class="{ active: textLayer.align === align }" :disabled="readonly"
                @click="change(() => { textLayer!.align = align })">{{ align === 'left' ? '居左' : align === 'right' ? '居右' : '居中' }}</button></div>
            <label class="field">颜色<input v-model="textLayer.color" type="color" :disabled="readonly" @focus="fieldFocus" @change="fieldChange" /></label>
          </template>
          <button v-if="imageLayer" type="button" class="wide-action" @click="openAIDialog({ kind: 'layer', id: imageLayer.id })">AI 加工</button>
        </template>
        <template v-else-if="selectedGroup">
          <label class="field">分组名称<input v-model="selectedGroup.name" :disabled="readonly" @focus="fieldFocus" @change="fieldChange" /></label>
          <div class="inspector-actions"><button type="button" @click="toggleGroup(selectedGroup!.id, 'visible')">{{ selectedGroup.visible ? '隐藏分组' : '显示分组' }}</button>
            <button type="button" @click="toggleGroup(selectedGroup!.id, 'locked')">{{ selectedGroup.locked ? '解锁分组' : '锁定分组' }}</button></div>
          <button type="button" class="wide-action" @click="openAIDialog({ kind: 'group', id: selectedGroup!.id })">合成预览 / AI 加工</button>
          <button type="button" class="wide-action" :disabled="readonly" @click="dissolveGroup(selectedGroup!.id)">解散分组（保留图层）</button>
        </template>
        <template v-else>
          <div class="canvas-presets" aria-label="画布比例预设">
            <button v-for="preset in canvasPresets" :key="preset.label" type="button"
              :class="{ active: draft.width * preset.height === draft.height * preset.width }"
              :aria-pressed="draft.width * preset.height === draft.height * preset.width"
              :disabled="readonly" @click="resizeCanvas(preset.canvasWidth,preset.canvasHeight)">{{ preset.label }}</button>
          </div>
          <div class="two-fields">
            <label class="field">宽<input :value="draft.width" type="number" min="320" max="4096" :disabled="readonly" @change="dimension('width', ($event.target as HTMLInputElement).value)" /></label>
            <label class="field">高<input :value="draft.height" type="number" min="320" max="4096" :disabled="readonly" @change="dimension('height', ($event.target as HTMLInputElement).value)" /></label>
          </div>
          <label class="field">背景色<input v-model="draft.background" type="color" :disabled="readonly" @focus="fieldFocus" @change="fieldChange" /></label>
          <h3>版式模板</h3>
          <div class="template-grid"><button v-for="layout in imageLayouts" :key="layout.key" type="button"
            :disabled="readonly" @click="template(layout.key)">{{ layout.label }}</button></div>
        </template>
        </div>
      </aside>
    </div>
    <a-modal v-model:open="saveArtifactOpen" title="保存为素材" ok-text="保存" :confirm-loading="savingArtifact" @ok="saveArtifact">
      <div class="artifact-save-form">
        <label>素材名称<a-input v-model:value="artifactName" :maxlength="120" /></label>
        <a-checkbox v-model:checked="syncToLibrary">同时同步到媒体库</a-checkbox>
        <label v-if="syncToLibrary">媒体库目录<div class="artifact-directory"><a-input v-model:value="syncDirectory" placeholder="选择媒体库扫描目录中的文件夹" /><a-button @click="browseSyncDirectory">选择目录</a-button></div></label>
      </div>
    </a-modal>
    <a-modal v-model:open="picker" :title="pickerMode === 'replace' ? '替换当前图片图层' : '从工作区添加图片'" :footer="null" width="620px">
      <div class="asset-picker-head"><input v-model="query" placeholder="搜索素材" aria-label="搜索工作区图片" />
        <a-button @click="emit('addAssets')">从媒体库加入素材</a-button></div>
      <p v-if="!imageAssets.length" class="empty">工作区还没有图片素材。</p>
      <div class="asset-grid"><div v-for="asset in filteredAssets" :key="asset.path" class="asset-tile"
        @contextmenu.prevent="showMenu($event.clientX, $event.clientY, 'asset', undefined, asset.path)">
        <button type="button" @click="addImage(asset.path, pickerMode === 'replace')">
          <img v-if="assetInfo[asset.path]" :src="toImageThumbnailUrl(assetInfo[asset.path], '256x256')" alt="" />
          <span v-else class="asset-placeholder">无法预览</span><span>{{ asset.name }}</span></button>
        <button type="button" class="asset-more" :aria-label="'更多操作：' + asset.name"
          @click="showMenu($event.clientX, $event.clientY, 'asset', undefined, asset.path)">⋯</button>
      </div></div>
    </a-modal>
    <a-modal v-model:open="renameDraftOpen" title="重命名草稿" ok-text="保存" @ok="confirmRenameDraft">
      <label class="rename-group-field">草稿名称
        <input ref="renameDraftInput" v-model="renameDraftName" maxlength="80" aria-label="草稿名称" @keyup.enter="confirmRenameDraft" />
      </label>
    </a-modal>
    <a-modal v-model:open="renameGroupOpen" title="重命名分组" ok-text="保存" @ok="confirmRenameGroup">
      <label class="rename-group-field">分组名称
        <input v-model="renameGroupName" maxlength="80" aria-label="分组名称" @keyup.enter="confirmRenameGroup" />
      </label>
    </a-modal>
    <a-modal v-model:open="createGroupOpen" title="将选中图层编组" ok-text="创建分组" @ok="confirmGroupSelection">
      <label class="rename-group-field">分组名称
        <input v-model="createGroupName" maxlength="80" aria-label="新分组名称" @keyup.enter="confirmGroupSelection" />
      </label>
      <p class="inspector-note">选中的图层会移入新分组；原分组保留，其余图层不变。</p>
    </a-modal>
    <StudioAIHandoff v-model:open="aiOpen" :doc="aiSnapshot" :scope="aiScope" :asset-info="assetInfo" :assets="assets" :workspace-id="workspaceId" @artifact-saved="emit('artifactSaved')" />
    <Teleport to="body">
      <div v-if="menu" class="studio-menu-mask" @pointerdown="menu = undefined">
        <div class="studio-menu" role="menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @pointerdown.stop>
          <template v-if="menu.kind === 'blank'">
            <button role="menuitem" @click="action('add-image')">添加图片</button><button role="menuitem" @click="action('add-text')">添加文字</button>
            <button v-if="layerClipboard" role="menuitem" :disabled="readonly" @click="action('paste')">粘贴图层 / 分组</button>
          </template>
          <template v-else-if="menu.kind === 'asset'">
            <button role="menuitem" @click="action('asset-add')">作为新图层加入</button>
            <button role="menuitem" :disabled="!imageLayer" @click="action('asset-replace')">替换选中的图片</button>
          </template>
          <template v-else-if="menu.kind === 'group'">
            <button role="menuitem" :disabled="readonly" @click="action('rename-group')">重命名分组</button>
            <button role="menuitem" @click="action('collapse-group')">{{ contextGroup?.collapsed ? '展开分组' : '收起分组' }}</button>
            <button role="menuitem" :disabled="readonly" @click="action('visibility-group')">{{ contextGroup?.visible ? '隐藏分组' : '显示分组' }}</button>
            <button role="menuitem" :disabled="readonly" @click="action('lock-group')">{{ contextGroup?.locked ? '解锁分组' : '锁定分组' }}</button>
            <button role="menuitem" @click="action('preview-group')">合成预览 / AI 加工</button>
            <button role="menuitem" @click="action('copy-group')">复制分组</button>
            <button v-if="layerClipboard" role="menuitem" :disabled="readonly" @click="action('paste')">粘贴图层 / 分组</button>
            <div class="menu-separator" role="separator" />
            <button role="menuitem" :disabled="readonly" @click="action('dissolve-group')">解散分组（保留图层）</button>
            <button role="menuitem" class="danger" :disabled="readonly" @click="action('delete-group')">删除分组及图层</button>
          </template>
          <template v-else>
            <button v-if="selected?.kind === 'text'" role="menuitem" @click="action('edit')">编辑文字</button>
            <button v-if="selected?.kind === 'image'" role="menuitem" @click="action('crop')">裁剪图片</button>
            <button v-if="selected?.kind === 'image'" role="menuitem" :disabled="readonly" @click="action('replace-image')">替换图片</button>
            <button v-if="selected?.kind === 'image'" role="menuitem" @click="action('ai-layer')">AI 加工</button>
            <button role="menuitem" @click="action('duplicate')">复制图层</button>
            <button role="menuitem" @click="action('copy')">复制到剪贴板</button>
            <button v-if="layerClipboard" role="menuitem" :disabled="readonly" @click="action('paste')">粘贴图层 / 分组</button>
            <button role="menuitem" @click="action('front')">移到最上层</button><button role="menuitem" @click="action('back')">移到最下层</button>
            <button v-if="selected?.kind === 'image'" role="menuitem" @click="action('reset')">重置裁剪</button>
            <button role="menuitem" @click="action('visibility')">{{ selected?.visible ? '隐藏' : '显示' }}</button>
            <button role="menuitem" @click="action('lock')">{{ selected?.locked ? '解锁' : '锁定' }}</button>
            <button role="menuitem" class="danger" @click="action('delete')">删除图层</button>
          </template>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.image-studio{display:flex;flex:none;flex-direction:column;gap:8px;width:100%;min-width:0;color:var(--ui-text);container-type:inline-size}
.studio-command-bar,.studio-side,.studio-stage{border:1px solid var(--ui-border);border-radius:var(--ui-radius-lg);background:var(--ui-surface)}
.studio-command-bar{display:flex;align-items:center;flex-wrap:wrap;gap:7px 12px;min-height:42px;box-sizing:border-box;padding:5px 8px}
.studio-command-actions{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:7px;margin-left:auto;min-width:0}
.panel-heading span,.layer-footer,.stage-foot,.inspector-note{font-size:11px;color:var(--ui-muted)}
.save-indicator{display:inline-flex;align-items:center;gap:6px;flex:none;padding:3px 7px;border-radius:99px;background:var(--ui-surface-soft);white-space:nowrap;font-size:10px;color:var(--ui-muted)}
.save-indicator i{width:6px;height:6px;flex:none;border-radius:50%;background:var(--ui-muted)}.save-indicator.saving i{background:var(--primary-color);animation:save-pulse 1s ease-in-out infinite}.save-indicator.saved i{background:#23966b}.save-indicator.error{color:var(--ui-danger,#b63b3b)}.save-indicator.error i{background:currentColor}
@keyframes save-pulse{50%{opacity:.35}}
.studio-export,.draft-tabs,.layer-actions,.inspector-actions,.zoom-actions,.crop-actions{display:flex;align-items:center;gap:6px}
button,select,input,textarea{font:inherit}.studio-export>button,.studio-export select,.draft-tabs button,.layer-actions button,.stage-toolbar button,.inspector-actions button,.wide-action,.template-grid button{border:1px solid var(--ui-border);border-radius:7px;background:var(--ui-surface-soft);color:var(--ui-text);cursor:pointer;padding:5px 9px;font-size:12px}
.studio-export .icon-button,.draft-tabs .icon-button{width:30px;height:30px;display:inline-grid;place-items:center;padding:0;font-size:14px}
button:hover:not(:disabled){border-color:var(--primary-color);color:var(--primary-color)}button:disabled{opacity:.45;cursor:default}
.studio-export select{height:30px}.draft-tabs{flex:1 1 250px;min-width:0;overflow-x:auto;white-space:nowrap}
.draft-tabs button{flex:none;border-color:transparent;background:transparent}.draft-tabs .active{border-color:var(--ui-border);background:var(--primary-color-1);color:var(--primary-color);font-weight:650}.draft-tabs .add-draft{margin-left:6px;border-style:dashed;border-color:var(--ui-border)}
.studio-export :deep(.ant-btn-primary){border-color:var(--primary-color);background:var(--primary-color);color:#fff;font-weight:600}.studio-export :deep(.ant-btn-primary:hover:not(:disabled)){color:#fff}
.studio-alert{padding:10px 13px;border-radius:8px;background:#fff2c9;color:#795313}
.studio-grid{position:relative;isolation:isolate;display:grid;flex:1;min-height:800px;grid-template-columns:210px minmax(0,1fr) 268px;grid-template-rows:minmax(0,1fr);gap:0;overflow:hidden;border:1px solid var(--ui-border);border-radius:var(--ui-radius-lg);background:var(--ui-surface);align-items:stretch}
.studio-grid>.studio-side,.studio-grid>.studio-stage{border:0;border-radius:0}.studio-side{min-width:0;min-height:0;overflow:hidden}.studio-layers{display:flex;flex-direction:column;padding:12px 12px 0;border-right:1px solid var(--ui-border)}.studio-inspector{display:flex;flex-direction:column;border-left:1px solid var(--ui-border)}.layer-list-area{flex:1;min-height:0;overflow:auto;margin:0 -12px;padding:11px 12px 16px;border-top:1px solid var(--ui-border);background:color-mix(in srgb,var(--ui-surface) 94%,var(--ui-text) 6%)}.panel-heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.panel-heading strong{font-size:14px}.layer-section-label{display:flex;align-items:center;gap:8px;margin:0 0 6px;color:var(--ui-muted);font-size:11px}.layer-section-label:after{content:'';height:1px;flex:1;background:var(--ui-border)}.layer-actions{margin-bottom:12px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}.layer-actions button{min-width:0;height:34px;padding:5px;font-size:16px;background:var(--ui-surface)}
.canvas-row{display:flex;align-items:center;gap:8px;width:100%;margin-bottom:12px;padding:8px;border:1px solid transparent;border-radius:7px;background:var(--ui-surface);color:var(--ui-text);text-align:left;cursor:pointer;font-size:12px}
.canvas-row>.anticon{font-size:16px;color:var(--primary-color)}.canvas-row span{font-weight:600}.canvas-row small{margin-left:auto;color:var(--ui-muted);font-size:11px}
.canvas-row:hover,.canvas-row.active{border-color:var(--primary-color);background:var(--primary-color-1)}.canvas-row:focus-visible{outline:2px solid var(--primary-color);outline-offset:2px}
.inspector-heading{gap:8px}
.empty{padding:16px 10px;background:var(--ui-surface-soft);border-radius:7px;color:var(--ui-muted);font-size:12px;line-height:1.5}
.layer-row{position:relative;display:flex;align-items:center;gap:5px;min-width:0;min-height:42px;padding:4px;border:1px solid transparent;border-radius:7px;cursor:pointer}
.layer-row.group-child{margin-left:14px}.group-row{display:flex;align-items:center;gap:5px;min-height:35px;padding:3px 4px;border:1px solid transparent;border-radius:7px;background:var(--ui-surface-soft);cursor:grab;color:var(--ui-text);font-size:11px}.group-row>.anticon{color:var(--primary-color)}.group-row>.group-status{color:var(--ui-muted)}.group-row small{color:var(--ui-muted)}.group-row button{flex:none;border:0;background:transparent;color:var(--ui-muted);padding:2px;cursor:pointer}.group-row:hover,.group-row.active{border-color:var(--primary-color);background:var(--primary-color-1)}.group-row.faded{opacity:.5}.group-row:focus-visible{outline:2px solid var(--primary-color);outline-offset:2px}
.group-row.dragging,.layer-row.dragging{opacity:.45}.group-row.drop-target,.layer-row.drop-target{outline:2px solid var(--primary-color);outline-offset:-2px;background:var(--primary-color-1)}.layer-footer.drop-target{outline:2px dashed var(--primary-color);outline-offset:2px;border-radius:5px}
.layer-row:hover,.layer-row.active{background:var(--primary-color-1)}.layer-row.active{border-color:var(--primary-color)}.layer-row.faded{opacity:.5}
.layer-row img{width:30px;height:30px;object-fit:cover;border-radius:5px;background:var(--ui-surface-soft);flex:none}.layer-symbol{display:grid;place-items:center;width:30px;height:30px;flex:none;color:var(--ui-muted)}.layer-symbol>.anticon{font-size:17px}.layer-row.active .layer-symbol{color:var(--primary-color)}
.layer-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.layer-row button{border:0;background:transparent;color:var(--ui-muted);cursor:pointer;font-size:13px;padding:2px}.layer-footer{margin-top:12px}
.studio-stage{display:flex;flex-direction:column;overflow:hidden;min-width:0;min-height:0;background:var(--ui-surface-soft)}
.stage-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:44px;padding:6px 10px;border-bottom:1px solid var(--ui-border);background:var(--ui-surface);font-size:11px}.tool-caption{color:var(--ui-muted);font-size:11px}
.studio-toolstrip{display:flex;align-items:center;gap:6px;min-width:0;overflow-x:auto;white-space:nowrap}.studio-toolstrip button{flex:none;width:31px;height:29px;display:grid;place-items:center;border:1px solid var(--ui-border);border-radius:6px;background:var(--ui-surface-soft);color:var(--ui-text);padding:0;cursor:pointer;font-size:15px}
.stage-toolbar .primary{background:var(--primary-color);color:#fff;border-color:var(--primary-color)}.crop-title{color:var(--primary-color);font-size:12px}.zoom-actions{margin-left:auto;flex:none}
.zoom-actions .history-button{width:30px;height:30px;display:inline-grid;place-items:center;padding:0;font-size:14px}
.zoom-actions .history-button:nth-of-type(3){margin-right:5px}
.artifact-save-form{display:grid;gap:16px}.artifact-save-form label{display:grid;gap:6px;font-size:12px;color:var(--ui-muted)}.artifact-directory{display:flex;gap:8px}.artifact-directory :deep(.ant-input){min-width:0}
.stage-viewport{display:flex;align-items:stretch;justify-content:flex-start;flex:1;min-height:0;padding:24px;overflow:auto;overscroll-behavior:contain;background:repeating-conic-gradient(color-mix(in srgb,var(--ui-border) 42%,transparent) 0 25%,transparent 0 50%) 50%/20px 20px}
.stage-viewport:hover{outline:2px solid color-mix(in srgb,var(--primary-color) 38%,transparent);outline-offset:-2px}
.stage-viewport:hover .artboard{box-shadow:0 0 0 2px color-mix(in srgb,var(--primary-color) 30%,transparent),0 10px 32px #0003}
.stage-viewport.panning,.stage-viewport.panning .artboard{cursor:grabbing!important}
.artboard{position:relative;flex:none;margin:auto;background:#fff;box-shadow:0 10px 32px #0003;touch-action:none;outline:none}.artboard canvas{width:100%;height:100%;display:block}
.selection{position:absolute;box-sizing:border-box;border:2px solid var(--primary-color);pointer-events:none}.selection.locked{border-style:dashed}
.group-selection{z-index:3;border-style:dashed;box-shadow:0 0 0 1px #fff9}.group-selection>span{position:absolute;left:-2px;bottom:calc(100% + 4px);max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:3px 6px;border-radius:4px;background:var(--primary-color);color:#fff;font-size:10px;line-height:1.2}
.handle{position:absolute;display:block;width:11px;height:11px;box-sizing:border-box;border:2px solid var(--primary-color);border-radius:3px;background:#fff;pointer-events:auto}
.handle.nw{left:-6px;top:-6px;cursor:nwse-resize}.handle.ne{right:-6px;top:-6px;cursor:nesw-resize}.handle.se{right:-6px;bottom:-6px;cursor:nwse-resize}.handle.sw{left:-6px;bottom:-6px;cursor:nesw-resize}
.rotation-stem{position:absolute;left:50%;top:-24px;height:22px;border-left:1px solid var(--primary-color)}.handle.rotate{left:calc(50% - 7px);top:-36px;width:14px;height:14px;border-radius:50%;cursor:grab}
.crop-box{position:absolute;box-sizing:border-box;border:2px dashed #fff;box-shadow:0 0 0 1px #202530b0;pointer-events:none}.crop-box .handle{background:#fff}
.inline-text{position:absolute;inset:0;width:100%;height:100%;box-sizing:border-box;padding-right:4px;padding-left:4px;pointer-events:auto;background:#ffffffd9;border:0;resize:none;outline:2px solid var(--primary-color)}
.stage-foot{min-height:30px;padding:8px 12px;text-align:center;background:var(--ui-surface)}.render-error{color:#b44d30}
.studio-inspector .field{display:flex;flex-direction:column;gap:3px;margin:7px 0;color:var(--ui-muted);font-size:11px}.field>span{float:right}.field input:not([type=range]),.field select,.field textarea{min-width:0;width:100%;box-sizing:border-box;padding:5px 6px;border:1px solid var(--ui-border);border-radius:6px;background:var(--ui-surface-soft);color:var(--ui-text);font-size:12px}
.field input[type=range]{width:100%;accent-color:var(--primary-color)}.field input[type=color]{height:31px;padding:2px}.two-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 8px}
.inspector-actions{flex-wrap:wrap;margin:8px 0}.inspector-actions button{flex:1;min-width:0}.inspector-actions button.active{background:var(--primary-color-1);color:var(--primary-color)}
.canvas-presets{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;margin:8px 0}.canvas-presets button{min-width:0;padding:5px 3px;border:1px solid var(--ui-border);border-radius:7px;background:var(--ui-surface-soft);color:var(--ui-text);font:inherit;font-size:11px;cursor:pointer}.canvas-presets button.active{border-color:var(--primary-color);background:var(--primary-color-1);color:var(--primary-color);font-weight:650}.canvas-presets button:focus-visible{outline:2px solid var(--primary-color);outline-offset:2px}
.studio-inspector h3{margin:11px 0 6px;font-size:12px}.template-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px}.template-grid button{padding:6px 3px}.inspector-note{line-height:1.5;margin:9px 0}.wide-action{display:block;width:100%}.wide-action+.wide-action{margin-top:6px}
.studio-grid>.studio-layers{border-right:1px solid var(--ui-border)}.studio-grid>.studio-inspector{border-left:1px solid var(--ui-border)}
.studio-export .note-entry{display:none;align-items:center;gap:5px;white-space:nowrap}.note-entry.active{border-color:var(--primary-color);color:var(--primary-color)}.note-entry i,.inspector-tabs i{display:inline-block;width:6px;height:6px;flex:none;border-radius:50%;background:var(--ui-amber,#d58b18)}
.inspector-tabs{display:flex;align-items:center;gap:2px;flex:none;height:38px;padding:3px 10px;border-bottom:1px solid var(--ui-border)}.inspector-tabs button{display:inline-flex;align-items:center;justify-content:center;gap:5px;border:0;border-radius:6px;background:transparent;color:var(--ui-muted);padding:6px 9px;cursor:pointer;font-size:12px}.inspector-tabs button.active{background:var(--primary-color-1);color:var(--primary-color);font-weight:650}.inspector-tabs .dock-close{display:none;margin-left:auto;padding:6px}.inspector-scroll{flex:1;min-height:0;overflow:auto;padding:10px 12px}.inspector-scroll .panel-heading{margin-bottom:6px}
.studio-note{display:flex;flex-direction:column;gap:9px}.studio-note strong{font-size:13px}.studio-note p{margin:0;color:var(--ui-muted);font-size:11px;line-height:1.5}.studio-note textarea{flex:1;min-height:170px;width:100%;box-sizing:border-box;resize:none;border:1px solid var(--ui-border);border-radius:7px;background:var(--ui-surface-soft);color:var(--ui-text);padding:9px;font:inherit;font-size:12px;line-height:1.6}.note-actions{display:flex;align-items:center;justify-content:space-between;gap:8px}.note-actions span{color:var(--ui-muted);font-size:10px}.note-actions button{flex:none;border:1px solid var(--primary-color);border-radius:6px;background:var(--primary-color);color:#fff;padding:6px 9px;cursor:pointer;font-size:11px}.note-actions button:disabled{opacity:.5;cursor:default}
.studio-toolstrip .dock-toggle,.zoom-actions .dock-toggle,.dock-backdrop{display:none}
.asset-picker-head{display:flex;gap:8px;margin-bottom:14px}.asset-picker-head input{flex:1;min-width:0;padding:7px;border:1px solid var(--ui-border);border-radius:7px}
.asset-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;max-height:430px;overflow:auto}.asset-tile{position:relative;min-width:0}.asset-tile>button:first-child{display:flex;flex-direction:column;width:100%;border:1px solid var(--ui-border);border-radius:8px;background:var(--ui-surface-soft);color:var(--ui-text);padding:5px;text-align:left;cursor:pointer}.asset-tile img,.asset-placeholder{width:100%;aspect-ratio:1;object-fit:cover;border-radius:5px;background:var(--ui-hover)}.asset-placeholder{display:grid;place-items:center}.asset-tile span:last-child{width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;padding-top:5px}.asset-more{position:absolute;right:8px;top:8px;border:0;border-radius:5px;background:#1e293bcc;color:#fff;cursor:pointer}
.rename-group-field{display:flex;flex-direction:column;gap:8px;color:var(--ui-muted);font-size:12px}.rename-group-field input{padding:8px 10px;border:1px solid var(--ui-border);border-radius:7px;background:var(--ui-surface);color:var(--ui-text)}
.studio-menu-mask{position:fixed;inset:0;z-index:1500}.studio-menu{position:fixed;display:flex;flex-direction:column;min-width:185px;max-height:calc(100vh - 16px);overflow-y:auto;padding:5px;border:1px solid var(--ui-border);border-radius:9px;background:var(--ui-surface);box-shadow:0 15px 35px #0004}.studio-menu button{width:100%;border:0;border-radius:5px;background:none;color:var(--ui-text);padding:7px 11px;text-align:left;cursor:pointer;font-size:12px}.studio-menu button:hover{background:var(--primary-color-1)}.studio-menu button:disabled{opacity:.4;cursor:not-allowed}.studio-menu .danger{color:#c34444}.menu-separator{height:1px;margin:4px 6px;background:var(--ui-border)}
@container(max-width:960px){
  .studio-export .note-entry{display:inline-flex}
  .studio-grid{min-height:700px;grid-template-columns:190px minmax(0,1fr)}
  .studio-grid>.studio-inspector{position:absolute;z-index:4;inset:0 0 0 auto;width:min(306px,calc(100% - 45px));box-sizing:border-box;background:var(--ui-surface);box-shadow:-12px 0 32px #0003;transform:translateX(101%);visibility:hidden;pointer-events:none;transition:transform var(--ui-motion-normal,180ms) var(--ui-ease,ease),visibility 0s linear var(--ui-motion-normal,180ms)}
  .studio-grid.inspector-open>.studio-inspector{transform:none;visibility:visible;pointer-events:auto;transition:transform var(--ui-motion-normal,180ms) var(--ui-ease,ease)}
  .studio-grid.inspector-open>.dock-backdrop{display:block;position:absolute;z-index:3;inset:0;width:100%;height:100%;border:0;border-radius:0;background:#091d2b55;cursor:default}
  .studio-inspector .dock-close,.zoom-actions .dock-toggle{display:inline-grid}
  .stage-toolbar{flex-wrap:wrap}.studio-toolstrip{flex-wrap:wrap;overflow:visible;white-space:normal}
}
@container(max-width:690px){
  .draft-tabs{flex-basis:100%}.studio-command-actions{width:100%;justify-content:flex-end}.studio-export{flex-wrap:wrap;justify-content:flex-end}
  .studio-grid{min-height:640px;grid-template-columns:minmax(0,1fr)}
  .studio-grid>.studio-layers{position:absolute;z-index:4;inset:0 auto 0 0;width:min(248px,calc(100% - 45px));box-sizing:border-box;background:var(--ui-surface);box-shadow:12px 0 32px #0003;transform:translateX(-101%);visibility:hidden;pointer-events:none;transition:transform var(--ui-motion-normal,180ms) var(--ui-ease,ease),visibility 0s linear var(--ui-motion-normal,180ms)}
  .studio-grid.layers-open>.studio-layers{transform:none;visibility:visible;pointer-events:auto;transition:transform var(--ui-motion-normal,180ms) var(--ui-ease,ease)}
  .studio-grid.layers-open>.dock-backdrop{display:block;position:absolute;z-index:3;inset:0;width:100%;height:100%;border:0;border-radius:0;background:#091d2b55;cursor:default}
  .studio-toolstrip .dock-toggle{display:inline-grid}.asset-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
}
@media(prefers-reduced-motion:reduce){.save-indicator.saving i{animation:none}.studio-grid>.studio-layers,.studio-grid>.studio-inspector{transition:none!important}}
</style>
