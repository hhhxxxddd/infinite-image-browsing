import { memo, useEffect, useMemo, useState } from 'react'
import { apiFetch, apiUrl } from '../../shared/apiClient'
import {
  videoClipStripWindow,
  sameVideoClipStripProps,
  type VideoClipStripProps
} from './videoClipStripView'
import { audioWaveformGeometry } from './audioWaveformView'

let sampling = 0
const queue: Array<() => void> = []
type SourceWaveform = { peaks: number[]; window_start: number; window_duration: number }
const peakCache = new Map<string, SourceWaveform>()
function sample<T>(
  request: () => Promise<T>,
  live: () => boolean,
  signal?: AbortSignal
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const cancel = () => {
      signal?.removeEventListener('abort', cancel)
      const index = queue.indexOf(run)
      if (index >= 0) queue.splice(index, 1)
      resolve(undefined)
    }
    const run = () => {
      signal?.removeEventListener('abort', cancel)
      if (!live() || signal?.aborted) {
        resolve(undefined)
        queue.shift()?.()
        return
      }
      sampling++
      void request()
        .then(resolve, reject)
        .finally(() => {
          sampling--
          queue.shift()?.()
        })
    }
    if (sampling < 2) run()
    else {
      queue.push(run)
      signal?.addEventListener('abort', cancel, { once: true })
      if (signal?.aborted) cancel()
    }
  })
}

function Thumbnail({ url }: { url: string }) {
  const [ready, setReady] = useState('')
  useEffect(() => {
    let live = true
    setReady('')
    void sample(
      async () => {
        for (let attempt = 0; attempt < 3 && live; attempt++) {
          const source = attempt ? `${url}${url.includes('?') ? '&' : '?'}retry=${attempt}` : url
          try {
            await new Promise<void>((resolve, reject) => {
              const image = new Image(),
                timer = window.setTimeout(() => {
                  image.src = ''
                  reject(new Error('thumbnail timeout'))
                }, 10000)
              image.onload = () => {
                window.clearTimeout(timer)
                resolve()
              }
              image.onerror = () => {
                window.clearTimeout(timer)
                reject(new Error('thumbnail unavailable'))
              }
              image.src = source
            })
            if (live) setReady(source)
            return
          } catch {
            if (attempt < 2 && live)
              await new Promise((resolve) => window.setTimeout(resolve, 500 * (attempt + 1)))
          }
        }
      },
      () => live
    ).catch(() => undefined)
    return () => {
      live = false
    }
  }, [url])
  return ready ? (
    <img src={ready} alt="" draggable={false} />
  ) : (
    <span className="video-frame-placeholder" />
  )
}

/** Only the visible source window is sampled. Zooming never queues an entire long movie. */
function VideoClipStrip({
  clip,
  workspaceId,
  left,
  width,
  pixelsPerSecond,
  lane,
  imageUrl,
  sourceRevision
}: VideoClipStripProps) {
  const [frames, setFrames] = useState<{ time: number; url: string }[]>([])
  const [peakResult, setPeakResult] = useState<{
    key: string
    sourceKey: string
    data: SourceWaveform
  } | null>(null)
  const { start, end, screenWidth, offset } = videoClipStripWindow({
    clip,
    workspaceId,
    left,
    width,
    pixelsPerSecond,
    lane,
    imageUrl
  })
  const count = Math.min(24, Math.max(1, Math.ceil(screenWidth / 90)))
  const peakParams = new URLSearchParams({
    workspace_id: workspaceId,
    path: clip.path,
    start: String(start),
    audio_stream: String(clip.audioStream ?? 0),
    peaks: 'true',
    duration: String(Math.max(0.01, end - start)),
    samples: String(Math.min(1024, Math.max(32, Math.ceil(screenWidth / 3))))
  })
  // A repaired file with the same path must not reuse peaks from its previous revision.
  const peakKey = JSON.stringify([imageUrl, sourceRevision, peakParams.toString()])
  const sourceKey = JSON.stringify([
    workspaceId,
    clip.path,
    clip.kind,
    clip.audioStream ?? 0,
    clip.sourceIn,
    clip.duration,
    clip.rate,
    clip.reverse,
    clip.freeze,
    pixelsPerSecond,
    sourceRevision,
    imageUrl
  ])
  const sourcePeaks =
    peakCache.get(peakKey) ?? (peakResult?.sourceKey === sourceKey ? peakResult.data : null)
  const peaks = useMemo(
    () => sourcePeaks && (clip.reverse ? [...sourcePeaks.peaks].reverse() : sourcePeaks.peaks),
    [sourcePeaks, clip.reverse]
  )
  const peakPath = useMemo(
    () =>
      peaks
        ?.map((peak, i) => `M${i} ${20 - Math.abs(peak) * 19}v${Math.abs(peak) * 38}`)
        .join(' ') ?? '',
    [peaks]
  )
  const waveformGeometry = sourcePeaks
    ? audioWaveformGeometry(sourcePeaks, clip, pixelsPerSecond, clip.reverse, { left, width })
    : null
  useEffect(() => {
    let live = true
    const controller = new AbortController()
    setFrames((current) => (current.length ? [] : current))
    if (screenWidth <= 0 || clip.kind === 'image') return
    if (lane === 'sound') {
      if (clip.freeze) return
      const cached = peakCache.get(peakKey)
      if (cached) {
        setPeakResult((current) =>
          current?.key === peakKey && current.sourceKey === sourceKey && current.data === cached
            ? current
            : { key: peakKey, sourceKey, data: cached }
        )
        return
      }
    }
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({
        workspace_id: workspaceId,
        path: clip.path,
        start: String(start)
      })
      if (lane === 'visual') {
        params.set('end', String(end))
        params.set('count', String(clip.freeze ? 1 : count))
        params.set('width', '120')
        void sample(
          () =>
            apiFetch<{ frames: { time: number; url: string }[] }>(
              `/video_studio/thumbnails?${params}`
            ),
          () => live
        )
          .then((r) => {
            if (live && r) setFrames(clip.reverse ? [...r.frames].reverse() : r.frames)
          })
          .catch(() => undefined)
      } else {
        void sample(
          () => {
            const cached = peakCache.get(peakKey)
            return cached
              ? Promise.resolve(cached)
              : apiFetch<SourceWaveform>(`/audio_studio/source?${peakParams}`, {
                  signal: controller.signal
                })
          },
          () => live,
          controller.signal
        )
          .then((r) => {
            if (live && r) {
              peakCache.set(peakKey, r)
              while (peakCache.size > 64) {
                const oldest = peakCache.keys().next().value
                if (!oldest) break
                peakCache.delete(oldest)
              }
              setPeakResult({ key: peakKey, sourceKey, data: r })
            }
          })
          .catch(() => undefined)
      }
    }, 180)
    return () => {
      live = false
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [
    workspaceId,
    clip.path,
    clip.kind,
    clip.reverse,
    clip.freeze,
    lane,
    start,
    end,
    count,
    screenWidth,
    peakKey,
    sourceKey
  ])
  if (clip.kind === 'image' && lane === 'visual')
    return (
      <div
        className="video-filmstrip"
        style={{
          left: offset,
          width: screenWidth,
          backgroundImage: `url(${JSON.stringify(imageUrl)})`
        }}
      />
    )
  return (
    <div
      className="video-filmstrip"
      style={
        lane === 'sound' && waveformGeometry
          ? waveformGeometry
          : { left: offset, width: screenWidth }
      }
      aria-hidden="true"
    >
      {frames.map((frame, index) => (
        <div
          className="video-film-frame"
          key={`${frame.time}-${index}`}
          style={{ width: `${100 / frames.length}%` }}
        >
          <Thumbnail url={apiUrl(frame.url.replace(/^\/api(?=\/)/, ''))} />
        </div>
      ))}
      {lane === 'sound' && !clip.freeze && waveformGeometry && !!peaks?.length && (
        <svg viewBox={`0 0 ${peaks.length} 40`} preserveAspectRatio="none">
          <path d={peakPath} fill="none" stroke="currentColor" strokeWidth="1" />
        </svg>
      )}
    </div>
  )
}

export default memo(VideoClipStrip, sameVideoClipStripProps)
