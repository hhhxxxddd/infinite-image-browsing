import { imageRects, type ImageLayout } from './imageCreationModel.ts'
import { isStudioFont, type StudioFont } from './imageStudioFonts.ts'
import {
  readStudioTextEffects,
  scaleStudioTextEffects,
  studioTextEffectInsets,
  type StudioTextEffects
} from './imageStudioTextEffects.ts'

import { readImageCorrection, type StudioImageCorrection } from './imageStudioCorrection.ts'

export type StudioLayer =
  | StudioImageLayer
  | StudioTextLayer
  | StudioGuideLayer
  | StudioMaskLayer
  | StudioPaintLayer
  | StudioVectorLayer
export type { StudioFont } from './imageStudioFonts.ts'
export type StudioAlign = 'left' | 'center' | 'right'
export interface StudioFrame {
  x: number
  y: number
  width: number
  height: number
}
export interface StudioCrop {
  x: number
  y: number
  width: number
  height: number
}
/** Keep the opposite corner or edge fixed, including rotated frames. */
export function resizeStudioFrame(
  frame: StudioFrame & { rotation: number },
  handle: string,
  dx: number,
  dy: number,
  keepRatio: boolean
): StudioFrame {
  const angle = (frame.rotation * Math.PI) / 180
  const cos = Math.cos(angle),
    sin = Math.sin(angle)
  const localX = dx * cos + dy * sin,
    localY = -dx * sin + dy * cos
  const sx = handle.includes('w') ? -1 : 1,
    sy = handle.includes('n') ? -1 : 1
  const horizontal = handle.includes('w') || handle.includes('e')
  const vertical = handle.includes('n') || handle.includes('s')
  let width = frame.width + (horizontal ? sx * localX : 0),
    height = frame.height + (vertical ? sy * localY : 0)
  if (keepRatio) {
    const factor =
      horizontal && (!vertical || Math.abs(localX / frame.width) >= Math.abs(localY / frame.height))
        ? width / frame.width
        : height / frame.height
    const bounded = Math.max(
      1 / Math.min(frame.width, frame.height),
      Math.min(16384 / Math.max(frame.width, frame.height), factor)
    )
    width = frame.width * bounded
    height = frame.height * bounded
  }
  width = Math.max(1, Math.min(16384, Math.round(width)))
  height = Math.max(1, Math.min(16384, Math.round(height)))
  const shiftX = horizontal ? (sx * (width - frame.width)) / 2 : 0,
    shiftY = vertical ? (sy * (height - frame.height)) / 2 : 0
  return {
    x: frame.x + frame.width / 2 + shiftX * cos - shiftY * sin - width / 2,
    y: frame.y + frame.height / 2 + shiftX * sin + shiftY * cos - height / 2,
    width,
    height
  }
}
export interface StudioLayerBase extends StudioFrame {
  id: string
  name: string
  rotation: number
  opacity: number
  visible: boolean
  locked: boolean
  groupId?: string
  /** A single-level clipping container; geometry remains in canvas coordinates. */
  frameId?: string
}
export type StudioVectorShape = 'rect' | 'ellipse' | 'polygon' | 'speech' | 'thought' | 'burst'
export interface StudioVectorLayer extends StudioLayerBase {
  kind: 'frame' | 'shape'
  shape: StudioVectorShape
  fill: string
  stroke: string
  strokeWidth: number
  radius: number
  points: StudioPoint[]
  tail: StudioPoint
}
export interface StudioGroup {
  id: string
  name: string
  visible: boolean
  locked: boolean
  collapsed: boolean
  /** An empty group's boundary in the bottom-to-top layer stack. */
  stackIndex?: number
}
export interface StudioPoint {
  x: number
  y: number
}
export interface StudioMaskStroke {
  points: StudioPoint[]
  size: number
  mode: 'paint' | 'erase'
}
export interface StudioImageLayer extends StudioLayerBase {
  kind: 'image'
  correction?: StudioImageCorrection
  path: string
  flipX?: boolean
  flipY?: boolean
  crop: StudioCrop
  zoom: number
  focusX: number
  focusY: number
  fit: 'cover' | 'contain' | 'stretch'
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
  italic?: boolean
  underline?: boolean
  strike?: boolean
  lineHeight?: number
  letterSpacing?: number
  flipX?: boolean
  flipY?: boolean
  align: StudioAlign
  color: string
  effects?: StudioTextEffects
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
  backgroundView?: 'checkerboard' | 'plain'
  groups: StudioGroup[]
  layers: StudioLayer[] // bottom to top
}
export interface StudioDocumentIndex {
  version: 2
  activeId: string
  docs: { id: string; name: string; updatedAt: string }[]
}

const clamp = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback
const color = (value: unknown, fallback: string) =>
  typeof value === 'string' && /^#[\da-fA-F]{6}$/.test(value) ? value : fallback
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const identifier = (value: unknown) =>
  typeof value === 'string' && /^[\w-]{1,80}$/.test(value) ? value : crypto.randomUUID()
const cropWithin = (crop: StudioCrop): StudioCrop => {
  const width = clamp(crop.width, 1, Number.EPSILON, 1)
  const height = clamp(crop.height, 1, Number.EPSILON, 1)
  return { x: clamp(crop.x, 0, 0, 1 - width), y: clamp(crop.y, 0, 0, 1 - height), width, height }
}

export function createStudioDocument(
  name = '未命名图片',
  now = new Date().toISOString()
): StudioDocument {
  return {
    version: 2,
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    width: 1080,
    height: 1080,
    background: '#ffffff',
    groups: [],
    layers: []
  }
}
export function createStudioGroup(name = '新建分组'): StudioGroup {
  return { id: crypto.randomUUID(), name, visible: true, locked: false, collapsed: false }
}
export function createImageLayer(
  path: string,
  frame: StudioFrame,
  name = '图片'
): StudioImageLayer {
  return {
    kind: 'image',
    id: crypto.randomUUID(),
    name,
    path,
    flipX: false,
    flipY: false,
    ...frame,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    zoom: 1,
    focusX: 0.5,
    focusY: 0.5,
    fit: 'cover',
    brightness: 100,
    contrast: 100,
    radius: 0
  }
}
export function createTextLayer(frame: StudioFrame, text = '双击编辑文字'): StudioTextLayer {
  return {
    kind: 'text',
    id: crypto.randomUUID(),
    name: '文字',
    ...frame,
    text,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    font: 'system-ui',
    fontSize: 64,
    bold: true,
    italic: false,
    underline: false,
    strike: false,
    lineHeight: 1.24,
    letterSpacing: 0,
    flipX: false,
    flipY: false,
    align: 'center',
    color: '#1f2937'
  }
}
export function createGuideLayer(
  frame: StudioFrame,
  shape: 'rect' | 'arrow' = 'rect'
): StudioGuideLayer {
  return {
    kind: 'guide',
    id: crypto.randomUUID(),
    name: shape === 'arrow' ? '提示箭头' : '提示框',
    ...frame,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    shape,
    flipX: false,
    flipY: false,
    prompt: '',
    color: '#ef4444',
    strokeWidth: 4
  }
}
export function createMaskLayer(width: number, height: number): StudioMaskLayer {
  return {
    kind: 'mask',
    id: crypto.randomUUID(),
    name: '遮罩 1',
    x: 0,
    y: 0,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    color: '#808080',
    strokes: []
  }
}
export function createPaintLayer(width: number, height: number): StudioPaintLayer {
  return {
    kind: 'paint',
    id: crypto.randomUUID(),
    name: '涂抹 1',
    x: 0,
    y: 0,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    prompt: '',
    color: '#ef4444',
    strokes: []
  }
}
/** Convert a canvas point into a mask's local coordinates, including its rotation. */
export function studioMaskPoint(
  layer: StudioMaskLayer | StudioPaintLayer,
  point: StudioPoint
): StudioPoint | null {
  const angle = (-layer.rotation * Math.PI) / 180
  const dx = point.x - layer.x - layer.width / 2
  const dy = point.y - layer.y - layer.height / 2
  const x = (dx * Math.cos(angle) - dy * Math.sin(angle)) / layer.width + 0.5
  const y = (dx * Math.sin(angle) + dy * Math.cos(angle)) / layer.height + 0.5
  if (x < 0 || x > 1 || y < 0 || y > 1) return null
  return { x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 }
}
/** Hit only painted mask pixels, respecting later eraser strokes and layer rotation. */
export function studioMaskContainsPoint(
  layer: StudioMaskLayer | StudioPaintLayer,
  point: StudioPoint,
  hitSlop = 4
): boolean {
  const local = studioMaskPoint(layer, point)
  if (!local) return false
  const x = local.x * layer.width,
    y = local.y * layer.height
  let painted = false
  for (const stroke of layer.strokes) {
    if (!stroke.points.length) continue
    const radius = stroke.size / 2 + (stroke.mode === 'paint' ? hitSlop : 0)
    const points = stroke.points.map((item) => ({
      x: item.x * layer.width,
      y: item.y * layer.height
    }))
    const touching = points.some((item, index) => {
      const next = points[index + 1] ?? item
      const dx = next.x - item.x,
        dy = next.y - item.y
      const t = Math.max(
        0,
        Math.min(1, ((x - item.x) * dx + (y - item.y) * dy) / (dx * dx + dy * dy || 1))
      )
      return Math.hypot(x - item.x - t * dx, y - item.y - t * dy) <= radius
    })
    if (touching) painted = stroke.mode === 'paint'
  }
  return painted
}
/** Paint and erase strokes in order, using the same pixels for display and selection bounds. */
export function drawStudioStrokes(
  ctx: CanvasRenderingContext2D,
  layer: StudioMaskLayer | StudioPaintLayer,
  color: string
) {
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
      for (const point of stroke.points.slice(1))
        ctx.lineTo(point.x * layer.width, point.y * layer.height)
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
    const angle = (layer.rotation * Math.PI) / 180
    const cos = Math.cos(angle),
      sin = Math.sin(angle)
    occupied = (x, y) => {
      const dx = ((x + 0.5) * layer.width) / columns - layer.width / 2
      const dy = ((y + 0.5) * layer.height) / rows - layer.height / 2
      return studioMaskContainsPoint(
        layer,
        {
          x: layer.x + layer.width / 2 + dx * cos - dy * sin,
          y: layer.y + layer.height / 2 + dx * sin + dy * cos
        },
        0
      )
    }
  }
  let left = columns,
    top = rows,
    right = -1,
    bottom = -1
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      if (!occupied(x, y)) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  if (right < left) return null
  const x = Math.max(0, (left * layer.width) / columns - 6)
  const y = Math.max(0, (top * layer.height) / rows - 6)
  const edgeX = Math.min(layer.width, ((right + 1) * layer.width) / columns + 6)
  const edgeY = Math.min(layer.height, ((bottom + 1) * layer.height) / rows + 6)
  return { x, y, width: edgeX - x, height: edgeY - y }
}
/** Selection outline follows the painted content instead of a full-canvas mask frame. */
export function studioMaskPaintBounds(
  layer: StudioMaskLayer | StudioPaintLayer
): StudioFrame | null {
  const painted = layer.strokes.filter((stroke) => stroke.mode === 'paint' && stroke.points.length)
  if (!painted.length) return null
  if (layer.strokes.some((stroke) => stroke.mode === 'erase' && stroke.points.length))
    return erasedStrokeBounds(layer)
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity
  for (const stroke of painted)
    for (const point of stroke.points) {
      const radius = stroke.size / 2 + 6
      left = Math.min(left, point.x * layer.width - radius)
      top = Math.min(top, point.y * layer.height - radius)
      right = Math.max(right, point.x * layer.width + radius)
      bottom = Math.max(bottom, point.y * layer.height + radius)
    }
  const x = Math.max(0, left),
    y = Math.max(0, top)
  return {
    x,
    y,
    width: Math.max(1, Math.min(layer.width, right) - x),
    height: Math.max(1, Math.min(layer.height, bottom) - y)
  }
}
export function studioLayerVisible(doc: StudioDocument, layer: StudioLayer): boolean {
  const frame =
    layer.frameId && doc.layers.find((item) => item.id === layer.frameId && item.kind === 'frame')
  return (
    layer.visible &&
    (!frame ||
      (frame.visible &&
        (!frame.groupId ||
          doc.groups.find((group) => group.id === frame.groupId)?.visible !== false))) &&
    (!layer.groupId || doc.groups.find((group) => group.id === layer.groupId)?.visible !== false)
  )
}
export function studioLayerLocked(doc: StudioDocument, layer: StudioLayer): boolean {
  const frame =
    layer.frameId && doc.layers.find((item) => item.id === layer.frameId && item.kind === 'frame')
  return (
    layer.locked ||
    !!(
      frame &&
      (frame.locked ||
        (frame.groupId && doc.groups.find((group) => group.id === frame.groupId)?.locked))
    ) ||
    !!(layer.groupId && doc.groups.find((group) => group.id === layer.groupId)?.locked)
  )
}
/** World-space bounds include rotated strokes and text effects, before clipping. */
export function studioLayerBounds(layer: StudioLayer): StudioFrame {
  const angle = (layer.rotation * Math.PI) / 180
  const insets =
    layer.kind === 'text'
      ? studioTextEffectInsets(layer)
      : layer.kind === 'shape' || layer.kind === 'frame'
        ? {
            left: layer.strokeWidth / 2,
            right: layer.strokeWidth / 2,
            top: layer.strokeWidth / 2,
            bottom: layer.strokeWidth / 2
          }
        : { left: 0, right: 0, top: 0, bottom: 0 }
  // Thought bubbles can place the small circles beyond the nominal frame at either tail extreme.
  if ((layer.kind === 'shape' || layer.kind === 'frame') && layer.shape === 'thought') {
    insets.left += Math.max(0, 0.022 - layer.tail.x) * layer.width
    insets.right +=
      Math.max(0, layer.tail.x + 0.022 - 1, 0.4 + layer.tail.x * 0.6 + 0.045 - 1) * layer.width
  }
  const width = layer.width + insets.left + insets.right
  const height = layer.height + insets.top + insets.bottom
  const halfWidth = (Math.abs(Math.cos(angle)) * width + Math.abs(Math.sin(angle)) * height) / 2
  const halfHeight = (Math.abs(Math.sin(angle)) * width + Math.abs(Math.cos(angle)) * height) / 2
  const offsetX = (insets.right - insets.left) / 2
  const offsetY = (insets.bottom - insets.top) / 2
  const x = layer.x + layer.width / 2 + offsetX * Math.cos(angle) - offsetY * Math.sin(angle)
  const y = layer.y + layer.height / 2 + offsetX * Math.sin(angle) + offsetY * Math.cos(angle)
  return { x: x - halfWidth, y: y - halfHeight, width: halfWidth * 2, height: halfHeight * 2 }
}
/** Export bounds exclude the canvas background, hidden layers and editing annotations. */
export function studioContentBounds(doc: StudioDocument, clipToCanvas = true): StudioFrame | null {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity
  for (const layer of doc.layers) {
    if (
      !studioLayerVisible(doc, layer) ||
      layer.opacity <= 0 ||
      (layer.kind !== 'image' &&
        layer.kind !== 'text' &&
        layer.kind !== 'frame' &&
        layer.kind !== 'shape') ||
      (layer.kind === 'image' ? !layer.path : layer.kind === 'text' ? !layer.text.trim() : false) ||
      !!layer.frameId
    )
      continue
    const bounds = studioLayerBounds(layer)
    const x1 = clipToCanvas ? Math.max(0, bounds.x) : bounds.x,
      y1 = clipToCanvas ? Math.max(0, bounds.y) : bounds.y
    const x2 = clipToCanvas
        ? Math.min(doc.width, bounds.x + bounds.width)
        : bounds.x + bounds.width,
      y2 = clipToCanvas ? Math.min(doc.height, bounds.y + bounds.height) : bounds.y + bounds.height
    if (x2 - x1 <= 1e-7 || y2 - y1 <= 1e-7) continue
    left = Math.min(left, x1)
    top = Math.min(top, y1)
    right = Math.max(right, x2)
    bottom = Math.max(bottom, y2)
  }
  if (left === Infinity) return null
  const x = Math.floor(left + 1e-7),
    y = Math.floor(top + 1e-7)
  return { x, y, width: Math.ceil(right - 1e-7) - x, height: Math.ceil(bottom - 1e-7) - y }
}

export function studioExportDocument(doc: StudioDocument, contentOnly: boolean): StudioDocument {
  const result: StudioDocument = JSON.parse(JSON.stringify(doc))
  if (!contentOnly) return result
  const bounds = studioContentBounds(doc)
  if (!bounds) throw new Error('没有可保存的内容，请添加或显示图层')
  result.width = bounds.width
  result.height = bounds.height
  for (const layer of result.layers) {
    layer.x -= bounds.x
    layer.y -= bounds.y
  }
  return result
}
/** Axis-aligned bounds of the visible content in a group, including rotated layers. */
export function studioGroupBounds(doc: StudioDocument, groupId: string): StudioFrame | null {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity
  for (const layer of doc.layers) {
    if (layer.groupId !== groupId || !studioLayerVisible(doc, layer)) continue
    const content =
      layer.kind === 'mask' || layer.kind === 'paint'
        ? studioMaskPaintBounds(layer)
        : { x: 0, y: 0, width: layer.width, height: layer.height }
    if (!content) continue
    const angle = (layer.rotation * Math.PI) / 180
    const cos = Math.cos(angle),
      sin = Math.sin(angle)
    const cx = layer.x + layer.width / 2,
      cy = layer.y + layer.height / 2
    for (const x of [content.x, content.x + content.width])
      for (const y of [content.y, content.y + content.height]) {
        const dx = x - layer.width / 2,
          dy = y - layer.height / 2
        const px = cx + dx * cos - dy * sin,
          py = cy + dx * sin + dy * cos
        left = Math.min(left, px)
        top = Math.min(top, py)
        right = Math.max(right, px)
        bottom = Math.max(bottom, py)
      }
  }
  return left === Infinity ? null : { x: left, y: top, width: right - left, height: bottom - top }
}

/** Keep all group members together, including hidden layers, and respect every lock. */
export function moveStudioGroup(
  doc: StudioDocument,
  groupId: string,
  dx: number,
  dy: number
): StudioDocument {
  const group = doc.groups.find((item) => item.id === groupId)
  const members = doc.layers.filter((layer) => layer.groupId === groupId)
  const frames = new Set(members.filter((layer) => layer.kind === 'frame').map((layer) => layer.id))
  if (!group || group.locked || !members.length || members.some((layer) => layer.locked)) return doc
  return {
    ...doc,
    layers: doc.layers.map((layer) =>
      layer.groupId === groupId || (layer.frameId && frames.has(layer.frameId))
        ? { ...layer, x: layer.x + dx, y: layer.y + dy }
        : layer
    )
  }
}

export type StudioLayerRow =
  { kind: 'group'; group: StudioGroup } | { kind: 'layer'; layer: StudioLayer }
export function studioLayerRows(doc: StudioDocument): StudioLayerRow[] {
  if (doc.layers.some((layer) => layer.kind === 'frame')) {
    const root = { ...doc, layers: doc.layers.filter((layer) => !layer.frameId) }
    const rows: StudioLayerRow[] = []
    const shown = new Set<string>()
    const empty = doc.groups.filter(
      (group) => !doc.layers.some((layer) => layer.groupId === group.id)
    )
    const emitEmpty = (boundary: number) => {
      for (const group of empty)
        if (!shown.has(group.id) && (group.stackIndex ?? doc.layers.length) >= boundary) {
          rows.push({ kind: 'group', group })
          shown.add(group.id)
        }
    }
    const emit = (layer: StudioLayer) => {
      const group = doc.groups.find((item) => item.id === layer.groupId)
      if (group && !shown.has(group.id)) {
        rows.push({ kind: 'group', group })
        shown.add(group.id)
      }
      if (group?.collapsed) return
      rows.push({ kind: 'layer', layer })
      if (layer.kind === 'frame')
        doc.layers
          .filter((child) => child.frameId === layer.id)
          .reverse()
          .forEach(emit)
    }
    root.layers
      .slice()
      .reverse()
      .forEach((layer) => {
        emitEmpty(doc.layers.indexOf(layer) + 1)
        emit(layer)
      })
    emitEmpty(0)
    return rows
  }
  const rows: StudioLayerRow[] = []
  const shown = new Set<string>()
  const populated = new Set(doc.layers.map((layer) => layer.groupId))
  for (let index = doc.layers.length; index >= 0; index--) {
    for (const group of doc.groups) {
      if (
        !populated.has(group.id) &&
        Math.max(0, Math.min(doc.layers.length, group.stackIndex ?? doc.layers.length)) === index
      )
        rows.push({ kind: 'group', group })
    }
    const layer = doc.layers[index - 1]
    if (!layer) continue
    const group = doc.groups.find((item) => item.id === layer.groupId)
    if (group && !shown.has(group.id)) {
      rows.push({ kind: 'group', group })
      shown.add(group.id)
    }
    if (!group || !group.collapsed) rows.push({ kind: 'layer', layer })
  }
  return rows
}
export function studioEditableMaskLayers(doc: StudioDocument): StudioMaskLayer[] {
  return doc.layers.filter(
    (layer): layer is StudioMaskLayer =>
      layer.kind === 'mask' && studioLayerVisible(doc, layer) && !studioLayerLocked(doc, layer)
  )
}
export function moveStudioLayerToGroup(
  doc: StudioDocument,
  layerId: string,
  groupId?: string
): StudioDocument {
  return moveStudioLayersToGroup(doc, [layerId], groupId)
}

/** Assign a selection in one operation, preserving member order and continuous group blocks. */
export function moveStudioLayersToGroup(
  doc: StudioDocument,
  layerIds: string[],
  groupId?: string
): StudioDocument {
  const destination = doc.groups.find((group) => group.id === groupId)
  if (groupId && (!destination || destination.locked)) return doc
  const ids = new Set(layerIds)
  const selected = doc.layers.filter((layer) => ids.has(layer.id))
  if (selected.some((layer) => studioLayerLocked(doc, layer))) return doc
  const moving = selected.filter((layer) => layer.groupId !== groupId)
  if (!moving.length) return doc
  const destinationMember = groupId && doc.layers.find((layer) => layer.groupId === groupId)
  const parent = destinationMember
    ? destinationMember.frameId
    : moving.every((layer) => layer.frameId === moving[0].frameId)
      ? moving[0].frameId
      : undefined
  if (parent && moving.some((layer) => layer.kind === 'frame')) return doc
  const movingIds = new Set(moving.map((layer) => layer.id))
  const rest = doc.layers.filter((layer) => !movingIds.has(layer.id))
  const top = moving[moving.length - 1]
  const groupTop = (id: string) =>
    doc.layers.reduce((last, layer, index) => (layer.groupId === id ? index : last), -1)
  // A new group or ungrouped selection belongs above its former group's whole block.
  const anchor = top.groupId ? groupTop(top.groupId) + 1 : doc.layers.indexOf(top) + 1
  const boundary = destination?.stackIndex ?? anchor
  const peers = groupId ? rest.filter((layer) => layer.groupId === groupId) : []
  const insertion = peers.length
    ? rest.indexOf(peers[peers.length - 1]) + 1
    : doc.layers.slice(0, boundary).filter((layer) => !movingIds.has(layer.id)).length
  const result = structuredClone(doc)
  result.groups.forEach((group) => {
    if (group.id === groupId || rest.some((layer) => layer.groupId === group.id)) return
    const formerTop = groupTop(group.id)
    const index = formerTop >= 0 ? formerTop + 1 : (group.stackIndex ?? doc.layers.length)
    const remaining = doc.layers.slice(0, index).filter((layer) => !movingIds.has(layer.id)).length
    group.stackIndex = remaining + (insertion < remaining ? moving.length : 0)
  })
  const assigned = moving.map((layer) => ({
    ...layer,
    groupId,
    ...(groupId && (parent || layer.frameId) ? { frameId: parent } : {})
  }))
  result.layers = structuredClone([
    ...rest.slice(0, insertion),
    ...assigned,
    ...rest.slice(insertion)
  ])
  return result
}

export function readStudioDocument(value: unknown): StudioDocument | undefined {
  if (!object(value) || value.version !== 2 || !Array.isArray(value.layers)) return undefined
  const width = Math.round(clamp(value.width, 1080, 1, 16384))
  const height = Math.round(clamp(value.height, 1080, 1, 16384))
  const layerCount = value.layers.length
  const groupIds = new Set<string>()
  const groups: StudioGroup[] = (Array.isArray(value.groups) ? value.groups : []).flatMap(
    (raw): StudioGroup[] => {
      if (
        !object(raw) ||
        typeof raw.id !== 'string' ||
        !/^[\w-]{1,80}$/.test(raw.id) ||
        groupIds.has(raw.id)
      )
        return []
      groupIds.add(raw.id)
      return [
        {
          id: raw.id,
          name: typeof raw.name === 'string' ? raw.name.slice(0, 80) : '分组',
          visible: raw.visible !== false,
          locked: raw.locked === true,
          collapsed: raw.collapsed === true,
          ...(typeof raw.stackIndex === 'number' && Number.isFinite(raw.stackIndex)
            ? { stackIndex: Math.max(0, Math.min(layerCount, Math.round(raw.stackIndex))) }
            : {})
        }
      ]
    }
  )
  const retainedGroupIds = new Set(groups.map((group) => group.id))
  const seen = new Set<string>()
  const layers = value.layers.flatMap((raw): StudioLayer[] => {
    if (
      !object(raw) ||
      !['image', 'text', 'guide', 'mask', 'paint', 'frame', 'shape'].includes(raw.kind as string)
    )
      return []
    const id = identifier(raw.id)
    if (seen.has(id)) return []
    seen.add(id)
    const name =
      typeof raw.name === 'string' ? raw.name.slice(0, 80) : raw.kind === 'image' ? '图片' : '文字'
    const displayName =
      raw.kind === 'mask' && /^编辑遮罩(?: (\d+))?$/.test(name)
        ? name.replace(/^编辑遮罩/, '遮罩')
        : raw.kind === 'paint' && /^彩色涂抹(?: (\d+))?$/.test(name)
          ? name.replace(/^彩色涂抹/, '涂抹')
          : name
    const base = {
      id,
      name: displayName,
      // Layers can remain outside a resized canvas; loading must not crop or rescale them.
      x: clamp(raw.x, 0, -65536, 65536),
      y: clamp(raw.y, 0, -65536, 65536),
      width: clamp(raw.width, 320, 1, 32768),
      height: clamp(raw.height, 180, 1, 32768),
      rotation: clamp(raw.rotation, 0, -360, 360),
      opacity: clamp(raw.opacity, 1, 0, 1),
      visible: raw.visible !== false,
      locked: raw.locked === true,
      ...(raw.kind !== 'frame' && typeof raw.frameId === 'string' ? { frameId: raw.frameId } : {}),
      ...(typeof raw.groupId === 'string' && retainedGroupIds.has(raw.groupId)
        ? { groupId: raw.groupId }
        : {})
    }
    if (raw.kind === 'frame' || raw.kind === 'shape') {
      const shape = [
        'rect',
        'ellipse',
        'polygon',
        ...(raw.kind === 'shape' ? ['speech', 'thought', 'burst'] : [])
      ].includes(raw.shape as string)
        ? (raw.shape as StudioVectorShape)
        : 'rect'
      const points =
        Array.isArray(raw.points) && raw.points.length === 4
          ? raw.points.map((point, i) => ({
              x: clamp(object(point) ? point.x : undefined, i === 1 || i === 2 ? 1 : 0, 0, 1),
              y: clamp(object(point) ? point.y : undefined, i >= 2 ? 1 : 0, 0, 1)
            }))
          : [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 1, y: 1 },
              { x: 0, y: 1 }
            ]
      return [
        {
          ...base,
          kind: raw.kind,
          shape,
          fill: raw.fill === 'transparent' ? 'transparent' : color(raw.fill, '#ffffff'),
          stroke: color(raw.stroke, '#18202b'),
          strokeWidth: clamp(raw.strokeWidth, 2, 0, 100),
          radius: clamp(raw.radius, 0, 0, 1000),
          points,
          tail: {
            x: clamp(object(raw.tail) ? raw.tail.x : undefined, 0.25, 0, 1),
            y: clamp(object(raw.tail) ? raw.tail.y : undefined, 1, 0.8, 1)
          }
        }
      ]
    }
    if (raw.kind === 'image') {
      const rect = object(raw.crop) ? raw.crop : {}
      return [
        {
          ...base,
          kind: 'image',
          ...(raw.correction ? { correction: readImageCorrection(raw.correction) } : {}),
          path: typeof raw.path === 'string' ? raw.path.slice(0, 2048) : '',
          flipX: raw.flipX === true,
          flipY: raw.flipY === true,
          crop: cropWithin({
            x: rect.x as number,
            y: rect.y as number,
            width: rect.width as number,
            height: rect.height as number
          }),
          zoom: clamp(raw.zoom, 1, 1, 8),
          focusX: clamp(raw.focusX, 0.5, 0, 1),
          focusY: clamp(raw.focusY, 0.5, 0, 1),
          fit: raw.fit === 'contain' || raw.fit === 'stretch' ? raw.fit : 'cover',
          brightness: clamp(raw.brightness, 100, 20, 200),
          contrast: clamp(raw.contrast, 100, 20, 200),
          radius: clamp(raw.radius, 0, 0, 200)
        }
      ]
    }
    if (raw.kind === 'guide')
      return [
        {
          ...base,
          kind: 'guide',
          prompt: typeof raw.prompt === 'string' ? raw.prompt.slice(0, 2000) : '',
          shape: raw.shape === 'arrow' ? 'arrow' : 'rect',
          flipX: raw.flipX === true,
          flipY: raw.flipY === true,
          color: color(raw.color, '#ef4444'),
          strokeWidth: clamp(raw.strokeWidth, 4, 1, 40)
        }
      ]
    if (raw.kind === 'mask' || raw.kind === 'paint') {
      const strokes: StudioMaskStroke[] = (Array.isArray(raw.strokes) ? raw.strokes : [])
        .slice(0, 200)
        .flatMap((stroke): StudioMaskStroke[] => {
          if (!object(stroke) || !Array.isArray(stroke.points)) return []
          const points = stroke.points
            .slice(0, 500)
            .flatMap((point): StudioPoint[] =>
              object(point) &&
              typeof point.x === 'number' &&
              Number.isFinite(point.x) &&
              typeof point.y === 'number' &&
              Number.isFinite(point.y)
                ? [{ x: clamp(point.x, 0, 0, 1), y: clamp(point.y, 0, 0, 1) }]
                : []
            )
          return points.length
            ? [
                {
                  points,
                  size: clamp(stroke.size, 32, 1, 400),
                  mode: stroke.mode === 'erase' ? 'erase' : 'paint'
                }
              ]
            : []
        })
      return raw.kind === 'mask'
        ? [{ ...base, kind: 'mask', color: color(raw.color, '#808080'), strokes }]
        : [
            {
              ...base,
              kind: 'paint',
              prompt: typeof raw.prompt === 'string' ? raw.prompt.slice(0, 2000) : '',
              color: color(raw.color, '#ef4444'),
              strokes
            }
          ]
    }
    return [
      {
        ...base,
        kind: 'text',
        text: typeof raw.text === 'string' ? raw.text.slice(0, 1000) : '',
        font: isStudioFont(raw.font) ? raw.font : 'system-ui',
        fontSize: clamp(raw.fontSize, 64, 1, 1000),
        bold: raw.bold !== false,
        italic: raw.italic === true,
        underline: raw.underline === true,
        strike: raw.strike === true,
        lineHeight: clamp(raw.lineHeight, 1.24, 1, 3),
        letterSpacing: clamp(raw.letterSpacing, 0, -20, 100),
        flipX: raw.flipX === true,
        flipY: raw.flipY === true,
        align: ['left', 'center', 'right'].includes(raw.align as string)
          ? (raw.align as StudioAlign)
          : 'center',
        color: color(raw.color, '#ffffff'),
        ...(object(raw.effects) ? { effects: readStudioTextEffects(raw.effects) } : {})
      }
    ]
  })
  return {
    version: 2,
    id: identifier(value.id),
    name:
      typeof value.name === 'string' && value.name.trim() ? value.name.slice(0, 80) : '未命名图片',
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
    width,
    height,
    background:
      value.background === 'transparent' ? 'transparent' : color(value.background, '#ffffff'),
    ...(value.backgroundView === 'checkerboard' ? { backgroundView: 'checkerboard' as const } : {}),
    groups,
    layers: layers.map((layer) =>
      layer.frameId && !layers.some((frame) => frame.id === layer.frameId && frame.kind === 'frame')
        ? { ...layer, frameId: undefined }
        : layer
    )
  }
}

export function readStudioIndex(value: unknown): StudioDocumentIndex | undefined {
  if (!object(value) || value.version !== 2 || !Array.isArray(value.docs)) return undefined
  const seen = new Set<string>()
  const docs = value.docs.flatMap((raw): StudioDocumentIndex['docs'] => {
    if (
      !object(raw) ||
      typeof raw.id !== 'string' ||
      !/^[\w-]{1,80}$/.test(raw.id) ||
      seen.has(raw.id)
    )
      return []
    seen.add(raw.id)
    return [
      {
        id: raw.id,
        name:
          typeof raw.name === 'string' && raw.name.trim() ? raw.name.slice(0, 80) : '未命名图片',
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : ''
      }
    ]
  })
  // Creation limits belong to each editor/work. Never truncate a shared index
  // while restoring it: one workspace can contain drafts from many works.
  return {
    version: 2,
    docs,
    activeId:
      typeof value.activeId === 'string' && seen.has(value.activeId)
        ? value.activeId
        : (docs[0]?.id ?? '')
  }
}

export function applyStudioTemplate(doc: StudioDocument, layout: ImageLayout): StudioDocument {
  const rects = imageRects({ layout, width: doc.width, height: doc.height, padding: 24, gap: 16 })
  const result = structuredClone(doc)
  const images = result.layers.filter(
    (layer): layer is StudioImageLayer => layer.kind === 'image' && layer.visible
  )
  const missing: StudioImageLayer[] = []
  rects.forEach((rect, index) => {
    const layer = images[index]
    if (layer) Object.assign(layer, rect)
    else missing.push(createImageLayer('', rect, `画面 ${index + 1}`))
  })
  const lastImageIndex = result.layers.reduce(
    (last, layer, index) => (layer.kind === 'image' ? index : last),
    -1
  )
  result.layers.splice(lastImageIndex + 1, 0, ...missing)
  return result
}

/** Resize the canvas around its center without changing any layer's content or dimensions. */
export function resizeStudioCanvas(
  doc: StudioDocument,
  width: number,
  height: number
): StudioDocument {
  const result = structuredClone(doc)
  result.width = Math.round(clamp(width, doc.width, 1, 16384))
  result.height = Math.round(clamp(height, doc.height, 1, 16384))
  const dx = (result.width - doc.width) / 2,
    dy = (result.height - doc.height) / 2
  result.layers.forEach((layer) => {
    layer.x += dx
    layer.y += dy
  })
  return result
}

export function scaleStudioDocument(
  doc: StudioDocument,
  width: number,
  height: number
): StudioDocument {
  const xScale = width / doc.width
  const yScale = height / doc.height
  const result = structuredClone(doc)
  result.width = width
  result.height = height
  result.layers.forEach((layer) => {
    layer.x *= xScale
    layer.y *= yScale
    layer.width *= xScale
    layer.height *= yScale
    if (layer.kind === 'text') {
      layer.fontSize *= xScale
      if (layer.letterSpacing !== undefined) layer.letterSpacing *= xScale
      if (layer.effects) scaleStudioTextEffects(layer.effects, Math.sqrt(xScale * yScale))
    }
    if (layer.kind === 'guide') layer.strokeWidth *= Math.sqrt(xScale * yScale)
    if (layer.kind === 'frame' || layer.kind === 'shape') {
      layer.strokeWidth *= Math.sqrt(xScale * yScale)
      layer.radius *= Math.sqrt(xScale * yScale)
    }
    if (layer.kind === 'mask' || layer.kind === 'paint')
      layer.strokes.forEach((stroke) => {
        stroke.size *= Math.sqrt(xScale * yScale)
      })
  })
  return result
}

export type StudioDragItem = { kind: 'layer' | 'group'; id: string }
export type StudioDropTarget =
  | { kind: 'layer' | 'group'; id: string; position: 'before' | 'after' | 'inside' }
  | { kind: 'top' | 'bottom' }

/** Drop positions follow the visible top-to-bottom list; layers are stored bottom-to-top. */
export function dropStudioItem(
  doc: StudioDocument,
  source: StudioDragItem,
  target: StudioDropTarget
): StudioDocument {
  const result = structuredClone(doc)
  const moving = result.layers.filter((layer) =>
    source.kind === 'group'
      ? layer.groupId === source.id
      : layer.id === source.id || layer.frameId === source.id
  )
  if (
    (source.kind === 'layer' && !moving.length) ||
    (source.kind === 'group' && !result.groups.some((group) => group.id === source.id)) ||
    (source.kind === 'layer' && studioLayerLocked(result, moving[0])) ||
    (source.kind === 'group' && result.groups.find((group) => group.id === source.id)?.locked)
  )
    return result
  const rest = result.layers.filter((layer) => !moving.some((item) => item.id === layer.id))
  let insertion = target.kind === 'top' ? rest.length : 0
  let groupId: string | undefined
  if (target.kind === 'layer' || target.kind === 'group') {
    const layer = target.kind === 'layer' ? rest.find((item) => item.id === target.id) : undefined
    if (target.kind === 'layer' && !layer) return result
    const targetGroup =
      target.kind === 'group' ? target.id : source.kind === 'group' ? layer?.groupId : undefined
    if (targetGroup) {
      if (source.kind === 'group' && targetGroup === source.id) return result
      const group = result.groups.find((item) => item.id === targetGroup)
      if (!group) return result
      if (target.position === 'inside' && source.kind === 'layer') {
        if (group.locked) return result
        groupId = group.id
      }
      const peers = rest
        .map((item, index) => (item.groupId === group.id ? index : -1))
        .filter((index) => index >= 0)
      insertion = peers.length
        ? target.position === 'after'
          ? Math.min(...peers)
          : Math.max(...peers) + 1
        : Math.max(0, Math.min(result.layers.length, group.stackIndex ?? result.layers.length)) -
          moving.filter(
            (item) => result.layers.indexOf(item) < (group.stackIndex ?? result.layers.length)
          ).length
    } else if (layer) {
      const frameId =
        layer.kind === 'frame' && target.position === 'inside' ? layer.id : layer.frameId
      if (moving.some((item) => item.kind === 'frame') && frameId) return doc
      if (
        frameId &&
        studioLayerLocked(result, result.layers.find((item) => item.id === frameId) || layer)
      )
        return doc
      moving
        .filter(
          (item) => item.kind !== 'frame' && !moving.some((frame) => frame.id === item.frameId)
        )
        .forEach((item) => {
          item.frameId = frameId
        })
      groupId = layer.groupId
      if (groupId && result.groups.find((group) => group.id === groupId)?.locked) return result
      insertion = rest.indexOf(layer) + (target.position === 'before' ? 1 : 0)
    }
  }
  if (target.kind === 'top' || target.kind === 'bottom')
    moving
      .filter((item) => !moving.some((frame) => frame.id === item.frameId))
      .forEach((item) => {
        item.frameId = undefined
      })
  if (source.kind === 'layer') moving[0].groupId = groupId
  for (const group of result.groups) {
    if (
      moving.some((layer) => layer.groupId === group.id) ||
      result.layers.some((layer) => layer.groupId === group.id)
    )
      continue
    const index = Math.max(
      0,
      Math.min(result.layers.length, group.stackIndex ?? result.layers.length)
    )
    const remaining = index - moving.filter((layer) => result.layers.indexOf(layer) < index).length
    group.stackIndex =
      remaining +
      (insertion < remaining ||
      (insertion === remaining &&
        target.kind === 'group' &&
        target.id === group.id &&
        target.position === 'after')
        ? moving.length
        : 0)
  }
  if (source.kind === 'group') {
    const sourceGroup = result.groups.find((group) => group.id === source.id)
    if (sourceGroup && !moving.length) {
      sourceGroup.stackIndex = insertion
      if (target.kind === 'group' && target.id !== source.id) {
        result.groups = result.groups.filter((group) => group.id !== source.id)
        const index = result.groups.findIndex((group) => group.id === target.id)
        result.groups.splice(index + (target.position === 'after' ? 1 : 0), 0, sourceGroup)
      } else if (target.kind === 'top' || target.kind === 'bottom') {
        result.groups = result.groups.filter((group) => group.id !== source.id)
        if (target.kind === 'top') result.groups.unshift(sourceGroup)
        else result.groups.push(sourceGroup)
      }
    }
  }
  result.layers = [...rest.slice(0, insertion), ...moving, ...rest.slice(insertion)]
  return result
}

export function reorderStudioLayer(doc: StudioDocument, from: string, to: string): StudioDocument {
  const result = structuredClone(doc)
  const source = result.layers.findIndex((layer) => layer.id === from)
  const target = result.layers.findIndex((layer) => layer.id === to)
  if (source < 0 || target < 0 || source === target) return result
  const [layer] = result.layers.splice(source, 1)
  result.layers.splice(target, 0, layer)
  return result
}

/** Move a group as one stack block without changing the order of its members. */
export function reorderStudioGroup(
  doc: StudioDocument,
  groupId: string,
  target: { kind: 'group' | 'layer'; id: string } | { kind: 'bottom' }
): StudioDocument {
  const result = structuredClone(doc)
  const sourceGroup = result.groups.find((group) => group.id === groupId)
  if (!sourceGroup || (target.kind === 'group' && target.id === groupId)) return result
  const moving = result.layers.filter((layer) => layer.groupId === groupId)
  if (!moving.length) {
    if (target.kind === 'group') {
      const from = result.groups.findIndex((group) => group.id === groupId)
      const to = result.groups.findIndex((group) => group.id === target.id)
      if (to >= 0) {
        result.groups.splice(from, 1)
        result.groups.splice(
          result.groups.findIndex((group) => group.id === target.id),
          0,
          sourceGroup
        )
      }
    }
    return result
  }
  if (target.kind === 'layer' && moving.some((layer) => layer.id === target.id)) return result
  const rest = result.layers.filter((layer) => layer.groupId !== groupId)
  let insertion = 0
  if (target.kind === 'group') {
    const peers = rest
      .map((layer, index) => (layer.groupId === target.id ? index : -1))
      .filter((index) => index >= 0)
    if (!result.groups.some((group) => group.id === target.id)) return result
    insertion = peers.length ? Math.max(...peers) + 1 : rest.length
  } else if (target.kind === 'layer') {
    const layer = rest.find((item) => item.id === target.id)
    if (!layer) return result
    const peers = layer.groupId
      ? rest
          .map((item, index) => (item.groupId === layer.groupId ? index : -1))
          .filter((index) => index >= 0)
      : []
    insertion = peers.length
      ? Math.max(...peers) + 1
      : rest.findIndex((item) => item.id === target.id) + 1
  }
  result.layers = [...rest.slice(0, insertion), ...moving, ...rest.slice(insertion)]
  return result
}

export function updateCrop(crop: StudioCrop, selection: StudioCrop): StudioCrop {
  return cropWithin({
    x: crop.x + selection.x * crop.width,
    y: crop.y + selection.y * crop.height,
    width: crop.width * selection.width,
    height: crop.height * selection.height
  })
}

/** Convert a crop drawn on the displayed layer into source-image coordinates. */
export function cropStudioImage(
  layer: StudioImageLayer,
  selection: StudioCrop,
  sourceWidth: number,
  sourceHeight: number
): StudioImageLayer {
  const result = structuredClone(layer)
  const box = cropWithin(selection)
  // The frame stays in displayed coordinates; source pixels follow the mirrored content.
  const sourceBox = {
    ...box,
    x: layer.flipX ? 1 - box.x - box.width : box.x,
    y: layer.flipY ? 1 - box.y - box.height : box.y
  }
  const oldWidth = layer.width,
    oldHeight = layer.height
  if (sourceWidth > 0 && sourceHeight > 0 && layer.crop.width > 0 && layer.crop.height > 0) {
    const sw = layer.crop.width * sourceWidth,
      sh = layer.crop.height * sourceHeight
    const base =
      layer.fit === 'cover'
        ? Math.max(oldWidth / sw, oldHeight / sh)
        : Math.min(oldWidth / sw, oldHeight / sh)
    const dw = (layer.fit === 'stretch' ? oldWidth : sw * base) * layer.zoom,
      dh = (layer.fit === 'stretch' ? oldHeight : sh * base) * layer.zoom
    const left = (oldWidth - dw) * layer.focusX,
      top = (oldHeight - dh) * layer.focusY
    const sourceX = Math.max(0, Math.min(1, (sourceBox.x * oldWidth - left) / dw))
    const sourceY = Math.max(0, Math.min(1, (sourceBox.y * oldHeight - top) / dh))
    const sourceW = Math.max(Number.EPSILON, Math.min(1 - sourceX, (box.width * oldWidth) / dw))
    const sourceH = Math.max(Number.EPSILON, Math.min(1 - sourceY, (box.height * oldHeight) / dh))
    result.crop = updateCrop(layer.crop, {
      x: sourceX,
      y: sourceY,
      width: sourceW,
      height: sourceH
    })
  } else result.crop = updateCrop(layer.crop, sourceBox)
  const centerX = layer.x + oldWidth / 2,
    centerY = layer.y + oldHeight / 2
  const offsetX = (box.x + box.width / 2 - 0.5) * oldWidth
  const offsetY = (box.y + box.height / 2 - 0.5) * oldHeight
  const angle = (layer.rotation * Math.PI) / 180
  const nextCenterX = centerX + offsetX * Math.cos(angle) - offsetY * Math.sin(angle)
  const nextCenterY = centerY + offsetX * Math.sin(angle) + offsetY * Math.cos(angle)
  result.width = oldWidth * box.width
  result.height = oldHeight * box.height
  result.x = nextCenterX - result.width / 2
  result.y = nextCenterY - result.height / 2
  result.zoom = 1
  result.focusX = 0.5
  result.focusY = 0.5
  return result
}
