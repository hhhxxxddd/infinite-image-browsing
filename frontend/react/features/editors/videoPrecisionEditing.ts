import {
  clipLocked,
  rebaseVideoAnimation,
  linkedSelection,
  mapClips,
  rounded,
  trackIdFor,
  type Lane,
  type VideoClip,
  type VideoTimelineDocument
} from './videoStudioModel.ts'

const EPSILON = 1e-6
export interface VideoPrecisionResult {
  document: VideoTimelineDocument
  changedIds: string[]
  error: string
}
export interface VideoBoundary {
  leftId: string
  rightId: string
  time: number
  label: string
}
export interface VideoPrecisionPreview {
  document: VideoTimelineDocument
  start: number
  end: number
  version: 'before' | 'after'
}
const fail = (document: VideoTimelineDocument, error: string): VideoPrecisionResult => ({
  document,
  changedIds: [],
  error
})
const entries = (doc: VideoTimelineDocument) => [
  ...doc.visuals.map((clip) => ({ clip, lane: 'visual' as const })),
  ...doc.sounds.map((clip) => ({ clip, lane: 'sound' as const }))
]
const selected = (doc: VideoTimelineDocument, id: string, lane: Lane) =>
  doc[lane === 'visual' ? 'visuals' : 'sounds'].find((clip) => clip.id === id)
function sourceError(clip: VideoClip, fps: number) {
  if (
    ![clip.start, clip.duration, clip.sourceIn, clip.sourceDuration, clip.rate].every(
      Number.isFinite
    ) ||
    clip.start < 0 ||
    clip.duration < 1 / fps - EPSILON ||
    clip.rate <= 0 ||
    clip.sourceIn < -EPSILON ||
    clip.sourceDuration <= 0
  )
    return '片段或源范围无效'
  if (clip.start + clip.duration > 21600 + EPSILON) return '片段超出 6 小时时间线'
  if (clip.reverse && clip.duration > 30 + EPSILON) return '倒放片段最长为 30 秒'
  if (
    clip.kind !== 'image' &&
    (clip.freeze
      ? clip.sourceIn >= clip.sourceDuration
      : clip.sourceIn + clip.duration * clip.rate > clip.sourceDuration + EPSILON)
  )
    return `源素材余量不足：${clip.name}`
  if ((clip.keyframes?.length ?? 0) > 128) return '精剪后的关键帧超过 128 个，请先减少关键帧'
  return ''
}
function lockError(doc: VideoTimelineDocument, ids: Set<string>) {
  const locked = entries(doc).find(
    ({ clip, lane }) => ids.has(clip.id) && clipLocked(doc, clip, lane)
  )
  return locked ? '片段或关联轨道已锁定，请先解锁' : ''
}

/** Positive offsets reveal later playback content; reverse sources therefore move backwards. */
export function slipVideoClip(
  doc: VideoTimelineDocument,
  id: string,
  lane: Lane,
  offsetFrames: number
): VideoPrecisionResult {
  const anchor = selected(doc, id, lane)
  if (!anchor) return fail(doc, '请选择片段')
  if (!Number.isFinite(offsetFrames) || !Number.isInteger(offsetFrames))
    return fail(doc, '偏移需为整数帧')
  const ids = new Set(linkedSelection(doc, [id]))
  const locked = lockError(doc, ids)
  if (locked) return fail(doc, locked)
  if (anchor.kind === 'image') return fail(doc, '静态图片没有可滑移的源区间')
  if (!offsetFrames) return fail(doc, '')
  const replacements = new Map<string, VideoClip>()
  for (const { clip } of entries(doc).filter(({ clip }) => ids.has(clip.id))) {
    if (clip.kind === 'image') return fail(doc, '关联片段含静态图片，无法滑移')
    const delta = (offsetFrames / doc.fps) * (clip.freeze ? 1 : clip.rate * (clip.reverse ? -1 : 1))
    const sourceIn = rounded(clip.sourceIn + delta)
    const next = { ...clip, sourceIn }
    const error = sourceError(next, doc.fps)
    if (error) return fail(doc, error)
    replacements.set(clip.id, next)
  }
  return {
    document: mapClips(doc, (clip) => replacements.get(clip.id) ?? clip),
    changedIds: [...ids],
    error: ''
  }
}

export function adjacentVideoBoundaries(
  doc: VideoTimelineDocument,
  id: string,
  lane: Lane
): VideoBoundary[] {
  const anchor = selected(doc, id, lane)
  if (!anchor) return []
  const clips = doc[lane === 'visual' ? 'visuals' : 'sounds'].filter(
    (clip) => trackIdFor(clip, lane) === trackIdFor(anchor, lane)
  )
  const result: VideoBoundary[] = []
  for (const other of clips) {
    if (other.id === id) continue
    const [left, right] = other.start < anchor.start ? [other, anchor] : [anchor, other]
    if (Math.abs(left.start + left.duration - right.start) > EPSILON) continue
    result.push({
      leftId: left.id,
      rightId: right.id,
      time: right.start,
      label: `${left.name} → ${right.name}`
    })
  }
  return result.sort((a, b) => a.time - b.time)
}

/** Retained animation stays at the same timeline time; new handles hold the nearest edge value. */
function changeBounds(clip: VideoClip, start: number, end: number): VideoClip {
  const from = start - clip.start,
    to = end - clip.start,
    duration = rounded(end - start)
  const transitionOffset = Math.max(0, (clip.transitionIn?.offset ?? 0) + from)
  return {
    ...clip,
    start: rounded(start),
    duration,
    sourceIn: rounded(
      clip.sourceIn +
        (clip.kind === 'image' || clip.freeze
          ? 0
          : clip.reverse
            ? (clip.duration - to) * clip.rate
            : from * clip.rate)
    ),
    ...(clip.keyframes?.length ? rebaseVideoAnimation(clip, from, to, true) : {}),
    transitionIn:
      clip.transitionIn && transitionOffset < clip.transitionIn.duration
        ? { ...clip.transitionIn, offset: transitionOffset }
        : undefined,
    envelopeOffset: rounded((clip.envelopeOffset ?? 0) + from),
    envelopeDuration: clip.envelopeDuration ?? clip.duration
  }
}

/** Roll one shared cut. Neither clip's outside edge, nor any unrelated clip, moves. */
export function rollVideoBoundary(
  doc: VideoTimelineDocument,
  leftId: string,
  rightId: string,
  lane: Lane,
  boundarySeconds: number
): VideoPrecisionResult {
  const left = selected(doc, leftId, lane),
    right = selected(doc, rightId, lane)
  if (
    !left ||
    !right ||
    left.id === right.id ||
    trackIdFor(left, lane) !== trackIdFor(right, lane) ||
    Math.abs(left.start + left.duration - right.start) > EPSILON
  )
    return fail(doc, '请选择同一轨道上紧邻的两个片段')
  if (!Number.isFinite(boundarySeconds)) return fail(doc, '交界时间无效')
  const leftIds = new Set(linkedSelection(doc, [leftId])),
    rightIds = new Set(linkedSelection(doc, [rightId]))
  if ([...leftIds].some((id) => rightIds.has(id)))
    return fail(doc, '交界两侧属于同一关联组，无法滚动')
  const ids = new Set([...leftIds, ...rightIds])
  const locked = lockError(doc, ids)
  if (locked) return fail(doc, locked)
  const members = entries(doc).filter(({ clip }) => ids.has(clip.id))
  if (
    members.some(
      ({ clip }) =>
        Math.abs((leftIds.has(clip.id) ? clip.start + clip.duration : clip.start) - right.start) >
        EPSILON
    )
  )
    return fail(doc, '关联片段的交界不一致，请先对齐')
  if (Math.abs(boundarySeconds - right.start) < EPSILON) return fail(doc, '')
  const boundary = rounded(Math.round(boundarySeconds * doc.fps) / doc.fps)
  if (Math.abs(boundary - right.start) < EPSILON) return fail(doc, '')
  const replacements = new Map<string, VideoClip>()
  for (const { clip, lane: memberLane } of members) {
    const next = leftIds.has(clip.id)
      ? changeBounds(clip, clip.start, boundary)
      : changeBounds(clip, boundary, clip.start + clip.duration)
    const error = sourceError(next, doc.fps)
    if (error) return fail(doc, error)
    const beforeEnd = clip.start + clip.duration,
      nextEnd = next.start + next.duration
    const grows =
      next.start < clip.start - EPSILON
        ? { start: next.start, end: clip.start }
        : nextEnd > beforeEnd + EPSILON
          ? { start: beforeEnd, end: nextEnd }
          : null
    if (
      grows &&
      entries(doc).some(
        ({ clip: other, lane: otherLane }) =>
          !ids.has(other.id) &&
          otherLane === memberLane &&
          trackIdFor(other, otherLane) === trackIdFor(clip, memberLane) &&
          other.start < grows.end - EPSILON &&
          other.start + other.duration > grows.start + EPSILON
      )
    )
      return fail(doc, '滚动会覆盖同轨的其他片段')
    replacements.set(clip.id, next)
  }
  return {
    document: mapClips(doc, (clip) => replacements.get(clip.id) ?? clip),
    changedIds: [...ids],
    error: ''
  }
}

export function precisionPreviewRange(
  document: VideoTimelineDocument,
  center: number,
  version: 'before' | 'after',
  seconds = 1
): VideoPrecisionPreview {
  const end = Math.max(
    0,
    ...[...document.visuals, ...document.sounds].map((clip) => clip.start + clip.duration)
  )
  const radius = Math.min(3, Math.max(0.1, Number.isFinite(seconds) ? seconds : 1))
  return {
    document,
    start: Math.max(0, Math.min(end, center) - radius),
    end: Math.min(end, Math.max(0, center) + radius),
    version
  }
}
