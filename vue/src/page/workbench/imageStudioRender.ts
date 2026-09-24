import type { FileNodeInfo } from '@/api/files'
import { toImageThumbnailUrl } from '@/util/file'
import { drawStudioStrokes, studioLayerVisible, type StudioDocument, type StudioGuideLayer, type StudioImageLayer,
  type StudioMaskLayer, type StudioPaintLayer, type StudioTextLayer } from './imageStudioModel'
import { layoutStudioText } from './imageStudioText'

const imageCache = new Map<string, Promise<HTMLImageElement | null>>()
export function clearStudioImageCache() { imageCache.clear() }

function loadImage(file: FileNodeInfo, size: number): Promise<HTMLImageElement | null> {
  const url = toImageThumbnailUrl(file, `${size}x${size}`)
  const cached = size <= 1280
  let task = cached ? imageCache.get(url) : undefined
  if (!task) {
    task = new Promise(resolve => {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.onload = () => resolve(image)
      image.onerror = () => { imageCache.delete(url); resolve(null) }
      image.src = url
    })
    if (cached) {
      imageCache.set(url, task)
      while (imageCache.size > 16) imageCache.delete(imageCache.keys().next().value!)
    }
  }
  return task
}

export async function studioImageDimensions(file: FileNodeInfo): Promise<{ width: number; height: number } | null> {
  if (file.width && file.height) return { width: file.width, height: file.height }
  const image = await loadImage(file, 1280)
  return image ? { width: image.naturalWidth, height: image.naturalHeight } : null
}

function paintImage(ctx: CanvasRenderingContext2D, layer: StudioImageLayer, image: HTMLImageElement) {
  const { width, height, crop } = layer
  const sx = crop.x * image.naturalWidth
  const sy = crop.y * image.naturalHeight
  const sw = crop.width * image.naturalWidth
  const sh = crop.height * image.naturalHeight
  const base = layer.fit === 'cover' ? Math.max(width / sw, height / sh) : Math.min(width / sw, height / sh)
  const dw = sw * base * layer.zoom
  const dh = sh * base * layer.zoom
  ctx.beginPath()
  ctx.roundRect(-width / 2, -height / 2, width, height, Math.min(layer.radius, width / 2, height / 2))
  ctx.clip()
  ctx.filter = `brightness(${layer.brightness}%) contrast(${layer.contrast}%)`
  ctx.drawImage(image, sx, sy, sw, sh,
    -width / 2 + (width - dw) * layer.focusX,
    -height / 2 + (height - dh) * layer.focusY, dw, dh)
}

function paintText(ctx: CanvasRenderingContext2D, layer: StudioTextLayer) {
  ctx.fillStyle = layer.color
  const layout = layoutStudioText(ctx, layer)
  ctx.textBaseline = 'top'
  ctx.textAlign = layer.align
  const x = layer.align === 'left' ? -layer.width / 2 : layer.align === 'right' ? layer.width / 2 : 0
  ctx.beginPath()
  ctx.rect(-layer.width / 2, -layer.height / 2, layer.width, layer.height)
  ctx.clip()
  const top = -layer.height / 2 + Math.max(4, (layer.height - layout.lines.length * layout.lineHeight) / 2)
  layout.lines.forEach((line, index) => ctx.fillText(line, x, top + index * layout.lineHeight))
}
function paintGuide(ctx: CanvasRenderingContext2D, layer: StudioGuideLayer) {
  ctx.strokeStyle = layer.color
  ctx.fillStyle = layer.color
  ctx.lineWidth = layer.strokeWidth
  if (layer.shape === 'arrow') {
    const startX = layer.flipX ? layer.width / 2 : -layer.width / 2
    const startY = layer.flipY ? layer.height / 2 : -layer.height / 2
    const endX = -startX, endY = -startY
    const angle = Math.atan2(endY - startY, endX - startX)
    const head = Math.max(14, layer.strokeWidth * 4)
    ctx.beginPath(); ctx.moveTo(startX, startY); ctx.lineTo(endX, endY); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(endX, endY)
    ctx.lineTo(endX - head * Math.cos(angle - Math.PI / 6), endY - head * Math.sin(angle - Math.PI / 6))
    ctx.lineTo(endX - head * Math.cos(angle + Math.PI / 6), endY - head * Math.sin(angle + Math.PI / 6))
    ctx.closePath(); ctx.fill()
  } else {
    ctx.setLineDash([Math.max(6, layer.strokeWidth * 3), Math.max(4, layer.strokeWidth * 2)])
    ctx.strokeRect(-layer.width / 2, -layer.height / 2, layer.width, layer.height)
  }
}

function maskLayerCanvas(layer: StudioMaskLayer | StudioPaintLayer, ratio: number, color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(layer.width * ratio))
  canvas.height = Math.max(1, Math.round(layer.height * ratio))
  const ctx = canvas.getContext('2d')!
  ctx.scale(canvas.width / layer.width, canvas.height / layer.height)
  drawStudioStrokes(ctx, layer, color)
  return canvas
}

export type StudioRenderScope = { kind: 'all' } | { kind: 'layer' | 'group'; id: string }
export function renderStudioMask(target: HTMLCanvasElement, doc: StudioDocument, maskIds?: string[], maxDimension = Infinity) {
  const ratio = Math.min(1, maxDimension / Math.max(doc.width, doc.height))
  target.width = Math.round(doc.width * ratio)
  target.height = Math.round(doc.height * ratio)
  const ctx = target.getContext('2d')
  if (!ctx) throw new Error('无法创建遮罩画布')
  ctx.scale(ratio, ratio)
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, doc.width, doc.height)
  for (const layer of doc.layers) {
    if (layer.kind !== 'mask' || !studioLayerVisible(doc, layer) || (maskIds && !maskIds.includes(layer.id))) continue
    const mask = maskLayerCanvas(layer, ratio, '#ffffff')
    ctx.save()
    ctx.translate(layer.x + layer.width / 2, layer.y + layer.height / 2)
    ctx.rotate(layer.rotation * Math.PI / 180)
    ctx.drawImage(mask, -layer.width / 2, -layer.height / 2, layer.width, layer.height)
    ctx.restore()
  }
}

/** Preview and export use identical artboard coordinates and layer painting. */
export async function renderStudioDocument(target: HTMLCanvasElement, doc: StudioDocument,
  assetInfo: Record<string, FileNodeInfo>, preview: boolean,
  scope: StudioRenderScope = { kind: 'all' }, maxDimension = preview ? 1200 : Infinity,
  includeAnnotations = false): Promise<string[]> {
  const ratio = Math.min(1, maxDimension / Math.max(doc.width, doc.height))
  const imageSourceSize = maxDimension <= 1280 ? 1280 : 4096
  target.width = Math.round(doc.width * ratio)
  target.height = Math.round(doc.height * ratio)
  const ctx = target.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')
  ctx.scale(ratio, ratio)
  ctx.fillStyle = doc.background
  ctx.fillRect(0, 0, doc.width, doc.height)
  const failures: string[] = []
  const annotations = doc.layers.filter(layer => layer.kind === 'guide' || layer.kind === 'paint')
  const base = doc.layers.filter(layer => layer.kind !== 'guide' && layer.kind !== 'paint' && layer.kind !== 'mask')
  const masks = preview ? doc.layers.filter(layer => layer.kind === 'mask') : []
  for (const layer of [...base, ...masks, ...(preview || includeAnnotations ? annotations : [])]) {
    if (!studioLayerVisible(doc, layer)) continue
    const annotation = layer.kind === 'guide' || layer.kind === 'paint'
    if (scope.kind === 'layer' && !annotation && layer.id !== scope.id) continue
    if (scope.kind === 'group' && layer.groupId !== scope.id) continue
    let image: HTMLImageElement | null = null
    if (layer.kind === 'image') {
      const file = assetInfo[layer.path]
      image = file && layer.path ? await loadImage(file, imageSourceSize) : null
      if (!image) failures.push(layer.name)
    }
    ctx.save()
    ctx.globalAlpha = layer.opacity
    ctx.translate(layer.x + layer.width / 2, layer.y + layer.height / 2)
    ctx.rotate(layer.rotation * Math.PI / 180)
    if (layer.kind === 'image') {
      if (image) paintImage(ctx, layer, image)
      else if (preview) {
        ctx.fillStyle = '#dfe7f1'
        ctx.fillRect(-layer.width / 2, -layer.height / 2, layer.width, layer.height)
        ctx.fillStyle = '#53647a'
        ctx.textAlign = 'center'
        ctx.font = `${Math.max(15, Math.min(30, layer.width / 12))}px system-ui`
        ctx.fillText(layer.path ? '图片不可用' : '添加图片', 0, 0)
      }
    } else if (layer.kind === 'text') paintText(ctx, layer)
    else if (layer.kind === 'guide') paintGuide(ctx, layer)
    else if (layer.kind === 'mask') {
      const mask = maskLayerCanvas(layer, ratio, layer.color)
      ctx.globalAlpha = layer.opacity * .55
      ctx.drawImage(mask, -layer.width / 2, -layer.height / 2, layer.width, layer.height)
    } else {
      const paint = maskLayerCanvas(layer, ratio, layer.color)
      ctx.drawImage(paint, -layer.width / 2, -layer.height / 2, layer.width, layer.height)
    }
    ctx.restore()
  }
  return failures
}
