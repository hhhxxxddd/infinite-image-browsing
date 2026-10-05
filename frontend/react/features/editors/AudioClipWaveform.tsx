import { memo, useEffect, useState } from 'react'
import { apiFetch } from '../../shared/apiClient'
import {
  audioWaveformPath,
  audioWaveformGeometry,
  sameAudioWaveformProps,
  type AudioWaveformProps
} from './audioWaveformView'

type WaveformWindow = {
  window_start: number
  window_duration: number
  peaks: number[]
  channel_peaks?: number[][]
}
const cache = new Map<string, WaveformWindow>()
export function invalidateAudioWaveforms(path: string) {
  for (const url of cache.keys())
    if (new URLSearchParams(url.split('?')[1]).get('path') === path) cache.delete(url)
}
let active = 0
const waiting: Array<() => void> = []
async function loadWindow(url: string, signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  const ready = cache.get(url)
  if (ready) return ready
  if (active >= 2)
    await new Promise<void>((resolve, reject) => {
      const resume = () => {
        signal.removeEventListener('abort', cancel)
        resolve()
      }
      const cancel = () => {
        const index = waiting.indexOf(resume)
        if (index >= 0) waiting.splice(index, 1)
        reject(new DOMException('Aborted', 'AbortError'))
      }
      waiting.push(resume)
      signal.addEventListener('abort', cancel, { once: true })
    })
  else active++
  try {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const cached = cache.get(url)
    if (cached) return cached
    const data = await apiFetch<WaveformWindow>(url, { signal })
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    cache.set(url, data)
    while (cache.size > 64) {
      const oldest = cache.keys().next().value
      if (!oldest) break
      cache.delete(oldest)
    }
    return data
  } finally {
    const next = waiting.shift()
    if (next) next()
    else active--
  }
}

const WaveformShape = memo(function WaveformShape({
  data,
  amplitude,
  stereo
}: {
  data: WaveformWindow
  amplitude: number
  stereo: boolean
}) {
  return (stereo ? (data.channel_peaks ?? [data.peaks, data.peaks]) : [data.peaks]).map(
    (peaks, channel) => (
      <g key={channel}>
        <path d={audioWaveformPath(peaks, amplitude, stereo ? 16 : 32, channel)} />
        {stereo && (
          <text x={2} y={channel * 16 + 8} fontSize={5} fill="currentColor">
            {channel ? 'R' : 'L'}
          </text>
        )}
      </g>
    )
  )
})

/** Decode and draw only the source interval visible at the current timeline zoom. */
function AudioClipWaveform({
  clip,
  workspaceId,
  zoom,
  left,
  width,
  retry,
  amplitude = 1,
  stereo = false
}: AudioWaveformProps) {
  const rate = clip.rate ?? 1
  const from = Math.max(0, (Math.floor((left - clip.start * zoom) / 128) * 128) / zoom)
  const to = Math.min(
    clip.duration,
    (Math.ceil((left + width - clip.start * zoom) / 128) * 128) / zoom
  )
  const start = clip.sourceIn + from * rate
  const duration = Math.max(0, to - from) * rate
  const samples = Math.max(32, Math.min(8192, Math.ceil(((to - from) * zoom) / 3)))
  const query = new URLSearchParams({
    workspace_id: workspaceId,
    path: clip.path,
    audio_stream: String(clip.audioStream ?? 0),
    peaks: 'true',
    start: start.toFixed(6),
    duration: duration.toFixed(6),
    samples: String(samples)
  }).toString()
  const url = `/audio_studio/source?${query}`
  const sourceKey = JSON.stringify([
    workspaceId,
    clip.path,
    clip.sourceKind,
    clip.audioStream ?? 0,
    clip.sourceIn,
    clip.duration,
    rate,
    zoom,
    retry
  ])
  const [result, setResult] = useState<{
    url: string
    sourceKey: string
    data: WaveformWindow
  } | null>(null)
  // Keep the previous correctly anchored part visible during scrolling or clip movement.
  const data = cache.get(url) ?? (result?.sourceKey === sourceKey ? result.data : null)
  useEffect(() => {
    if (duration <= 0) return
    const cached = cache.get(url)
    if (cached) {
      setResult((current) =>
        current?.url === url && current.sourceKey === sourceKey && current.data === cached
          ? current
          : { url, sourceKey, data: cached }
      )
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void loadWindow(url, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) setResult({ url, sourceKey, data })
        })
        .catch(() => {
          /* Source availability is reported once by the editor. */
        })
    }, 120)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [url, duration, sourceKey, retry])
  if (!data || duration <= 0) return null
  const geometry = audioWaveformGeometry(data, clip, zoom, false, { left, width })
  if (!geometry) return null
  return (
    <svg
      className="react-audio-waveform"
      viewBox={`0 0 ${data.peaks.length * 3} 32`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ ...geometry, right: 'auto' }}
    >
      <WaveformShape data={data} amplitude={amplitude} stereo={stereo} />
    </svg>
  )
}

export default memo(AudioClipWaveform, sameAudioWaveformProps)
