import {
  defaultAudioProcessing,
  rebaseGainPoints,
  validAudioProcessing,
  validGainPoints,
  type AudioProcessing,
  type GainPoint
} from './audioProcessing.ts'
import {
  setClipFades,
  visibleClipFades,
  type AudioClip,
  type AudioTrack,
  type AudioTimelineDocument
} from './audioTimeline.ts'
export type AudioProperties =
  | {
      kind: 'clip'
      gain: number
      pan: number
      fadeIn: number
      fadeOut: number
      fadeCurve: NonNullable<AudioClip['fadeCurve']>
      channels: NonNullable<AudioClip['channels']>
      invertPhase: boolean
      points: GainPoint[]
    }
  | {
      kind: 'track'
      gain: number
      pan: number
      role: NonNullable<AudioTrack['role']>
      duck: boolean
      processing: AudioProcessing
    }
  | { kind: 'master'; gain: number; processing: AudioProcessing }
export type AudioPropertyPreset = { id: string; name: string; properties: AudioProperties }
export const audioPresetsKey = (workspaceId: string) =>
  `omnigallery:editor-presets-v1:${workspaceId}:audio`
export function captureClipProperties(clip: AudioClip): AudioProperties {
  return {
    kind: 'clip',
    gain: clip.gain,
    pan: clip.pan ?? 0,
    ...visibleClipFades(clip),
    fadeCurve: clip.fadeCurve ?? 'linear',
    channels: clip.channels ?? 'stereo',
    invertPhase: clip.invertPhase ?? false,
    points: (rebaseGainPoints(clip.gainPoints, clip.envelopeOffset, clip.duration) ?? []).map(
      (point) => ({ ...point, time: point.time / clip.duration })
    )
  }
}
export function captureTrackProperties(track: AudioTrack): AudioProperties {
  return {
    kind: 'track',
    gain: track.gain,
    pan: track.pan ?? 0,
    role: track.role ?? 'sound',
    duck: track.duck ?? false,
    processing: { ...defaultAudioProcessing, ...track.processing }
  }
}
export function captureMasterProperties(document: AudioTimelineDocument): AudioProperties {
  return {
    kind: 'master',
    gain: document.masterGain,
    processing: { ...defaultAudioProcessing, ...document.processing }
  }
}
export function validAudioProperties(value: unknown): value is AudioProperties {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const data = value as AudioProperties
  const allowed =
    data.kind === 'clip'
      ? [
          'kind',
          'gain',
          'pan',
          'fadeIn',
          'fadeOut',
          'fadeCurve',
          'channels',
          'invertPhase',
          'points'
        ]
      : data.kind === 'track'
        ? ['kind', 'gain', 'pan', 'role', 'duck', 'processing']
        : ['kind', 'gain', 'processing']
  if (Object.keys(data).some((key) => !allowed.includes(key))) return false
  const finite = (value: unknown, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
  if (!finite(data.gain, 0, data.kind === 'master' ? 2 : 4)) return false
  if (data.kind === 'master') return !!data.processing && validAudioProcessing(data.processing)
  if (!finite(data.pan, -1, 1)) return false
  if (data.kind === 'track')
    return (
      ['sound', 'dialogue', 'music'].includes(data.role) &&
      typeof data.duck === 'boolean' &&
      !!data.processing &&
      validAudioProcessing(data.processing)
    )
  if (data.kind !== 'clip') return false
  return (
    finite(data.fadeIn, 0, 86400) &&
    finite(data.fadeOut, 0, 86400) &&
    ['linear', 'smooth', 'equalPower'].includes(data.fadeCurve) &&
    ['stereo', 'swap', 'mono', 'left', 'right'].includes(data.channels) &&
    typeof data.invertPhase === 'boolean' &&
    Array.isArray(data.points) &&
    validGainPoints(data.points, 1) &&
    data.points.every(
      (point) =>
        point.time <= 1 && Object.keys(point).every((key) => ['time', 'gain'].includes(key))
    )
  )
}
export function applyAudioProperties(
  document: AudioTimelineDocument,
  properties: AudioProperties,
  ids: string[]
): AudioTimelineDocument {
  if (!validAudioProperties(properties)) throw new Error('声音预设数据无效')
  if (properties.kind === 'master')
    return {
      ...document,
      masterGain: properties.gain,
      processing: structuredClone(properties.processing)
    }
  if (!ids.length) throw new Error('请先选择片段或音轨')
  const targets = document.tracks.filter((track) =>
    properties.kind === 'track'
      ? ids.includes(track.id)
      : track.clips.some((clip) => ids.includes(clip.id))
  )
  if (!targets.length) throw new Error('没有匹配的选中对象')
  if (targets.some((track) => track.locked)) throw new Error('请先解锁所有目标音轨')
  return {
    ...document,
    tracks: document.tracks.map((track) => {
      if (properties.kind === 'track')
        return ids.includes(track.id)
          ? {
              ...track,
              gain: properties.gain,
              pan: properties.pan,
              role: properties.role,
              duck: properties.duck,
              processing: structuredClone(properties.processing)
            }
          : track
      return {
        ...track,
        clips: track.clips.map((clip) =>
          ids.includes(clip.id)
            ? {
                ...setClipFades(clip, properties.fadeIn, properties.fadeOut),
                gain: properties.gain,
                pan: properties.pan,
                fadeCurve: properties.fadeCurve,
                channels: properties.channels,
                invertPhase: properties.invertPhase,
                gainPoints: properties.points.map((point) => ({
                  ...point,
                  time: point.time * clip.duration
                }))
              }
            : clip
        )
      }
    })
  }
}
export function readAudioPresets(raw: string | null): AudioPropertyPreset[] {
  if (!raw) return []
  if (new TextEncoder().encode(raw).byteLength > 256 * 1024) throw new Error('声音预设容量过大')
  const list = JSON.parse(raw)
  if (
    !Array.isArray(list) ||
    list.length > 30 ||
    new Set(list.map((entry) => entry?.id)).size !== list.length ||
    list.some(
      (entry) =>
        !entry ||
        typeof entry !== 'object' ||
        Array.isArray(entry) ||
        Object.keys(entry).some((key) => !['id', 'name', 'properties'].includes(key)) ||
        typeof entry.id !== 'string' ||
        !entry.id ||
        entry.id.length > 128 ||
        typeof entry.name !== 'string' ||
        !entry.name.trim() ||
        entry.name.length > 80 ||
        !validAudioProperties(entry.properties)
    )
  )
    throw new Error('声音预设无法读取，原始数据已保留')
  return list
}
