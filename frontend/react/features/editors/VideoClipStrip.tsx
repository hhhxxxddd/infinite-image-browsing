import { useEffect, useState } from 'react'
import { apiFetch, apiUrl } from '../../shared/apiClient'
import { sourceTime, type VideoClip } from './videoStudioModel'

let sampling = 0
const queue: Array<() => void> = []
function sample<T>(request: () => Promise<T>, live: () => boolean): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const run = () => {
      if (!live()) {
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
    else queue.push(run)
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
export default function VideoClipStrip({
  clip,
  workspaceId,
  left,
  width,
  pixelsPerSecond,
  lane,
  imageUrl
}: {
  clip: VideoClip
  workspaceId: string
  left: number
  width: number
  pixelsPerSecond: number
  lane: 'visual' | 'sound'
  imageUrl: string
}) {
  const [frames, setFrames] = useState<{ time: number; url: string }[]>([])
  const [peaks, setPeaks] = useState<number[]>([])
  const visibleStart = Math.max(clip.start, left / pixelsPerSecond)
  const visibleEnd = Math.min(clip.start + clip.duration, (left + width) / pixelsPerSecond)
  const screenWidth = Math.max(0, (visibleEnd - visibleStart) * pixelsPerSecond)
  const count = Math.min(24, Math.max(1, Math.ceil(screenWidth / 90)))
  const first = sourceTime(clip, visibleStart),
    last = sourceTime(clip, visibleEnd)
  const start = Math.max(0, Math.min(first, last)),
    end = Math.max(start + 0.001, Math.max(first, last))
  useEffect(() => {
    let live = true
    setFrames([])
    setPeaks([])
    if (screenWidth <= 0 || clip.kind === 'image') return
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
        if (clip.freeze) return
        params.set('peaks', 'true')
        params.set('duration', String(Math.max(0.01, end - start)))
        params.set('samples', String(Math.min(1024, Math.max(32, Math.ceil(screenWidth / 3)))))
        void sample(
          () => apiFetch<{ peaks: number[] }>(`/audio_studio/source?${params}`),
          () => live
        )
          .then((r) => {
            if (live && r) setPeaks(clip.reverse ? [...r.peaks].reverse() : r.peaks)
          })
          .catch(() => undefined)
      }
    }, 180)
    return () => {
      live = false
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
    screenWidth
  ])
  const offset = (visibleStart - clip.start) * pixelsPerSecond
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
      style={{ left: offset, width: screenWidth }}
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
      {!!peaks.length && (
        <svg viewBox={`0 0 ${peaks.length} 40`} preserveAspectRatio="none">
          <path
            d={peaks
              .map((peak, i) => `M${i} ${20 - Math.abs(peak) * 19}v${Math.abs(peak) * 38}`)
              .join(' ')}
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          />
        </svg>
      )}
    </div>
  )
}
