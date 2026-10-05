import {
  sampleTime,
  splitClip,
  type AudioClip,
  type AudioTimelineDocument
} from './audioTimeline.ts'
import { splitTextCue, textLimits, type TextCue } from './textTimeline.ts'

type Document = AudioTimelineDocument & { groups?: string[][] }
export type AudioEntry = {
  kind: 'clip' | 'cue'
  trackId: string
  locked: boolean
  item: AudioClip | TextCue
}
export const audioEntries = (doc: Document): AudioEntry[] => [
  ...doc.tracks.flatMap((track) =>
    track.clips.map((item) => ({
      kind: 'clip' as const,
      trackId: track.id,
      locked: track.locked,
      item
    }))
  ),
  ...(doc.textTracks ?? []).flatMap((track) =>
    track.cues.map((item) => ({
      kind: 'cue' as const,
      trackId: track.id,
      locked: track.locked,
      item
    }))
  )
]
export function expandAudioSelection(doc: Document, ids: string[]): string[] {
  const selected = new Set(ids)
  let changed = true
  while (changed) {
    changed = false
    for (const group of doc.groups ?? [])
      if (group.some((id) => selected.has(id)))
        for (const id of group)
          if (!selected.has(id)) {
            selected.add(id)
            changed = true
          }
  }
  return audioEntries(doc)
    .filter((entry) => selected.has(entry.item.id))
    .map((entry) => entry.item.id)
}
export function moveAudioSelection(doc: Document, ids: string[], delta: number): Document {
  const expanded = new Set(expandAudioSelection(doc, ids))
  const selected = audioEntries(doc).filter((entry) => expanded.has(entry.item.id))
  if (!selected.length || selected.some((entry) => entry.locked)) return doc
  const shift = sampleTime(
    Math.max(
      -Math.min(...selected.map((entry) => entry.item.start)),
      Math.min(
        delta,
        86400 - Math.max(...selected.map((entry) => entry.item.start + entry.item.duration))
      )
    )
  )
  const move = <T extends { id: string; start: number }>(item: T): T =>
    expanded.has(item.id) ? { ...item, start: sampleTime(item.start + shift) } : item
  return {
    ...doc,
    tracks: doc.tracks.map((track) => ({ ...track, clips: track.clips.map(move) })),
    textTracks: doc.textTracks?.map((track) => ({ ...track, cues: track.cues.map(move) }))
  }
}
export function groupAudioSelection(doc: Document, ids: string[], unlink = false): Document {
  const selected = new Set(expandAudioSelection(doc, ids))
  const groups = (doc.groups ?? []).filter((group) => !group.some((id) => selected.has(id)))
  if (!unlink && selected.size > 1) groups.push([...selected])
  assertGroups(groups)
  return { ...doc, groups }
}
function assertGroups(groups: string[][]) {
  if (groups.length > 256 || groups.some((group) => group.length > 256))
    throw new Error('关联分组过多，请先解除部分片段关联')
}
type Span = { start: number; end: number }
function mergeSpans(spans: Span[]): Span[] {
  const output: Span[] = []
  for (const span of spans.sort((a, b) => a.start - b.start)) {
    const last = output.at(-1)
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end)
    else output.push({ ...span })
  }
  return output
}
export function removeAudioSelection(doc: Document, ids: string[], ripple = false): Document {
  const selected = new Set(expandAudioSelection(doc, ids))
  const entries = audioEntries(doc)
  if (entries.some((entry) => selected.has(entry.item.id) && entry.locked)) return doc
  const removed = entries.filter((entry) => selected.has(entry.item.id))
  if (!removed.length) return doc
  let gaps = ripple
    ? mergeSpans(
        removed.map(({ item }) => ({ start: item.start, end: item.start + item.duration }))
      )
    : []
  for (const { item } of entries.filter((entry) => !selected.has(entry.item.id))) {
    const end = item.start + item.duration
    gaps = gaps.flatMap((gap) =>
      end <= gap.start || item.start >= gap.end
        ? [gap]
        : [
            ...(item.start > gap.start ? [{ start: gap.start, end: item.start }] : []),
            ...(end < gap.end ? [{ start: end, end: gap.end }] : [])
          ]
    )
  }
  // A locked later clip must not lose synchronization when gaps close elsewhere.
  if (
    ripple &&
    entries.some((entry) => entry.locked && gaps.some((gap) => gap.end <= entry.item.start))
  )
    return doc
  const compress = <T extends { start: number }>(item: T): T => ({
    ...item,
    start: sampleTime(
      item.start -
        gaps.reduce((shift, gap) => shift + (gap.end <= item.start ? gap.end - gap.start : 0), 0)
    )
  })
  const alive = new Set(
    entries.filter((entry) => !selected.has(entry.item.id)).map((entry) => entry.item.id)
  )
  return {
    ...doc,
    tracks: doc.tracks.map((track) => ({
      ...track,
      clips: track.clips.filter((clip) => !selected.has(clip.id)).map(compress)
    })),
    textTracks: doc.textTracks?.map((track) => ({
      ...track,
      cues: track.cues.filter((cue) => !selected.has(cue.id)).map(compress)
    })),
    groups: doc.groups
      ?.map((group) => group.filter((id) => alive.has(id)))
      .filter((group) => group.length > 1),
    markers: doc.markers?.map((marker) => ({
      ...marker,
      time: Math.max(
        0,
        marker.time -
          gaps.reduce(
            (shift, gap) => shift + Math.max(0, Math.min(marker.time, gap.end) - gap.start),
            0
          )
      )
    }))
  }
}
export function splitAudioSelection(doc: Document, ids: string[], at: number): Document {
  const selected = new Set(expandAudioSelection(doc, ids))
  if (audioEntries(doc).some((entry) => entry.locked && selected.has(entry.item.id))) return doc
  const added: Record<string, string[]> = {}
  const clips = (clip: AudioClip) => {
    const parts = selected.has(clip.id) ? splitClip(clip, at) : undefined
    if (parts) added[clip.id] = parts.map((part) => part.id)
    return parts ?? [clip]
  }
  const cues = (cue: TextCue) => {
    const parts = selected.has(cue.id) ? splitTextCue(cue, at) : undefined
    if (parts) added[cue.id] = parts.map((part) => part.id)
    return parts ?? [cue]
  }
  const tracks = doc.tracks.map((track) => ({ ...track, clips: track.clips.flatMap(clips) }))
  const textTracks = doc.textTracks?.map((track) => ({ ...track, cues: track.cues.flatMap(cues) }))
  if (
    tracks.some((track) => track.clips.length > 256) ||
    textTracks?.some((track) => track.cues.length > textLimits.cues)
  )
    throw new Error('拆分后的片段过多')
  const entries = audioEntries(doc)
  const groups = doc.groups?.flatMap((group) => {
    if (!group.some((id) => added[id])) return [group]
    const left: string[] = [],
      right: string[] = []
    for (const id of group) {
      const parts = added[id]
      if (parts) {
        left.push(parts[0])
        right.push(parts[1])
      } else {
        const entry = entries.find((item) => item.item.id === id)
        if (entry) (entry.item.start >= at ? right : left).push(id)
      }
    }
    return [left, right].filter((part) => part.length > 1)
  })
  assertGroups(groups ?? [])
  return {
    ...doc,
    tracks,
    textTracks,
    groups
  }
}
export type AudioClipboard = { entries: AudioEntry[]; groups: string[][]; origin: number }
export function copyAudioSelection(doc: Document, ids: string[]): AudioClipboard | null {
  const selected = new Set(expandAudioSelection(doc, ids))
  const entries = audioEntries(doc).filter((entry) => selected.has(entry.item.id))
  if (!entries.length) return null
  return {
    entries: structuredClone(entries),
    origin: Math.min(...entries.map((entry) => entry.item.start)),
    groups: (doc.groups ?? [])
      .map((group) => group.filter((id) => selected.has(id)))
      .filter((group) => group.length > 1)
  }
}
export function pasteAudioSelection(
  doc: Document,
  clipboard: AudioClipboard,
  at: number
): { document: Document; ids: string[] } {
  const copied = structuredClone(clipboard)
  const idMap = new Map(copied.entries.map((entry) => [entry.item.id, crypto.randomUUID()]))
  const remapId = (id: string) => {
    const next = idMap.get(id)
    if (!next) throw new Error('复制的片段已失效，请重新复制')
    return next
  }
  const shift = at - copied.origin
  const entries = copied.entries.map((entry) => ({
    ...entry,
    item: {
      ...entry.item,
      id: remapId(entry.item.id),
      start: sampleTime(entry.item.start + shift)
    }
  }))
  if (
    entries.some((entry) => entry.item.start < 0 || entry.item.start + entry.item.duration > 86400)
  )
    throw new Error('粘贴超出时间线范围')
  const target = (entry: AudioEntry) =>
    entry.kind === 'clip'
      ? doc.tracks.find((track) => track.id === entry.trackId)
      : doc.textTracks?.find((track) => track.id === entry.trackId)
  if (entries.some((entry) => !target(entry) || target(entry)?.locked))
    throw new Error('原轨道已删除或锁定，无法粘贴')
  const tracks = doc.tracks.map((track) => ({
    ...track,
    clips: [
      ...track.clips,
      ...entries
        .filter((entry) => entry.kind === 'clip' && entry.trackId === track.id)
        .map((entry) => entry.item as AudioClip)
    ]
  }))
  const textTracks = doc.textTracks?.map((track) => ({
    ...track,
    cues: [
      ...track.cues,
      ...entries
        .filter((entry) => entry.kind === 'cue' && entry.trackId === track.id)
        .map((entry) => entry.item as TextCue)
    ]
  }))
  if (
    tracks.some((track) => track.clips.length > 256) ||
    textTracks?.some((track) => track.cues.length > textLimits.cues)
  )
    throw new Error('粘贴后的片段过多')
  const groups = [...(doc.groups ?? []), ...copied.groups.map((group) => group.map(remapId))]
  assertGroups(groups)
  return {
    document: {
      ...doc,
      tracks,
      textTracks,
      groups
    },
    ids: entries.map((entry) => entry.item.id)
  }
}
