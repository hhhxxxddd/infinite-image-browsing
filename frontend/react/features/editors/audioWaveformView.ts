import type { AudioClip } from '../../../src/features/media-editor/model/audioTimeline'

export interface AudioWaveformProps {
  clip: AudioClip
  workspaceId: string
  zoom: number
  left: number
  width: number
  retry: number
  amplitude?: number
  stereo?: boolean
}

/** Anchor a decoded source window to its clip while the next visible window loads. */
export function audioWaveformGeometry(
  window: { window_start: number; window_duration: number },
  clip: Pick<AudioClip, 'start' | 'sourceIn' | 'duration' | 'rate'>,
  zoom: number,
  reverse = false,
  viewport?: { left: number; width: number }
) {
  const from = (window.window_start - clip.sourceIn) / (clip.rate ?? 1)
  const duration = window.window_duration / (clip.rate ?? 1)
  const geometry = {
    left: (reverse ? clip.duration - from - duration : from) * zoom,
    width: duration * zoom
  }
  if (!viewport) return geometry
  const fromPixel = Math.max(geometry.left, 0, viewport.left - clip.start * zoom)
  const toPixel = Math.min(
    geometry.left + geometry.width,
    clip.duration * zoom,
    viewport.left + viewport.width - clip.start * zoom
  )
  if (toPixel <= fromPixel) return null
  return {
    ...geometry,
    clipPath: `inset(0 ${Math.max(0, geometry.left + geometry.width - toPixel)}px 0 ${Math.max(0, fromPixel - geometry.left)}px)`
  }
}

/** Keep each peak's original rectangle geometry without a DOM node per sample. */
export function audioWaveformPath(peaks: number[], amplitude: number, lane: number, channel = 0) {
  return peaks
    .map((peak, index) => {
      const height = Math.max(0.4, Math.min(lane - 2, peak * amplitude * (lane - 2)))
      const y = channel * lane + (lane - height) / 2
      return `M${index * 3},${y}h2v${height}h-2z`
    })
    .join('')
}

/** Clip names, selection and processing controls do not change the source waveform. */
export function sameAudioWaveformProps(previous: AudioWaveformProps, next: AudioWaveformProps) {
  return (
    previous.workspaceId === next.workspaceId &&
    previous.zoom === next.zoom &&
    previous.left === next.left &&
    previous.width === next.width &&
    previous.retry === next.retry &&
    (previous.amplitude ?? 1) === (next.amplitude ?? 1) &&
    (previous.stereo ?? false) === (next.stereo ?? false) &&
    previous.clip.path === next.clip.path &&
    previous.clip.sourceKind === next.clip.sourceKind &&
    previous.clip.start === next.clip.start &&
    previous.clip.sourceIn === next.clip.sourceIn &&
    previous.clip.duration === next.clip.duration &&
    (previous.clip.rate ?? 1) === (next.clip.rate ?? 1) &&
    (previous.clip.audioStream ?? 0) === (next.clip.audioStream ?? 0)
  )
}
