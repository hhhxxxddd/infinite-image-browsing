import type { WorkspaceAsset } from '../../../src/features/workspaces/model/workspaceModel'
import type { SourceMetadata } from './sourceRange'
import { sourceAudioStreamError } from './sourceAudioStreams.ts'

export interface SourceRelinkClip {
  id: string
  sourceIn: number
  duration: number
  rate?: number
  freeze?: boolean
  requiresAudio?: boolean
  requiresVideo?: boolean
  audioStream?: number
}
export interface SourceRelinkSource {
  path: string
  name: string
  kind: WorkspaceAsset['kind']
  clips: SourceRelinkClip[]
}
export interface SourceRelinkSelection {
  source: SourceRelinkSource
  replacement: WorkspaceAsset
  sourceDuration: number
  metadata?: SourceMetadata
}

export function sourceRelinkCompatible(source: SourceRelinkSource, replacement: WorkspaceAsset) {
  // Image clips and video clips have different timing semantics; don't convert them implicitly.
  if (source.kind === 'image') return replacement.kind === 'image'
  const video =
    source.clips.some((clip) => clip.requiresVideo) ||
    (source.kind === 'video' &&
      !source.clips.every((clip) => clip.requiresAudio && clip.requiresVideo === false))
  return video
    ? replacement.kind === 'video'
    : replacement.kind === 'audio' || replacement.kind === 'video'
}

export function sourceRelinkError(
  source: SourceRelinkSource,
  replacement: WorkspaceAsset,
  metadata: SourceMetadata
) {
  if (!source.clips.length) return '没有需要重新指定的片段'
  if (!sourceRelinkCompatible(source, replacement)) return '素材类型与片段不匹配'
  if (source.kind === 'image')
    return metadata.width > 0 && metadata.height > 0 ? '' : '替换图片尺寸未知'
  if (!Number.isFinite(metadata.duration) || metadata.duration <= 0) return '替换素材时长未知'
  const needsAudio = source.kind === 'audio' || source.clips.some((clip) => clip.requiresAudio)
  if (needsAudio && !metadata.hasAudio) return '替换素材没有可用的声音轨道'
  if (source.clips.some((clip) => clip.requiresVideo) && !metadata.hasVideo)
    return '替换素材没有可用的视频画面'
  for (const clip of source.clips) {
    if (source.kind === 'audio' || clip.requiresAudio) {
      const streamError = sourceAudioStreamError(
        metadata.audioStreams,
        clip.audioStream ?? 0,
        clip.sourceIn,
        clip.freeze ? 1e-6 : clip.duration,
        clip.freeze ? 1 : (clip.rate ?? 1)
      )
      if (streamError) return streamError
    }
    const rate = clip.rate ?? 1
    if (
      ![clip.sourceIn, clip.duration, rate].every(Number.isFinite) ||
      clip.sourceIn < 0 ||
      clip.duration <= 0 ||
      rate <= 0
    )
      return '现有片段的源区间无效，请先检查片段'
    if (
      clip.freeze
        ? clip.sourceIn >= metadata.duration
        : clip.sourceIn + clip.duration * rate > metadata.duration + 1e-6
    )
      return '替换素材过短，无法保留全部片段的源区间'
  }
  return ''
}

export function sourceRelinkSelection(
  source: SourceRelinkSource,
  replacement: WorkspaceAsset,
  metadata: SourceMetadata
): SourceRelinkSelection {
  const error = sourceRelinkError(source, replacement, metadata)
  if (error) throw new Error(error)
  return { source, replacement, sourceDuration: metadata.duration, metadata }
}

/** Only the source reference changes. Timeline positions, styles and envelopes stay intact. */
export function applySourceRelink<
  T extends { id?: string; path: string; name: string; sourceDuration?: number }
>(clip: T, selection: SourceRelinkSelection): T {
  if (clip.path !== selection.source.path) return clip
  const reference = selection.source.clips.find((item) => item.id === clip.id)
  const audioDuration =
    reference && (reference.requiresAudio || selection.source.kind === 'audio')
      ? selection.metadata?.audioStreams?.find(
          (stream) => stream.ordinal === (reference.audioStream ?? 0)
        )?.duration
      : undefined
  return {
    ...clip,
    path: selection.replacement.path,
    name: selection.replacement.name,
    ...('sourceDuration' in clip && selection.replacement.kind !== 'image'
      ? { sourceDuration: audioDuration ?? selection.sourceDuration }
      : {}),
    ...('kind' in clip
      ? { kind: selection.replacement.kind }
      : selection.replacement.kind !== 'image'
        ? { sourceKind: selection.replacement.kind }
        : {})
  }
}
