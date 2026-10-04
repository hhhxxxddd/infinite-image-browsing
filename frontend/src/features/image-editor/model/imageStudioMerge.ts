import {
  createImageLayer,
  studioLayerBounds,
  studioLayerLocked,
  studioLayerVisible,
  type StudioDocument,
  type StudioFrame
} from './imageStudioModel.ts'
import { deleteStudioSelection, studioSelectionIds } from './imageStudioSelection.ts'

export type StudioMergeBackground = 'transparent' | 'white'

/** Keep ancestor frames in the render document for clipping, but never paint unselected content. */
export function prepareStudioMerge(
  doc: StudioDocument,
  layerIds: string[],
  groupIds: string[],
  background: StudioMergeBackground
) {
  const ids = studioSelectionIds(doc, layerIds, groupIds)
  const selected = new Set(ids)
  if (
    doc.groups.some((g) => groupIds.includes(g.id) && g.locked) ||
    doc.layers.some((l) => selected.has(l.id) && studioLayerLocked(doc, l))
  )
    throw new Error('请先解锁需要合成的图层或分组')
  if (doc.layers.some((l) => selected.has(l.id) && ['guide', 'mask', 'paint'].includes(l.kind)))
    throw new Error('标注和蒙版不能合成为图片')
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity
  for (const layer of doc.layers) {
    if (
      !selected.has(layer.id) ||
      !studioLayerVisible(doc, layer) ||
      layer.opacity <= 0 ||
      (layer.kind === 'text' && !layer.text.trim()) ||
      (layer.kind === 'image' && !layer.path)
    )
      continue
    const bounds = studioLayerBounds(layer)
    let x = bounds.x,
      y = bounds.y,
      r = x + bounds.width,
      b = y + bounds.height
    const frame = doc.layers.find((l) => l.kind === 'frame' && l.id === layer.frameId)
    if (frame?.kind === 'frame') {
      if (frame.opacity <= 0) continue
      const clip = studioLayerBounds({ ...frame, strokeWidth: 0 })
      x = Math.max(x, clip.x)
      y = Math.max(y, clip.y)
      r = Math.min(r, clip.x + clip.width)
      b = Math.min(b, clip.y + clip.height)
    }
    if (r - x <= 1e-7 || b - y <= 1e-7) continue
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, r)
    bottom = Math.max(bottom, b)
  }
  if (left === Infinity) throw new Error('所选内容没有可合成的可见图层')
  const x = Math.floor(left + 1e-7),
    y = Math.floor(top + 1e-7)
  const bounds: StudioFrame = {
    x,
    y,
    width: Math.ceil(right - 1e-7) - x,
    height: Math.ceil(bottom - 1e-7) - y
  }
  if (Math.max(bounds.width, bounds.height) > 16384 || bounds.width * bounds.height > 100_000_000)
    throw new Error('合成范围过大，请缩小选中内容（边长不超过 16384 像素，总量不超过一亿像素）')
  const document = structuredClone(doc)
  document.width = bounds.width
  document.height = bounds.height
  document.background = background === 'white' ? '#ffffff' : 'transparent'
  for (const layer of document.layers) {
    layer.x -= x
    layer.y -= y
  }
  return { document, ids, bounds }
}

/** One replacement transaction; the composite is a root layer above the entire existing stack. */
export function applyStudioMerge(
  doc: StudioDocument,
  layerIds: string[],
  groupIds: string[],
  path: string,
  bounds: StudioFrame,
  keepOriginals: boolean
) {
  const document = keepOriginals ? doc : deleteStudioSelection(doc, layerIds, groupIds)
  if (!keepOriginals && document === doc) throw new Error('所选内容已锁定，无法替换')
  const layer = createImageLayer(path, bounds, '合成图片')
  return { document: { ...document, layers: [...document.layers, layer] }, layerId: layer.id }
}
