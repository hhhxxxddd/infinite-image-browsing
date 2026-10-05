import {
  bounded,
  captionStyle,
  clipLocked,
  evaluatedTransform,
  rounded,
  transformFor,
  videoAnimatedFields,
  type Caption,
  type VideoClip,
  type VideoTimelineDocument,
  type VideoTransform
} from './videoStudioModel.ts'
import { videoCaptionLines } from './videoCaptionLayout.ts'

export interface StagePoint {
  x: number
  y: number
}
export interface StageRect extends StagePoint {
  width: number
  height: number
}
export interface StageClipGeometry {
  canvas: { width: number; height: number }
  source: { width: number; height: number }
  transform: VideoTransform
  center: StagePoint
  drawn: { width: number; height: number }
  local: StageRect
  corners: StagePoint[]
}
export type StageAlignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
export interface StageGuide {
  axis: 'x' | 'y'
  position: number
}
/** Dock the compact toolbar away from handles so both commands and handles remain reachable. */
export function stageToolsRect(
  viewport: { width: number; height: number },
  handles: readonly StagePoint[],
  size: { width: number; height: number }
): StageRect {
  const width = Math.min(size.width, Math.max(0, viewport.width - 16)),
    height = size.height,
    right = Math.max(8, viewport.width - width - 8),
    bottom = Math.max(8, viewport.height - height - 8),
    center = Math.max(8, (viewport.width - width) / 2)
  const candidates = [
    [8, 8],
    [right, 8],
    [center, 8],
    [8, 44],
    [right, 44],
    [center, 44],
    [8, bottom],
    [right, bottom],
    [center, bottom],
    [8, Math.max(8, (viewport.height - height) / 2)],
    [right, Math.max(8, (viewport.height - height) / 2)]
  ].map(([x, y]) => ({ x, y: Math.min(y, bottom), width, height }))
  const collisions = (rect: StageRect) =>
    handles.filter(
      (p) =>
        p.x >= rect.x - 10 &&
        p.x <= rect.x + width + 10 &&
        p.y >= rect.y - 10 &&
        p.y <= rect.y + height + 10
    ).length
  return candidates.reduce((best, candidate) =>
    collisions(candidate) < collisions(best) ? candidate : best
  )
}
const add = (a: StagePoint, b: StagePoint) => ({ x: a.x + b.x, y: a.y + b.y })
const subtract = (a: StagePoint, b: StagePoint) => ({ x: a.x - b.x, y: a.y - b.y })
const multiply = (p: StagePoint, n: number) => ({ x: p.x * n, y: p.y * n })
const rotate = (p: StagePoint, degrees: number) => {
  const angle = (degrees * Math.PI) / 180
  return {
    x: p.x * Math.cos(angle) - p.y * Math.sin(angle),
    y: p.x * Math.sin(angle) + p.y * Math.cos(angle)
  }
}
export const stageRectCorners = (r: StageRect): StagePoint[] => [
  { x: r.x, y: r.y },
  { x: r.x + r.width, y: r.y },
  { x: r.x + r.width, y: r.y + r.height },
  { x: r.x, y: r.y + r.height }
]
export function stageBounds(points: readonly StagePoint[]): StageRect {
  const x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y))
  return {
    x,
    y,
    width: Math.max(...points.map((p) => p.x)) - x,
    height: Math.max(...points.map((p) => p.y)) - y
  }
}
export function stageLocalToWorld(g: StageClipGeometry, p: StagePoint): StagePoint {
  const t = g.transform
  return add(
    g.center,
    rotate(
      { x: p.x * t.scale * (t.flipX ? -1 : 1), y: p.y * t.scale * (t.flipY ? -1 : 1) },
      t.rotation
    )
  )
}
export function stageWorldToLocal(g: StageClipGeometry, p: StagePoint): StagePoint {
  const t = g.transform,
    v = rotate(subtract(p, g.center), -t.rotation)
  return { x: (v.x / t.scale) * (t.flipX ? -1 : 1), y: (v.y / t.scale) * (t.flipY ? -1 : 1) }
}
/** The same crop, fit, local clip and transform used by preview/export. */
export function stageClipGeometry(
  doc: Pick<VideoTimelineDocument, 'width' | 'height'>,
  clip: VideoClip,
  time: number,
  source: { width: number; height: number }
): StageClipGeometry | null {
  const t = evaluatedTransform(clip, Math.max(0, Math.min(clip.duration, time - clip.start)))
  const cw = source.width * t.crop.width,
    ch = source.height * t.crop.height
  if (!(cw > 0 && ch > 0 && t.scale > 0)) return null
  const fit =
    t.fit === 'cover'
      ? Math.max(doc.width / cw, doc.height / ch)
      : Math.min(doc.width / cw, doc.height / ch)
  const drawn = {
    width: t.fit === 'stretch' ? doc.width : cw * fit,
    height: t.fit === 'stretch' ? doc.height : ch * fit
  }
  const width = Math.min(doc.width, drawn.width),
    height = Math.min(doc.height, drawn.height)
  const result: StageClipGeometry = {
    canvas: doc,
    source,
    transform: t,
    center: { x: doc.width * (0.5 + t.x), y: doc.height * (0.5 + t.y) },
    drawn,
    local: { x: -width / 2, y: -height / 2, width, height },
    corners: []
  }
  result.corners = stageRectCorners(result.local).map((p) => stageLocalToWorld(result, p))
  return result
}
/** Returns the exact source pixel to alpha-test; contain margins and clipped cover pixels miss. */
export function stageSourcePoint(g: StageClipGeometry, p: StagePoint): StagePoint | null {
  if (
    p.x < 0 ||
    p.y < 0 ||
    p.x > g.canvas.width ||
    p.y > g.canvas.height ||
    g.transform.opacity <= 0.001
  )
    return null
  const local = stageWorldToLocal(g, p),
    r = g.local
  if (local.x < r.x || local.y < r.y || local.x > r.x + r.width || local.y > r.y + r.height)
    return null
  const crop = g.transform.crop
  return {
    x: g.source.width * (crop.x + (local.x / g.drawn.width + 0.5) * crop.width),
    y: g.source.height * (crop.y + (local.y / g.drawn.height + 0.5) * crop.height)
  }
}
export function stageHitClip(
  g: StageClipGeometry,
  p: StagePoint,
  alpha?: (sourcePoint: StagePoint) => number
): boolean {
  const source = stageSourcePoint(g, p)
  return !!source && (!alpha || alpha(source) * g.transform.opacity > 0.01)
}
/** CSS object-fit: contain / SVG preserveAspectRatio coordinates, excluding letterbox gutters. */
export function stageViewportPoint(
  viewport: StageRect,
  canvas: { width: number; height: number },
  client: StagePoint
): StagePoint {
  const scale = Math.min(viewport.width / canvas.width, viewport.height / canvas.height)
  return {
    x: (client.x - viewport.x - (viewport.width - canvas.width * scale) / 2) / scale,
    y: (client.y - viewport.y - (viewport.height - canvas.height * scale) / 2) / scale
  }
}
export function stageCanEdit(
  doc: VideoTimelineDocument,
  clip: VideoClip,
  readonly = false,
  playing = false
) {
  return !readonly && !playing && !clipLocked(doc, clip, 'visual')
}
/** A captured pose must never be written into another object, playback time or hidden layer. */
export function stageGestureCanContinue(
  original: { id: string; time: number },
  current: { selectedId?: string; time: number; visible: boolean; editable: boolean }
) {
  return (
    current.selectedId === original.id &&
    Math.abs(current.time - original.time) < 0.0000001 &&
    current.visible &&
    current.editable
  )
}
/** Direct changes at an animated property become a current-time keyframe, not an invisible base edit. */
export function stagePatchTransform(
  clip: VideoClip,
  time: number,
  patch: Partial<VideoTransform>
): VideoClip {
  const transform = { ...transformFor(clip) },
    keyframes = [...(clip.keyframes ?? [])]
  const local = rounded(bounded(time - clip.start, 0, clip.duration))
  const index = keyframes.findIndex((f) => Math.abs(f.time - local) < 0.000001)
  let frame = index >= 0 ? { ...keyframes[index] } : { time: local }
  let animated = false
  for (const [key, value] of Object.entries(patch)) {
    if (
      videoAnimatedFields.includes(key as (typeof videoAnimatedFields)[number]) &&
      keyframes.some((f) => f[key as (typeof videoAnimatedFields)[number]] !== undefined)
    ) {
      if (index < 0 && keyframes.length >= 128) continue
      frame = { ...frame, [key]: value }
      animated = true
    } else Object.assign(transform, { [key]: value })
  }
  if (animated) {
    if (index >= 0) keyframes[index] = frame
    else keyframes.push(frame)
  }
  return {
    ...clip,
    transform,
    ...(animated ? { keyframes: keyframes.sort((a, b) => a.time - b.time) } : {})
  }
}
function snapAxis(values: readonly number[], targets: readonly number[], threshold: number) {
  let delta = 0,
    distance = threshold + 1,
    position: number | undefined
  for (const value of values)
    for (const target of targets) {
      const d = target - value
      if (Math.abs(d) < distance && Math.abs(d) <= threshold) {
        delta = d
        distance = Math.abs(d)
        position = target
      }
    }
  return { delta, position }
}
export function stageMoveTransform(
  g: StageClipGeometry,
  delta: StagePoint,
  threshold = 0,
  others: readonly StageRect[] = []
) {
  const b = stageBounds(g.corners),
    moved = { ...b, x: b.x + delta.x, y: b.y + delta.y }
  const sx = snapAxis(
    [moved.x, moved.x + moved.width / 2, moved.x + moved.width],
    [
      0,
      g.canvas.width / 2,
      g.canvas.width,
      ...others.flatMap((r) => [r.x, r.x + r.width / 2, r.x + r.width])
    ],
    threshold
  )
  const sy = snapAxis(
    [moved.y, moved.y + moved.height / 2, moved.y + moved.height],
    [
      0,
      g.canvas.height / 2,
      g.canvas.height,
      ...others.flatMap((r) => [r.y, r.y + r.height / 2, r.y + r.height])
    ],
    threshold
  )
  const guides: StageGuide[] = []
  if (sx.position !== undefined) guides.push({ axis: 'x', position: sx.position })
  if (sy.position !== undefined) guides.push({ axis: 'y', position: sy.position })
  return {
    patch: {
      x: bounded(g.transform.x + (delta.x + sx.delta) / g.canvas.width, -2, 2),
      y: bounded(g.transform.y + (delta.y + sy.delta) / g.canvas.height, -2, 2)
    },
    guides
  }
}
/** Uniform corner resize keeps the opposite transformed corner anchored, including flipped/rotated clips. */
export function stageResizeTransform(
  g: StageClipGeometry,
  corner: number,
  point: StagePoint,
  fromCenter = false
): Partial<VideoTransform> {
  const anchor = fromCenter ? g.center : g.corners[(corner + 2) % 4]
  const diagonal = subtract(g.corners[corner], anchor),
    desired = subtract(point, anchor)
  const factor = Math.max(
    0.001,
    (desired.x * diagonal.x + desired.y * diagonal.y) / (diagonal.x ** 2 + diagonal.y ** 2)
  )
  const scale = bounded(g.transform.scale * factor, 0.05, 4),
    ratio = scale / g.transform.scale
  const center = fromCenter ? g.center : add(anchor, multiply(subtract(g.center, anchor), ratio))
  return {
    scale,
    x: bounded(center.x / g.canvas.width - 0.5, -2, 2),
    y: bounded(center.y / g.canvas.height - 0.5, -2, 2)
  }
}
export function stageRotateTransform(
  g: StageClipGeometry,
  start: StagePoint,
  point: StagePoint,
  snap = false
) {
  const angle = (p: StagePoint) => (Math.atan2(p.y - g.center.y, p.x - g.center.x) * 180) / Math.PI
  let delta = angle(point) - angle(start)
  delta = ((delta + 540) % 360) - 180
  const rotation = g.transform.rotation + delta
  return { rotation: bounded(snap ? Math.round(rotation / 15) * 15 : rotation, -360, 360) }
}
export function stageAlignTransform(
  g: StageClipGeometry,
  alignment: StageAlignment
): Partial<VideoTransform> {
  const b = stageBounds(g.corners)
  const delta = {
    x:
      alignment === 'left'
        ? -b.x
        : alignment === 'right'
          ? g.canvas.width - b.x - b.width
          : alignment === 'center'
            ? g.canvas.width / 2 - b.x - b.width / 2
            : 0,
    y:
      alignment === 'top'
        ? -b.y
        : alignment === 'bottom'
          ? g.canvas.height - b.y - b.height
          : alignment === 'middle'
            ? g.canvas.height / 2 - b.y - b.height / 2
            : 0
  }
  return stageMoveTransform(g, delta).patch
}
export function stageCaptionRects(
  doc: Pick<VideoTimelineDocument, 'width' | 'height'>,
  caption: Caption,
  measure: (text: string, font: string) => number
): StageRect[] {
  const s = captionStyle(caption),
    lines = videoCaptionLines(caption, doc.width, measure),
    lineHeight = s.fontSize * 1.2
  const font = `${s.bold ? 'bold ' : ''}${s.fontSize}px ${s.fontFamily}`
  return lines.map((text, index) => {
    const width = measure(text, font),
      x = s.x * doc.width,
      y = s.y * doc.height + (index - (lines.length - 1) / 2) * lineHeight
    return {
      x: x - (s.align === 'center' ? width / 2 : s.align === 'right' ? width : 0) - 4,
      y: y - lineHeight / 2,
      width: width + 8,
      height: lineHeight
    }
  })
}
export const stageHitRect = (r: StageRect, p: StagePoint) =>
  p.x >= r.x && p.y >= r.y && p.x <= r.x + r.width && p.y <= r.y + r.height
export function stageMoveCaption(
  doc: Pick<VideoTimelineDocument, 'width' | 'height'>,
  cue: Caption,
  delta: StagePoint,
  threshold = 0
) {
  const s = captionStyle(cue),
    point = { x: s.x * doc.width + delta.x, y: s.y * doc.height + delta.y }
  const sx = snapAxis([point.x], [0, doc.width / 2, doc.width], threshold),
    sy = snapAxis([point.y], [0, doc.height / 2, doc.height], threshold)
  return {
    ...cue,
    style: {
      ...s,
      x: bounded((point.x + sx.delta) / doc.width, 0, 1),
      y: bounded((point.y + sy.delta) / doc.height, 0, 1)
    }
  }
}
export function stageCropImageRect(
  canvas: { width: number; height: number },
  source: { width: number; height: number }
): StageRect {
  const scale = Math.min(canvas.width / source.width, canvas.height / source.height)
  return {
    x: (canvas.width - source.width * scale) / 2,
    y: (canvas.height - source.height * scale) / 2,
    width: source.width * scale,
    height: source.height * scale
  }
}
export function stageCropRect(image: StageRect, crop: VideoTransform['crop']): StageRect {
  return {
    x: image.x + crop.x * image.width,
    y: image.y + crop.y * image.height,
    width: crop.width * image.width,
    height: crop.height * image.height
  }
}
export function stageEditCrop(
  image: StageRect,
  crop: VideoTransform['crop'],
  delta: StagePoint,
  corner?: number
): VideoTransform['crop'] {
  const dx = delta.x / image.width,
    dy = delta.y / image.height
  if (corner === undefined)
    return {
      ...crop,
      x: bounded(crop.x + dx, 0, 1 - crop.width),
      y: bounded(crop.y + dy, 0, 1 - crop.height)
    }
  const left = corner === 0 || corner === 3,
    top = corner === 0 || corner === 1
  const x = left ? bounded(crop.x + dx, 0, crop.x + crop.width - 0.01) : crop.x
  const y = top ? bounded(crop.y + dy, 0, crop.y + crop.height - 0.01) : crop.y
  const right = left ? crop.x + crop.width : bounded(crop.x + crop.width + dx, crop.x + 0.01, 1)
  const bottom = top ? crop.y + crop.height : bounded(crop.y + crop.height + dy, crop.y + 0.01, 1)
  return { x, y, width: right - x, height: bottom - y }
}
/** Cancelled gestures return the captured object, never the latest intermediate mutation. */
export const stageGestureResult = <T>(original: T, latest: T, cancelled: boolean) =>
  cancelled ? original : latest
