import { imageRects, readImageDraft, type ImageLayout } from './imageCreationModel.ts'
import { isStudioFont, type StudioFont } from './imageStudioFonts.ts'

export type StudioLayer = StudioImageLayer | StudioTextLayer | StudioGuideLayer | StudioMaskLayer | StudioPaintLayer
export type { StudioFont } from './imageStudioFonts.ts'
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
  groupId?: string
}
export interface StudioGroup { id: string; name: string; visible: boolean; locked: boolean; collapsed: boolean }
export interface StudioPoint { x: number; y: number }
export interface StudioMaskStroke { points: StudioPoint[]; size: number; mode: 'paint' | 'erase' }
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
export interface StudioGuideLayer extends StudioLayerBase {
  kind: 'guide'
  shape: 'rect' | 'arrow'
  flipX: boolean
  flipY: boolean
  prompt: string
  color: string
  strokeWidth: number
}
export interface StudioMaskLayer extends StudioLayerBase {
  kind: 'mask'
  color: string
  strokes: StudioMaskStroke[]
}
export interface StudioPaintLayer extends StudioLayerBase {
  kind: 'paint'
  prompt: string
  color: string
  strokes: StudioMaskStroke[]
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
  groups: StudioGroup[]
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
    width: 1080, height: 1080, background: '#ffffff', groups: [], layers: [] }
}
export function createStudioGroup(name = '新建分组'): StudioGroup {
  return { id: crypto.randomUUID(), name, visible: true, locked: false, collapsed: false }
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
export function createGuideLayer(frame: StudioFrame, shape: 'rect' | 'arrow' = 'rect'): StudioGuideLayer {
  return { kind: 'guide', id: crypto.randomUUID(), name: shape === 'arrow' ? '提示箭头' : '提示框', ...frame, rotation: 0, opacity: 1,
    visible: true, locked: false, shape, flipX: false, flipY: false, prompt: '', color: '#ef4444', strokeWidth: 4 }
}
export function createMaskLayer(width: number, height: number): StudioMaskLayer {
  return { kind: 'mask', id: crypto.randomUUID(), name: '遮罩 1', x: 0, y: 0, width, height,
    rotation: 0, opacity: 1, visible: true, locked: false, color: '#808080', strokes: [] }
}
export function createPaintLayer(width: number, height: number): StudioPaintLayer {
  return { kind: 'paint', id: crypto.randomUUID(), name: '涂抹 1', x: 0, y: 0, width, height,
    rotation: 0, opacity: 1, visible: true, locked: false, prompt: '', color: '#ef4444', strokes: [] }
}
/** Convert a canvas point into a mask's local coordinates, including its rotation. */
export function studioMaskPoint(layer: StudioMaskLayer | StudioPaintLayer, point: StudioPoint): StudioPoint | null {
  const angle = -layer.rotation * Math.PI / 180
  const dx = point.x - layer.x - layer.width / 2
  const dy = point.y - layer.y - layer.height / 2
  const x = (dx * Math.cos(angle) - dy * Math.sin(angle)) / layer.width + .5
  const y = (dx * Math.sin(angle) + dy * Math.cos(angle)) / layer.height + .5
  if (x < 0 || x > 1 || y < 0 || y > 1) return null
  return { x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 }
}
/** Hit only painted mask pixels, respecting later eraser strokes and layer rotation. */
export function studioMaskContainsPoint(layer: StudioMaskLayer | StudioPaintLayer, point: StudioPoint, hitSlop = 4): boolean {
  const local = studioMaskPoint(layer, point)
  if (!local) return false
  const x = local.x * layer.width, y = local.y * layer.height
  let painted = false
  for (const stroke of layer.strokes) {
    if (!stroke.points.length) continue
    const radius = stroke.size / 2 + (stroke.mode === 'paint' ? hitSlop : 0)
    const points = stroke.points.map(item => ({ x: item.x * layer.width, y: item.y * layer.height }))
    const touching = points.some((item, index) => {
      const next = points[index + 1] ?? item
      const dx = next.x - item.x, dy = next.y - item.y
      const t = Math.max(0, Math.min(1, ((x - item.x) * dx + (y - item.y) * dy) / (dx * dx + dy * dy || 1)))
      return Math.hypot(x - item.x - t * dx, y - item.y - t * dy) <= radius
    })
    if (touching) painted = stroke.mode === 'paint'
  }
  return painted
}
/** Paint and erase strokes in order, using the same pixels for display and selection bounds. */
export function drawStudioStrokes(ctx: CanvasRenderingContext2D, layer: StudioMaskLayer | StudioPaintLayer, color: string) {
  ctx.save()
  for (const stroke of layer.strokes) {
    if (!stroke.points.length) continue
    ctx.globalCompositeOperation = stroke.mode === 'erase' ? 'destination-out' : 'source-over'
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = Math.max(1, stroke.size)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const first = stroke.points[0]
    ctx.beginPath()
    if (stroke.points.length === 1) {
      ctx.arc(first.x * layer.width, first.y * layer.height, ctx.lineWidth / 2, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.moveTo(first.x * layer.width, first.y * layer.height)
      for (const point of stroke.points.slice(1)) ctx.lineTo(point.x * layer.width, point.y * layer.height)
      ctx.stroke()
    }
  }
  ctx.restore()
}
function erasedStrokeBounds(layer: StudioMaskLayer | StudioPaintLayer): StudioFrame | null {
  const resolution = 384
  const ratio = Math.min(1, resolution / Math.max(layer.width, layer.height))
  const columns = Math.max(1, Math.ceil(layer.width * ratio))
  const rows = Math.max(1, Math.ceil(layer.height * ratio))
  let occupied: ((x: number, y: number) => boolean) | undefined
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    canvas.width = columns
    canvas.height = rows
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.scale(columns / layer.width, rows / layer.height)
      drawStudioStrokes(ctx, layer, '#ffffff')
      const pixels = ctx.getImageData(0, 0, columns, rows).data
      occupied = (x, y) => pixels[(y * columns + x) * 4 + 3] > 0
    }
  }
  if (!occupied) {
    // The model also runs in Node tests, where there is no DOM canvas.
    const angle = layer.rotation * Math.PI / 180
    const cos = Math.cos(angle), sin = Math.sin(angle)
    occupied = (x, y) => {
      const dx = (x + .5) * layer.width / columns - layer.width / 2
      const dy = (y + .5) * layer.height / rows - layer.height / 2
      return studioMaskContainsPoint(layer, {
        x: layer.x + layer.width / 2 + dx * cos - dy * sin,
        y: layer.y + layer.height / 2 + dx * sin + dy * cos,
      }, 0)
    }
  }
  let left = columns, top = rows, right = -1, bottom = -1
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    if (!occupied(x, y)) continue
    left = Math.min(left, x); top = Math.min(top, y)
    right = Math.max(right, x); bottom = Math.max(bottom, y)
  }
  if (right < left) return null
  const x = Math.max(0, left * layer.width / columns - 6)
  const y = Math.max(0, top * layer.height / rows - 6)
  const edgeX = Math.min(layer.width, (right + 1) * layer.width / columns + 6)
  const edgeY = Math.min(layer.height, (bottom + 1) * layer.height / rows + 6)
  return { x, y, width: edgeX - x, height: edgeY - y }
}
/** Selection outline follows the painted content instead of a full-canvas mask frame. */
export function studioMaskPaintBounds(layer: StudioMaskLayer | StudioPaintLayer): StudioFrame | null {
  const painted = layer.strokes.filter(stroke => stroke.mode === 'paint' && stroke.points.length)
  if (!painted.length) return null
  if (layer.strokes.some(stroke => stroke.mode === 'erase' && stroke.points.length)) return erasedStrokeBounds(layer)
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const stroke of painted) for (const point of stroke.points) {
    const radius = stroke.size / 2 + 6
    left = Math.min(left, point.x * layer.width - radius)
    top = Math.min(top, point.y * layer.height - radius)
    right = Math.max(right, point.x * layer.width + radius)
    bottom = Math.max(bottom, point.y * layer.height + radius)
  }
  const x = Math.max(0, left), y = Math.max(0, top)
  return { x, y, width: Math.max(1, Math.min(layer.width, right) - x),
    height: Math.max(1, Math.min(layer.height, bottom) - y) }
}
export function studioLayerVisible(doc: StudioDocument, layer: StudioLayer): boolean {
  return layer.visible && (!layer.groupId || doc.groups.find(group => group.id === layer.groupId)?.visible !== false)
}
export function studioLayerLocked(doc: StudioDocument, layer: StudioLayer): boolean {
  return layer.locked || !!(layer.groupId && doc.groups.find(group => group.id === layer.groupId)?.locked)
}
/** Axis-aligned bounds of the visible content in a group, including rotated layers. */
export function studioGroupBounds(doc: StudioDocument, groupId: string): StudioFrame | null {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const layer of doc.layers) {
    if (layer.groupId !== groupId || !studioLayerVisible(doc, layer)) continue
    const content = layer.kind === 'mask' || layer.kind === 'paint'
      ? studioMaskPaintBounds(layer) : { x: 0, y: 0, width: layer.width, height: layer.height }
    if (!content) continue
    const angle = layer.rotation * Math.PI / 180
    const cos = Math.cos(angle), sin = Math.sin(angle)
    const cx = layer.x + layer.width / 2, cy = layer.y + layer.height / 2
    for (const x of [content.x, content.x + content.width]) for (const y of [content.y, content.y + content.height]) {
      const dx = x - layer.width / 2, dy = y - layer.height / 2
      const px = cx + dx * cos - dy * sin, py = cy + dx * sin + dy * cos
      left = Math.min(left, px); top = Math.min(top, py)
      right = Math.max(right, px); bottom = Math.max(bottom, py)
    }
  }
  return left === Infinity ? null : { x: left, y: top, width: right - left, height: bottom - top }
}
export function studioEditableMaskLayers(doc: StudioDocument): StudioMaskLayer[] {
  return doc.layers.filter((layer): layer is StudioMaskLayer => layer.kind === 'mask' &&
    studioLayerVisible(doc, layer) && !studioLayerLocked(doc, layer))
}
export function moveStudioLayerToGroup(doc: StudioDocument, layerId: string, groupId?: string): StudioDocument {
  const result = structuredClone(doc)
  const index = result.layers.findIndex(layer => layer.id === layerId)
  if (index < 0 || (groupId && !result.groups.some(group => group.id === groupId))) return result
  const [layer] = result.layers.splice(index, 1)
  const formerGroupId = layer.groupId
  layer.groupId = groupId
  const peers = groupId ? result.layers.map((item, at) => item.groupId === groupId ? at : -1).filter(at => at >= 0) : []
  const formerPeers = formerGroupId ? result.layers.map((item, at) => item.groupId === formerGroupId ? at : -1).filter(at => at >= 0) : []
  const insertion = peers.length ? Math.max(...peers) + 1 : formerPeers.length
    ? Math.max(...formerPeers) + 1 : Math.min(index, result.layers.length)
  result.layers.splice(insertion, 0, layer)
  return result
}

export function readStudioDocument(value: unknown): StudioDocument | undefined {
  if (!object(value) || value.version !== 2 || !Array.isArray(value.layers)) return undefined
  const width = Math.round(clamp(value.width, 1080, 320, 4096))
  const height = Math.round(clamp(value.height, 1080, 320, 4096))
  const groupIds = new Set<string>()
  const groups: StudioGroup[] = (Array.isArray(value.groups) ? value.groups : []).flatMap((raw): StudioGroup[] => {
    if (!object(raw) || typeof raw.id !== 'string' || !/^[\w-]{1,80}$/.test(raw.id) || groupIds.has(raw.id)) return []
    groupIds.add(raw.id)
    return [{ id: raw.id, name: typeof raw.name === 'string' ? raw.name.slice(0, 80) : '分组',
      visible: raw.visible !== false, locked: raw.locked === true, collapsed: raw.collapsed === true }]
  }).slice(0, 50)
  const retainedGroupIds = new Set(groups.map(group => group.id))
  const seen = new Set<string>()
  const layers = value.layers.flatMap((raw): StudioLayer[] => {
    if (!object(raw) || !['image', 'text', 'guide', 'mask', 'paint'].includes(raw.kind as string)) return []
    const id = identifier(raw.id)
    if (seen.has(id)) return []
    seen.add(id)
    const name = typeof raw.name === 'string' ? raw.name.slice(0, 80) : raw.kind === 'image' ? '图片' : '文字'
    const displayName = raw.kind === 'mask' && /^编辑遮罩(?: (\d+))?$/.test(name)
      ? name.replace(/^编辑遮罩/, '遮罩') : raw.kind === 'paint' && /^彩色涂抹(?: (\d+))?$/.test(name)
        ? name.replace(/^彩色涂抹/, '涂抹') : name
    const base = {
      id, name: displayName,
      x: clamp(raw.x, 0, -width, width * 2), y: clamp(raw.y, 0, -height, height * 2),
      width: clamp(raw.width, 320, 16, width * 2), height: clamp(raw.height, 180, 16, height * 2),
      rotation: clamp(raw.rotation, 0, -360, 360), opacity: clamp(raw.opacity, 1, 0, 1),
      visible: raw.visible !== false, locked: raw.locked === true,
      ...(typeof raw.groupId === 'string' && retainedGroupIds.has(raw.groupId) ? { groupId: raw.groupId } : {})
    }
    if (raw.kind === 'image') {
      const rect = object(raw.crop) ? raw.crop : {}
      return [{ ...base, kind: 'image', path: typeof raw.path === 'string' ? raw.path.slice(0, 2048) : '',
        crop: cropWithin({ x: rect.x as number, y: rect.y as number, width: rect.width as number, height: rect.height as number }),
        zoom: clamp(raw.zoom, 1, 1, 8), focusX: clamp(raw.focusX, .5, 0, 1), focusY: clamp(raw.focusY, .5, 0, 1),
        fit: raw.fit === 'contain' ? 'contain' : 'cover', brightness: clamp(raw.brightness, 100, 20, 200),
        contrast: clamp(raw.contrast, 100, 20, 200), radius: clamp(raw.radius, 0, 0, 200) }]
    }
    if (raw.kind === 'guide') return [{ ...base, kind: 'guide', prompt: typeof raw.prompt === 'string' ? raw.prompt.slice(0, 2000) : '',
      shape: raw.shape === 'arrow' ? 'arrow' : 'rect', flipX: raw.flipX === true, flipY: raw.flipY === true,
      color: color(raw.color, '#ef4444'), strokeWidth: clamp(raw.strokeWidth, 4, 1, 40) }]
    if (raw.kind === 'mask' || raw.kind === 'paint') {
      const strokes: StudioMaskStroke[] = (Array.isArray(raw.strokes) ? raw.strokes : []).slice(0, 200).flatMap((stroke): StudioMaskStroke[] => {
        if (!object(stroke) || !Array.isArray(stroke.points)) return []
        const points = stroke.points.slice(0, 500).flatMap((point): StudioPoint[] => object(point) &&
          typeof point.x === 'number' && Number.isFinite(point.x) && typeof point.y === 'number' && Number.isFinite(point.y)
          ? [{ x: clamp(point.x, 0, 0, 1), y: clamp(point.y, 0, 0, 1) }] : [])
        return points.length ? [{ points, size: clamp(stroke.size, 32, 1, 400), mode: stroke.mode === 'erase' ? 'erase' : 'paint' }] : []
      })
      return raw.kind === 'mask' ? [{ ...base, kind: 'mask', color: color(raw.color, '#808080'), strokes }] :
        [{ ...base, kind: 'paint', prompt: typeof raw.prompt === 'string' ? raw.prompt.slice(0, 2000) : '',
          color: color(raw.color, '#ef4444'), strokes }]
    }
    return [{ ...base, kind: 'text', text: typeof raw.text === 'string' ? raw.text.slice(0, 1000) : '',
      font: isStudioFont(raw.font) ? raw.font : 'system-ui',
      fontSize: clamp(raw.fontSize, 64, 12, 400), bold: raw.bold !== false,
      align: ['left', 'center', 'right'].includes(raw.align as string) ? raw.align as StudioAlign : 'center',
      color: color(raw.color, '#ffffff') }]
  }).slice(0, 100)
  return { version: 2, id: identifier(value.id), name: typeof value.name === 'string' && value.name.trim() ? value.name.slice(0, 80) : '未命名图片',
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
    width, height, background: color(value.background, '#ffffff'), groups, layers }
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
    if (layer.kind === 'guide') layer.strokeWidth *= Math.sqrt(xScale * yScale)
    if (layer.kind === 'mask' || layer.kind === 'paint') layer.strokes.forEach(stroke => { stroke.size *= Math.sqrt(xScale * yScale) })
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

/** Move a group as one stack block without changing the order of its members. */
export function reorderStudioGroup(doc: StudioDocument, groupId: string,
  target: { kind: 'group' | 'layer'; id: string } | { kind: 'bottom' }): StudioDocument {
  const result = structuredClone(doc)
  const sourceGroup = result.groups.find(group => group.id === groupId)
  if (!sourceGroup || (target.kind === 'group' && target.id === groupId)) return result
  const moving = result.layers.filter(layer => layer.groupId === groupId)
  if (!moving.length) {
    if (target.kind === 'group') {
      const from = result.groups.findIndex(group => group.id === groupId)
      const to = result.groups.findIndex(group => group.id === target.id)
      if (to >= 0) { result.groups.splice(from, 1); result.groups.splice(result.groups.findIndex(group => group.id === target.id), 0, sourceGroup) }
    }
    return result
  }
  if (target.kind === 'layer' && moving.some(layer => layer.id === target.id)) return result
  const rest = result.layers.filter(layer => layer.groupId !== groupId)
  let insertion = 0
  if (target.kind === 'group') {
    const peers = rest.map((layer, index) => layer.groupId === target.id ? index : -1).filter(index => index >= 0)
    if (!result.groups.some(group => group.id === target.id)) return result
    insertion = peers.length ? Math.max(...peers) + 1 : rest.length
  } else if (target.kind === 'layer') {
    const layer = rest.find(item => item.id === target.id)
    if (!layer) return result
    const peers = layer.groupId ? rest.map((item, index) => item.groupId === layer.groupId ? index : -1).filter(index => index >= 0) : []
    insertion = peers.length ? Math.max(...peers) + 1 : rest.findIndex(item => item.id === target.id) + 1
  }
  result.layers = [...rest.slice(0, insertion), ...moving, ...rest.slice(insertion)]
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
