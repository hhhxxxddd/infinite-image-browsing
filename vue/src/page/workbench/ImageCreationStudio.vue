<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { EyeOutlined, EyeInvisibleOutlined, LockOutlined, UnlockOutlined, MoreOutlined } from '@ant-design/icons-vue'
import type { FileNodeInfo } from '@/api/files'
import { toImageThumbnailUrl } from '@/util/file'
import type { WorkspaceAsset } from './workspaceModel'
import { imageLayouts, type ImageLayout } from './imageCreationModel'
import { applyStudioTemplate, cropStudioImage, createImageLayer, createStudioDocument, createTextLayer, legacyStudioKey,
  migrateImageDraft, readStudioDocument, readStudioIndex, reorderStudioLayer, scaleStudioDocument,
  studioDocumentKey, studioIndexKey, type StudioCrop, type StudioDocument,
  type StudioDocumentIndex, type StudioLayer } from './imageStudioModel'
import { clearStudioImageCache, renderStudioDocument, studioImageDimensions } from './imageStudioRender'

const props = defineProps<{ workspaceId: string; workspaceName: string; assets: WorkspaceAsset[];
  assetInfo: Record<string, FileNodeInfo>; readonly?: boolean }>()
const emit = defineEmits<{ addAssets: [] }>()
const imageAssets = computed(() => props.assets.filter(asset => asset.kind === 'image'))
const docs = ref<StudioDocumentIndex['docs']>([])
const draft = ref<StudioDocument>(createStudioDocument())
const selectedId = ref('')
const selected = computed(() => draft.value.layers.find(layer => layer.id === selectedId.value))
const imageLayer = computed(() => selected.value?.kind === 'image' ? selected.value : undefined)
const textLayer = computed(() => selected.value?.kind === 'text' ? selected.value : undefined)
const canvas = ref<HTMLCanvasElement>()
const viewport = ref<HTMLElement>()
const board = ref<HTMLElement>()
const boardSize = ref({ width: 700, height: 600 })
const viewZoom = ref(1)
const fitScale = computed(() => Math.min(1, (boardSize.value.width - 48) / draft.value.width,
  (boardSize.value.height - 48) / draft.value.height))
const scale = computed(() => Math.max(.03, fitScale.value * viewZoom.value))
const boardStyle = computed(() => ({ width: draft.value.width * scale.value + 'px',
  height: draft.value.height * scale.value + 'px' }))
const format = ref<'png' | 'jpeg'>('png')
const exporting = ref(false)
const renderError = ref('')
const storageError = ref('')
const picker = ref(false)
const query = ref('')
const filteredAssets = computed(() => imageAssets.value.filter(asset => asset.name.toLowerCase().includes(query.value.toLowerCase())))
const menu = ref<{ x: number; y: number; kind: 'layer' | 'blank' | 'asset'; id?: string; path?: string }>()
const cropMode = ref(false)
const cropSelection = ref<StudioCrop>({ x: 0, y: 0, width: 1, height: 1 })
const cropBefore = ref('')
const editingText = ref(false)
const textInput = ref('')
const textArea = ref<HTMLTextAreaElement>()
const histories = new Map<string, { undo: string[]; redo: string[] }>()
const canUndo = ref(false), canRedo = ref(false)
let saveTimer: ReturnType<typeof setTimeout> | undefined
let previewRevision = 0
let previewFrame: number | undefined
let observer: ResizeObserver | undefined
let inspectorBefore = ''
let restoring = false
const snapshot = () => JSON.stringify(draft.value)
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
function undo() { const item = history(), old = item.undo.pop(); if (!old) return
  item.redo.push(snapshot()); draft.value = readStudioDocument(JSON.parse(old)) ?? draft.value; refreshHistory() }
function redo() { const item = history(), next = item.redo.pop(); if (!next) return
  item.undo.push(snapshot()); draft.value = readStudioDocument(JSON.parse(next)) ?? draft.value; refreshHistory() }
function persist() {
  if (!props.workspaceId || restoring) return
  try {
    const updatedAt = new Date().toISOString()
    const meta = { id: draft.value.id, name: draft.value.name, updatedAt }
    docs.value = docs.value.some(item => item.id === meta.id) ? docs.value.map(item => item.id === meta.id ? meta : item) : [...docs.value, meta]
    localStorage.setItem(studioDocumentKey(props.workspaceId, draft.value.id), JSON.stringify({ ...draft.value, updatedAt }))
    localStorage.setItem(studioIndexKey(props.workspaceId), JSON.stringify({ version: 2, activeId: draft.value.id, docs: docs.value }))
    storageError.value = ''
  } catch { storageError.value = '本机草稿保存失败，请检查可用空间。' }
}
function flush() { if (saveTimer) clearTimeout(saveTimer); saveTimer = undefined; persist() }
function schedule() { if (restoring) return; if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(flush, 250) }
function restore(id: string) {
  restoring = true; histories.clear(); selectedId.value = ''; cropMode.value = false
  try {
    const index = readStudioIndex(JSON.parse(localStorage.getItem(studioIndexKey(id)) || 'null'))
    const available = index?.docs.map(meta => {
      try { return readStudioDocument(JSON.parse(localStorage.getItem(studioDocumentKey(id, meta.id)) || 'null')) }
      catch { return undefined }
    }) ?? []
    const current = available.find(item => item?.id === index?.activeId) ?? available.find(Boolean)
    if (current) { draft.value = current; docs.value = index!.docs.filter(meta => available.some(item => item?.id === meta.id)) }
    else {
      const legacy = localStorage.getItem(legacyStudioKey(id))
      draft.value = legacy ? migrateImageDraft(JSON.parse(legacy)) : createStudioDocument()
      docs.value = [{ id: draft.value.id, name: draft.value.name, updatedAt: draft.value.updatedAt }]
    }
  } catch { draft.value = createStudioDocument(); docs.value = [{ id: draft.value.id, name: draft.value.name, updatedAt: draft.value.updatedAt }] }
  restoring = false; refreshHistory(); schedule(); schedulePreview()
}
watch(() => props.workspaceId, (id, old) => { if (old) flush(); restore(id) }, { immediate: true })
watch(draft, () => { schedule(); schedulePreview() }, { deep: true })
watch(() => props.assetInfo, () => { clearStudioImageCache(); schedulePreview() })
function visibility() { if (document.visibilityState === 'hidden') flush() }
onMounted(() => {
  observer = new ResizeObserver(() => { if (viewport.value) boardSize.value = { width: viewport.value.clientWidth, height: viewport.value.clientHeight } })
  if (viewport.value) observer.observe(viewport.value)
  document.addEventListener('visibilitychange', visibility)
  window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup)
  schedulePreview()
})
onBeforeUnmount(() => { flush(); observer?.disconnect(); document.removeEventListener('visibilitychange', visibility)
  if (previewFrame !== undefined) cancelAnimationFrame(previewFrame)
  window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup) })
function schedulePreview() { if (previewFrame !== undefined) return
  previewFrame = requestAnimationFrame(() => { previewFrame = undefined; void preview() }) }
function createDraft() {
  if (docs.value.length >= 100) return
  flush(); draft.value = createStudioDocument('未命名图片 ' + (docs.value.length + 1))
  selectedId.value = ''; docs.value.push({ id: draft.value.id, name: draft.value.name, updatedAt: draft.value.updatedAt }); refreshHistory(); persist()
}
function switchDraft(id: string) {
  if (draft.value.id === id) return
  flush()
  try { const item = readStudioDocument(JSON.parse(localStorage.getItem(studioDocumentKey(props.workspaceId, id)) || 'null'))
    if (!item) throw new Error(); draft.value = item; selectedId.value = ''; cropMode.value = false; refreshHistory(); persist()
  } catch { message.error('草稿无法打开') }
}
function renameDraft() { const name = window.prompt('草稿名称', draft.value.name)?.trim()
  if (name) change(() => { draft.value.name = name.slice(0, 80) }) }
function deleteDraft() {
  Modal.confirm({ title: '删除草稿“' + draft.value.name + '”？', content: '本机图层草稿会删除，引用的素材文件不会删除。',
    okText: '删除草稿', okType: 'danger', onOk: () => {
      const id = draft.value.id, index = docs.value.findIndex(item => item.id === id)
      docs.value = docs.value.filter(item => item.id !== id)
      localStorage.removeItem(studioDocumentKey(props.workspaceId, id)); histories.delete(id)
      if (docs.value.length) {
        const nextId = docs.value[Math.max(0, index - 1)].id
        const item = readStudioDocument(JSON.parse(localStorage.getItem(studioDocumentKey(props.workspaceId, nextId)) || 'null'))
        if (item) { draft.value = item; selectedId.value = ''; refreshHistory(); persist() }
      }
      else { draft.value = createStudioDocument(); docs.value = [{ id: draft.value.id, name: draft.value.name, updatedAt: draft.value.updatedAt }]; persist() }
    } })
}
async function preview() {
  const revision = ++previewRevision; await nextTick(); if (!canvas.value) return
  try { const target = document.createElement('canvas')
    const failures = await renderStudioDocument(target, JSON.parse(snapshot()), props.assetInfo, true)
    if (revision === previewRevision && canvas.value) {
      canvas.value.width = target.width; canvas.value.height = target.height
      canvas.value.getContext('2d')?.drawImage(target, 0, 0)
      renderError.value = failures.length ? '无法读取图层：' + failures.join('、') : ''
    }
  } catch { if (revision === previewRevision) renderError.value = '画布预览失败' }
}
async function exportImage() {
  if (exporting.value) return
  exporting.value = true; flush()
  try {
    const target = document.createElement('canvas')
    const failures = await renderStudioDocument(target, JSON.parse(snapshot()), props.assetInfo, false)
    if (failures.length) throw new Error('无法读取图层：' + failures.join('、'))
    const blob = await new Promise<Blob | null>(resolve => target.toBlob(resolve, format.value === 'jpeg' ? 'image/jpeg' : 'image/png', .93))
    if (!blob) throw new Error('导出失败，请缩小画布尺寸')
    const url = URL.createObjectURL(blob), link = document.createElement('a')
    link.href = url; link.download = draft.value.name.replace(/[\\/:*?"<>|]/g, '_') + (format.value === 'jpeg' ? '.jpg' : '.png')
    document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000)
    message.success('图片已下载，可手动加入工作区输出文件')
  } catch (error) { message.error(error instanceof Error ? error.message : '导出失败') }
  finally { exporting.value = false }
}
function addImage(path: string, replace = false) {
  const asset = imageAssets.value.find(item => item.path === path); if (!asset) return
  change(() => {
    if (replace && imageLayer.value) { imageLayer.value.path = path; imageLayer.value.name = asset.name
      imageLayer.value.crop = { x: 0, y: 0, width: 1, height: 1 }; imageLayer.value.zoom = 1 }
    else { const size = Math.min(draft.value.width, draft.value.height) * .62
      const layer = createImageLayer(path, { x: (draft.value.width - size) / 2, y: (draft.value.height - size) / 2, width: size, height: size }, asset.name)
      draft.value.layers.push(layer); selectedId.value = layer.id }
  })
  picker.value = false; menu.value = undefined
}
function addText() { change(() => { const layer = createTextLayer({ x: draft.value.width * .15, y: draft.value.height * .43,
  width: draft.value.width * .7, height: 130 }); draft.value.layers.push(layer); selectedId.value = layer.id }); menu.value = undefined }
function template(layout: ImageLayout) { change(() => { draft.value = applyStudioTemplate(JSON.parse(snapshot()), layout) }) }
function resizeCanvas(width: number, height: number) { change(() => { draft.value = scaleStudioDocument(JSON.parse(snapshot()), width, height) }) }
function dimension(which: 'width' | 'height', raw: string) { const size = Math.round(Math.min(4096, Math.max(320, Number(raw) || 1080)))
  resizeCanvas(which === 'width' ? size : draft.value.width, which === 'height' ? size : draft.value.height) }
function fieldFocus() { inspectorBefore = snapshot() }
function fieldChange() { if (inspectorBefore) record(inspectorBefore); inspectorBefore = '' }
function duplicate() { if (!selected.value) return; change(() => { const copy = JSON.parse(JSON.stringify(selected.value)) as StudioLayer
  copy.id = crypto.randomUUID(); copy.name += ' 副本'; copy.x += 24; copy.y += 24
  draft.value.layers.splice(draft.value.layers.indexOf(selected.value!) + 1, 0, copy); selectedId.value = copy.id }) }
function moveLayer(where: 'front' | 'back') { if (!selected.value) return; change(() => {
  const index = draft.value.layers.indexOf(selected.value!), [layer] = draft.value.layers.splice(index, 1)
  draft.value.layers.splice(where === 'front' ? draft.value.layers.length : 0, 0, layer) }) }
function removeLayer() { if (!selected.value) return; change(() => { draft.value.layers = draft.value.layers.filter(item => item.id !== selectedId.value); selectedId.value = '' }) }
function resetCrop() { if (imageLayer.value) change(() => { imageLayer.value!.crop = { x: 0, y: 0, width: 1, height: 1 }
  imageLayer.value!.zoom = 1; imageLayer.value!.focusX = .5; imageLayer.value!.focusY = .5 }) }
function toggle(id: string, key: 'visible' | 'locked') { change(() => { const layer = draft.value.layers.find(item => item.id === id); if (layer) layer[key] = !layer[key] }) }
const orderedLayers = computed(() => [...draft.value.layers].reverse())
let dragId = ''
function reorder(to: string) { if (dragId && dragId !== to) change(() => { draft.value = reorderStudioLayer(JSON.parse(snapshot()), dragId, to) }); dragId = '' }
function layerStyle(layer: StudioLayer) { return { left: layer.x * scale.value + 'px', top: layer.y * scale.value + 'px',
  width: layer.width * scale.value + 'px', height: layer.height * scale.value + 'px', transform: `rotate(${layer.rotation}deg)` } }
function point(event: MouseEvent | PointerEvent) { const rect = board.value!.getBoundingClientRect()
  return { x: (event.clientX - rect.left) / scale.value, y: (event.clientY - rect.top) / scale.value } }
function localPoint(layer: StudioLayer, p: { x: number; y: number }) {
  const dx = p.x - layer.x - layer.width / 2, dy = p.y - layer.y - layer.height / 2
  const a = -layer.rotation * Math.PI / 180
  return { x: (dx * Math.cos(a) - dy * Math.sin(a)) / layer.width + .5,
    y: (dx * Math.sin(a) + dy * Math.cos(a)) / layer.height + .5 }
}
function hit(p: { x: number; y: number }) { return [...draft.value.layers].reverse().find(layer => {
  if (!layer.visible) return false
  const q = localPoint(layer, p); return q.x >= 0 && q.x <= 1 && q.y >= 0 && q.y <= 1
}) }
function rotatedDelta(dx: number, dy: number, angle: number) {
  const a = -angle * Math.PI / 180
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) }
}
type Gesture = { mode: 'move' | 'resize' | 'rotate' | 'crop-edge' | 'crop-pan' | 'pan'; before: string;
  start: { x: number; y: number }; frame?: { x: number; y: number; width: number; height: number; rotation: number };
  handle?: string; crop?: StudioCrop; focus?: { x: number; y: number }; scroll?: { x: number; y: number } }
let gesture: Gesture | undefined, space = false
function pointerDown(event: PointerEvent) {
  if (event.button !== 0 || editingText.value) return
  menu.value = undefined
  const p = point(event)
  if (space) { gesture = { mode: 'pan', before: '', start: { x: event.clientX, y: event.clientY },
    scroll: { x: viewport.value!.scrollLeft, y: viewport.value!.scrollTop } }
    board.value?.setPointerCapture(event.pointerId); event.preventDefault(); return }
  const handle = (event.target as HTMLElement).closest<HTMLElement>('[data-handle]')?.dataset.handle
  const layer = handle ? selected.value : hit(p)
  if (cropMode.value && layer?.id !== selectedId.value) return
  if (!layer) { selectedId.value = ''; return }
  selectedId.value = layer.id
  if (layer.locked || props.readonly) return
  gesture = { mode: cropMode.value ? (handle?.startsWith('crop-') ? 'crop-edge' : 'crop-pan') :
    handle === 'rotate' ? 'rotate' : handle ? 'resize' : 'move',
    before: snapshot(), start: p, handle,
    frame: { x: layer.x, y: layer.y, width: layer.width, height: layer.height, rotation: layer.rotation },
    crop: { ...cropSelection.value }, focus: layer.kind === 'image' ? { x: layer.focusX, y: layer.focusY } : undefined }
  board.value?.setPointerCapture(event.pointerId); event.preventDefault()
}
function pointerMove(event: PointerEvent) {
  if (!gesture) return
  if (gesture.mode === 'pan') { viewport.value!.scrollLeft = gesture.scroll!.x - (event.clientX - gesture.start.x)
    viewport.value!.scrollTop = gesture.scroll!.y - (event.clientY - gesture.start.y); return }
  const layer = selected.value, frame = gesture.frame
  if (!layer || !frame) return
  const p = point(event), dx = p.x - gesture.start.x, dy = p.y - gesture.start.y
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
function pointerUp() { if (!gesture) return; if (gesture.mode !== 'pan' && !cropMode.value) record(gesture.before); gesture = undefined }
function wheel(event: WheelEvent) {
  if (cropMode.value && imageLayer.value && !props.readonly) { event.preventDefault()
    imageLayer.value.zoom = Math.max(1, Math.min(8, imageLayer.value.zoom * (event.deltaY < 0 ? 1.08 : .92))) }
  else if (event.ctrlKey) { event.preventDefault(); viewZoom.value = Math.max(.3, Math.min(4, viewZoom.value * (event.deltaY < 0 ? 1.1 : .9))) }
}
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
  if (commit && textLayer.value) { textLayer.value.text = textInput.value; record(inspectorBefore) }; editingText.value = false }
function doubleClick(event: MouseEvent) { const layer = hit(point(event)); if (!layer) return
  selectedId.value = layer.id; if (layer.kind === 'image') beginCrop(); else beginTextEdit() }
function showMenu(x: number, y: number, kind: 'layer' | 'blank' | 'asset', id?: string, path?: string) {
  menu.value = { x: Math.max(8, Math.min(x, innerWidth - 180)), y: Math.max(8, Math.min(y, innerHeight - 320)), kind, id, path }
}
function context(event: MouseEvent) { event.preventDefault(); const layer = hit(point(event))
  if (layer) { selectedId.value = layer.id; showMenu(event.clientX, event.clientY, 'layer', layer.id) }
  else showMenu(event.clientX, event.clientY, 'blank') }
function action(name: string) {
  const current = menu.value; if (!current) return
  if (current.id) selectedId.value = current.id
  menu.value = undefined
  switch (name) {
    case 'add-image': picker.value = true; break
    case 'add-text': addText(); break
    case 'asset-add': if (current.path) addImage(current.path); break
    case 'asset-replace': if (current.path) addImage(current.path, true); break
    case 'edit': beginTextEdit(); break
    case 'crop': beginCrop(); break
    case 'duplicate': duplicate(); break
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
  if (target?.closest('input,textarea,[contenteditable=true]')) return
  if (event.code === 'Space') { space = true; return }
  if (event.key === 'Escape') { if (cropMode.value) cancelCrop(); else menu.value = undefined; return }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return }
  if (event.key === 'Delete' && selected.value && !props.readonly) { event.preventDefault(); removeLayer(); return }
  const step = event.shiftKey ? 10 : 1
  const motions: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
  if (motions[event.key] && selected.value && !selected.value.locked && !props.readonly) { event.preventDefault()
    change(() => { selected.value!.x += motions[event.key][0]; selected.value!.y += motions[event.key][1] }) }
}
function keyup(event: KeyboardEvent) { if (event.code === 'Space') space = false }
</script>

<template>
  <div class="image-studio" @click="menu = undefined">
    <header class="studio-top">
      <div class="studio-title"><strong>图片制作</strong><span>{{ workspaceName }} · 草稿保存在本机</span></div>
      <div class="studio-export">
        <button type="button" :disabled="!canUndo || readonly" title="撤销 Ctrl+Z" @click="undo">↶ 撤销</button>
        <button type="button" :disabled="!canRedo || readonly" title="重做 Ctrl+Y" @click="redo">↷ 重做</button>
        <select v-model="format" aria-label="导出格式"><option value="png">PNG</option><option value="jpeg">JPG</option></select>
        <a-button type="primary" :loading="exporting" @click="exportImage">下载图片</a-button>
      </div>
    </header>
    <nav class="draft-tabs" aria-label="图片草稿">
      <button v-for="item in docs" :key="item.id" type="button" class="draft-tab"
        :class="{ active: item.id === draft.id }" :aria-current="item.id === draft.id ? 'page' : undefined"
        @click="switchDraft(item.id)">{{ item.name }}</button>
      <button type="button" class="add-draft" :disabled="readonly" @click="createDraft">＋ 新建草稿</button>
      <button type="button" class="draft-more" :disabled="readonly" title="重命名当前草稿" @click="renameDraft">重命名</button>
      <button type="button" class="draft-more" :disabled="readonly" title="删除当前草稿" @click="deleteDraft">删除</button>
    </nav>
    <div v-if="storageError" class="studio-alert" role="alert">{{ storageError }}</div>
    <div class="studio-grid">
      <aside class="studio-side studio-layers">
        <div class="panel-heading"><strong>图层</strong><span>{{ draft.layers.length }} 层</span></div>
        <div class="layer-actions">
          <button type="button" :disabled="readonly" @click="picker = true">＋ 添加图片</button>
          <button type="button" :disabled="readonly" @click="addText">＋ 添加文字</button>
        </div>
        <p v-if="!draft.layers.length" class="empty">从工作区素材添加图片，或在画布中添加文字。</p>
        <div v-for="layer in orderedLayers" :key="layer.id" class="layer-row"
          :class="{ active: selectedId === layer.id, faded: !layer.visible }"
          :draggable="!readonly" @dragstart="dragId = layer.id" @dragover.prevent @drop.prevent="reorder(layer.id)"
          @click="selectedId = layer.id"
          @contextmenu.prevent.stop="showMenu($event.clientX, $event.clientY, 'layer', layer.id)">
          <img v-if="layer.kind === 'image' && assetInfo[layer.path]" :src="toImageThumbnailUrl(assetInfo[layer.path], '96x96')" alt="" />
          <span v-else class="layer-symbol">{{ layer.kind === 'image' ? '▧' : 'T' }}</span>
          <span class="layer-name" :title="layer.name">{{ layer.name }}</span>
          <button type="button" :aria-label="layer.visible ? '隐藏图层' : '显示图层'" :title="layer.visible ? '隐藏' : '显示'"
            @click.stop="toggle(layer.id, 'visible')"><EyeOutlined v-if="layer.visible" /><EyeInvisibleOutlined v-else /></button>
          <button type="button" :aria-label="layer.locked ? '解锁图层' : '锁定图层'" :title="layer.locked ? '解锁' : '锁定'"
            @click.stop="toggle(layer.id, 'locked')"><LockOutlined v-if="layer.locked" /><UnlockOutlined v-else /></button>
          <button type="button" :aria-label="'更多操作：' + layer.name" title="更多操作"
            @click.stop="selectedId = layer.id; showMenu($event.clientX, $event.clientY, 'layer', layer.id)"><MoreOutlined /></button>
        </div>
        <div class="layer-footer">拖动图层可调整叠放顺序</div>
      </aside>
      <main class="studio-stage">
        <div class="stage-toolbar">
          <span>{{ draft.width }} × {{ draft.height }}</span>
          <span v-if="cropMode" class="crop-actions"><strong>裁剪图片</strong><button type="button" @click="cancelCrop">取消</button><button type="button" class="primary" @click="finishCrop">完成</button></span>
          <span v-else class="zoom-actions">
            <button type="button" title="缩小画布" @click="viewZoom = Math.max(.3, viewZoom / 1.2)">−</button>
            <button type="button" title="适应窗口" @click="viewZoom = 1">{{ Math.round(viewZoom * 100) }}%</button>
            <button type="button" title="放大画布" @click="viewZoom = Math.min(4, viewZoom * 1.2)">＋</button>
          </span>
        </div>
        <div ref="viewport" class="stage-viewport">
          <div ref="board" class="artboard" :style="boardStyle" tabindex="0" aria-label="图片画布"
            @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerUp"
            @dblclick="doubleClick" @contextmenu="context" @wheel="wheel">
            <canvas ref="canvas" />
            <template v-for="layer in draft.layers" :key="layer.id">
              <div v-if="layer.id === selectedId && layer.visible" class="selection" :class="{ locked: layer.locked }" :style="layerStyle(layer)">
                <template v-if="!layer.locked && !cropMode">
                  <i v-for="handle in ['nw','ne','se','sw']" :key="handle" :class="'handle ' + handle" :data-handle="handle" />
                  <i class="rotation-stem" /><i class="handle rotate" data-handle="rotate" title="旋转" />
                </template>
                <div v-if="cropMode && layer.kind === 'image'" class="crop-box"
                  :style="{ left: cropSelection.x * 100 + '%', top: cropSelection.y * 100 + '%',
                    width: cropSelection.width * 100 + '%', height: cropSelection.height * 100 + '%' }">
                  <i v-for="handle in ['nw','ne','se','sw']" :key="handle" :class="'handle ' + handle" :data-handle="'crop-' + handle" />
                </div>
                <textarea v-if="editingText && layer.kind === 'text'" ref="textArea" v-model="textInput"
                  class="inline-text" :style="{ fontSize: layer.fontSize * scale + 'px', color: layer.color, textAlign: layer.align,
                    fontFamily: layer.font, fontWeight: layer.bold ? 700 : 400, opacity: layer.opacity }"
                  @pointerdown.stop @dblclick.stop @keydown.esc.stop.prevent="finishTextEdit(false)"
                  @keydown.ctrl.enter.stop.prevent="finishTextEdit()" @blur="finishTextEdit()" />
              </div>
            </template>
          </div>
        </div>
        <div class="stage-foot">
          <span v-if="renderError" class="render-error" role="alert">{{ renderError }}</span>
          <span v-else>{{ cropMode ? '拖动边界裁剪；拖动图片调整取景，滚轮缩放。' : '双击图片裁剪，双击文字编辑；按住空格拖动画布。' }}</span>
        </div>
      </main>
      <aside class="studio-side studio-inspector">
        <div class="panel-heading"><strong>{{ selected ? selected.kind === 'image' ? '图片属性' : '文字属性' : '画布属性' }}</strong></div>
        <template v-if="selected">
          <label class="field">名称<input v-model="selected.name" :disabled="readonly" @focus="fieldFocus" @change="fieldChange" /></label>
          <div class="two-fields">
            <label class="field">X<input v-model.number="selected.x" type="number" :disabled="readonly" @focus="fieldFocus" @change="fieldChange" /></label>
            <label class="field">Y<input v-model.number="selected.y" type="number" :disabled="readonly" @focus="fieldFocus" @change="fieldChange" /></label>
            <label class="field">宽<input v-model.number="selected.width" type="number" min="16" :disabled="readonly" @focus="fieldFocus" @change="fieldChange" /></label>
            <label class="field">高<input v-model.number="selected.height" type="number" min="16" :disabled="readonly" @focus="fieldFocus" @change="fieldChange" /></label>
          </div>
          <label class="field">旋转 <span>{{ Math.round(selected.rotation) }}°</span>
            <input v-model.number="selected.rotation" type="range" min="-180" max="180" :disabled="readonly || selected.locked" @pointerdown="fieldFocus" @change="fieldChange" />
          </label>
          <label class="field">透明度 <span>{{ Math.round(selected.opacity * 100) }}%</span>
            <input v-model.number="selected.opacity" type="range" min="0" max="1" step=".01" :disabled="readonly" @pointerdown="fieldFocus" @change="fieldChange" />
          </label>
          <template v-if="imageLayer">
            <div class="inspector-actions"><button type="button" :disabled="readonly" @click="beginCrop">裁剪图片</button>
              <button type="button" :disabled="readonly" @click="resetCrop">重置裁剪</button></div>
            <label class="field">填充方式<select v-model="imageLayer.fit" :disabled="readonly" @focus="fieldFocus" @change="fieldChange">
              <option value="cover">填满</option><option value="contain">完整</option></select></label>
            <label class="field">缩放 <span>{{ imageLayer.zoom.toFixed(1) }}×</span>
              <input v-model.number="imageLayer.zoom" type="range" min="1" max="8" step=".05" :disabled="readonly" @pointerdown="fieldFocus" @change="fieldChange" /></label>
            <label class="field">亮度<input v-model.number="imageLayer.brightness" type="range" min="20" max="200" :disabled="readonly" @pointerdown="fieldFocus" @change="fieldChange" /></label>
            <label class="field">对比度<input v-model.number="imageLayer.contrast" type="range" min="20" max="200" :disabled="readonly" @pointerdown="fieldFocus" @change="fieldChange" /></label>
            <label class="field">圆角<input v-model.number="imageLayer.radius" type="range" min="0" max="200" :disabled="readonly" @pointerdown="fieldFocus" @change="fieldChange" /></label>
            <button type="button" class="wide-action" :disabled="readonly" @click="picker = true">替换图片</button>
          </template>
          <template v-if="textLayer">
            <label class="field">内容<textarea v-model="textLayer.text" rows="3" :disabled="readonly" @focus="fieldFocus" @change="fieldChange" /></label>
            <label class="field">字体<select v-model="textLayer.font" :disabled="readonly" @focus="fieldFocus" @change="fieldChange">
              <option value="system-ui">系统字体</option><option value="Arial">Arial</option><option value="Georgia">Georgia</option><option value="monospace">等宽</option></select></label>
            <label class="field">字号<input v-model.number="textLayer.fontSize" type="number" min="12" max="400" :disabled="readonly" @focus="fieldFocus" @change="fieldChange" /></label>
            <div class="inspector-actions"><button type="button" :class="{ active: textLayer.bold }" :disabled="readonly"
              @click="change(() => { textLayer!.bold = !textLayer!.bold })">粗体</button>
              <button v-for="align in ['left','center','right'] as const" :key="align" type="button"
                :class="{ active: textLayer.align === align }" :disabled="readonly"
                @click="change(() => { textLayer!.align = align })">{{ align === 'left' ? '居左' : align === 'right' ? '居右' : '居中' }}</button></div>
            <label class="field">颜色<input v-model="textLayer.color" type="color" :disabled="readonly" @focus="fieldFocus" @change="fieldChange" /></label>
          </template>
        </template>
        <template v-else>
          <div class="inspector-actions canvas-sizes">
            <button type="button" :disabled="readonly" @click="resizeCanvas(1080,1080)">方形</button>
            <button type="button" :disabled="readonly" @click="resizeCanvas(1080,1350)">竖版</button>
            <button type="button" :disabled="readonly" @click="resizeCanvas(1600,900)">横版</button>
          </div>
          <div class="two-fields">
            <label class="field">宽<input :value="draft.width" type="number" min="320" max="4096" :disabled="readonly" @change="dimension('width', ($event.target as HTMLInputElement).value)" /></label>
            <label class="field">高<input :value="draft.height" type="number" min="320" max="4096" :disabled="readonly" @change="dimension('height', ($event.target as HTMLInputElement).value)" /></label>
          </div>
          <label class="field">背景色<input v-model="draft.background" type="color" :disabled="readonly" @focus="fieldFocus" @change="fieldChange" /></label>
          <h3>版式模板</h3>
          <div class="template-grid"><button v-for="layout in imageLayouts" :key="layout.key" type="button"
            :disabled="readonly" @click="template(layout.key)">{{ layout.label }}</button></div>
          <p class="inspector-note">按可见图片图层顺序重排；文字与额外图层保持原位。</p>
        </template>
        <p class="inspector-note">下载后可手动将成品加入工作区输出文件；原素材不会修改。</p>
      </aside>
    </div>
    <a-modal v-model:open="picker" title="从工作区添加图片" :footer="null" width="620px">
      <div class="asset-picker-head"><input v-model="query" placeholder="搜索素材" aria-label="搜索工作区图片" />
        <a-button @click="emit('addAssets')">从媒体库加入素材</a-button></div>
      <p v-if="!imageAssets.length" class="empty">工作区还没有图片素材。</p>
      <div class="asset-grid"><div v-for="asset in filteredAssets" :key="asset.path" class="asset-tile"
        @contextmenu.prevent="showMenu($event.clientX, $event.clientY, 'asset', undefined, asset.path)">
        <button type="button" @click="addImage(asset.path)">
          <img v-if="assetInfo[asset.path]" :src="toImageThumbnailUrl(assetInfo[asset.path], '256x256')" alt="" />
          <span v-else class="asset-placeholder">无法预览</span><span>{{ asset.name }}</span></button>
        <button type="button" class="asset-more" :aria-label="'更多操作：' + asset.name"
          @click="showMenu($event.clientX, $event.clientY, 'asset', undefined, asset.path)">⋯</button>
      </div></div>
    </a-modal>
    <Teleport to="body">
      <div v-if="menu" class="studio-menu-mask" @pointerdown="menu = undefined">
        <div class="studio-menu" role="menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @pointerdown.stop>
          <template v-if="menu.kind === 'blank'">
            <button role="menuitem" @click="action('add-image')">添加图片</button><button role="menuitem" @click="action('add-text')">添加文字</button>
          </template>
          <template v-else-if="menu.kind === 'asset'">
            <button role="menuitem" @click="action('asset-add')">作为新图层加入</button>
            <button role="menuitem" :disabled="!imageLayer" @click="action('asset-replace')">替换选中的图片</button>
          </template>
          <template v-else>
            <button v-if="selected?.kind === 'text'" role="menuitem" @click="action('edit')">编辑文字</button>
            <button v-if="selected?.kind === 'image'" role="menuitem" @click="action('crop')">裁剪图片</button>
            <button role="menuitem" @click="action('duplicate')">复制图层</button>
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
.image-studio{display:flex;flex-direction:column;gap:10px;min-width:0;color:var(--ui-text);container-type:inline-size}
.studio-top,.draft-tabs,.studio-side,.studio-stage{border:1px solid var(--ui-border);border-radius:var(--ui-radius-lg);background:var(--ui-surface)}
.studio-top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 16px}
.studio-title{display:flex;align-items:baseline;gap:10px}.studio-title strong{font-size:17px}.studio-title span,.panel-heading span,.layer-footer,.stage-foot,.inspector-note{font-size:11px;color:var(--ui-muted)}
.studio-export,.draft-tabs,.layer-actions,.inspector-actions,.zoom-actions,.crop-actions{display:flex;align-items:center;gap:6px}
button,select,input,textarea{font:inherit}.studio-export>button,.studio-export select,.draft-tabs button,.layer-actions button,.stage-toolbar button,.inspector-actions button,.wide-action,.template-grid button{border:1px solid var(--ui-border);border-radius:7px;background:var(--ui-surface-soft);color:var(--ui-text);cursor:pointer;padding:5px 9px;font-size:12px}
button:hover:not(:disabled){border-color:var(--primary-color);color:var(--primary-color)}button:disabled{opacity:.45;cursor:default}
.studio-export select{height:30px}.draft-tabs{padding:5px;overflow-x:auto;white-space:nowrap;border-radius:9px}
.draft-tabs button{flex:none;border-color:transparent;background:transparent}.draft-tabs .active{border-color:var(--ui-border);background:var(--primary-color-1);color:var(--primary-color);font-weight:650}.draft-tabs .add-draft{margin-left:6px;border-style:dashed;border-color:var(--ui-border)}
.studio-alert{padding:10px 13px;border-radius:8px;background:#fff2c9;color:#795313}
.studio-grid{display:grid;grid-template-columns:minmax(172px,210px) minmax(280px,1fr) minmax(220px,260px);gap:10px;min-height:610px;align-items:stretch}
.studio-side{min-width:0;padding:14px;overflow:auto}.panel-heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.panel-heading strong{font-size:14px}.layer-actions{margin-bottom:12px}.layer-actions button{flex:1;min-width:0;padding:6px 4px;font-size:11px}
.empty{padding:16px 10px;background:var(--ui-surface-soft);border-radius:7px;color:var(--ui-muted);font-size:12px;line-height:1.5}
.layer-row{display:flex;align-items:center;gap:5px;min-width:0;min-height:42px;padding:4px;border:1px solid transparent;border-radius:7px;cursor:pointer}
.layer-row:hover,.layer-row.active{background:var(--primary-color-1)}.layer-row.active{border-color:var(--primary-color)}.layer-row.faded{opacity:.5}
.layer-row img,.layer-symbol{width:30px;height:30px;object-fit:cover;border-radius:5px;background:var(--ui-surface-soft);flex:none}
.layer-symbol{display:grid;place-items:center;font-size:18px;font-weight:700;color:var(--primary-color)}
.layer-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.layer-row button{border:0;background:transparent;color:var(--ui-muted);cursor:pointer;font-size:13px;padding:2px}.layer-footer{margin-top:12px}
.studio-stage{display:flex;flex-direction:column;overflow:hidden;min-width:0;background:var(--ui-surface-soft)}
.stage-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:42px;padding:5px 12px;border-bottom:1px solid var(--ui-border);background:var(--ui-surface);font-size:11px}
.stage-toolbar .primary{background:var(--primary-color);color:#fff;border-color:var(--primary-color)}.crop-actions strong{color:var(--primary-color)}
.stage-viewport{display:flex;align-items:center;justify-content:center;flex:1;min-height:480px;padding:24px;overflow:auto;background:repeating-conic-gradient(color-mix(in srgb,var(--ui-border) 42%,transparent) 0 25%,transparent 0 50%) 50%/20px 20px}
.artboard{position:relative;flex:none;background:#fff;box-shadow:0 10px 32px #0003;touch-action:none;outline:none}.artboard canvas{width:100%;height:100%;display:block}
.selection{position:absolute;box-sizing:border-box;border:2px solid var(--primary-color);pointer-events:none}.selection.locked{border-style:dashed}
.handle{position:absolute;display:block;width:11px;height:11px;box-sizing:border-box;border:2px solid var(--primary-color);border-radius:3px;background:#fff;pointer-events:auto}
.handle.nw{left:-6px;top:-6px;cursor:nwse-resize}.handle.ne{right:-6px;top:-6px;cursor:nesw-resize}.handle.se{right:-6px;bottom:-6px;cursor:nwse-resize}.handle.sw{left:-6px;bottom:-6px;cursor:nesw-resize}
.rotation-stem{position:absolute;left:50%;top:-24px;height:22px;border-left:1px solid var(--primary-color)}.handle.rotate{left:calc(50% - 7px);top:-36px;width:14px;height:14px;border-radius:50%;cursor:grab}
.crop-box{position:absolute;box-sizing:border-box;border:2px dashed #fff;box-shadow:0 0 0 1px #202530b0;pointer-events:none}.crop-box .handle{background:#fff}
.inline-text{position:absolute;inset:0;width:100%;height:100%;box-sizing:border-box;pointer-events:auto;background:#ffffffd9;border:0;resize:none;outline:2px solid var(--primary-color)}
.stage-foot{min-height:30px;padding:8px 12px;text-align:center;background:var(--ui-surface)}.render-error{color:#b44d30}
.studio-inspector .field{display:flex;flex-direction:column;gap:5px;margin:11px 0;color:var(--ui-muted);font-size:11px}.field>span{float:right}.field input:not([type=range]),.field select,.field textarea{min-width:0;width:100%;box-sizing:border-box;padding:6px;border:1px solid var(--ui-border);border-radius:6px;background:var(--ui-surface-soft);color:var(--ui-text);font-size:12px}
.field input[type=range]{width:100%;accent-color:var(--primary-color)}.field input[type=color]{height:31px;padding:2px}.two-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 8px}
.inspector-actions{flex-wrap:wrap;margin:12px 0}.inspector-actions button{flex:1;min-width:0}.inspector-actions button.active{background:var(--primary-color-1);color:var(--primary-color)}
.studio-inspector h3{margin:18px 0 8px;font-size:12px}.template-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.template-grid button{padding:8px 3px}.inspector-note{line-height:1.5;margin:13px 0}.wide-action{width:100%}
.asset-picker-head{display:flex;gap:8px;margin-bottom:14px}.asset-picker-head input{flex:1;min-width:0;padding:7px;border:1px solid var(--ui-border);border-radius:7px}
.asset-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;max-height:430px;overflow:auto}.asset-tile{position:relative;min-width:0}.asset-tile>button:first-child{display:flex;flex-direction:column;width:100%;border:1px solid var(--ui-border);border-radius:8px;background:var(--ui-surface-soft);color:var(--ui-text);padding:5px;text-align:left;cursor:pointer}.asset-tile img,.asset-placeholder{width:100%;aspect-ratio:1;object-fit:cover;border-radius:5px;background:var(--ui-hover)}.asset-placeholder{display:grid;place-items:center}.asset-tile span:last-child{width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;padding-top:5px}.asset-more{position:absolute;right:8px;top:8px;border:0;border-radius:5px;background:#1e293bcc;color:#fff;cursor:pointer}
.studio-menu-mask{position:fixed;inset:0;z-index:1500}.studio-menu{position:fixed;display:flex;flex-direction:column;min-width:165px;padding:5px;border:1px solid var(--ui-border);border-radius:9px;background:var(--ui-surface);box-shadow:0 15px 35px #0004}.studio-menu button{width:100%;border:0;border-radius:5px;background:none;color:var(--ui-text);padding:7px 11px;text-align:left;cursor:pointer;font-size:12px}.studio-menu button:hover{background:var(--primary-color-1)}.studio-menu .danger{color:#c34444}
@container(max-width:1050px){.studio-grid{grid-template-columns:175px minmax(260px,1fr)}.studio-inspector{grid-column:1/-1}.stage-viewport{min-height:420px}}
@container(max-width:690px){.studio-top{align-items:flex-start;flex-direction:column}.studio-grid{display:flex;flex-direction:column}.studio-layers{order:2}.studio-stage{order:1}.studio-inspector{order:3}.stage-viewport{min-height:340px}.asset-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
</style>
