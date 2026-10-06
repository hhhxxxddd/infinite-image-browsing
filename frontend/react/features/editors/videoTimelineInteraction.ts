import {
  bounded,
  clipLocked,
  clipTrack,
  linkedSelection,
  mapClips,
  rounded,
  type Caption,
  type Lane,
  type VideoClip,
  type VideoTimelineDocument
} from './videoStudioModel.ts'
import { linkedVideoTiming } from './videoLinks.ts'

export function videoFrameTime(value: number, fps: number, min = 0, max = 21600) {
  return rounded(bounded(Math.round(value * fps) / fps, min, max))
}

/** Keep the opposite edge fixed; imported sub-frame cues must not grow when clamped. */
export function trimVideoCaption(cue: Caption, edge: 'left' | 'right', time: number, fps: number) {
  const minimum = Math.min(cue.duration, 1 / fps)
  const end = cue.start + cue.duration
  if (edge === 'left') {
    const start = videoFrameTime(time, fps, 0, end - minimum)
    return { ...cue, start, duration: rounded(end - start) }
  }
  return {
    ...cue,
    duration: rounded(bounded(videoFrameTime(time, fps) - cue.start, minimum, 21600 - cue.start))
  }
}

export function commitVideoTimingInput(
  draft: string | number,
  current: number,
  apply: (value: number) => number,
  cancelled = false
) {
  if (cancelled) return current
  const value = draft === '' ? NaN : Number(draft)
  return Number.isFinite(value) && value !== current ? apply(value) : current
}

export function videoTimingLockReason(doc: VideoTimelineDocument, clip: VideoClip, lane: Lane) {
  const own = clipTrack(doc, clip, lane)
  if (own?.locked) return `“${own.name || own.id}”已锁定，请先解锁轨道。`
  const linked = new Set(linkedSelection(doc, [clip.id]))
  const tracks = [
    ...doc.visuals.filter((c) => linked.has(c.id)).map((c) => clipTrack(doc, c, 'visual')),
    ...doc.sounds.filter((c) => linked.has(c.id)).map((c) => clipTrack(doc, c, 'sound'))
  ].flatMap((track) => (track?.locked ? [track] : []))
  return tracks.length
    ? `关联轨道“${[...new Set(tracks.map((track) => track.name || track.id))].join('、')}”已锁定，请先解锁后调整时间。`
    : ''
}

/** Numeric edits return the accepted clip so a rejected/clamped value cannot remain in the field. */
export function editVideoClip(
  doc: VideoTimelineDocument,
  id: string,
  lane: Lane,
  transform: (clip: VideoClip) => VideoClip
) {
  const original = doc[lane === 'visual' ? 'visuals' : 'sounds'].find((clip) => clip.id === id)
  if (!original) return { document: doc, clip: undefined, error: '' }
  if (clipLocked(doc, original, lane))
    return { document: doc, clip: original, error: videoTimingLockReason(doc, original, lane) }
  const transformed = transform(original)
  if (transformed === original || JSON.stringify(transformed) === JSON.stringify(original))
    return { document: doc, clip: original, error: '' }
  const timingKeys = ['start', 'sourceIn', 'duration', 'rate', 'reverse', 'freeze'] as const
  const timing = Object.fromEntries(
    timingKeys
      .filter((key) => transformed[key] !== original[key])
      .map((key) => [key, transformed[key]])
  )
  const lock = Object.keys(timing).length ? videoTimingLockReason(doc, original, lane) : ''
  if (lock) return { document: doc, clip: original, error: lock }
  const normalize = (clip: VideoClip, before: VideoClip) => {
    const scale = before.rate / clip.rate
    const envelope =
      scale === 1
        ? clip
        : {
            ...clip,
            envelopeOffset: (before.envelopeOffset ?? 0) * scale,
            envelopeDuration: (before.envelopeDuration ?? before.duration) * scale,
            gainPoints: before.gainPoints?.map((point) => ({ ...point, time: point.time * scale })),
            fadeIn: (before.fadeIn ?? 0) * scale,
            fadeOut: (before.fadeOut ?? 0) * scale
          }
    const normalized = {
      ...envelope,
      fadeIn: Math.min(envelope.fadeIn ?? 0, envelope.envelopeDuration ?? envelope.duration),
      fadeOut: Math.min(envelope.fadeOut ?? 0, envelope.envelopeDuration ?? envelope.duration),
      keyframes: envelope.keyframes?.filter((frame) => frame.time <= envelope.duration)
    }
    return JSON.stringify(normalized) === JSON.stringify(before) ? before : normalized
  }
  const next = mapClips(doc, (clip) =>
    clip.id === id
      ? normalize(transformed, clip)
      : Object.keys(timing).length && clip.linkId && clip.linkId === original.linkId
        ? normalize(linkedVideoTiming(original, transformed, clip), clip)
        : clip
  )
  if (
    next.visuals.every((clip, index) => clip === doc.visuals[index]) &&
    next.sounds.every((clip, index) => clip === doc.sounds[index])
  )
    return { document: doc, clip: original, error: '' }
  const edited = [...next.visuals, ...next.sounds].filter(
    (clip) => clip.id === id || (clip.linkId && clip.linkId === original.linkId)
  )
  const error = edited.some(
    (clip) =>
      ![clip.start, clip.duration, clip.sourceIn, clip.rate].every(Number.isFinite) ||
      clip.start < 0 ||
      clip.duration <= 0 ||
      clip.sourceIn < 0 ||
      clip.rate < 0.25 ||
      clip.rate > 4
  )
    ? '调整后关联片段的时间、源范围或速度无效'
    : edited.some((clip) => clip.reverse && clip.duration > 30)
      ? '倒放片段最长为 30 秒'
      : edited.some((clip) => clip.start + clip.duration > 21600)
        ? '片段不能超出 6 小时时间线'
        : edited.some(
              (clip) =>
                clip.kind !== 'image' &&
                (clip.freeze
                  ? clip.sourceIn >= clip.sourceDuration
                  : clip.sourceIn + clip.duration * clip.rate > clip.sourceDuration + 0.000001)
            )
          ? '调整范围超出关联素材时长'
          : ''
  if (error) return { document: doc, clip: original, error }
  return {
    document: next,
    clip: next[lane === 'visual' ? 'visuals' : 'sounds'].find((c) => c.id === id),
    error: ''
  }
}

/** A pointer gesture uses a fixed document, so its excluded anchors can be prepared once. */
export function videoSnapPoints(
  doc: VideoTimelineDocument,
  playhead: number,
  exceptIds: readonly string[] = []
) {
  const excluded = new Set(linkedSelection(doc, exceptIds))
  return [
    0,
    playhead,
    ...doc.markers.filter((marker) => !exceptIds.includes(marker.id)).map((marker) => marker.time),
    ...[...doc.visuals, ...doc.sounds, ...doc.captions]
      .filter((clip) => !excluded.has(clip.id))
      .flatMap((clip) => [clip.start, clip.start + clip.duration])
  ]
}

export function snapVideoTime(
  value: number,
  doc: VideoTimelineDocument,
  options: {
    pixelsPerSecond: number
    playhead: number
    enabled: boolean
    exceptIds?: string[]
    offsets?: number[]
    points?: readonly number[]
  }
) {
  const aligned = videoFrameTime(value, doc.fps)
  if (!options.enabled) return aligned
  const points = options.points ?? videoSnapPoints(doc, options.playhead, options.exceptIds)
  const tolerance = 8 / Math.max(0.03125, options.pixelsPerSecond)
  let best = aligned,
    distance = tolerance + 1e-8
  for (const offset of options.offsets ?? [0])
    for (const point of points) {
      const candidate = videoFrameTime(point - offset, doc.fps)
      const difference = Math.abs(candidate - aligned)
      if (difference <= tolerance && difference < distance) {
        best = candidate
        distance = difference
      }
    }
  return best
}

export function fitVideoTimeline(
  start: number,
  end: number,
  viewportWidth: number,
  maxZoom = 4096
) {
  const width = Math.max(80, viewportWidth)
  const span = Math.max(1 / 60, end - start)
  const zoom = bounded((width - 32) / (span * 1.1), 0.03125, maxZoom)
  return { zoom, left: Math.max(0, start * zoom - 16 - span * zoom * 0.05) }
}

export function videoContentScrollLimit(
  end: number,
  pixelsPerSecond: number,
  viewportWidth: number
) {
  return Math.max(0, end * pixelsPerSecond + 32 - Math.max(0, viewportWidth))
}

export function videoClipGeometry(duration: number, pixelsPerSecond: number) {
  const width = Math.max(0, duration * pixelsPerSecond)
  return { width, compact: width < 32 }
}

export function videoSpaceControlsPlayback(target: {
  typing: boolean
  timelineItem: boolean
  interactive: boolean
}) {
  return !target.typing && (target.timelineItem || !target.interactive)
}
