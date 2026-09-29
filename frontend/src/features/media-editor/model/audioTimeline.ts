export interface AudioClip {
  id: string
  path: string
  name: string
  start: number
  sourceIn: number
  duration: number
  gain: number
  fadeIn: number
  fadeOut: number
  envelopeOffset: number
  envelopeDuration: number
}
export interface AudioTrack {
  id: string
  name: string
  gain: number
  muted: boolean
  solo: boolean
  locked: boolean
  clips: AudioClip[]
}
export interface AudioTimelineDocument {
  version: 1
  tracks: AudioTrack[]
  masterGain: number
}
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
  start = 0
): AudioClip {
  const length = sampleTime(duration)
  return {
    id: crypto.randomUUID(),
    path,
    name,
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
    ...doc.tracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration))
  )
export function audibleTracks(doc: AudioTimelineDocument) {
  const solo = doc.tracks.some((track) => track.solo)
  return doc.tracks.filter((track) => !track.muted && (!solo || track.solo))
}
export function clipEnvelope(clip: AudioClip, localTime: number) {
  const time = clip.envelopeOffset + localTime
  return (
    clip.gain *
    (clip.fadeIn ? Math.min(1, time / clip.fadeIn) : 1) *
    (clip.fadeOut ? Math.max(0, Math.min(1, (clip.envelopeDuration - time) / clip.fadeOut)) : 1)
  )
}
/** Trims and splits preserve both source samples and the original gain envelope. */
export function trimClip(clip: AudioClip, left: number, right: number): AudioClip {
  const from = sampleTime(Math.max(0, Math.min(left, clip.duration - 1 / 48000)))
  const to = sampleTime(Math.max(from + 1 / 48000, Math.min(right, clip.duration)))
  return {
    ...clip,
    start: sampleTime(clip.start + from),
    sourceIn: sampleTime(clip.sourceIn + from),
    duration: sampleTime(to - from),
    envelopeOffset: sampleTime(clip.envelopeOffset + from)
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
    envelopeDuration: clip.duration
  }
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
    !finite(doc.masterGain, 0, 2)
  )
    throw new Error('音频制作文件无法读取，原始数据已保留')
  const ids = new Set<string>()
  for (const track of doc.tracks) {
    if (
      !validId(track.id) ||
      ids.has(track.id) ||
      typeof track.name !== 'string' ||
      !finite(track.gain, 0, 4) ||
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
        !finite(clip.start, 0, 86400) ||
        !finite(clip.sourceIn, 0, 86400) ||
        !finite(clip.duration, 1 / 48000, 86400) ||
        !finite(clip.gain, 0, 4) ||
        !finite(clip.envelopeOffset, 0, 86400) ||
        !finite(clip.envelopeDuration, clip.duration, 86400) ||
        !finite(clip.fadeIn, 0, clip.envelopeDuration) ||
        !finite(clip.fadeOut, 0, clip.envelopeDuration) ||
        clip.envelopeOffset + clip.duration > clip.envelopeDuration + 1 / 48000 ||
        clip.fadeIn + clip.fadeOut > clip.envelopeDuration + 1 / 48000 ||
        clip.start + clip.duration > 86400 ||
        clip.sourceIn + clip.duration > 86400
      )
        throw new Error('音频片段数据无效，原始数据已保留')
      ids.add(clip.id)
    }
  }
  return doc
}
