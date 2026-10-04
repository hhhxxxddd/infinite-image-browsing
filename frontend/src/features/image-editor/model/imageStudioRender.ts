import { canvasContext } from '../../../shared/lib/canvasContext.ts'
import type { FileNodeInfo } from '../../../shared/types/fileNode.ts'
import { toImageThumbnailUrl, toImageUrl } from '../../../shared/lib/mediaUrls.ts'
import { managedImageAssetFile } from '../../../shared/lib/managedImageAssets.ts'
import {
  drawStudioStrokes,
  studioLayerVisible,
  type StudioDocument,
  type StudioGuideLayer,
  type StudioImageLayer,
  type StudioMaskLayer,
  type StudioPaintLayer
} from './imageStudioModel.ts'
import {
  paintStudioTextLayer,
  retainStudioTextCache,
  clearStudioTextCache
} from './imageStudioTextRender.ts'
import { createStudioImageCache } from './studioImageCache.ts'
import { studioFrameOrder, studioVectorPath } from './imageStudioVectors.ts'
import { correctedStudioImage, clearImageCorrectionCache } from './imageStudioCorrectionRender.ts'

function fetchImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = url
  })
}
type StudioImageCache = ReturnType<typeof createStudioImageCache<HTMLImageElement>>
let imageCaches = new WeakMap<HTMLCanvasElement, StudioImageCache>()
export function clearStudioImageCache() {
  imageCaches = new WeakMap()
  clearStudioTextCache()
  clearImageCorrectionCache()
}

function loadImage(
  file: FileNodeInfo,
  size: number,
  cache?: StudioImageCache
): Promise<HTMLImageElement | null> {
  const url = size === 0 ? toImageUrl(file) : toImageThumbnailUrl(file, `${size}x${size}`)
  return cache ? cache.load(url, size * size) : fetchImage(url)
}

export async function studioImageDimensions(
  file: FileNodeInfo
): Promise<{ width: number; height: number } | null> {
  if (file.width && file.height) return { width: file.width, height: file.height }
  const image = await loadImage(file, 0)
  return image ? { width: image.naturalWidth, height: image.naturalHeight } : null
}

function paintImage(
  ctx: CanvasRenderingContext2D,
  layer: StudioImageLayer,
  image: HTMLImageElement
) {
  ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1)
  const { width, height, crop } = layer
  const sx = crop.x * image.naturalWidth
  const sy = crop.y * image.naturalHeight
  const sw = crop.width * image.naturalWidth
  const sh = crop.height * image.naturalHeight
  const source = correctedStudioImage(image, layer.correction)
  if (layer.fit === 'stretch') {
    ctx.beginPath()
    ctx.roundRect(
      -width / 2,
      -height / 2,
      width,
      height,
      Math.min(layer.radius, width / 2, height / 2)
    )
    ctx.clip()
    ctx.filter =
      layer.brightness === 100 && layer.contrast === 100
        ? 'none'
        : `brightness(${layer.brightness}%) contrast(${layer.contrast}%)`
    const zoom = layer.zoom
    ctx.drawImage(
      source,
      sx,
      sy,
      sw,
      sh,
      -width / 2 + width * (1 - zoom) * layer.focusX,
      -height / 2 + height * (1 - zoom) * layer.focusY,
      width * zoom,
      height * zoom
    )
    return
  }
  const base =
    layer.fit === 'cover' ? Math.max(width / sw, height / sh) : Math.min(width / sw, height / sh)
  const dw = sw * base * layer.zoom
  const dh = sh * base * layer.zoom
  ctx.beginPath()
  ctx.roundRect(
    -width / 2,
    -height / 2,
    width,
    height,
    Math.min(layer.radius, width / 2, height / 2)
  )
  ctx.clip()
  ctx.filter =
    layer.brightness === 100 && layer.contrast === 100
      ? 'none'
      : `brightness(${layer.brightness}%) contrast(${layer.contrast}%)`
  ctx.drawImage(
    source,
    sx,
    sy,
    sw,
    sh,
    -width / 2 + (width - dw) * layer.focusX,
    -height / 2 + (height - dh) * layer.focusY,
    dw,
    dh
  )
}

function paintGuide(ctx: CanvasRenderingContext2D, layer: StudioGuideLayer) {
  ctx.strokeStyle = layer.color
  ctx.fillStyle = layer.color
  ctx.lineWidth = layer.strokeWidth
  if (layer.shape === 'arrow') {
    const startX = layer.flipX ? layer.width / 2 : -layer.width / 2
    const startY = layer.flipY ? layer.height / 2 : -layer.height / 2
    const endX = -startX,
      endY = -startY
    const angle = Math.atan2(endY - startY, endX - startX)
    const head = Math.max(14, layer.strokeWidth * 4)
    ctx.beginPath()
    ctx.moveTo(startX, startY)
    ctx.lineTo(endX, endY)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(endX, endY)
    ctx.lineTo(
      endX - head * Math.cos(angle - Math.PI / 6),
      endY - head * Math.sin(angle - Math.PI / 6)
    )
    ctx.lineTo(
      endX - head * Math.cos(angle + Math.PI / 6),
      endY - head * Math.sin(angle + Math.PI / 6)
    )
    ctx.closePath()
    ctx.fill()
  } else {
    ctx.setLineDash([Math.max(6, layer.strokeWidth * 3), Math.max(4, layer.strokeWidth * 2)])
    ctx.strokeRect(-layer.width / 2, -layer.height / 2, layer.width, layer.height)
  }
}

function maskLayerCanvas(
  layer: StudioMaskLayer | StudioPaintLayer,
  ratio: number,
  color: string
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(layer.width * ratio))
  canvas.height = Math.max(1, Math.round(layer.height * ratio))
  const ctx = canvasContext(canvas)
  ctx.scale(canvas.width / layer.width, canvas.height / layer.height)
  drawStudioStrokes(ctx, layer, color)
  return canvas
}

export type StudioRenderScope =
  { kind: 'all' } | { kind: 'layer' | 'group'; id: string } | { kind: 'selection'; ids: string[] }
export function renderStudioMask(
  target: HTMLCanvasElement,
  doc: StudioDocument,
  maskIds?: string[],
  maxDimension = Infinity
) {
  const ratio = Math.min(1, maxDimension / Math.max(doc.width, doc.height))
  target.width = Math.round(doc.width * ratio)
  target.height = Math.round(doc.height * ratio)
  const ctx = target.getContext('2d')
  if (!ctx) throw new Error('无法创建遮罩画布')
  ctx.scale(ratio, ratio)
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, doc.width, doc.height)
  for (const layer of doc.layers) {
    if (
      layer.kind !== 'mask' ||
      !studioLayerVisible(doc, layer) ||
      (maskIds && !maskIds.includes(layer.id))
    )
      continue
    const mask = maskLayerCanvas(layer, ratio, '#ffffff')
    ctx.save()
    ctx.translate(layer.x + layer.width / 2, layer.y + layer.height / 2)
    ctx.rotate((layer.rotation * Math.PI) / 180)
    ctx.drawImage(mask, -layer.width / 2, -layer.height / 2, layer.width, layer.height)
    ctx.restore()
  }
}

/** Preview and export use identical artboard coordinates and layer painting. */
export async function renderStudioDocument(
  target: HTMLCanvasElement,
  doc: StudioDocument,
  assetInfo: Record<string, FileNodeInfo>,
  preview: boolean,
  scope: StudioRenderScope = { kind: 'all' },
  maxDimension = preview ? 1200 : Infinity,
  includeAnnotations = false,
  signal?: AbortSignal,
  previewScale?: number
): Promise<string[]> {
  const ratio =
    preview && previewScale !== undefined && Number.isFinite(previewScale) && previewScale > 0
      ? previewScale
      : Math.min(1, maxDimension / Math.max(doc.width, doc.height))
  const imageSourceSize = preview ? (maxDimension <= 1280 ? 1280 : 4096) : 0
  const failures: string[] = []
  const annotations = doc.layers.filter((layer) => layer.kind === 'guide' || layer.kind === 'paint')
  const base = studioFrameOrder(doc).filter(
    (layer) => layer.kind !== 'guide' && layer.kind !== 'paint' && layer.kind !== 'mask'
  )
  const masks = preview ? doc.layers.filter((layer) => layer.kind === 'mask') : []
  const layers = [...base, ...masks, ...(preview || includeAnnotations ? annotations : [])].filter(
    (layer) => {
      if (!studioLayerVisible(doc, layer)) return false
      if (scope.kind === 'selection') return scope.ids.includes(layer.id)
      const annotation = layer.kind === 'guide' || layer.kind === 'paint'
      if (
        scope.kind === 'layer' &&
        !annotation &&
        layer.id !== scope.id &&
        layer.frameId !== scope.id
      )
        return false
      return scope.kind !== 'group' || layer.groupId === scope.id
    }
  )
  let imageCache: StudioImageCache | undefined
  if (preview && imageSourceSize <= 1280) {
    imageCache = imageCaches.get(target) ?? createStudioImageCache(fetchImage)
    imageCaches.set(target, imageCache)
    imageCache.retain(
      new Set(
        layers.flatMap((layer) => {
          const file =
            layer.kind === 'image' && (assetInfo[layer.path] || managedImageAssetFile(layer.path))
          return file ? [toImageThumbnailUrl(file, `${imageSourceSize}x${imageSourceSize}`)] : []
        })
      )
    )
  }
  const images = await Promise.all(
    layers.map((layer) => {
      const file =
        layer.kind === 'image' && (assetInfo[layer.path] || managedImageAssetFile(layer.path))
      return file && layer.path ? loadImage(file, imageSourceSize, imageCache) : null
    })
  )
  if (signal?.aborted) return []
  retainStudioTextCache(
    target,
    new Set(layers.filter((layer) => layer.kind === 'text').map((layer) => layer.id))
  )
  const width = Math.max(1, Math.round(doc.width * ratio)),
    height = Math.max(1, Math.round(doc.height * ratio))
  if (target.width !== width) target.width = width
  if (target.height !== height) target.height = height
  const ctx = target.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, width, height)
  ctx.scale(ratio, ratio)
  ctx.fillStyle = doc.background
  ctx.fillRect(0, 0, doc.width, doc.height)
  const frames = new Map(
    doc.layers.filter((layer) => layer.kind === 'frame').map((layer) => [layer.id, layer])
  )
  const lastChildren = new Map(
    layers.filter((layer) => layer.frameId).map((layer) => [layer.frameId || '', layer.id])
  )
  const borderAfter = new Map(
    layers
      .filter((layer) => layer.kind === 'frame')
      .map((frame) => [lastChildren.get(frame.id) || frame.id, frame])
  )
  const operations = layers.flatMap((layer, index) => {
    const frame = borderAfter.get(layer.id)
    return [
      { layer, index, border: false },
      ...(frame ? [{ layer: frame, index: -1, border: true }] : [])
    ]
  })
  for (const { index, layer, border } of operations) {
    const image = images[index]
    if (layer.kind === 'image' && layer.path) {
      if (!image) failures.push(layer.name)
    }
    ctx.save()
    ctx.globalAlpha = layer.opacity
    const frame = frames.get(layer.frameId || '')
    if (frame && frame.kind === 'frame') {
      const transform = ctx.getTransform()
      ctx.translate(frame.x + frame.width / 2, frame.y + frame.height / 2)
      ctx.rotate((frame.rotation * Math.PI) / 180)
      ctx.translate(-frame.width / 2, -frame.height / 2)
      ctx.clip(new Path2D(studioVectorPath(frame)))
      ctx.setTransform(transform)
      ctx.globalAlpha *= frame.opacity
    }
    ctx.translate(layer.x + layer.width / 2, layer.y + layer.height / 2)
    ctx.rotate((layer.rotation * Math.PI) / 180)
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
    } else if (layer.kind === 'frame' || layer.kind === 'shape') {
      ctx.translate(-layer.width / 2, -layer.height / 2)
      const path = new Path2D(studioVectorPath(layer))
      if (!border && layer.fill !== 'transparent') {
        ctx.fillStyle = layer.fill
        ctx.fill(path)
      }
      if ((border || layer.kind === 'shape') && layer.strokeWidth > 0) {
        ctx.strokeStyle = layer.stroke
        ctx.lineWidth = layer.strokeWidth
        ctx.lineJoin = 'round'
        ctx.stroke(path)
      }
    } else if (layer.kind === 'text') paintStudioTextLayer(ctx, layer, target, ratio, preview)
    else if (layer.kind === 'guide') paintGuide(ctx, layer)
    else if (layer.kind === 'mask') {
      const mask = maskLayerCanvas(layer, ratio, layer.color)
      ctx.globalAlpha = layer.opacity * 0.55
      ctx.drawImage(mask, -layer.width / 2, -layer.height / 2, layer.width, layer.height)
    } else if (layer.kind === 'paint') {
      const paint = maskLayerCanvas(layer, ratio, layer.color)
      ctx.drawImage(paint, -layer.width / 2, -layer.height / 2, layer.width, layer.height)
    }
    ctx.restore()
  }
  return failures
}
