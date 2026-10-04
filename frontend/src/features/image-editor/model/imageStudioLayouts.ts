import { imageLayouts, imageRects, type ImageLayout } from './imageCreationModel.ts'
import {
  readStudioDocument,
  scaleStudioDocument,
  studioLayerLocked,
  studioLayerVisible,
  type StudioDocument,
  type StudioVectorLayer
} from './imageStudioModel.ts'
import { createStudioVector } from './imageStudioVectors.ts'
import type { TextTemplate } from './imageTextTemplates.ts'

export const comicLayouts = [
  { key: 'comic-hero', label: '大格开场' },
  { key: 'comic-asymmetric', label: '错落三格' },
  { key: 'comic-diagonal', label: '斜切对话' },
  { key: 'comic-strip', label: '四格条漫' },
  { key: 'comic-six', label: '叙事六格' }
] as const
export type StudioLayoutPreset = ImageLayout | (typeof comicLayouts)[number]['key']
export { imageLayouts }

export function studioLayoutFrames(
  doc: Pick<StudioDocument, 'width' | 'height'>,
  preset: StudioLayoutPreset,
  margin = 0.035,
  spacing = 0.025
): StudioVectorLayer[] {
  const unit = Math.min(doc.width, doc.height),
    pad = unit * margin,
    gap = unit * spacing
  const w = Math.max(1, doc.width - 2 * pad),
    h = Math.max(1, doc.height - 2 * pad)
  let frames: StudioVectorLayer[]
  const rect = (x: number, y: number, width: number, height: number) =>
    createStudioVector('frame', 'rect', {
      x: pad + x,
      y: pad + y,
      width: Math.max(1, width),
      height: Math.max(1, height)
    })
  if (!preset.startsWith('comic-'))
    frames = imageRects({
      layout: preset as ImageLayout,
      width: doc.width,
      height: doc.height,
      padding: pad,
      gap
    }).map((box) => createStudioVector('frame', 'rect', box))
  else if (preset === 'comic-hero') {
    const top = (h - gap) * 0.6,
      bottom = h - gap - top,
      col = (w - gap) / 2
    frames = [
      rect(0, 0, w, top),
      rect(0, top + gap, col, bottom),
      rect(col + gap, top + gap, col, bottom)
    ]
  } else if (preset === 'comic-asymmetric') {
    const left = (w - gap) * 0.4,
      right = w - gap - left,
      row = (h - gap) / 2
    frames = [
      rect(0, 0, left, h),
      rect(left + gap, 0, right, row),
      rect(left + gap, row + gap, right, row)
    ]
  } else if (preset === 'comic-diagonal') {
    frames = [rect(0, 0, w, h), rect(0, 0, w, h)]
    const g = Math.min(0.1, gap / w / 2)
    frames[0].shape = 'polygon'
    frames[0].points = [
      { x: 0, y: 0 },
      { x: 0.65 - g, y: 0 },
      { x: 0.35 - g, y: 1 },
      { x: 0, y: 1 }
    ]
    frames[1].shape = 'polygon'
    frames[1].points = [
      { x: 0.65 + g, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0.35 + g, y: 1 }
    ]
  } else if (preset === 'comic-strip') {
    const row = (h - gap * 3) / 4
    frames = Array.from({ length: 4 }, (_, i) => rect(0, i * (row + gap), w, row))
  } else {
    const row = (h - gap * 2) / 3,
      col = (w - gap) / 2
    frames = Array.from({ length: 6 }, (_, i) =>
      rect((i % 2) * (col + gap), Math.floor(i / 2) * (row + gap), col, row)
    )
  }
  return frames.map((frame, i) => ({
    ...frame,
    name: `画框 ${i + 1}`,
    strokeWidth: Math.max(0.5, unit * 0.004)
  }))
}

export function applyStudioFrames(
  doc: StudioDocument,
  frames: StudioVectorLayer[]
): StudioDocument {
  if (
    doc.layers.some(
      (layer) => (layer.kind === 'frame' || layer.frameId) && studioLayerLocked(doc, layer)
    )
  )
    throw new Error('请先解锁已有画框及其内容，再更换版式')
  const images = doc.layers.filter(
    (layer) =>
      layer.kind === 'image' &&
      !layer.groupId &&
      studioLayerVisible(doc, layer) &&
      !studioLayerLocked(doc, layer)
  )
  const slots = new Map(images.slice(0, frames.length).map((layer, i) => [layer.id, frames[i]]))
  const layers = doc.layers
    .filter((layer) => layer.kind !== 'frame')
    .map((layer) => {
      const frame = slots.get(layer.id)
      return frame
        ? {
            ...layer,
            frameId: frame.id,
            x: frame.x,
            y: frame.y,
            width: frame.width,
            height: frame.height,
            rotation: frame.rotation
          }
        : { ...layer, frameId: undefined }
    })
  return { ...doc, layers: [...frames, ...layers] }
}

export function capturePageTemplate(doc: StudioDocument, kind: 'layout' | 'image'): StudioDocument {
  const next = structuredClone(doc)
  next.layers = next.layers.filter((layer) =>
    kind === 'layout'
      ? layer.kind === 'frame'
      : ['image', 'text', 'shape', 'frame'].includes(layer.kind)
  )
  if (!next.layers.length)
    throw new Error(kind === 'layout' ? '请先添加画框或应用一个版式' : '画布中没有可保存的内容')
  if (kind === 'layout') {
    next.groups = []
    next.layers = next.layers.map((layer) => ({
      ...layer,
      groupId: undefined,
      visible: true,
      locked: false
    }))
  } else
    next.groups = next.groups.filter((group) =>
      next.layers.some((layer) => layer.groupId === group.id)
    )
  return next
}

export function applyPageTemplate(doc: StudioDocument, template: TextTemplate): StudioDocument {
  const saved = readStudioDocument(template.document)
  if (!saved || !['layout', 'image'].includes(template.type)) throw new Error('版式模板无效')
  const next =
    template.type === 'layout' ? scaleStudioDocument(saved, doc.width, doc.height) : saved
  const ids = new Map(next.layers.map((layer) => [layer.id, crypto.randomUUID()]))
  const groups = new Map(next.groups.map((group) => [group.id, crypto.randomUUID()]))
  next.layers = next.layers.map((layer) => ({
    ...layer,
    id: ids.get(layer.id) || layer.id,
    groupId: layer.groupId ? groups.get(layer.groupId) : undefined,
    frameId: layer.frameId ? ids.get(layer.frameId) : undefined
  }))
  if (template.type === 'layout')
    return applyStudioFrames(
      doc,
      next.layers.filter((l): l is StudioVectorLayer => l.kind === 'frame')
    )
  return {
    ...next,
    id: doc.id,
    name: doc.name,
    createdAt: doc.createdAt,
    groups: next.groups.map((group) => ({ ...group, id: groups.get(group.id) || group.id }))
  }
}
