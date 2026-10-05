import type { WorkspaceAsset } from '../../../src/features/workspaces/model/workspaceModel'
import {
  readSourceAudioStreams,
  sourceAudioStreamError,
  type SourceAudioStream
} from './sourceAudioStreams.ts'

export type SourceAddMode = 'default' | 'visual' | 'sound'
export type SourcePlacementMode = 'overlay' | 'insert' | 'overwrite'
export interface SourceRange {
  start: number
  end: number
}
export interface SourceMetadata {
  duration: number
  hasAudio: boolean
  hasVideo: boolean
  width: number
  height: number
  fps: number
  fingerprint: string
  audioStreams?: SourceAudioStream[]
}
export interface SourceRangeSelection {
  asset: WorkspaceAsset
  sourceIn: number
  duration: number
  sourceDuration: number
  mode: SourceAddMode
  placementMode?: SourcePlacementMode
  audioStream?: number
  /** Selected audio stream's usable end on the original source timeline. */
  audioSourceDuration?: number
}

/** Metadata is fetched without downloading or decoding the entire source in the browser. */
export function sourceMetadata(raw: unknown, kind: WorkspaceAsset['kind']): SourceMetadata {
  if (!raw || typeof raw !== 'object') throw new Error('无法读取素材信息')
  const info = raw as Record<string, unknown>
  const number = (key: string) =>
    typeof info[key] === 'number' && Number.isFinite(info[key]) ? (info[key] as number) : 0
  const duration = number('duration'),
    width = number('width'),
    height = number('height')
  if (kind === 'image' ? width <= 0 || height <= 0 : duration <= 0)
    throw new Error('素材时长或尺寸未知，无法继续')
  if (kind === 'video' && (width <= 0 || height <= 0)) throw new Error('未找到可用的视频画面')
  return {
    duration,
    width,
    height,
    fps: number('fps'),
    hasAudio: info.has_audio === true,
    hasVideo: kind === 'video' || kind === 'image',
    fingerprint: typeof info.fingerprint === 'string' ? info.fingerprint : '',
    audioStreams: readSourceAudioStreams(info.audio_streams, duration, info.has_audio === true)
  }
}

export function initialSourceRange(duration: number, maximum = 21600): SourceRange {
  return { start: 0, end: Math.max(0, Math.min(duration, maximum)) }
}

/** Only initialize against the selected streams; later range edits remain strictly validated. */
export function initialSourceRangeForMode(
  metadata: SourceMetadata,
  mode: SourceAddMode,
  maximum = 21600,
  audioStream = 0
): SourceRange {
  const stream =
    mode !== 'visual' && metadata.hasAudio
      ? metadata.audioStreams?.find((item) => item.ordinal === audioStream)
      : undefined
  return initialSourceRange(
    stream ? Math.min(metadata.duration, stream.duration) : metadata.duration,
    maximum
  )
}

export function sourceRangeError(range: SourceRange, duration: number, maximum = 21600) {
  if (!Number.isFinite(duration) || duration <= 0) return '素材时长未知'
  if (![range.start, range.end, maximum].every(Number.isFinite) || maximum <= 0)
    return '选段范围无效'
  if (range.start < 0 || range.end > duration) return '选段超出素材时长'
  if (range.end - range.start < 0.001) return '出点需晚于入点'
  if (range.end - range.start > maximum + 1e-6) return '所选片段超过可添加时长，请缩短选段'
  return ''
}

export function sourceModeError(
  asset: WorkspaceAsset,
  metadata: SourceMetadata,
  mode: SourceAddMode
) {
  if (asset.kind === 'image') return '图片无需选段'
  if ((mode === 'sound' || asset.kind === 'audio') && !metadata.hasAudio)
    return '素材没有可用的声音轨道'
  if (mode === 'visual' && !metadata.hasVideo) return '素材没有可用的视频画面'
  return ''
}

/** Moving an endpoint past its partner keeps a usable interval instead of silently clearing it. */
export function setSourceRangeEndpoint(
  range: SourceRange,
  endpoint: 'start' | 'end',
  value: number,
  duration: number
) {
  if (!Number.isFinite(value) || value < 0 || value > duration) return undefined
  const length = Math.max(0.001, range.end - range.start)
  const next =
    endpoint === 'start'
      ? { start: value, end: value < range.end ? range.end : Math.min(duration, value + length) }
      : { start: value > range.start ? range.start : Math.max(0, value - length), end: value }
  return next.end - next.start >= 0.001 ? next : undefined
}

export function sourceRangeSelection(
  asset: WorkspaceAsset,
  metadata: SourceMetadata,
  range: SourceRange,
  mode: SourceAddMode,
  maximum = 21600,
  audioStream = 0
): SourceRangeSelection {
  const error =
    sourceRangeError(range, metadata.duration, maximum) ||
    sourceModeError(asset, metadata, mode) ||
    (mode !== 'visual' && metadata.hasAudio
      ? sourceAudioStreamError(
          metadata.audioStreams,
          audioStream,
          range.start,
          range.end - range.start
        )
      : '')
  if (error) throw new Error(error)
  return {
    asset,
    sourceIn: range.start,
    duration: range.end - range.start,
    sourceDuration: metadata.duration,
    mode,
    ...(mode !== 'visual' && metadata.hasAudio
      ? {
          audioStream,
          audioSourceDuration:
            metadata.audioStreams?.find((stream) => stream.ordinal === audioStream)?.duration ??
            metadata.duration
        }
      : {})
  }
}

/** API-relative URL; native media elements use byte-range requests, never fetch(...).blob(). */
export function sourceStreamPath(asset: WorkspaceAsset) {
  const artifact = asset.path.startsWith('workspace-artifact:') ? asset.path.slice(19) : ''
  return artifact
    ? `/workspace_artifacts/${encodeURIComponent(artifact)}/file`
    : `/stream_video?${new URLSearchParams({ path: asset.path })}`
}

export function sourceMetadataPath(workspaceId: string, asset: WorkspaceAsset) {
  return `/video_studio/media?${new URLSearchParams({ workspace_id: workspaceId, path: asset.path, kind: asset.kind })}`
}
