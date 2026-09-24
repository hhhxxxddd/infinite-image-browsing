import { imageRects, readImageDraft, type ImageLayout } from './imageCreationModel.ts'

export type StudioLayer = StudioImageLayer | StudioTextLayer
export type StudioFont = 'system-ui' | 'Arial' | 'Georgia' | 'monospace'
export type StudioAlign = 'left' | 'center' | 'right'
export interface StudioFrame { x: number; y: number; width: number; height: number }
export interface StudioCrop { x: number; y: number; width: number; height: number }
interface StudioLayerBase extends StudioFrame {
  id: string
  name: string
  rotation: number
  opacity: number
  visible: boolean
  locked: boolean
}
export interface StudioImageLayer extends StudioLayerBase {
  kind: 'image'
  path: string
  crop: StudioCrop
  zoom: number
  focusX: number
  focusY: number
  fit: 'cover' | 'contain'
  brightness: number
  contrast: number
  radius: number
}
export interface StudioTextLayer extends StudioLayerBase {
  kind: 'text'
  text: string
  font: StudioFont
  fontSize: number
  bold: boolean
  align: StudioAlign
  color: string
}
export interface StudioDocument {
  version: 2
  id: string
  name: string
  createdAt: string
  updatedAt: string
  width: number
  height: number
  background: string
  layers: StudioLayer[] // bottom to top
}
export interface StudioDocumentIndex {
  version: 2
  activeId: string
  docs: { id: string; name: string; updatedAt: string }[]
}

const clamp = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
const color = (value: unknown, fallback: string) => typeof value === 'string' && /^#[\da-fA-F]{6}$/.test(value) ? value : fallback
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const identifier = (value: unknown) => typeof value === 'string' && /^[\w-]{1,80}$/.test(value) ? value : crypto.randomUUID()
const cropWithin = (crop: StudioCrop): StudioCrop => {
  const width = clamp(crop.width, 1, .02, 1)
  const height = clamp(crop.height, 1, .02, 1)
  return { x: clamp(crop.x, 0, 0, 1 - width), y: clamp(crop.y, 0, 0, 1 - height), width, height }
}

export function createStudioDocument(name = '未命名图片', now = new Date().toISOString()): StudioDocument {
  return { version: 2, id: crypto.randomUUID(), name, createdAt: now, updatedAt: now,
    width: 1080, height: 1080, background: '#ffffff', layers: [] }
}
export function createImageLayer(path: string, frame: StudioFrame, name = '图片'): StudioImageLayer {
  return { kind: 'image', id: crypto.randomUUID(), name, path, ...frame, rotation: 0, opacity: 1,
    visible: true, locked: false, crop: { x: 0, y: 0, width: 1, height: 1 }, zoom: 1,
    focusX: .5, focusY: .5, fit: 'cover', brightness: 100, contrast: 100, radius: 0 }
}
export function createTextLayer(frame: StudioFrame, text = '双击编辑文字'): StudioTextLayer {
  return { kind: 'text', id: crypto.randomUUID(), name: '文字', ...frame, text, rotation: 0, opacity: 1,
    visible: true, locked: false, font: 'system-ui', fontSize: 64, bold: true, align: 'center', color: '#1f2937' }
}

export function readStudioDocument(value: unknown): StudioDocument | undefined {
  if (!object(value) || value.version !== 2 || !Array.isArray(value.layers)) return undefined
  const width = Math.round(clamp(value.width, 1080, 320, 4096))
  const height = Math.round(clamp(value.height, 1080, 320, 4096))
  const seen = new Set<string>()
  const layers = value.layers.flatMap((raw): StudioLayer[] => {
    if (!object(raw) || (raw.kind !== 'image' && raw.kind !== 'text')) return []
    const id = identifier(raw.id)
    if (seen.has(id)) return []
    seen.add(id)
    const base = {
      id, name: typeof raw.name === 'string' ? raw.name.slice(0, 80) : raw.kind === 'image' ? '图片' : '文字',
      x: clamp(raw.x, 0, -width, width * 2), y: clamp(raw.y, 0, -height, height * 2),
      width: clamp(raw.width, 320, 16, width * 2), height: clamp(raw.height, 180, 16, height * 2),
      rotation: clamp(raw.rotation, 0, -360, 360), opacity: clamp(raw.opacity, 1, 0, 1),
      visible: raw.visible !== false, locked: raw.locked === true
    }
    if (raw.kind === 'image') {
      const rect = object(raw.crop) ? raw.crop : {}
      return [{ ...base, kind: 'image', path: typeof raw.path === 'string' ? raw.path.slice(0, 2048) : '',
        crop: cropWithin({ x: rect.x as number, y: rect.y as number, width: rect.width as number, height: rect.height as number }),
        zoom: clamp(raw.zoom, 1, 1, 8), focusX: clamp(raw.focusX, .5, 0, 1), focusY: clamp(raw.focusY, .5, 0, 1),
        fit: raw.fit === 'contain' ? 'contain' : 'cover', brightness: clamp(raw.brightness, 100, 20, 200),
        contrast: clamp(raw.contrast, 100, 20, 200), radius: clamp(raw.radius, 0, 0, 200) }]
    }
    return [{ ...base, kind: 'text', text: typeof raw.text === 'string' ? raw.text.slice(0, 1000) : '',
      font: ['system-ui', 'Arial', 'Georgia', 'monospace'].includes(raw.font as string) ? raw.font as StudioFont : 'system-ui',
      fontSize: clamp(raw.fontSize, 64, 12, 400), bold: raw.bold !== false,
      align: ['left', 'center', 'right'].includes(raw.align as string) ? raw.align as StudioAlign : 'center',
      color: color(raw.color, '#ffffff') }]
  }).slice(0, 100)
  return { version: 2, id: identifier(value.id), name: typeof value.name === 'string' && value.name.trim() ? value.name.slice(0, 80) : '未命名图片',
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
    width, height, background: color(value.background, '#ffffff'), layers }
}

export function readStudioIndex(value: unknown): StudioDocumentIndex | undefined {
  if (!object(value) || value.version !== 2 || !Array.isArray(value.docs)) return undefined
  const seen = new Set<string>()
  const docs = value.docs.flatMap((raw): StudioDocumentIndex['docs'] => {
    if (!object(raw) || typeof raw.id !== 'string' || !/^[\w-]{1,80}$/.test(raw.id) || seen.has(raw.id)) return []
    seen.add(raw.id)
    return [{ id: raw.id, name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.slice(0, 80) : '未命名图片',
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '' }]
  }).slice(0, 100)
  return { version: 2, docs, activeId: typeof value.activeId === 'string' && seen.has(value.activeId) ? value.activeId : docs[0]?.id ?? '' }
}

export function migrateImageDraft(value: unknown, name = '原画布'): StudioDocument {
  const legacy = readImageDraft(value)
  const doc = createStudioDocument(name)
  doc.width = legacy.width
  doc.height = legacy.height
  doc.background = legacy.background
  const visible = imageRects(legacy)
  const all = imageRects({ ...legacy, layout: 'grid-nine' })
  doc.layers = legacy.slots.flatMap((slot, index): StudioImageLayer[] => {
    if (!slot.path) return index < visible.length ? [createImageLayer('', visible[index], `画面 ${index + 1}`)] : []
    const layer = createImageLayer(slot.path, visible[index] ?? all[index], `画面 ${index + 1}`)
    layer.visible = index < visible.length
    layer.rotation = slot.rotation
    layer.zoom = slot.zoom
    layer.focusX = slot.focusX / 100
    layer.focusY = slot.focusY / 100
    layer.fit = legacy.fit
    layer.brightness = legacy.brightness
    layer.contrast = legacy.contrast
    layer.radius = legacy.radius
    return [layer]
  })
  if (legacy.caption.trim()) {
    const text = createTextLayer({ x: legacy.width * .08, y: legacy.height * .78,
      width: legacy.width * .84, height: legacy.height * .18 }, legacy.caption)
    text.fontSize = legacy.captionSize
    text.color = legacy.captionColor
    doc.layers.push(text)
  }
  return doc
}

export function applyStudioTemplate(doc: StudioDocument, layout: ImageLayout): StudioDocument {
  const rects = imageRects({ layout, width: doc.width, height: doc.height, padding: 24, gap: 16 })
  const result = structuredClone(doc)
  const images = result.layers.filter((layer): layer is StudioImageLayer => layer.kind === 'image' && layer.visible)
  const missing: StudioImageLayer[] = []
  rects.forEach((rect, index) => {
    const layer = images[index]
    if (layer) Object.assign(layer, rect)
    else missing.push(createImageLayer('', rect, `画面 ${index + 1}`))
  })
  const lastImageIndex = result.layers.reduce((last, layer, index) => layer.kind === 'image' ? index : last, -1)
  result.layers.splice(lastImageIndex + 1, 0, ...missing)
  return result
}

export function scaleStudioDocument(doc: StudioDocument, width: number, height: number): StudioDocument {
  const xScale = width / doc.width
  const yScale = height / doc.height
  const result = structuredClone(doc)
  result.width = width
  result.height = height
  result.layers.forEach(layer => {
    layer.x *= xScale; layer.y *= yScale; layer.width *= xScale; layer.height *= yScale
    if (layer.kind === 'text') layer.fontSize *= xScale
  })
  return result
}

export function reorderStudioLayer(doc: StudioDocument, from: string, to: string): StudioDocument {
  const result = structuredClone(doc)
  const source = result.layers.findIndex(layer => layer.id === from)
  const target = result.layers.findIndex(layer => layer.id === to)
  if (source < 0 || target < 0 || source === target) return result
  const [layer] = result.layers.splice(source, 1)
  result.layers.splice(target, 0, layer)
  return result
}

export function updateCrop(crop: StudioCrop, selection: StudioCrop): StudioCrop {
  return cropWithin({ x: crop.x + selection.x * crop.width, y: crop.y + selection.y * crop.height,
    width: crop.width * selection.width, height: crop.height * selection.height })
}

/** Convert a crop drawn on the displayed layer into source-image coordinates. */
export function cropStudioImage(layer: StudioImageLayer, selection: StudioCrop,
  sourceWidth: number, sourceHeight: number): StudioImageLayer {
  const result = structuredClone(layer)
  const box = cropWithin(selection)
  const oldWidth = layer.width, oldHeight = layer.height
  if (sourceWidth > 0 && sourceHeight > 0 && layer.crop.width > 0 && layer.crop.height > 0) {
    const sw = layer.crop.width * sourceWidth, sh = layer.crop.height * sourceHeight
    const base = layer.fit === 'cover' ? Math.max(oldWidth / sw, oldHeight / sh) : Math.min(oldWidth / sw, oldHeight / sh)
    const dw = sw * base * layer.zoom, dh = sh * base * layer.zoom
    const left = (oldWidth - dw) * layer.focusX, top = (oldHeight - dh) * layer.focusY
    const sourceX = Math.max(0, Math.min(1, (box.x * oldWidth - left) / dw))
    const sourceY = Math.max(0, Math.min(1, (box.y * oldHeight - top) / dh))
    const sourceW = Math.max(.02, Math.min(1 - sourceX, box.width * oldWidth / dw))
    const sourceH = Math.max(.02, Math.min(1 - sourceY, box.height * oldHeight / dh))
    result.crop = updateCrop(layer.crop, { x: sourceX, y: sourceY, width: sourceW, height: sourceH })
  } else result.crop = updateCrop(layer.crop, box)
  const centerX = layer.x + oldWidth / 2, centerY = layer.y + oldHeight / 2
  const offsetX = (box.x + box.width / 2 - .5) * oldWidth
  const offsetY = (box.y + box.height / 2 - .5) * oldHeight
  const angle = layer.rotation * Math.PI / 180
  const nextCenterX = centerX + offsetX * Math.cos(angle) - offsetY * Math.sin(angle)
  const nextCenterY = centerY + offsetX * Math.sin(angle) + offsetY * Math.cos(angle)
  result.width = oldWidth * box.width; result.height = oldHeight * box.height
  result.x = nextCenterX - result.width / 2; result.y = nextCenterY - result.height / 2
  result.zoom = 1; result.focusX = .5; result.focusY = .5
  return result
}

export const studioIndexKey = (workspaceId: string) => `iib-workbench-image-documents-v2:${workspaceId}`
export const studioDocumentKey = (workspaceId: string, docId: string) => `iib-workbench-image-document-v2:${workspaceId}:${docId}`
export const legacyStudioKey = (workspaceId: string) => `iib-workbench-image-draft:${workspaceId}`
export function clearStudioWorkspace(workspaceId: string,
  storage: Pick<Storage, 'getItem' | 'removeItem'> & Partial<Pick<Storage, 'key' | 'length'>> = localStorage) {
  let index: StudioDocumentIndex | undefined
  try { index = readStudioIndex(JSON.parse(storage.getItem(studioIndexKey(workspaceId)) || 'null')) } catch { /* Remove the index below. */ }
  index?.docs.forEach(doc => storage.removeItem(studioDocumentKey(workspaceId, doc.id)))
  if (storage.key && typeof storage.length === 'number') {
    const prefix = `iib-workbench-image-document-v2:${workspaceId}:`
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key!(index)).filter((key): key is string => !!key && key.startsWith(prefix))
    keys.forEach(key => storage.removeItem(key))
  }
  storage.removeItem(studioIndexKey(workspaceId))
  storage.removeItem(legacyStudioKey(workspaceId))
}
