import { validateLocalVideoEffects, type LocalVideoEffects } from './videoLocalEffects.ts'
import { textLimits } from '../../../src/features/media-editor/model/textTimeline.ts'
import {
  fadeGain,
  validAudioProcessing,
  validGainPoints,
  type AudioProcessing,
  type GainPoint,
  type FadeCurve
} from '../../../src/features/media-editor/model/audioProcessing.ts'
export type Lane = 'visual' | 'sound'
export type ClipKind = 'image' | 'video' | 'audio'
export interface VideoTrack {
  id: string
  kind: 'video' | 'audio'
  name: string
  hidden?: boolean
  muted?: boolean
  solo?: boolean
  locked?: boolean
  gain?: number
  pan?: number
  processing?: Partial<AudioProcessing>
}
export interface VideoTransform {
  x: number
  y: number
  scale: number
  rotation: number
  flipX: boolean
  flipY: boolean
  opacity: number
  fit: 'contain' | 'cover' | 'stretch'
  crop: { x: number; y: number; width: number; height: number }
}
export type VideoEasing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut'
export type VideoAnimatedField = 'x' | 'y' | 'scale' | 'rotation' | 'opacity'
export interface VideoCurve {
  easing: VideoEasing
  start: number
  end: number
}
export interface VideoKeyframe {
  time: number
  x?: number
  y?: number
  scale?: number
  opacity?: number
  rotation?: number
  easing?: VideoEasing
  /** Retained curve subranges keep split/trim interpolation identical to the original. */
  curves?: Partial<Record<VideoAnimatedField, VideoCurve>>
}
export interface VideoClip {
  id: string
  path: string
  name: string
  kind: ClipKind
  start: number
  sourceIn: number
  duration: number
  sourceDuration: number
  /** Audio-only stream ordinal; only sound-lane decoding uses this field. */
  audioStream?: number
  rate: number
  gain: number
  trackId?: string
  linkId?: string
  transform?: Partial<VideoTransform>
  keyframes?: VideoKeyframe[]
  color?: { brightness: number; contrast: number; saturation: number }
  fadeIn?: number
  fadeOut?: number
  reverse?: boolean
  freeze?: boolean
  transitionIn?: { previousId: string; duration: number; easing: VideoEasing; offset?: number }
  localEffects?: LocalVideoEffects
  pan?: number
  gainPoints?: GainPoint[]
  fadeCurve?: FadeCurve
  channels?: 'stereo' | 'swap' | 'mono' | 'left' | 'right'
  invertPhase?: boolean
  envelopeOffset?: number
  envelopeDuration?: number
}
export interface CaptionStyle {
  fontSize: number
  fontFamily: string
  color: string
  background: string
  outlineColor: string
  outlineWidth: number
  bold: boolean
  align: 'left' | 'center' | 'right'
  x: number
  y: number
  maxWidth: number
  wrap: boolean
}
export interface Caption {
  id: string
  text: string
  start: number
  duration: number
  style?: Partial<CaptionStyle>
}
export interface Marker {
  id: string
  name: string
  time: number
}
export interface VideoTimelineDocument {
  version: 1
  width: number
  height: number
  fps: number
  tracks: VideoTrack[]
  visuals: VideoClip[]
  sounds: VideoClip[]
  captions: Caption[]
  markers: Marker[]
  masterGain?: number
  processing?: Partial<AudioProcessing>
}
export const bounded = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
export const rounded = (value: number) => Math.round(value * 1e6) / 1e6
export const defaultTracks = (): VideoTrack[] => [
  { id: 'video-1', kind: 'video', name: '画面 1', gain: 1 },
  { id: 'audio-1', kind: 'audio', name: '声音 1', gain: 1 }
]
export const emptyDocument = (): VideoTimelineDocument => ({
  version: 1,
  width: 1280,
  height: 720,
  fps: 30,
  tracks: defaultTracks(),
  visuals: [],
  sounds: [],
  captions: [],
  markers: []
})
export const trackIdFor = (clip: VideoClip, lane: Lane) =>
  clip.trackId || (lane === 'visual' ? 'video-1' : 'audio-1')
export const timelineEnd = (doc: VideoTimelineDocument) =>
  Math.max(
    0,
    ...[...doc.visuals, ...doc.sounds, ...doc.captions.filter((c) => c.text.trim())].map(
      (c) => c.start + c.duration
    )
  )
export const transformFor = (clip: VideoClip): VideoTransform => ({
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  flipX: false,
  flipY: false,
  opacity: 1,
  fit: 'contain',
  crop: { x: 0, y: 0, width: 1, height: 1 },
  ...clip.transform
})
export const captionStyle = (cue: Caption): CaptionStyle => ({
  fontSize: 32,
  fontFamily: 'sans-serif',
  color: '#ffffff',
  background: '#00000000',
  outlineColor: '#000000',
  outlineWidth: 2,
  bold: false,
  align: 'center',
  x: 0.5,
  y: 0.9,
  maxWidth: 0.9,
  wrap: true,
  ...cue.style
})
export const clipTrack = (doc: VideoTimelineDocument, clip: VideoClip, lane: Lane) =>
  doc.tracks.find((t) => t.id === trackIdFor(clip, lane))
export const clipLocked = (doc: VideoTimelineDocument, clip: VideoClip, lane: Lane) =>
  !!clipTrack(doc, clip, lane)?.locked
export function trackAudible(doc: VideoTimelineDocument, clip: VideoClip) {
  const track = clipTrack(doc, clip, 'sound')
  return (
    !clip.freeze &&
    !track?.muted &&
    !track?.hidden &&
    (!doc.tracks.some((t) => t.kind === 'audio' && t.solo) || !!track?.solo)
  )
}
export function clipEnvelope(clip: VideoClip, local: number) {
  const time = (clip.envelopeOffset ?? 0) + local
  const duration = clip.envelopeDuration ?? clip.duration
  return Math.min(
    1,
    clip.fadeIn ? fadeGain(time / clip.fadeIn, clip.fadeCurve) : 1,
    clip.fadeOut ? fadeGain((duration - time) / clip.fadeOut, clip.fadeCurve) : 1
  )
}
export function sourceTime(clip: VideoClip, time: number) {
  const local = bounded(time - clip.start, 0, clip.duration)
  return (
    clip.sourceIn +
    (clip.freeze
      ? 0
      : clip.reverse
        ? Math.max(0, clip.duration - local) * clip.rate
        : local * clip.rate)
  )
}
/** FFmpeg samples the rate-adjusted output before reversing; freeze selects a source frame. */
export function previewSourceTime(
  clip: VideoClip,
  time: number,
  outputFps: number,
  sourceFps = outputFps
) {
  const fps = sourceFps > 0 ? sourceFps : outputFps
  const local =
    Math.floor(bounded(time - clip.start, 0, clip.duration) * outputFps + 1e-8) / outputFps
  const target = clip.freeze
    ? Math.floor(clip.sourceIn * fps) / fps
    : clip.reverse
      ? clip.sourceIn + Math.max(0, clip.duration - 1 / outputFps - local) * clip.rate
      : sourceTime(clip, time)
  return bounded(target, 0, Math.max(0, clip.sourceDuration - 1 / fps))
}
export const videoAnimatedFields: readonly VideoAnimatedField[] = [
  'x',
  'y',
  'scale',
  'rotation',
  'opacity'
]
export const videoEasings: readonly VideoEasing[] = ['linear', 'easeIn', 'easeOut', 'easeInOut']
export function videoEase(value: number, easing: VideoEasing = 'linear') {
  const t = bounded(value, 0, 1)
  return easing === 'easeIn'
    ? t * t
    : easing === 'easeOut'
      ? 1 - (1 - t) ** 2
      : easing === 'easeInOut'
        ? t * t * (3 - 2 * t)
        : t
}
export function videoCurveValue(value: number, curve: VideoCurve) {
  const a = videoEase(curve.start, curve.easing),
    b = videoEase(curve.end, curve.easing)
  return b - a < 0.0000000001
    ? bounded(value, 0, 1)
    : (videoEase(curve.start + (curve.end - curve.start) * bounded(value, 0, 1), curve.easing) -
        a) /
        (b - a)
}
export function videoAnimationPoints(
  clip: VideoClip,
  field: VideoAnimatedField
): (VideoKeyframe & Record<VideoAnimatedField, number>)[] {
  return [
    { time: 0, [field]: transformFor(clip)[field] },
    ...(clip.keyframes ?? []).filter((f) => f[field] !== undefined)
  ].sort((a, b) => a.time - b.time) as (VideoKeyframe & Record<VideoAnimatedField, number>)[]
}
export function evaluatedTransform(clip: VideoClip, local: number): VideoTransform {
  const result = transformFor(clip)
  for (const key of videoAnimatedFields) {
    const frames = videoAnimationPoints(clip, key)
    const before = frames.filter((f) => f.time <= local).at(-1) ?? frames[0]
    const after = frames.find((f) => f.time > local)
    const a = before[key] as number
    result[key] = !after
      ? a
      : a +
        ((after[key] as number) - a) *
          videoCurveValue(
            bounded((local - before.time) / (after.time - before.time), 0, 1),
            after.curves?.[key] ?? { easing: after.easing ?? 'linear', start: 0, end: 1 }
          )
  }
  result.opacity *= clipEnvelope(clip, local)
  if (clip.transitionIn)
    result.opacity *= videoEase(
      (local + (clip.transitionIn.offset ?? 0)) / clip.transitionIn.duration,
      clip.transitionIn.easing
    )
  return result
}
export function readDocument(raw: string | null): VideoTimelineDocument {
  if (!raw) return emptyDocument()
  const d = JSON.parse(raw) as VideoTimelineDocument
  const fail = () => {
    throw new Error('视频制作文件无法读取，原始数据已保留')
  }
  if (
    !d ||
    d.version !== 1 ||
    !['visuals', 'sounds', 'captions', 'markers'].every((k) =>
      Array.isArray(d[k as keyof VideoTimelineDocument])
    )
  )
    return fail()
  const width = d.width ?? 1280,
    height = d.height ?? 720,
    fps = d.fps ?? 30
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 240 ||
    height < 240 ||
    width > 3840 ||
    height > 3840 ||
    width * height > 3840 * 2160 ||
    width % 2 ||
    height % 2 ||
    !Number.isInteger(fps) ||
    fps < 1 ||
    fps > 60
  )
    return fail()
  if (
    d.visuals.length > 256 ||
    d.sounds.length > 256 ||
    d.captions.length > 4096 ||
    d.markers.length > 256
  )
    return fail()
  const ids = new Set<string>()
  const finite = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
  if (
    (d.masterGain !== undefined && !finite(d.masterGain, 0, 2)) ||
    !validAudioProcessing(d.processing)
  )
    return fail()
  for (const c of [...d.visuals, ...d.sounds]) {
    if (c.localEffects !== undefined && !validateLocalVideoEffects(c.localEffects)) return fail()
    if (
      !c ||
      typeof c.id !== 'string' ||
      ids.has(c.id) ||
      typeof c.path !== 'string' ||
      typeof c.name !== 'string' ||
      !['image', 'video', 'audio'].includes(c.kind) ||
      ![c.start, c.sourceIn, c.duration, c.sourceDuration, c.rate, c.gain].every(Number.isFinite) ||
      c.start < 0 ||
      c.sourceIn < 0 ||
      c.duration <= 0 ||
      c.sourceDuration <= 0 ||
      (c.audioStream !== undefined &&
        (!Number.isInteger(c.audioStream) || c.audioStream < 0 || c.audioStream > 255)) ||
      c.rate < 0.25 ||
      c.rate > 4 ||
      c.gain < 0 ||
      c.gain > 4
    )
      return fail()
    ids.add(c.id)
    if (
      c.start + c.duration > 21600 ||
      (c.reverse && c.duration > 30) ||
      (c.fadeIn !== undefined &&
        !finite(c.fadeIn, 0, c.envelopeDuration ?? Math.min(30, c.duration))) ||
      (c.fadeOut !== undefined &&
        !finite(c.fadeOut, 0, c.envelopeDuration ?? Math.min(30, c.duration))) ||
      (c.pan !== undefined && !finite(c.pan, -1, 1)) ||
      (c.fadeCurve !== undefined && !['linear', 'smooth', 'equalPower'].includes(c.fadeCurve)) ||
      (c.channels !== undefined &&
        !['stereo', 'swap', 'mono', 'left', 'right'].includes(c.channels)) ||
      (c.invertPhase !== undefined && typeof c.invertPhase !== 'boolean') ||
      (c.envelopeOffset !== undefined && !finite(c.envelopeOffset, -345600, 345600)) ||
      (c.envelopeDuration !== undefined && !finite(c.envelopeDuration, 0.000001, 345600)) ||
      !validGainPoints(c.gainPoints, c.envelopeDuration ?? c.duration)
    )
      return fail()
    if (
      c.transform &&
      ![
        c.transform.x ?? 0,
        c.transform.y ?? 0,
        c.transform.scale ?? 1,
        c.transform.rotation ?? 0,
        c.transform.opacity ?? 1
      ].every(Number.isFinite)
    )
      return fail()
    if (c.transform) {
      const t = transformFor(c),
        r = t.crop
      if (
        !finite(t.x, -2, 2) ||
        !finite(t.y, -2, 2) ||
        !finite(t.scale, 0.05, 4) ||
        !finite(t.opacity, 0, 1) ||
        !finite(t.rotation, -360, 360) ||
        !['contain', 'cover', 'stretch'].includes(t.fit) ||
        !r ||
        !finite(r.x, 0, 1) ||
        !finite(r.y, 0, 1) ||
        !finite(r.width, 0.00001, 1) ||
        !finite(r.height, 0.00001, 1) ||
        r.x + r.width > 1.000001 ||
        r.y + r.height > 1.000001
      )
        return fail()
    }
    if (
      c.color &&
      (!finite(c.color.brightness, -1, 1) ||
        !finite(c.color.contrast, 0, 3) ||
        !finite(c.color.saturation, 0, 3))
    )
      return fail()
    if (
      c.keyframes &&
      (!Array.isArray(c.keyframes) ||
        c.keyframes.length > 128 ||
        c.keyframes.some(
          (f) =>
            !Number.isFinite(f.time) ||
            f.time < 0 ||
            f.time > c.duration ||
            c.keyframes?.filter((other) => other.time === f.time).length !== 1 ||
            (f.x !== undefined && !finite(f.x, -2, 2)) ||
            (f.y !== undefined && !finite(f.y, -2, 2)) ||
            (f.scale !== undefined && !finite(f.scale, 0.05, 4)) ||
            (f.opacity !== undefined && !finite(f.opacity, 0, 1)) ||
            (f.rotation !== undefined && !finite(f.rotation, -360, 360)) ||
            (f.easing !== undefined && !videoEasings.includes(f.easing)) ||
            (f.curves !== undefined &&
              (typeof f.curves !== 'object' ||
                !f.curves ||
                Object.entries(f.curves).some(
                  ([key, curve]) =>
                    !videoAnimatedFields.includes(key as VideoAnimatedField) ||
                    !curve ||
                    !videoEasings.includes(curve.easing) ||
                    !finite(curve.start, 0, 1) ||
                    !finite(curve.end, 0, 1) ||
                    curve.end <= curve.start
                ))) ||
            videoAnimatedFields.some(
              (k) =>
                f[k as keyof VideoKeyframe] !== undefined &&
                !Number.isFinite(f[k as keyof VideoKeyframe])
            )
        ))
    )
      return fail()
    if (
      c.transitionIn &&
      (typeof c.transitionIn.previousId !== 'string' ||
        !c.transitionIn.previousId ||
        !finite(c.transitionIn.duration, 0.000001, 30) ||
        !videoEasings.includes(c.transitionIn.easing) ||
        (c.transitionIn.offset !== undefined &&
          !finite(c.transitionIn.offset, 0, c.transitionIn.duration)))
    )
      return fail()
  }
  if (
    d.captions.some(
      (c) =>
        !c ||
        typeof c.id !== 'string' ||
        typeof c.text !== 'string' ||
        c.text.length > textLimits.text ||
        !Number.isFinite(c.start) ||
        c.start < 0 ||
        !Number.isFinite(c.duration) ||
        c.duration <= 0 ||
        (c.style?.maxWidth !== undefined && !finite(c.style.maxWidth, 0.1, 1)) ||
        (c.style?.wrap !== undefined && typeof c.style.wrap !== 'boolean')
    ) ||
    d.markers.some(
      (m) =>
        !m ||
        typeof m.id !== 'string' ||
        typeof m.name !== 'string' ||
        !Number.isFinite(m.time) ||
        m.time < 0
    )
  )
    return fail()
  const tracks = d.tracks ?? defaultTracks()
  if (
    !Array.isArray(tracks) ||
    tracks.length > 32 ||
    tracks.some(
      (t) =>
        !t ||
        typeof t.id !== 'string' ||
        !['video', 'audio'].includes(t.kind) ||
        typeof t.name !== 'string' ||
        (t.gain !== undefined && !finite(t.gain, 0, 4)) ||
        (t.pan !== undefined && !finite(t.pan, -1, 1)) ||
        !validAudioProcessing(t.processing)
    )
  )
    return fail()
  for (const [lane, list] of [
    ['visual', d.visuals],
    ['sound', d.sounds]
  ] as const)
    for (const c of list)
      if (!tracks.some((t) => t.id === trackIdFor(c, lane)))
        tracks.push({
          id: trackIdFor(c, lane),
          kind: lane === 'visual' ? 'video' : 'audio',
          name: lane === 'visual' ? '画面' : '声音',
          gain: 1
        })
  return {
    ...d,
    width,
    height,
    fps,
    tracks
  }
}
export function linkedSelection(doc: VideoTimelineDocument, ids: readonly string[]) {
  const clips = [...doc.visuals, ...doc.sounds]
  const links = new Set(clips.filter((c) => ids.includes(c.id) && c.linkId).map((c) => c.linkId))
  return [
    ...new Set([...ids, ...clips.filter((c) => c.linkId && links.has(c.linkId)).map((c) => c.id)])
  ]
}
export function mapClips(
  doc: VideoTimelineDocument,
  operation: (clip: VideoClip, lane: Lane) => VideoClip
): VideoTimelineDocument {
  return {
    ...doc,
    visuals: doc.visuals.map((c) => operation(c, 'visual')),
    sounds: doc.sounds.map((c) => operation(c, 'sound'))
  }
}
export function moveClips(doc: VideoTimelineDocument, ids: readonly string[], delta: number) {
  const selected = linkedSelection(doc, ids)
  const clips = [...doc.visuals, ...doc.sounds].filter((c) => selected.includes(c.id))
  if (
    !clips.length ||
    doc.visuals.some((c) => selected.includes(c.id) && clipLocked(doc, c, 'visual')) ||
    doc.sounds.some((c) => selected.includes(c.id) && clipLocked(doc, c, 'sound'))
  )
    return doc
  const shift = bounded(
    delta,
    -Math.min(...clips.map((c) => c.start)),
    21600 - Math.max(...clips.map((c) => c.start + c.duration))
  )
  if (Math.abs(shift) < 1e-8) return doc
  return mapClips(doc, (c) =>
    selected.includes(c.id) ? { ...c, start: rounded(c.start + shift) } : c
  )
}
/** Restrict every sparse channel's original curve; extended source handles hold edge values. */
export function rebaseVideoAnimation(
  clip: VideoClip,
  start: number,
  end: number,
  holdEdges = false
): Pick<VideoClip, 'transform' | 'keyframes'> {
  const raw = { ...clip, fadeIn: 0, fadeOut: 0, transitionIn: undefined }
  const at = (stamp: number) => evaluatedTransform(raw, bounded(stamp, 0, clip.duration))
  const first = at(start)
  const keyTimes = [
    ...new Set(
      (clip.keyframes ?? []).map((f) => f.time).filter((time) => time > start && time < end)
    )
  ]
  if (holdEdges && start < 0 && end > 0) keyTimes.push(0)
  if (holdEdges && end > clip.duration && start < clip.duration) keyTimes.push(clip.duration)
  if (holdEdges || (clip.keyframes ?? []).some((f) => f.time >= end)) keyTimes.push(end)
  keyTimes.sort((a, b) => a - b)
  let previousTime = start
  const keyframes = [...new Set(keyTimes)].map((stamp): VideoKeyframe => {
    const values = at(stamp),
      curves: VideoKeyframe['curves'] = {}
    for (const field of videoAnimatedFields) {
      const points = videoAnimationPoints(clip, field)
      const after = points.find((f) => f.time >= stamp && f.time > previousTime)
      const before = after ? points.filter((f) => f.time < after.time).at(-1) : undefined
      if (!after || !before || after.time <= before.time) continue
      const curve = after.curves?.[field] ?? { easing: after.easing ?? 'linear', start: 0, end: 1 }
      const span = curve.end - curve.start
      const retained = {
        easing: curve.easing,
        start:
          curve.start +
          span * bounded((previousTime - before.time) / (after.time - before.time), 0, 1),
        end: curve.start + span * bounded((stamp - before.time) / (after.time - before.time), 0, 1)
      }
      if (retained.end - retained.start > 1e-10) curves[field] = retained
    }
    previousTime = stamp
    return {
      time: rounded(stamp - start),
      x: values.x,
      y: values.y,
      scale: values.scale,
      rotation: values.rotation,
      opacity: values.opacity,
      curves
    }
  })
  return {
    transform: {
      ...transformFor(clip),
      x: first.x,
      y: first.y,
      scale: first.scale,
      rotation: first.rotation,
      opacity: first.opacity
    },
    keyframes: clip.keyframes?.length ? keyframes : undefined
  }
}
/** Split keeps the original source interval (also for reverse), and rebases local keyframes. */
export function sliceClip(clip: VideoClip, from: number, to: number, id = clip.id): VideoClip {
  const start = bounded(from, 0, clip.duration),
    end = bounded(to, start, clip.duration)
  const transitionOffset = (clip.transitionIn?.offset ?? 0) + start
  return {
    ...clip,
    id,
    start: rounded(clip.start + start),
    duration: rounded(end - start),
    sourceIn: rounded(
      clip.sourceIn +
        (clip.freeze || clip.kind === 'image'
          ? 0
          : clip.reverse
            ? (clip.duration - end) * clip.rate
            : start * clip.rate)
    ),
    ...rebaseVideoAnimation(clip, start, end),
    transitionIn:
      clip.transitionIn && transitionOffset < clip.transitionIn.duration
        ? { ...clip.transitionIn, offset: transitionOffset }
        : undefined,
    envelopeOffset: rounded((clip.envelopeOffset ?? 0) + start),
    envelopeDuration: clip.envelopeDuration ?? clip.duration,
    fadeIn: clip.fadeIn,
    fadeOut: clip.fadeOut
  }
}
export function splitClips(doc: VideoTimelineDocument, ids: readonly string[], time: number) {
  const selected = linkedSelection(doc, ids),
    links = new Map<string, string>()
  const split = (clip: VideoClip, lane: Lane) => {
    if (
      !selected.includes(clip.id) ||
      clipLocked(doc, clip, lane) ||
      time <= clip.start ||
      time >= clip.start + clip.duration
    )
      return [clip]
    const local = time - clip.start
    let linkId = undefined
    if (clip.linkId) {
      if (!links.has(clip.linkId)) links.set(clip.linkId, crypto.randomUUID())
      linkId = links.get(clip.linkId)
    }
    return [
      sliceClip(clip, 0, local),
      { ...sliceClip(clip, local, clip.duration, crypto.randomUUID()), linkId }
    ]
  }
  if (
    doc.visuals.some((c) => selected.includes(c.id) && clipLocked(doc, c, 'visual')) ||
    doc.sounds.some((c) => selected.includes(c.id) && clipLocked(doc, c, 'sound'))
  )
    return doc
  return {
    ...doc,
    visuals: doc.visuals.flatMap((c) => split(c, 'visual')),
    sounds: doc.sounds.flatMap((c) => split(c, 'sound'))
  }
}
export function removeClips(doc: VideoTimelineDocument, ids: readonly string[], ripple = false) {
  if (ripple && doc.tracks.some((t) => t.locked)) return doc
  const selected = linkedSelection(doc, ids)
  if (
    doc.visuals.some((c) => selected.includes(c.id) && clipLocked(doc, c, 'visual')) ||
    doc.sounds.some((c) => selected.includes(c.id) && clipLocked(doc, c, 'sound'))
  )
    return doc
  const spans = [...doc.visuals, ...doc.sounds]
    .filter((c) => selected.includes(c.id))
    .map((c) => [c.start, c.start + c.duration] as const)
    .sort((a, b) => a[0] - b[0])
  const merged: number[][] = []
  for (const span of spans) {
    const last = merged.at(-1)
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1])
    else merged.push([...span])
  }
  // Ripple only removes intervals which have no remaining picture/sound. Overlays remain intact.
  const remain = [...doc.visuals, ...doc.sounds].filter((c) => !selected.includes(c.id))
  const gaps = merged.filter(
    ([a, b]) => !remain.some((c) => c.start < b && c.start + c.duration > a)
  )
  const shift = (time: number) =>
    ripple ? gaps.reduce((sum, [a, b]) => sum + (time >= b ? b - a : 0), 0) : 0
  const filter = (list: VideoClip[], lane: Lane) =>
    list
      .filter((c) => !selected.includes(c.id))
      .map((c) =>
        clipLocked(doc, c, lane) ? c : { ...c, start: rounded(c.start - shift(c.start)) }
      )
  return {
    ...doc,
    visuals: filter(doc.visuals, 'visual'),
    sounds: filter(doc.sounds, 'sound'),
    captions: doc.captions.map((c) => ({ ...c, start: rounded(c.start - shift(c.start)) })),
    markers: doc.markers.map((m) => ({ ...m, time: rounded(m.time - shift(m.time)) }))
  }
}
export function closeGaps(doc: VideoTimelineDocument) {
  // Close only global empty gaps: tracks and linked picture/sound keep their relative timing.
  const spans = [...doc.visuals, ...doc.sounds]
    .map((c) => [c.start, c.start + c.duration])
    .sort((a, b) => a[0] - b[0])
  let end = 0
  const gaps: number[][] = []
  for (const [a, b] of spans) {
    if (a > end) gaps.push([end, a])
    end = Math.max(end, b)
  }
  if (doc.tracks.some((t) => t.locked)) return doc
  const shift = (v: number) => gaps.reduce((sum, [a, b]) => sum + (v >= b ? b - a : 0), 0)
  return {
    ...mapClips(doc, (c) => ({ ...c, start: rounded(c.start - shift(c.start)) })),
    captions: doc.captions.map((c) => ({ ...c, start: rounded(c.start - shift(c.start)) })),
    markers: doc.markers.map((m) => ({ ...m, time: rounded(m.time - shift(m.time)) }))
  }
}
export interface VideoClipboard {
  visuals: VideoClip[]
  sounds: VideoClip[]
}
export function copyClips(doc: VideoTimelineDocument, ids: readonly string[]): VideoClipboard {
  const chosen = linkedSelection(doc, ids)
  return structuredClone({
    visuals: doc.visuals
      .filter((c) => chosen.includes(c.id))
      .map((c) => ({ ...c, trackId: trackIdFor(c, 'visual') })),
    sounds: doc.sounds
      .filter((c) => chosen.includes(c.id))
      .map((c) => ({ ...c, trackId: trackIdFor(c, 'sound') }))
  })
}
export function pasteClips(doc: VideoTimelineDocument, copy: VideoClipboard, at: number) {
  const all = [...copy.visuals, ...copy.sounds]
  if (!all.length) return doc
  const origin = Math.min(...all.map((c) => c.start)),
    links = new Map<string, string>()
  const clone = (c: VideoClip) => {
    if (c.linkId && !links.has(c.linkId)) links.set(c.linkId, crypto.randomUUID())
    return {
      ...structuredClone(c),
      id: crypto.randomUUID(),
      linkId: c.linkId ? links.get(c.linkId) : undefined,
      start: rounded(Math.max(0, at) + c.start - origin)
    }
  }
  if (
    all.some((c) => doc.tracks.find((t) => t.id === c.trackId)?.locked) ||
    at + Math.max(...all.map((c) => c.start + c.duration)) - origin > 21600
  )
    return doc
  return {
    ...doc,
    visuals: [...doc.visuals, ...copy.visuals.map(clone)],
    sounds: [...doc.sounds, ...copy.sounds.map(clone)]
  }
}
export function addClips(
  doc: VideoTimelineDocument,
  incoming: VideoClipboard,
  mode: 'overlay' | 'insert' | 'overwrite'
) {
  const all = [...incoming.visuals, ...incoming.sounds]
  if (!all.length) return doc
  const a = Math.min(...all.map((c) => c.start)),
    b = Math.max(...all.map((c) => c.start + c.duration)),
    tracks = new Set(all.map((c) => c.trackId))
  const tailLinks = new Map<string, string>()
  const tail = (clip: VideoClip, from: number) => {
    if (clip.linkId && !tailLinks.has(clip.linkId)) tailLinks.set(clip.linkId, crypto.randomUUID())
    return {
      ...sliceClip(clip, from, clip.duration, crypto.randomUUID()),
      linkId: clip.linkId ? tailLinks.get(clip.linkId) : undefined
    }
  }
  if (doc.tracks.some((t) => t.locked && (mode === 'insert' || tracks.has(t.id)))) return doc
  const cut = (clip: VideoClip): VideoClip[] => {
    if (mode === 'overlay') return [clip]
    if (mode === 'insert') {
      if (clip.start >= a) return [{ ...clip, start: rounded(clip.start + b - a) }]
      if (clip.start + clip.duration > a)
        return [sliceClip(clip, 0, a - clip.start), { ...tail(clip, a - clip.start), start: b }]
      return [clip]
    }
    if (!tracks.has(clip.trackId) || clip.start >= b || clip.start + clip.duration <= a)
      return [clip]
    const out = []
    if (clip.start < a) out.push(sliceClip(clip, 0, a - clip.start))
    if (clip.start + clip.duration > b) out.push(tail(clip, b - clip.start))
    return out
  }
  const normalize = (c: VideoClip, lane: Lane) => ({ ...c, trackId: trackIdFor(c, lane) })
  return {
    ...doc,
    visuals: [...doc.visuals.flatMap((c) => cut(normalize(c, 'visual'))), ...incoming.visuals],
    sounds: [...doc.sounds.flatMap((c) => cut(normalize(c, 'sound'))), ...incoming.sounds],
    captions:
      mode === 'insert'
        ? doc.captions.map((c) => (c.start >= a ? { ...c, start: rounded(c.start + b - a) } : c))
        : doc.captions,
    markers:
      mode === 'insert'
        ? doc.markers.map((m) => (m.time >= a ? { ...m, time: rounded(m.time + b - a) } : m))
        : doc.markers
  }
}

export function transitionPrevious(doc: VideoTimelineDocument, clip: VideoClip) {
  const referenced =
    clip.transitionIn &&
    doc.visuals.find(
      (c) =>
        c.id === clip.transitionIn?.previousId &&
        trackIdFor(c, 'visual') === trackIdFor(clip, 'visual')
    )
  return (
    referenced ||
    doc.visuals
      .filter(
        (c) =>
          c.id !== clip.id &&
          trackIdFor(c, 'visual') === trackIdFor(clip, 'visual') &&
          c.start < clip.start
      )
      .sort((a, b) => a.start - b.start)
      .at(-1)
  )
}
export function setVideoTransition(
  doc: VideoTimelineDocument,
  id: string,
  seconds: number,
  easing: VideoEasing = 'linear'
): { document: VideoTimelineDocument; error?: string } {
  const clip = doc.visuals.find((c) => c.id === id)
  if (!clip) return { document: doc, error: '片段不存在' }
  if (seconds === 0 && !clip.transitionIn) return { document: doc }
  const previous = transitionPrevious(doc, clip)
  if (!previous) return { document: doc, error: '同一画面轨需要有前一片段' }
  if (linkedSelection(doc, [clip.id]).includes(previous.id))
    return { document: doc, error: '前后片段属于同一关联组，请先解除关联' }
  const involved = linkedSelection(doc, [clip.id, previous.id])
  if (
    [...doc.visuals, ...doc.sounds].some(
      (c) =>
        involved.includes(c.id) &&
        clipLocked(doc, c, c.kind === 'audio' || doc.sounds.includes(c) ? 'sound' : 'visual')
    )
  )
    return { document: doc, error: '转场涉及的画面或关联声音轨已锁定' }
  if (!Number.isFinite(seconds) || seconds < 0 || !videoEasings.includes(easing))
    return { document: doc, error: '转场参数无效' }
  const duration = Math.min(seconds, 30, clip.duration, previous.duration)
  const from = previous.start + previous.duration - duration,
    to = previous.start + previous.duration
  if (
    duration &&
    doc.visuals.some(
      (c) =>
        c.id !== clip.id &&
        c.id !== previous.id &&
        trackIdFor(c, 'visual') === trackIdFor(clip, 'visual') &&
        c.start < to &&
        c.start + c.duration > from
    )
  )
    return { document: doc, error: '转场范围内还有其他片段，请先调整位置' }
  const moved = moveClips(doc, [id], previous.start + previous.duration - duration - clip.start)
  const current = moved.visuals.find((c) => c.id === id)
  if (!current || Math.abs(current.start - from) > 0.000001)
    return { document: doc, error: '无法移动转场及关联声音，时间线边界超出范围' }
  return {
    document: {
      ...moved,
      visuals: moved.visuals.map((c) =>
        c.id === id
          ? {
              ...c,
              transitionIn: duration ? { previousId: previous.id, duration, easing } : undefined
            }
          : c
      )
    }
  }
}
export function dissolveClip(doc: VideoTimelineDocument, id: string, seconds = 0.5) {
  return setVideoTransition(doc, id, seconds).document
}
