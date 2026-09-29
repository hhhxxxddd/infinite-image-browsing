export interface TextCue {
  id: string
  start: number
  duration: number
  text: string
}
export interface TextTrack {
  id: string
  name: string
  visible: boolean
  locked: boolean
  cues: TextCue[]
}
export type TextFormat = 'lrc' | 'srt' | 'vtt' | 'txt'
export const textLimits = { tracks: 8, cues: 4096, text: 5000, fileBytes: 2 * 1024 * 1024 }
export const textTime = (value: number) => Math.round(value * 1000) / 1000
export function createTextTrack(name = '文字 1'): TextTrack {
  return { id: crypto.randomUUID(), name, visible: true, locked: false, cues: [] }
}
export function createTextCue(text = '请输入文字', start = 0, duration = 3): TextCue {
  return { id: crypto.randomUUID(), text, start: textTime(start), duration: textTime(duration) }
}
export function validateTextTracks(value: unknown, ids: Set<string>): void {
  if (value === undefined) return
  const finite = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
  const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 80
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'
  const invalid = () => {
    throw new Error('文字轨数据无效，原始数据已保留')
  }
  if (!Array.isArray(value) || value.length > textLimits.tracks) return invalid()
  for (const track of value) {
    if (
      !object(track) ||
      !id(track.id) ||
      ids.has(track.id) ||
      typeof track.name !== 'string' ||
      track.name.length > 120 ||
      typeof track.visible !== 'boolean' ||
      typeof track.locked !== 'boolean' ||
      !Array.isArray(track.cues) ||
      track.cues.length > textLimits.cues
    )
      return invalid()
    ids.add(track.id)
    for (const cue of track.cues) {
      if (
        !object(cue) ||
        !id(cue.id) ||
        ids.has(cue.id) ||
        typeof cue.text !== 'string' ||
        cue.text.length > textLimits.text ||
        !finite(cue.start, 0, 86400) ||
        !finite(cue.duration, 0.001, 86400) ||
        Number(cue.start) + Number(cue.duration) > 86400
      )
        return invalid()
      ids.add(cue.id)
    }
  }
}
export function activeTextCues(tracks: TextTrack[], time: number): TextCue[] {
  return tracks
    .filter((track) => track.visible)
    .flatMap((track) =>
      track.cues
        .filter((cue) => cue.start <= time && time < cue.start + cue.duration)
        .sort((a, b) => a.start - b.start)
    )
}
export function splitTextCue(cue: TextCue, time: number): [TextCue, TextCue] | undefined {
  const at = textTime(time)
  if (at <= cue.start || at >= cue.start + cue.duration) return
  return [
    { ...cue, duration: textTime(at - cue.start) },
    {
      ...cue,
      id: crypto.randomUUID(),
      start: at,
      duration: textTime(cue.start + cue.duration - at)
    }
  ]
}
function clock(raw: string): number {
  const match = /^(?:(\d{2,}):)?(\d{2}):(\d{2})[.,](\d{1,3})$/.exec(raw)
  if (!match || Number(match[2]) >= 60 || Number(match[3]) >= 60)
    throw new Error(`无效的字幕时间：${raw}`)
  return (
    Number(match[1] ?? 0) * 3600 +
    Number(match[2]) * 60 +
    Number(match[3]) +
    Number(`0.${match[4]}`)
  )
}
export function decodeTextFile(buffer: ArrayBuffer): string {
  if (buffer.byteLength > textLimits.fileBytes) throw new Error('文字文件最大为 2 MB')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    throw new Error('无法读取文字编码，请将文件另存为 UTF-8 后再导入')
  }
}
function captionText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(?:b|i|u|font|c(?:\.[^\s>]+)?|v|lang|ruby|rt)(?:\s[^>]*)?>/gi, '')
    .replace(/<(?:(?:\d{2,}):)?\d{2}:\d{2}\.\d{3}>/g, '')
    .replace(
      /&(amp|lt|gt|nbsp|quot|apos);/g,
      (_, entity: string) =>
        ({ amp: '&', lt: '<', gt: '>', nbsp: ' ', quot: '"', apos: "'" })[entity] ?? entity
    )
}
/** Local imports are atomic: malformed or oversized input never replaces an existing track. */
export function parseTextTrack(
  input: string,
  format: TextFormat,
  options: { duration?: number; start?: number } = {}
): TextCue[] {
  if (new TextEncoder().encode(input).length > textLimits.fileBytes)
    throw new Error('文字文件最大为 2 MB')
  const text = input
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim()
  let cues: TextCue[] = []
  if (format === 'txt') {
    cues = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => createTextCue(line, (options.start ?? 0) + index * 3))
  } else if (format === 'lrc') {
    const offsets = [...text.matchAll(/\[offset:([+-]?\d+)\]/gi)]
    const offset = Number(offsets[offsets.length - 1]?.[1] ?? 0) / 1000
    for (const line of text.split('\n')) {
      const raw = line.trim()
      const prefix = /^(?:\[\d+:\d{2}(?:[.:]\d{1,3})?\])+/.exec(raw)?.[0] ?? ''
      const tags = [...prefix.matchAll(/\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g)]
      const lyric = raw.slice(prefix.length).trim()
      for (const tag of tags) {
        if (Number(tag[2]) >= 60) throw new Error(`无效的歌词时间：${tag[0]}`)
        const start = Math.max(
          0,
          textTime(Number(tag[1]) * 60 + Number(tag[2]) + Number(`0.${tag[3] ?? '0'}`) + offset)
        )
        // Empty timestamped lines end the previous lyric without creating blank cues.
        cues.push(createTextCue(lyric, start))
      }
    }
    cues.sort((a, b) => a.start - b.start)
    const starts = [...new Set(cues.map((cue) => cue.start))]
    const next = new Map(starts.map((start, index) => [start, starts[index + 1]]))
    cues = cues
      .filter((cue) => cue.text)
      .map((cue) => ({
        ...cue,
        duration: textTime(
          (next.get(cue.start) ?? Math.max(cue.start + 3, options.duration ?? 0)) - cue.start
        )
      }))
  } else {
    if (format === 'vtt' && !/^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(text))
      throw new Error('VTT 文件缺少 WEBVTT 标头')
    for (const block of text.split(/\n[ \t]*\n/)) {
      if (
        format === 'vtt' &&
        /^(?:WEBVTT|NOTE(?:[ \t]|$)|STYLE$|REGION$)/m.test(block.split('\n')[0])
      )
        continue
      const lines = block.split('\n')
      const index = lines.findIndex((line) => line.includes('-->'))
      if (index < 0 || index > 1) throw new Error('字幕片段缺少有效的开始／结束时间')
      const timing = /^(\S+)\s+-->\s+(\S+)(?:\s+.*)?$/.exec(lines[index].trim())
      if (!timing) throw new Error('字幕时间格式无效')
      const start = clock(timing[1]),
        end = clock(timing[2])
      cues.push(
        createTextCue(
          captionText(
            lines
              .slice(index + 1)
              .join('\n')
              .trim()
          ),
          start,
          end - start
        )
      )
    }
  }
  if (!cues.length) throw new Error('文件中没有可导入的文字片段')
  const track = createTextTrack()
  track.cues = cues
  validateTextTracks([track], new Set())
  return cues.sort((a, b) => a.start - b.start)
}
function stamp(time: number, format: 'lrc' | 'srt' | 'vtt'): string {
  const units = format === 'lrc' ? 100 : 1000
  const ticks = Math.round(Math.max(0, time) * units)
  const seconds = Math.floor(ticks / units)
  const fraction = (ticks % units).toString().padStart(format === 'lrc' ? 2 : 3, '0')
  const second = (seconds % 60).toString().padStart(2, '0')
  if (format === 'lrc')
    return `${Math.floor(seconds / 60)
      .toString()
      .padStart(2, '0')}:${second}.${fraction}`
  return `${Math.floor(seconds / 3600)
    .toString()
    .padStart(
      2,
      '0'
    )}:${(Math.floor(seconds / 60) % 60).toString().padStart(2, '0')}:${second}${format === 'srt' ? ',' : '.'}${fraction}`
}
export function serializeTextTrack(
  track: TextTrack,
  format: Exclude<TextFormat, 'txt'>,
  range?: { start: number; end: number }
): string {
  validateTextTracks([track], new Set())
  const cues = track.cues
    .filter((cue) => cue.text.trim())
    .flatMap((cue) => {
      const start = Math.max(cue.start, range?.start ?? 0)
      const end = Math.min(cue.start + cue.duration, range?.end ?? 86400)
      return end > start
        ? [{ ...cue, start: start - (range?.start ?? 0), duration: end - start }]
        : []
    })
    .sort((a, b) => a.start - b.start)
  if (!cues.length) throw new Error('当前范围内没有可导出的文字')
  if (format === 'lrc') {
    // Empty timestamped lines retain gaps and the last lyric's ending time.
    const events = cues
      .flatMap((cue) => [
        { time: cue.start, text: cue.text.replace(/\n/g, ' '), ending: false },
        { time: cue.start + cue.duration, text: '', ending: true }
      ])
      .sort((a, b) => a.time - b.time || Number(b.ending) - Number(a.ending))
    return (
      events
        .filter(
          (event, index) =>
            !event.ending ||
            (!cues.some(
              (cue) => cue.start <= event.time && event.time < cue.start + cue.duration
            ) &&
              (index === 0 || events[index - 1].time !== event.time || !events[index - 1].ending))
        )
        .map((event) => `[${stamp(event.time, 'lrc')}]${event.text}`)
        .join('\n') + '\n'
    )
  }
  return (
    (format === 'vtt' ? 'WEBVTT\n\n' : '') +
    cues
      .map(
        (cue, index) =>
          `${index + 1}\n${stamp(cue.start, format)} --> ${stamp(cue.start + cue.duration, format)}\n${cue.text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n[ \t]*\n/g, '\n')}`
      )
      .join('\n\n') +
    '\n'
  )
}
