import type { FileNodeInfo } from '@/api/files'
import { toImageThumbnailUrl } from '@/util/file'
import type { StudioDocument, StudioImageLayer, StudioTextLayer } from './imageStudioModel'

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
  ctx.font = `${layer.bold ? '700' : '400'} ${layer.fontSize}px ${layer.font}, sans-serif`
  ctx.textBaseline = 'top'
  ctx.textAlign = layer.align
  const x = layer.align === 'left' ? -layer.width / 2 : layer.align === 'right' ? layer.width / 2 : 0
  const lines: string[] = []
  for (const paragraph of layer.text.split('\n')) {
    let line = ''
    for (const char of paragraph) {
      if (line && ctx.measureText(line + char).width > layer.width) { lines.push(line); line = char }
      else line += char
    }
    lines.push(line)
  }
  ctx.beginPath()
  ctx.rect(-layer.width / 2, -layer.height / 2, layer.width, layer.height)
  ctx.clip()
  lines.forEach((line, index) => ctx.fillText(line, x, -layer.height / 2 + index * layer.fontSize * 1.24))
}

/** Preview and export use identical artboard coordinates and layer painting. */
export async function renderStudioDocument(target: HTMLCanvasElement, doc: StudioDocument,
  assetInfo: Record<string, FileNodeInfo>, preview: boolean): Promise<string[]> {
  const ratio = preview ? Math.min(1, 1200 / Math.max(doc.width, doc.height)) : 1
  target.width = Math.round(doc.width * ratio)
  target.height = Math.round(doc.height * ratio)
  const ctx = target.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')
  ctx.scale(ratio, ratio)
  ctx.fillStyle = doc.background
  ctx.fillRect(0, 0, doc.width, doc.height)
  const failures: string[] = []
  for (const layer of doc.layers) {
    if (!layer.visible) continue
    let image: HTMLImageElement | null = null
    if (layer.kind === 'image') {
      const file = assetInfo[layer.path]
      image = file && layer.path ? await loadImage(file, preview ? 1280 : 4096) : null
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
    } else paintText(ctx, layer)
    ctx.restore()
  }
  return failures
}
