import {
  createStudioGroup,
  createTextLayer,
  studioLayerLocked,
  studioLayerVisible,
  type StudioDocument,
  type StudioFrame,
  type StudioLayer,
  type StudioPoint,
  type StudioVectorLayer,
  type StudioVectorShape
} from './imageStudioModel.ts'
import {
  studioFrameContainsPoint,
  studioFramePoint,
  studioFrameWorldPoint
} from './imageStudioGeometry.ts'

export function createStudioVector(
  kind: 'frame' | 'shape',
  shape: StudioVectorShape,
  rect: StudioFrame
): StudioVectorLayer {
  return {
    ...rect,
    id: crypto.randomUUID(),
    name: kind === 'frame' ? '画框' : '形状',
    kind,
    shape,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    fill: '#ffffff',
    stroke: '#18202b',
    strokeWidth: Math.max(1, Math.min(rect.width, rect.height) * 0.012),
    radius: 0,
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 }
    ],
    tail: { x: 0.25, y: 1 }
  }
}

/** SVG and Canvas share this exact path, in layer-local pixels. */
export function studioVectorPath(layer: StudioVectorLayer): string {
  const w = layer.width,
    h = layer.height
  if (layer.shape === 'polygon')
    return layer.points.map((p, i) => `${i ? 'L' : 'M'}${p.x * w},${p.y * h}`).join(' ') + ' Z'
  if (layer.shape === 'burst')
    return (
      Array.from({ length: 24 }, (_, i) => {
        const a = (i * Math.PI) / 12 - Math.PI / 2,
          r = i % 2 ? 0.36 : 0.5
        return `${i ? 'L' : 'M'}${w * (0.5 + Math.cos(a) * r)},${h * (0.5 + Math.sin(a) * r)}`
      }).join(' ') + ' Z'
    )
  const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
    `M${cx - rx},${cy} a${rx},${ry} 0 1,0 ${rx * 2},0 a${rx},${ry} 0 1,0 ${-rx * 2},0 Z`
  if (layer.shape === 'ellipse') return ellipse(w / 2, h / 2, w / 2, h / 2)
  if (layer.shape === 'thought')
    return (
      ellipse(w / 2, h * 0.38, w / 2, h * 0.38) +
      ' ' +
      ellipse(w * (0.4 + layer.tail.x * 0.6), h * 0.83, w * 0.045, h * 0.045) +
      ' ' +
      ellipse(w * layer.tail.x, h * layer.tail.y - h * 0.022, w * 0.022, h * 0.022)
    )
  if (layer.shape === 'speech') {
    const b = h * 0.78,
      r = Math.min(w * 0.15, h * 0.2),
      t = layer.tail.x * w
    return `M${r},0 H${w - r} Q${w},0 ${w},${r} V${b - r} Q${w},${b} ${w - r},${b} H${w * 0.52} L${t},${h * layer.tail.y} L${w * 0.32},${b} H${r} Q0,${b} 0,${b - r} V${r} Q0,0 ${r},0 Z`
  }
  const r = Math.min(layer.radius, w / 2, h / 2)
  return `M${r},0 H${w - r} Q${w},0 ${w},${r} V${h - r} Q${w},${h} ${w - r},${h} H${r} Q0,${h} 0,${h - r} V${r} Q0,0 ${r},0 Z`
}

export function studioVectorContains(layer: StudioVectorLayer, point: StudioPoint): boolean {
  if (!studioFrameContainsPoint(layer, point)) return false
  const p = studioFramePoint(layer, point),
    x = p.x / layer.width,
    y = p.y / layer.height
  if (layer.shape === 'ellipse') return ((x - 0.5) * 2) ** 2 + ((y - 0.5) * 2) ** 2 <= 1
  if (layer.shape !== 'polygon') return true
  let inside = false
  for (let i = 0, j = layer.points.length - 1; i < layer.points.length; j = i++) {
    const a = layer.points[i],
      b = layer.points[j]
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

export function studioHitLayer(
  doc: StudioDocument,
  point: StudioPoint,
  enterFrame = false
): StudioLayer | undefined {
  const ordered = studioFrameOrder(doc)
  for (const layer of [...ordered].reverse()) {
    if (!studioLayerVisible(doc, layer)) continue
    const frame = doc.layers.find((f) => f.kind === 'frame' && f.id === layer.frameId) as
      StudioVectorLayer | undefined
    if (frame && !studioVectorContains(frame, point)) continue
    if (
      !(layer.kind === 'frame' || layer.kind === 'shape'
        ? studioVectorContains(layer, point)
        : studioFrameContainsPoint(layer, point))
    )
      continue
    return frame && !enterFrame ? frame : layer
  }
}

/** Containers are atomic stack entries; children preserve their own stack order. */
export function studioFrameOrder(doc: StudioDocument): StudioLayer[] {
  const children = new Map<string, StudioLayer[]>()
  for (const layer of doc.layers)
    if (layer.frameId) children.set(layer.frameId, [...(children.get(layer.frameId) || []), layer])
  return doc.layers
    .filter((layer) => !layer.frameId)
    .flatMap((layer) =>
      layer.kind === 'frame' ? [layer, ...(children.get(layer.id) || [])] : [layer]
    )
}

export function changeStudioLayer(
  doc: StudioDocument,
  id: string,
  change: Partial<StudioLayer>
): StudioDocument {
  const old = doc.layers.find((layer) => layer.id === id)
  if (!old) return doc
  const next = { ...old, ...change } as StudioLayer
  // Resizing only changes the clipping boundary. Translating/rotating carries its content.
  const resize = next.width !== old.width || next.height !== old.height
  const dx = resize ? 0 : next.x - old.x,
    dy = resize ? 0 : next.y - old.y
  const angle = ((next.rotation - old.rotation) * Math.PI) / 180
  const cx = old.x + old.width / 2,
    cy = old.y + old.height / 2
  return {
    ...doc,
    layers: doc.layers.map((layer) => {
      if (layer.id === id) return next
      if (old.kind !== 'frame' || layer.frameId !== id) return layer
      if (!angle) return dx || dy ? { ...layer, x: layer.x + dx, y: layer.y + dy } : layer
      const x = layer.x + layer.width / 2 - cx,
        y = layer.y + layer.height / 2 - cy
      return {
        ...layer,
        x: cx + x * Math.cos(angle) - y * Math.sin(angle) - layer.width / 2 + dx,
        y: cy + x * Math.sin(angle) + y * Math.cos(angle) - layer.height / 2 + dy,
        rotation: layer.rotation + next.rotation - old.rotation
      }
    })
  }
}

export function assignStudioFrame(
  doc: StudioDocument,
  ids: string[],
  frameId?: string
): StudioDocument {
  const frame = doc.layers.find((layer) => layer.id === frameId && layer.kind === 'frame')
  if (frameId && (!frame || studioLayerLocked(doc, frame))) return doc
  const picked = doc.layers.filter((layer) => ids.includes(layer.id))
  const groups = new Set(picked.map((layer) => layer.groupId).filter(Boolean))
  const members = doc.layers.filter(
    (layer) => ids.includes(layer.id) || (!!layer.groupId && groups.has(layer.groupId))
  )
  if (members.some((layer) => layer.kind === 'frame' || studioLayerLocked(doc, layer))) return doc
  const selected = new Set(members.map((layer) => layer.id))
  return {
    ...doc,
    layers: doc.layers.map((layer) => (selected.has(layer.id) ? { ...layer, frameId } : layer))
  }
}

export function removeStudioLayers(doc: StudioDocument, ids: string[]): StudioDocument {
  const selected = new Set(
    ids.filter((id) => {
      const l = doc.layers.find((v) => v.id === id)
      return l && !studioLayerLocked(doc, l)
    })
  )
  return {
    ...doc,
    layers: doc.layers.filter(
      (layer) => !selected.has(layer.id) && !(layer.frameId && selected.has(layer.frameId))
    )
  }
}

export const studioBubblePresets = [
  { shape: 'speech', name: '对白气泡', text: '在这里输入对白' },
  { shape: 'thought', name: '思考气泡', text: '我在想……' },
  { shape: 'burst', name: '强调气泡', text: '哇！' },
  { shape: 'rect', name: '旁白框', text: '故事从这里开始……' }
] as const

export function addStudioBubble(
  doc: StudioDocument,
  shape: (typeof studioBubblePresets)[number]['shape'],
  frameId?: string
): { document: StudioDocument; groupId: string } {
  const preset = studioBubblePresets.find((item) => item.shape === shape) || studioBubblePresets[0]
  const frame = doc.layers.find((layer) => layer.id === frameId && layer.kind === 'frame')
  const area = frame || doc
  const w = Math.max(4, area.width * 0.45),
    h = Math.max(4, Math.min(area.height * 0.3, w * 0.65))
  const box = { x: (area.width - w) / 2, y: (area.height - h) / 2, width: w, height: h }
  const group = createStudioGroup(preset.name)
  const vector = {
    ...createStudioVector('shape', shape, box),
    name: preset.name,
    groupId: group.id,
    frameId,
    fill: shape === 'rect' ? '#fff4ce' : '#ffffff'
  }
  const text = {
    ...createTextLayer({
      ...box,
      x: box.x + w * 0.16,
      y: box.y + h * 0.16,
      width: w * 0.68,
      height: h * (shape === 'speech' || shape === 'thought' ? 0.42 : 0.68)
    }),
    name: '对白',
    text: preset.text,
    fontSize: Math.max(2, w / 13),
    color: '#18202b',
    groupId: group.id,
    frameId
  }
  return {
    document: {
      ...doc,
      groups: [...doc.groups, group],
      layers: [
        ...doc.layers,
        ...[vector, text].map((layer) => {
          if (!frame) return layer
          const point = studioFrameWorldPoint(frame, {
            x: layer.x + layer.width / 2,
            y: layer.y + layer.height / 2
          })
          return {
            ...layer,
            x: point.x - layer.width / 2,
            y: point.y - layer.height / 2,
            rotation: frame.rotation
          }
        })
      ]
    },
    groupId: group.id
  }
}
