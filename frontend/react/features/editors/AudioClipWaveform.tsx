import { useEffect, useState } from 'react'
import { apiFetch } from '../../shared/apiClient'
import type { AudioClip } from '../../../src/features/media-editor/model/audioTimeline'

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
  if (active >= 2) await new Promise<void>((resolve) => waiting.push(resolve))
  else active++
  try {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const cached = cache.get(url)
    if (cached) return cached
    const data = await apiFetch<WaveformWindow>(url, { signal })
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

/** Decode and draw only the source interval visible at the current timeline zoom. */
export default function AudioClipWaveform({
  clip,
  workspaceId,
  zoom,
  left,
  width,
  retry,
  amplitude = 1,
  stereo = false
}: {
  clip: AudioClip
  workspaceId: string
  zoom: number
  left: number
  width: number
  retry: number
  amplitude?: number
  stereo?: boolean
}) {
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
  const [result, setResult] = useState<{ query: string; data: WaveformWindow } | null>(null)
  useEffect(() => {
    if (duration <= 0) return
    const controller = new AbortController()
    const url = `/audio_studio/source?${query}`
    const timer = window.setTimeout(() => {
      void loadWindow(url, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) setResult({ query, data })
        })
        .catch(() => {
          /* Source availability is reported once by the editor. */
        })
    }, 120)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query, duration, retry])
  if (!result || result.query !== query || duration <= 0) return null
  const { data } = result
  return (
    <svg
      className="react-audio-waveform"
      viewBox={`0 0 ${data.peaks.length * 3} 32`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ left: from * zoom, width: (to - from) * zoom, right: 'auto' }}
    >
      {(stereo ? (data.channel_peaks ?? [data.peaks, data.peaks]) : [data.peaks]).map(
        (peaks, channel) => (
          <g key={channel}>
            {peaks.map((peak, index) => {
              const lane = stereo ? 16 : 32
              const height = Math.max(0.4, Math.min(lane - 2, peak * amplitude * (lane - 2)))
              return (
                <rect
                  key={index}
                  x={index * 3}
                  y={channel * lane + (lane - height) / 2}
                  width={2}
                  height={height}
                />
              )
            })}
            {stereo && (
              <text x={2} y={channel * 16 + 8} fontSize={5} fill="currentColor">
                {channel ? 'R' : 'L'}
              </text>
            )}
          </g>
        )
      )}
    </svg>
  )
}
