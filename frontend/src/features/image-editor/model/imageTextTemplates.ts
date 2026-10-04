import {
  createStudioGroup,
  readStudioDocument,
  scaleStudioDocument,
  studioContentBounds,
  type StudioDocument
} from './imageStudioModel.ts'

export interface CreativeTemplate {
  id: string
  name: string
  type: 'text' | 'layout' | 'image'
  payload_type: 'image-group-v1' | 'image-layout-v1' | 'image-document-v1'
  created_at: string
  updated_at: string
  builtin: boolean
  has_preview: boolean
}
export interface TextTemplate extends CreativeTemplate {
  document: StudioDocument
}

/** Keep both dark and light lettering readable without changing the saved design. */
export function textTemplatePreviewBackground(doc: StudioDocument): string {
  const text = doc.layers
    .filter((layer) => layer.kind === 'text' && layer.visible)
    .sort((a, b) => b.width * b.height - a.width * a.height)[0]
  const color =
    text?.kind === 'text' && text.color.match(/^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
  if (!color) return '#34383f'
  const lightness =
    Number.parseInt(color[1], 16) * 0.299 +
    Number.parseInt(color[2], 16) * 0.587 +
    Number.parseInt(color[3], 16) * 0.114
  return lightness < 140 ? '#eef1f5' : '#34383f'
}

/** Snapshot the whole group, not only its text, in local coordinates. */
export function captureTextTemplate(
  doc: StudioDocument,
  selection: { groupId?: string; layerId?: string }
): StudioDocument {
  const group = selection.groupId
    ? doc.groups.find((item) => item.id === selection.groupId)
    : undefined
  const selected = doc.layers.filter((layer) =>
    group ? layer.groupId === group.id : layer.id === selection.layerId
  )
  const frames = new Set(
    selected.filter((layer) => layer.kind === 'frame').map((layer) => layer.id)
  )
  const layers = doc.layers.filter(
    (layer) => selected.includes(layer) || (layer.frameId && frames.has(layer.frameId))
  )
  if (!layers.some((layer) => layer.kind === 'text')) throw new Error('分组中至少需要一个文字图层')
  if (layers.some((layer) => !['text', 'image', 'shape', 'frame'].includes(layer.kind)))
    throw new Error('编辑遮罩和 AI 批注不属于文字模板')
  const next = structuredClone(doc)
  const savedGroup = group ? structuredClone(group) : createStudioGroup(layers[0].name)
  // A hidden/locked group must still produce a visible, editable inserted instance.
  Object.assign(savedGroup, { visible: true, locked: false, collapsed: false, stackIndex: 0 })
  next.layers = structuredClone(layers).map((layer) => ({
    ...layer,
    groupId: savedGroup.id,
    frameId: layer.frameId && frames.has(layer.frameId) ? layer.frameId : undefined
  }))
  next.groups = [savedGroup]
  next.name = savedGroup.name
  next.background = 'transparent'
  next.backgroundView = 'checkerboard'
  // Include hidden members in geometry, while preserving their visibility in the payload.
  const bounds = studioContentBounds(
    {
      ...next,
      layers: next.layers.map((layer) => ({ ...layer, visible: true, opacity: 1 }))
    },
    false
  )
  if (!bounds) throw new Error('模板没有可保存的内容，请先输入文字或添加图片')
  if (bounds.width > 16384 || bounds.height > 16384 || bounds.width * bounds.height > 100_000_000)
    throw new Error('模板尺寸过大，请先缩小分组')
  next.width = bounds.width
  next.height = bounds.height
  for (const layer of next.layers) {
    layer.x -= bounds.x
    layer.y -= bounds.y
  }
  return next
}

/** Independent IDs and proportional fitting; existing canvas and layers are untouched. */
export function insertTextTemplate(doc: StudioDocument, template: TextTemplate) {
  if (template.type !== 'text' || template.payload_type !== 'image-group-v1')
    throw new Error('当前编辑器不支持此模板类型')
  const saved = readStudioDocument(template.document)
  if (!saved || !saved.layers.some((layer) => layer.kind === 'text'))
    throw new Error('文字模板内容无效')
  if (doc.layers.length + saved.layers.length > 500)
    throw new Error('图层数量超过 500，请先减少图层')
  const ratio = Math.min(1, (doc.width * 0.85) / saved.width, (doc.height * 0.85) / saved.height)
  const fitted = scaleStudioDocument(saved, saved.width * ratio, saved.height * ratio)
  const group = { ...createStudioGroup(template.name), stackIndex: doc.layers.length }
  const dx = (doc.width - fitted.width) / 2,
    dy = (doc.height - fitted.height) / 2
  const ids = new Map(fitted.layers.map((layer) => [layer.id, crypto.randomUUID()]))
  const layers = fitted.layers.map((layer) => ({
    ...layer,
    id: ids.get(layer.id) || layer.id,
    frameId: layer.frameId ? ids.get(layer.frameId) : undefined,
    groupId: group.id,
    x: layer.x + dx,
    y: layer.y + dy,
    ...(layer.kind === 'image' ? { radius: layer.radius * ratio } : {})
  }))
  return {
    document: { ...doc, groups: [...doc.groups, group], layers: [...doc.layers, ...layers] },
    groupId: group.id
  }
}
