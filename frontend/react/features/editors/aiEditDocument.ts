import {
  createGuideLayer,
  createMaskLayer,
  createPaintLayer,
  studioMaskPoint,
  type StudioDocument,
  type StudioGuideLayer,
  type StudioImageLayer,
  type StudioMaskLayer,
  type StudioPaintLayer,
  type StudioPoint
} from '../../../src/features/image-editor/model/imageStudioModel.ts'
import { cropAIInputDocument } from '../../../src/features/ai-workflows/model/aiImageTransform.ts'

export type AIBrushTool = 'paint' | 'mask' | 'erase'
export type AIEraseTarget = 'paint' | 'mask'

export function appendAIStroke(
  document: StudioDocument,
  tool: AIBrushTool,
  points: StudioPoint[],
  size: number,
  color: string,
  eraseTarget: AIEraseTarget = 'paint'
): StudioDocument {
  if (!points.length) return document
  const next = structuredClone(document)
  const kind = tool === 'erase' ? eraseTarget : tool
  let layers: (StudioMaskLayer | StudioPaintLayer)[] = []
  if (tool === 'paint') {
    const layer = createPaintLayer(next.width, next.height)
    layer.color = color
    layer.name = `涂抹 ${next.layers.filter((item) => item.kind === 'paint').length + 1}`
    next.layers.push(layer)
    layers = [layer]
  } else if (tool === 'mask') {
    let layer = next.layers.find((item): item is StudioMaskLayer => item.kind === 'mask')
    if (!layer) {
      layer = createMaskLayer(next.width, next.height)
      next.layers.push(layer)
    }
    layer.name = '遮罩'
    layers = [layer]
  } else {
    layers = next.layers.filter(
      (item): item is StudioMaskLayer | StudioPaintLayer =>
        item.kind === kind && item.strokes.some((stroke) => stroke.mode === 'paint')
    )
  }
  let changed = false
  for (const layer of layers) {
    const normalized = points.flatMap((point) => {
      const local = studioMaskPoint(layer, point)
      return local ? [local] : []
    })
    if (!normalized.length) continue
    layer.strokes.push({
      points: normalized,
      size: Math.max(1, Math.min(300, size)),
      mode: tool === 'erase' ? 'erase' : 'paint'
    })
    changed = true
  }
  if (!changed) return document
  next.updatedAt = new Date().toISOString()
  return next
}

export function cropAIEditDocument(
  document: StudioDocument,
  frame: { x: number; y: number; width: number; height: number }
): StudioDocument {
  const x = Math.max(0, Math.min(document.width - 1, Math.round(frame.x)))
  const y = Math.max(0, Math.min(document.height - 1, Math.round(frame.y)))
  const width = Math.max(1, Math.min(document.width - x, Math.round(frame.width)))
  const height = Math.max(1, Math.min(document.height - y, Math.round(frame.height)))
  if (width < 10 || height < 10) return document
  const next = cropAIInputDocument(document, { x, y, width, height }, { width, height })
  next.updatedAt = new Date().toISOString()
  return next
}

export function appendAIGuide(
  document: StudioDocument,
  shape: 'rect' | 'arrow',
  start: StudioPoint,
  end: StudioPoint,
  color: string,
  strokeWidth: number
): { document: StudioDocument; id: string } | null {
  const width = Math.abs(end.x - start.x)
  const height = Math.abs(end.y - start.y)
  if (Math.hypot(width, height) < 10) return null
  const next = structuredClone(document)
  const layer = createGuideLayer(
    {
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.max(1, width),
      height: Math.max(1, height)
    },
    shape
  )
  layer.name = `${shape === 'rect' ? '提示框' : '箭头'} ${next.layers.filter((item) => item.kind === 'guide' && item.shape === shape).length + 1}`
  layer.flipX = end.x < start.x
  layer.flipY = end.y < start.y
  layer.color = color
  layer.strokeWidth = Math.max(1, Math.min(24, strokeWidth))
  next.layers.push(layer)
  next.updatedAt = new Date().toISOString()
  return { document: next, id: layer.id }
}

export function updateAIGuide(
  document: StudioDocument,
  id: string,
  changes: Partial<Pick<StudioGuideLayer, 'prompt' | 'color' | 'strokeWidth' | 'x' | 'y'>>
): StudioDocument {
  if (!document.layers.some((layer) => layer.kind === 'guide' && layer.id === id)) return document
  const next = structuredClone(document)
  next.layers = next.layers.map((layer) =>
    layer.kind === 'guide' && layer.id === id ? { ...layer, ...changes } : layer
  )
  next.updatedAt = new Date().toISOString()
  return next
}

export function removeAIAnnotation(document: StudioDocument, id: string): StudioDocument {
  if (
    !document.layers.some(
      (layer) => layer.id === id && ['guide', 'paint', 'mask'].includes(layer.kind)
    )
  )
    return document
  const next = structuredClone(document)
  next.layers = next.layers.filter((layer) => layer.id !== id)
  next.updatedAt = new Date().toISOString()
  return next
}

export function updateAIImageContent(
  document: StudioDocument,
  sourcePath: string,
  changes: Partial<Pick<StudioImageLayer, 'zoom' | 'focusX' | 'focusY' | 'fit'>>
): StudioDocument {
  if (!document.layers.some((layer) => layer.kind === 'image' && layer.path === sourcePath))
    return document
  const next = structuredClone(document)
  next.layers = next.layers.map((layer) =>
    layer.kind === 'image' && layer.path === sourcePath
      ? {
          ...layer,
          ...changes,
          zoom: Math.max(1, Math.min(8, changes.zoom ?? layer.zoom)),
          focusX: Math.max(0, Math.min(1, changes.focusX ?? layer.focusX)),
          focusY: Math.max(0, Math.min(1, changes.focusY ?? layer.focusY))
        }
      : layer
  )
  next.updatedAt = new Date().toISOString()
  return next
}
