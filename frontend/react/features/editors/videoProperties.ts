import { assertProductionDraftExists } from '../../../src/features/workspaces/model/workspaceWorks.ts'
import {
  captionStyle,
  clipLocked,
  sliceClip,
  transformFor,
  videoAnimatedFields,
  videoEasings,
  type Caption,
  type CaptionStyle,
  type VideoClip,
  type VideoKeyframe,
  type VideoTimelineDocument,
  type VideoTransform
} from './videoStudioModel.ts'
import {
  defaultLocalVideoEffects,
  validateLocalVideoEffects,
  type LocalVideoEffects
} from './videoLocalEffects.ts'
import { visibleClipFades } from '../../../src/features/media-editor/model/audioTimeline.ts'
import { videoAudioClip } from './videoSoundProperties.ts'

export type VideoProperties =
  | {
      kind: 'visual'
      duration: number
      transform: VideoTransform
      color: NonNullable<VideoClip['color']>
      localEffects: LocalVideoEffects
      keyframes: VideoKeyframe[]
      fadeIn: number
      fadeOut: number
      fadeCurve?: VideoClip['fadeCurve']
    }
  | { kind: 'caption'; style: CaptionStyle }
export interface VideoPropertyPreset {
  id: string
  name: string
  properties: VideoProperties
}
export interface VideoPropertyApplication {
  document: VideoTimelineDocument
  appliedIds: string[]
  skippedLockedIds: string[]
  unchangedIds: string[]
}
const transformKeys = ['x', 'y', 'scale', 'rotation', 'flipX', 'flipY', 'opacity', 'fit', 'crop']
const captionKeys = [
  'fontSize',
  'fontFamily',
  'color',
  'background',
  'outlineColor',
  'outlineWidth',
  'bold',
  'align',
  'x',
  'y',
  'maxWidth',
  'wrap'
]
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const onlyKeys = (value: unknown, keys: readonly string[]) =>
  object(value) && Object.keys(value).every((key) => keys.includes(key))
const finite = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const clone = <T>(value: T): T => structuredClone(value)

/** Select fields explicitly: no path, text, timing, audio or source/link identifiers. */
export function captureVideoProperties(clip: VideoClip): VideoProperties {
  const transform = transformFor(clip)
  const fades = visibleClipFades(videoAudioClip(clip))
  const properties: VideoProperties = {
    kind: 'visual',
    duration: clip.duration,
    transform: clone(
      Object.fromEntries(
        transformKeys.map((key) => [key, transform[key as keyof VideoTransform]])
      ) as unknown as VideoTransform
    ),
    color: clone(clip.color ?? { brightness: 0, contrast: 1, saturation: 1 }),
    localEffects: clone(clip.localEffects ?? defaultLocalVideoEffects()),
    keyframes: clone(clip.keyframes ?? []),
    fadeIn: fades.fadeIn,
    fadeOut: fades.fadeOut,
    fadeCurve: clip.fadeCurve ?? 'linear'
  }
  if (!validVideoProperties(properties)) throw new Error('画面属性无效，无法复制')
  return properties
}
export function captureCaptionProperties(caption: Caption): VideoProperties {
  const style = captionStyle(caption)
  const properties: VideoProperties = {
    kind: 'caption',
    style: Object.fromEntries(
      captionKeys.map((key) => [key, style[key as keyof CaptionStyle]])
    ) as unknown as CaptionStyle
  }
  if (!validVideoProperties(properties)) throw new Error('字幕属性无效，无法复制')
  return properties
}

function validTransform(t: VideoTransform): boolean {
  const r = t?.crop
  return (
    onlyKeys(t, transformKeys) &&
    finite(t.x, -2, 2) &&
    finite(t.y, -2, 2) &&
    finite(t.scale, 0.05, 4) &&
    finite(t.rotation, -360, 360) &&
    finite(t.opacity, 0, 1) &&
    typeof t.flipX === 'boolean' &&
    typeof t.flipY === 'boolean' &&
    ['contain', 'cover', 'stretch'].includes(t.fit) &&
    onlyKeys(r, ['x', 'y', 'width', 'height']) &&
    finite(r.x, 0, 1) &&
    finite(r.y, 0, 1) &&
    finite(r.width, 0.00001, 1) &&
    finite(r.height, 0.00001, 1) &&
    r.x + r.width <= 1.000001 &&
    r.y + r.height <= 1.000001
  )
}
function validFrame(frame: VideoKeyframe, duration: number) {
  if (
    !onlyKeys(frame, ['time', ...videoAnimatedFields, 'easing', 'curves']) ||
    !finite(frame.time, 0, duration)
  )
    return false
  if (frame.easing !== undefined && !videoEasings.includes(frame.easing)) return false
  const ranges = {
    x: [-2, 2],
    y: [-2, 2],
    scale: [0.05, 4],
    rotation: [-360, 360],
    opacity: [0, 1]
  }
  if (
    videoAnimatedFields.some(
      (key) => frame[key] !== undefined && !finite(frame[key], ranges[key][0], ranges[key][1])
    )
  )
    return false
  return (
    frame.curves === undefined ||
    (onlyKeys(frame.curves, videoAnimatedFields) &&
      Object.values(frame.curves).every(
        (curve) =>
          onlyKeys(curve, ['easing', 'start', 'end']) &&
          videoEasings.includes(curve.easing) &&
          finite(curve.start, 0, 1) &&
          finite(curve.end, 0, 1) &&
          curve.end > curve.start
      ))
  )
}
export function validVideoProperties(value: unknown): value is VideoProperties {
  if (!object(value)) return false
  const properties = value as VideoProperties
  if (properties.kind === 'caption') {
    const s = properties.style
    return (
      onlyKeys(properties, ['kind', 'style']) &&
      onlyKeys(s, captionKeys) &&
      finite(s.fontSize, 8, 300) &&
      typeof s.fontFamily === 'string' &&
      s.fontFamily.length <= 120 &&
      /^[\p{L}\p{N}_ -]+$/u.test(s.fontFamily) &&
      /^#[a-fA-F0-9]{6}$/.test(s.color) &&
      /^#[a-fA-F0-9]{8}$/.test(s.background) &&
      /^#[a-fA-F0-9]{6}$/.test(s.outlineColor) &&
      finite(s.outlineWidth, 0, 10) &&
      typeof s.bold === 'boolean' &&
      ['left', 'center', 'right'].includes(s.align) &&
      finite(s.x, 0, 1) &&
      finite(s.y, 0, 1) &&
      finite(s.maxWidth, 0.1, 1) &&
      typeof s.wrap === 'boolean'
    )
  }
  if (
    properties.kind !== 'visual' ||
    !onlyKeys(properties, [
      'kind',
      'duration',
      'transform',
      'color',
      'localEffects',
      'keyframes',
      'fadeIn',
      'fadeOut',
      'fadeCurve'
    ])
  )
    return false
  const c = properties.color,
    local = properties.localEffects
  return (
    finite(properties.duration, 0.000001, 21600) &&
    validTransform(properties.transform) &&
    onlyKeys(c, ['brightness', 'contrast', 'saturation']) &&
    finite(c.brightness, -1, 1) &&
    finite(c.contrast, 0, 3) &&
    finite(c.saturation, 0, 3) &&
    onlyKeys(local, ['exposure', 'temperature', 'tint', 'gamma', 'regions']) &&
    validateLocalVideoEffects(local) &&
    local.regions.every((region) =>
      onlyKeys(region, [
        'id',
        'shape',
        'effect',
        'x',
        'y',
        'width',
        'height',
        'invert',
        'feather',
        'strength'
      ])
    ) &&
    finite(properties.fadeIn, 0, properties.duration) &&
    finite(properties.fadeOut, 0, properties.duration) &&
    (properties.fadeCurve === undefined ||
      ['linear', 'smooth', 'equalPower'].includes(properties.fadeCurve)) &&
    Array.isArray(properties.keyframes) &&
    properties.keyframes.length <= 128 &&
    new Set(properties.keyframes.map((frame) => frame?.time)).size ===
      properties.keyframes.length &&
    properties.keyframes.every((frame) => validFrame(frame, properties.duration))
  )
}

function forDuration(properties: Extract<VideoProperties, { kind: 'visual' }>, duration: number) {
  if (!finite(duration, 0.000001, 21600)) throw new Error('目标片段时长无效')
  // Reuse the model's curve-aware trim. Timing/source fields from this temporary
  // image clip are never applied to the destination.
  const animation =
    duration < properties.duration
      ? sliceClip(
          {
            id: 'property-preview',
            path: '',
            name: '',
            kind: 'image',
            start: 0,
            sourceIn: 0,
            duration: properties.duration,
            sourceDuration: properties.duration,
            rate: 1,
            gain: 1,
            transform: properties.transform,
            keyframes: properties.keyframes
          },
          0,
          duration
        )
      : properties
  return {
    transform: clone(animation.transform),
    keyframes: clone(animation.keyframes ?? []).map((frame) => ({
      ...frame,
      time: Math.min(duration, frame.time)
    })),
    color: clone(properties.color),
    localEffects: clone(properties.localEffects),
    fadeIn: Math.min(properties.fadeIn, duration),
    fadeOut: Math.min(properties.fadeOut, duration),
    fadeCurve: properties.fadeCurve ?? 'linear',
    envelopeOffset: 0,
    envelopeDuration: duration
  }
}

/** Applies only to explicitly selected matching objects, never linked sound clips. */
export function applyVideoProperties(
  document: VideoTimelineDocument,
  ids: readonly string[],
  properties: VideoProperties,
  policy: { readonly?: boolean; lockedIds?: readonly string[] } = {}
): VideoPropertyApplication {
  const result: VideoPropertyApplication = {
    document,
    appliedIds: [],
    skippedLockedIds: [],
    unchangedIds: []
  }
  if (policy.readonly) return result
  if (!validVideoProperties(properties)) throw new Error('视频属性无效，原始内容未修改')
  const selected = new Set(ids),
    locked = new Set(policy.lockedIds)
  if (properties.kind === 'visual') {
    const visuals = document.visuals.map((clip) => {
      if (!selected.has(clip.id)) return clip
      if (locked.has(clip.id) || clipLocked(document, clip, 'visual')) {
        result.skippedLockedIds.push(clip.id)
        return clip
      }
      const next = { ...clip, ...forDuration(properties, clip.duration) }
      if (
        JSON.stringify(captureVideoProperties(clip)) ===
          JSON.stringify(captureVideoProperties(next)) &&
        (clip.envelopeOffset ?? 0) === 0 &&
        (clip.envelopeDuration ?? clip.duration) === clip.duration
      ) {
        result.unchangedIds.push(clip.id)
        return clip
      }
      result.appliedIds.push(clip.id)
      return next
    })
    if (result.appliedIds.length) result.document = { ...document, visuals }
  } else {
    const captions = document.captions.map((caption) => {
      if (!selected.has(caption.id)) return caption
      if (locked.has(caption.id)) {
        result.skippedLockedIds.push(caption.id)
        return caption
      }
      if (JSON.stringify(captionStyle(caption)) === JSON.stringify(properties.style)) {
        result.unchangedIds.push(caption.id)
        return caption
      }
      result.appliedIds.push(caption.id)
      return { ...caption, style: clone(properties.style) }
    })
    if (result.appliedIds.length) result.document = { ...document, captions }
  }
  return result
}

export const videoPresetsKey = (workspaceId: string) =>
  `omnigallery:editor-presets-v1:${workspaceId}:video`
export function readVideoPresets(raw: string | null): VideoPropertyPreset[] {
  if (!raw) return []
  if (new TextEncoder().encode(raw).byteLength > 256 * 1024)
    throw new Error('视频预设容量过大，原始数据已保留')
  let list: unknown
  try {
    list = JSON.parse(raw)
  } catch {
    throw new Error('视频预设无法读取，原始数据已保留')
  }
  if (
    !Array.isArray(list) ||
    list.length > 30 ||
    new Set(list.map((entry) => entry?.id)).size !== list.length ||
    list.some(
      (entry) =>
        !onlyKeys(entry, ['id', 'name', 'properties']) ||
        typeof entry.id !== 'string' ||
        !/^[\w-]{1,128}$/.test(entry.id) ||
        typeof entry.name !== 'string' ||
        !entry.name.trim() ||
        entry.name.length > 80 ||
        !validVideoProperties(entry.properties)
    )
  )
    throw new Error('视频预设无法读取，原始数据已保留')
  return list
}
type PresetStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export function saveVideoPreset(
  storage: PresetStorage,
  workspaceId: string,
  draftId: string,
  preset: VideoPropertyPreset,
  readonly = false
) {
  if (readonly) throw new Error('当前编辑器为只读')
  assertProductionDraftExists(storage, workspaceId, draftId)
  const key = videoPresetsKey(workspaceId),
    list = readVideoPresets(storage.getItem(key))
  if (list.length >= 30) throw new Error('最多保存 30 个视频预设，请先删除不再使用的预设')
  const next = JSON.stringify([...list, clone(preset)])
  readVideoPresets(next)
  storage.setItem(key, next)
}
export function deleteVideoPreset(
  storage: PresetStorage,
  workspaceId: string,
  draftId: string,
  id: string,
  readonly = false
) {
  if (readonly) throw new Error('当前编辑器为只读')
  assertProductionDraftExists(storage, workspaceId, draftId)
  const key = videoPresetsKey(workspaceId),
    list = readVideoPresets(storage.getItem(key))
  if (!list.some((preset) => preset.id === id)) throw new Error('预设已删除，请刷新列表')
  storage.setItem(key, JSON.stringify(list.filter((preset) => preset.id !== id)))
}
