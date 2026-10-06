import { validateTextTracks, type TextTrack } from './textTimeline.ts'
import {
  automationGain,
  fadeGain,
  rebaseGainPoints,
  validAudioProcessing,
  validGainPoints,
  type AudioProcessing,
  type GainPoint,
  type FadeCurve
} from './audioProcessing.ts'

export interface AudioClip {
  id: string
  path: string
  name: string
  sourceKind?: 'audio' | 'video'
  /** Audio-only stream ordinal; omitted legacy values mean the first audio stream. */
  audioStream?: number
  rate?: number
  preservePitch?: boolean
  start: number
  sourceIn: number
  duration: number
  gain: number
  fadeIn: number
  fadeOut: number
  fadeCurve?: FadeCurve
  channels?: 'stereo' | 'swap' | 'mono' | 'left' | 'right'
  invertPhase?: boolean
  envelopeOffset: number
  envelopeDuration: number
  pan?: number
  gainPoints?: GainPoint[]
}
export interface AudioTrack {
  id: string
  name: string
  gain: number
  muted: boolean
  solo: boolean
  locked: boolean
  clips: AudioClip[]
  pan?: number
  role?: 'sound' | 'dialogue' | 'music'
  duck?: boolean
  processing?: Partial<AudioProcessing>
}
export interface AudioTimelineDocument {
  version: 1
  tracks: AudioTrack[]
  masterGain: number
  textTracks?: TextTrack[]
  markers?: AudioMarker[]
  groups?: string[][]
  processing?: Partial<AudioProcessing>
}
export interface AudioMarker {
  id: string
  name: string
  time: number
  note?: string
}
export const audioLimits = { markers: 256, minRate: 0.25, maxRate: 4 }
export const clipRate = (clip: AudioClip) => clip.rate ?? 1
export const audioTimelineKey = (workspaceId: string, draftId: string) =>
  `omnigallery:audio-timeline-v1:${workspaceId}:${draftId}`
export const sampleTime = (time: number) => Math.round(time * 48000) / 48000
export const cloneTimeline = (doc: AudioTimelineDocument): AudioTimelineDocument =>
  JSON.parse(JSON.stringify(doc))
export function createAudioTrack(name = '音轨'): AudioTrack {
  return {
    id: crypto.randomUUID(),
    name,
    gain: 1,
    muted: false,
    solo: false,
    locked: false,
    clips: []
  }
}
export function createAudioTimeline(): AudioTimelineDocument {
  return { version: 1, tracks: [createAudioTrack('声音 1')], masterGain: 1 }
}
export function createAudioClip(
  path: string,
  name: string,
  duration: number,
  start = 0,
  sourceKind: 'audio' | 'video' = 'audio'
): AudioClip {
  const length = sampleTime(duration)
  return {
    id: crypto.randomUUID(),
    path,
    name,
    sourceKind,
    duration: length,
    start: sampleTime(start),
    sourceIn: 0,
    gain: 1,
    fadeIn: 0,
    fadeOut: 0,
    envelopeOffset: 0,
    envelopeDuration: length
  }
}
export const timelineDuration = (doc: AudioTimelineDocument) =>
  Math.max(
    0,
    ...doc.tracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration)),
    ...(doc.textTracks ?? []).flatMap((track) => track.cues.map((cue) => cue.start + cue.duration))
  )
export function audibleTracks(doc: AudioTimelineDocument) {
  const solo = doc.tracks.some((track) => track.solo)
  return doc.tracks.filter((track) => !track.muted && (!solo || track.solo))
}
export function clipEnvelope(clip: AudioClip, localTime: number) {
  const time = clip.envelopeOffset + localTime
  return (
    clip.gain *
    automationGain(clip.gainPoints, time) *
    (clip.fadeIn ? fadeGain(time / clip.fadeIn, clip.fadeCurve) : 1) *
    (clip.fadeOut ? fadeGain((clip.envelopeDuration - time) / clip.fadeOut, clip.fadeCurve) : 1)
  )
}
/** Trims and splits preserve both source samples and the original gain envelope. */
export function trimClip(clip: AudioClip, left: number, right: number): AudioClip {
  const from = sampleTime(Math.max(0, Math.min(left, clip.duration - 1 / 48000)))
  const to = sampleTime(Math.max(from + 1 / 48000, Math.min(right, clip.duration)))
  return {
    ...clip,
    start: sampleTime(clip.start + from),
    sourceIn: sampleTime(clip.sourceIn + from * clipRate(clip)),
    duration: sampleTime(to - from),
    envelopeOffset: sampleTime(clip.envelopeOffset + from)
  }
}
/** Move a clip edge within the source, retaining trimmed audio and automation. */
export function resizeAudioClip(
  clip: AudioClip,
  edge: 'left' | 'right',
  at: number,
  sourceDuration?: number
): AudioClip {
  const sample = 1 / 48000
  const rate = clipRate(clip)
  if (edge === 'right') {
    const sourceEnd =
      typeof sourceDuration === 'number' && Number.isFinite(sourceDuration)
        ? Math.min(sourceDuration, 86400)
        : clip.sourceIn + clip.duration * rate
    const maximum = Math.max(
      sample,
      Math.floor(
        Math.min(
          (sourceEnd - clip.sourceIn) / rate,
          86400 - clip.start,
          86400 - clip.envelopeOffset
        ) * 48000
      ) / 48000
    )
    const duration = Math.max(sample, Math.min(maximum, sampleTime(at - clip.start)))
    if (duration === clip.duration) return clip
    return {
      ...clip,
      duration,
      envelopeDuration: Math.max(clip.envelopeDuration, sampleTime(clip.envelopeOffset + duration))
    }
  }
  const minimum =
    Math.ceil(
      Math.max(
        -clip.start,
        -clip.sourceIn / rate,
        clip.envelopeDuration - 86400 - clip.envelopeOffset
      ) * 48000
    ) / 48000
  const from = Math.max(
    minimum,
    Math.min(sampleTime(clip.duration - sample), sampleTime(at - clip.start))
  )
  if (!from) return clip
  const prepend = Math.max(0, -sampleTime(clip.envelopeOffset + from))
  return {
    ...clip,
    start: sampleTime(clip.start + from),
    sourceIn: sampleTime(clip.sourceIn + from * rate),
    duration: sampleTime(clip.duration - from),
    envelopeOffset: sampleTime(clip.envelopeOffset + from + prepend),
    envelopeDuration: sampleTime(clip.envelopeDuration + prepend),
    ...(prepend && clip.gainPoints
      ? {
          gainPoints: clip.gainPoints.map((point) => ({
            ...point,
            time: sampleTime(point.time + prepend)
          }))
        }
      : {})
  }
}
export function splitClip(clip: AudioClip, at: number): [AudioClip, AudioClip] | undefined {
  const local = sampleTime(at - clip.start)
  if (local <= 0 || local >= clip.duration) return
  return [
    trimClip(clip, 0, local),
    { ...trimClip(clip, local, clip.duration), id: crypto.randomUUID() }
  ]
}
export function setClipFades(clip: AudioClip, fadeIn: number, fadeOut: number): AudioClip {
  const first = Math.max(0, Math.min(fadeIn, clip.duration))
  return {
    ...clip,
    fadeIn: first,
    fadeOut: Math.max(0, Math.min(fadeOut, clip.duration - first)),
    envelopeOffset: 0,
    envelopeDuration: clip.duration,
    ...(clip.gainPoints
      ? { gainPoints: rebaseGainPoints(clip.gainPoints, clip.envelopeOffset, clip.duration) }
      : {})
  }
}
/** Remaining fade lengths within a trimmed or split clip's visible envelope. */
export function visibleClipFades(clip: AudioClip) {
  return {
    fadeIn: clip.fadeIn
      ? Math.max(0, Math.min(clip.duration, clip.fadeIn - clip.envelopeOffset))
      : 0,
    fadeOut: clip.fadeOut
      ? Math.max(
          0,
          Math.min(
            clip.duration,
            clip.fadeOut - (clip.envelopeDuration - clip.envelopeOffset - clip.duration)
          )
        )
      : 0
  }
}
/** Keep the same source range; only the timeline duration and fade times change. */
export function setClipRate(clip: AudioClip, rate: number): AudioClip {
  if (!Number.isFinite(rate) || rate < audioLimits.minRate || rate > audioLimits.maxRate)
    throw new Error('变速范围为 0.25 至 4 倍')
  const scale = clipRate(clip) / rate
  const next = {
    ...clip,
    rate,
    duration: Math.max(1 / 48000, sampleTime(clip.duration * scale)),
    envelopeOffset: sampleTime(clip.envelopeOffset * scale),
    envelopeDuration: sampleTime(clip.envelopeDuration * scale),
    fadeIn: sampleTime(clip.fadeIn * scale),
    fadeOut: sampleTime(clip.fadeOut * scale)
  }
  if (clip.gainPoints)
    next.gainPoints = clip.gainPoints
      .map((point) => ({
        ...point,
        time: sampleTime(point.time * scale)
      }))
      .filter(
        (point, index, points) =>
          index === points.length - 1 || point.time !== points[index + 1].time
      )
  next.envelopeDuration = Math.max(next.duration, next.envelopeDuration)
  if (next.start + next.duration > 86400 || next.envelopeDuration > 86400)
    throw new Error('变速后片段超出 24 小时时间线')
  return next
}
export function readAudioTimeline(raw: string | null): AudioTimelineDocument {
  if (raw === null) return createAudioTimeline()
  const doc = JSON.parse(raw) as AudioTimelineDocument
  const finite = (v: unknown, min: number, max: number): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
  const validId = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 80
  if (
    doc.version !== 1 ||
    !Array.isArray(doc.tracks) ||
    doc.tracks.length > 32 ||
    !finite(doc.masterGain, 0, 2) ||
    !validAudioProcessing(doc.processing)
  )
    throw new Error('音频制作文件无法读取，原始数据已保留')
  const ids = new Set<string>()
  for (const track of doc.tracks) {
    if (
      !validId(track.id) ||
      ids.has(track.id) ||
      typeof track.name !== 'string' ||
      !finite(track.gain, 0, 4) ||
      (track.pan !== undefined && !finite(track.pan, -1, 1)) ||
      (track.role !== undefined && !['sound', 'dialogue', 'music'].includes(track.role)) ||
      (track.duck !== undefined && typeof track.duck !== 'boolean') ||
      !validAudioProcessing(track.processing) ||
      !['muted', 'solo', 'locked'].every(
        (key) => typeof track[key as keyof AudioTrack] === 'boolean'
      ) ||
      !Array.isArray(track.clips) ||
      track.clips.length > 256
    )
      throw new Error('音轨数据无效，原始数据已保留')
    ids.add(track.id)
    for (const clip of track.clips) {
      if (
        !validId(clip.id) ||
        ids.has(clip.id) ||
        typeof clip.path !== 'string' ||
        !clip.path ||
        typeof clip.name !== 'string' ||
        (clip.sourceKind !== undefined && !['audio', 'video'].includes(clip.sourceKind)) ||
        (clip.audioStream !== undefined &&
          (!Number.isInteger(clip.audioStream) ||
            clip.audioStream < 0 ||
            clip.audioStream > 255)) ||
        (clip.rate !== undefined && !finite(clip.rate, audioLimits.minRate, audioLimits.maxRate)) ||
        (clip.preservePitch !== undefined && typeof clip.preservePitch !== 'boolean') ||
        (clip.fadeCurve !== undefined &&
          !['linear', 'smooth', 'equalPower'].includes(clip.fadeCurve)) ||
        (clip.channels !== undefined &&
          !['stereo', 'swap', 'mono', 'left', 'right'].includes(clip.channels)) ||
        (clip.invertPhase !== undefined && typeof clip.invertPhase !== 'boolean') ||
        !finite(clip.start, 0, 86400) ||
        !finite(clip.sourceIn, 0, 86400) ||
        !finite(clip.duration, 1 / 48000, 86400) ||
        !finite(clip.gain, 0, 4) ||
        (clip.pan !== undefined && !finite(clip.pan, -1, 1)) ||
        !validGainPoints(clip.gainPoints, clip.envelopeDuration) ||
        !finite(clip.envelopeOffset, 0, 86400) ||
        !finite(clip.envelopeDuration, clip.duration, 86400) ||
        !finite(clip.fadeIn, 0, clip.envelopeDuration) ||
        !finite(clip.fadeOut, 0, clip.envelopeDuration) ||
        clip.envelopeOffset + clip.duration > clip.envelopeDuration + 1 / 48000 ||
        clip.fadeIn + clip.fadeOut > clip.envelopeDuration + 1 / 48000 ||
        clip.start + clip.duration > 86400 ||
        clip.sourceIn + clip.duration * clipRate(clip) > 86400 + 1 / 48000
      )
        throw new Error('音频片段数据无效，原始数据已保留')
      ids.add(clip.id)
    }
  }
  validateTextTracks(doc.textTracks, ids)
  if (
    doc.groups !== undefined &&
    (!Array.isArray(doc.groups) ||
      doc.groups.length > 256 ||
      doc.groups.some(
        (group) =>
          !Array.isArray(group) ||
          group.length > 256 ||
          group.some((id) => !validId(id)) ||
          new Set(group).size !== group.length
      ))
  )
    throw new Error('片段分组数据无效，原始数据已保留')
  if (doc.markers !== undefined) {
    if (!Array.isArray(doc.markers) || doc.markers.length > audioLimits.markers)
      throw new Error('标记点数据无效，原始数据已保留')
    for (const marker of doc.markers) {
      if (
        !marker ||
        !validId(marker.id) ||
        ids.has(marker.id) ||
        typeof marker.name !== 'string' ||
        marker.name.length > 120 ||
        (marker.note !== undefined &&
          (typeof marker.note !== 'string' || marker.note.length > 2000)) ||
        !finite(marker.time, 0, 86400)
      )
        throw new Error('标记点数据无效，原始数据已保留')
      ids.add(marker.id)
    }
  }
  return doc
}

/** Overlap adjacent clips without changing their source range; locked tracks are unchanged. */
export function crossfadeClips(
  track: AudioTrack,
  leftId: string,
  rightId: string,
  seconds: number
): AudioTrack {
  if (track.locked || !Number.isFinite(seconds) || seconds <= 0) return track
  const left = track.clips.find((clip) => clip.id === leftId)
  const right = track.clips.find((clip) => clip.id === rightId)
  if (!left || !right || left.id === right.id || right.start < left.start) return track
  const duration = sampleTime(Math.min(seconds, left.duration, right.duration))
  const nextLeft = setClipFades(left, Math.min(left.fadeIn, left.duration - duration), duration)
  const nextRight = {
    ...setClipFades(right, duration, Math.min(right.fadeOut, right.duration - duration)),
    start: sampleTime(left.start + left.duration - duration)
  }
  if (nextRight.start + nextRight.duration > 86400) return track
  return {
    ...track,
    clips: track.clips.map((clip) =>
      clip.id === leftId ? nextLeft : clip.id === rightId ? nextRight : clip
    )
  }
}
