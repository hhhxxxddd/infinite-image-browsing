export interface SourceAudioStream {
  ordinal: number
  index: number
  duration: number
  startTime: number
  title: string
  language: string
  channels: number
  sampleRate: number
  channelLayout: string
  isDefault: boolean
}
export function validAudioStream(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255
}
export function readSourceAudioStreams(
  raw: unknown,
  duration: number,
  hasAudio: boolean
): SourceAudioStream[] {
  if (raw !== undefined && !Array.isArray(raw)) throw new Error('声音流信息无效')
  if (!Array.isArray(raw))
    return hasAudio
      ? [
          {
            ordinal: 0,
            index: 0,
            duration,
            startTime: 0,
            title: '',
            language: '',
            channels: 0,
            sampleRate: 0,
            channelLayout: '',
            isDefault: false
          }
        ]
      : []
  const seen = new Set<number>()
  return raw.map((item: Record<string, unknown>, ordinal) => {
    if (!item || typeof item !== 'object' || !validAudioStream(item.ordinal ?? ordinal))
      throw new Error('声音流编号无效')
    const streamOrdinal = Number(item.ordinal ?? ordinal)
    if (seen.has(streamOrdinal)) throw new Error('声音流编号重复')
    seen.add(streamOrdinal)
    const number = (value: unknown, fallback = 0) =>
      typeof value === 'number' && Number.isFinite(value) ? value : fallback
    return {
      ordinal: Number(item.ordinal ?? ordinal),
      index: number(item.index, ordinal),
      duration: number(item.duration),
      startTime: number(item.start_time),
      title:
        typeof item.title === 'string'
          ? item.title
          : typeof item.name === 'string'
            ? item.name
            : '',
      language: typeof item.language === 'string' ? item.language : '',
      channels: number(item.channels),
      sampleRate: number(item.sample_rate ?? item.sampleRate),
      channelLayout: typeof item.channel_layout === 'string' ? item.channel_layout : '',
      isDefault: item.default === true
    }
  })
}
export function sourceAudioStreamLabel(stream: SourceAudioStream): string {
  return [
    `声音流 ${stream.ordinal + 1}`,
    stream.title,
    stream.language && stream.language !== 'und' ? stream.language : '',
    stream.channels === 1
      ? '单声道'
      : stream.channels === 2
        ? '立体声'
        : stream.channels
          ? `${stream.channels} 声道`
          : '',
    stream.sampleRate ? `${Number((stream.sampleRate / 1000).toFixed(1))} kHz` : ''
  ]
    .filter(Boolean)
    .join(' · ')
}
export function sourceAudioStreamError(
  streams: SourceAudioStream[] | undefined,
  ordinal: number,
  sourceIn: number,
  duration: number,
  rate = 1
): string {
  if (!validAudioStream(ordinal)) return '声音流编号无效'
  // Older in-memory metadata can describe only the first stream; never invent another.
  if (!streams) return ordinal === 0 ? '' : '声音流信息未知，请重新读取素材'
  const stream = streams.find((item) => item.ordinal === ordinal)
  if (!stream) return `素材不包含第 ${ordinal + 1} 条声音流，请重新选择`
  if (!Number.isFinite(stream.duration) || stream.duration <= 0) return '所选声音流时长未知'
  if (
    ![sourceIn, duration, rate].every(Number.isFinite) ||
    sourceIn < 0 ||
    duration <= 0 ||
    rate <= 0
  )
    return '所选片段的源区间无效'
  if (sourceIn + duration * rate > stream.duration + 1e-6)
    return '所选声音流过短，无法保留当前源区间'
  return ''
}
