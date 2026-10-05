import {
  clipLocked,
  linkedSelection,
  mapClips,
  rounded,
  type Lane,
  type VideoClip,
  type VideoTimelineDocument
} from './videoStudioModel.ts'

export interface VideoLinkResult {
  document: VideoTimelineDocument
  memberIds: string[]
  changedIds: string[]
  error: string
}
const entries = (document: VideoTimelineDocument) => [
  ...document.visuals.map((clip) => ({ clip, lane: 'visual' as const })),
  ...document.sounds.map((clip) => ({ clip, lane: 'sound' as const }))
]
const rejected = (document: VideoTimelineDocument, error: string): VideoLinkResult => ({
  document,
  memberIds: [],
  changedIds: [],
  error
})
export function videoLinkMembers(document: VideoTimelineDocument, ids: readonly string[]) {
  const selected = new Set(linkedSelection(document, ids))
  return entries(document).filter(({ clip }) => selected.has(clip.id))
}
function lockError(document: VideoTimelineDocument, ids: readonly string[], readonly = false) {
  if (readonly) return '当前制作文件为只读'
  return videoLinkMembers(document, ids).some(({ clip, lane }) => clipLocked(document, clip, lane))
    ? '所选或关联轨道已锁定，请先解锁'
    : ''
}

/** Merge whole existing groups. No existing member is silently detached. */
export function linkSelectedVideoClips(
  document: VideoTimelineDocument,
  ids: readonly string[],
  options: { readonly?: boolean; createId?: () => string } = {}
): VideoLinkResult {
  const members = videoLinkMembers(document, ids)
  const error = lockError(document, ids, options.readonly)
  if (error) return rejected(document, error)
  if (
    !members.some((item) => item.lane === 'visual') ||
    !members.some((item) => item.lane === 'sound')
  )
    return rejected(document, '请同时选择画面和声音片段')
  const memberIds = members.map(({ clip }) => clip.id)
  const links = new Set(members.map(({ clip }) => clip.linkId))
  if (links.size === 1 && members[0].clip.linkId)
    return { document, memberIds, changedIds: [], error: '' }
  const linkId = (options.createId ?? (() => crypto.randomUUID()))()
  if (!linkId || entries(document).some(({ clip }) => clip.linkId === linkId))
    return rejected(document, '关联编号已存在，请重试')
  const selected = new Set(memberIds)
  return {
    document: mapClips(document, (clip) => (selected.has(clip.id) ? { ...clip, linkId } : clip)),
    memberIds,
    changedIds: memberIds,
    error: ''
  }
}

export function unlinkVideoClips(
  document: VideoTimelineDocument,
  ids: readonly string[],
  readonly = false
): VideoLinkResult {
  const error = lockError(document, ids, readonly)
  if (error) return rejected(document, error)
  const members = videoLinkMembers(document, ids),
    memberIds = members.map(({ clip }) => clip.id)
  const changedIds = members.filter(({ clip }) => clip.linkId).map(({ clip }) => clip.id)
  if (!changedIds.length) return { document, memberIds, changedIds, error: '' }
  const selected = new Set(changedIds)
  return {
    document: mapClips(document, (clip) =>
      selected.has(clip.id) ? { ...clip, linkId: undefined } : clip
    ),
    memberIds,
    changedIds,
    error: ''
  }
}

/** Offset is sound.start - visual.start. Only the chosen side's linked members move. */
export function synchronizeVideoPair(
  document: VideoTimelineDocument,
  visualId: string,
  soundId: string,
  options: { move: Lane; offsetSeconds: number; readonly?: boolean }
): VideoLinkResult {
  const visual = document.visuals.find((clip) => clip.id === visualId)
  const sound = document.sounds.find((clip) => clip.id === soundId)
  if (!visual || !sound) return rejected(document, '请选择要同步的画面和声音')
  const error = lockError(document, [visualId, soundId], options.readonly)
  if (error) return rejected(document, error)
  if (!Number.isFinite(options.offsetSeconds) || !['visual', 'sound'].includes(options.move))
    return rejected(document, '请输入有效的同步偏移')
  const offset = rounded(Math.round(options.offsetSeconds * document.fps) / document.fps)
  const current = sound.start - visual.start
  const delta = rounded(options.move === 'sound' ? offset - current : current - offset)
  const movingAnchor = options.move === 'sound' ? sound.id : visual.id
  const members = videoLinkMembers(document, [movingAnchor]).filter(
    ({ lane }) => lane === options.move
  )
  const moving = new Set(members.map(({ clip }) => clip.id))
  const memberIds = videoLinkMembers(document, [visualId, soundId]).map(({ clip }) => clip.id)
  if (
    members.some(
      ({ clip }) =>
        rounded(clip.start + delta) < 0 || rounded(clip.start + delta) + clip.duration > 21600
    )
  )
    return rejected(document, '同步后会超出时间线范围，请调整偏移')
  if (!delta) return { document, memberIds, changedIds: [], error: '' }
  return {
    document: mapClips(document, (clip) =>
      moving.has(clip.id) ? { ...clip, start: rounded(clip.start + delta) } : clip
    ),
    memberIds,
    changedIds: [...moving],
    error: ''
  }
}

/** Apply a linked timing edit relatively, retaining independently chosen source and timeline offsets. */
export function linkedVideoTiming(
  original: VideoClip,
  transformed: VideoClip,
  partner: VideoClip
): VideoClip {
  const factor = transformed.rate / original.rate
  const duration = rounded(
    partner.duration / factor + transformed.duration - original.duration / factor
  )
  const rate = rounded(partner.rate * factor)
  // Compare playback-leading source edges using the old direction; toggling reverse reverses
  // the same source window instead of being misinterpreted as a slip to its opposite edge.
  const leading = (clip: VideoClip, reverse: boolean) =>
    clip.sourceIn + (reverse && !clip.freeze ? clip.duration * clip.rate : 0)
  const elapsed =
    original.kind === 'image'
      ? 0
      : original.freeze
        ? transformed.sourceIn - original.sourceIn
        : (leading({ ...transformed, freeze: original.freeze }, !!original.reverse) -
            leading(original, !!original.reverse)) /
          (original.rate * (original.reverse ? -1 : 1))
  const sourceIn =
    partner.kind === 'image'
      ? partner.sourceIn
      : partner.freeze
        ? rounded(partner.sourceIn + (original.freeze ? elapsed : 0))
        : rounded(
            leading(partner, !!partner.reverse) +
              elapsed * partner.rate * (partner.reverse ? -1 : 1) -
              (partner.reverse ? duration * rate : 0)
          )
  return {
    ...partner,
    start: rounded(partner.start + transformed.start - original.start),
    duration,
    sourceIn,
    rate,
    ...(transformed.reverse !== original.reverse ? { reverse: transformed.reverse } : {}),
    ...(transformed.freeze !== original.freeze ? { freeze: transformed.freeze } : {})
  }
}
