import { sampleTime, type AudioClip } from './audioTimeline.ts'
import { automationGain, type GainPoint } from './audioProcessing.ts'

export function gainPointAt(clip: AudioClip, local: number, gain: number): GainPoint {
  return {
    time: sampleTime(clip.envelopeOffset + Math.max(0, Math.min(clip.duration, local))),
    gain: Math.max(0, Math.min(4, gain))
  }
}
export function insertGainPoint(clip: AudioClip, local: number, gain?: number) {
  const point = gainPointAt(
    clip,
    local,
    gain ?? automationGain(clip.gainPoints, clip.envelopeOffset + local)
  )
  const points = [...(clip.gainPoints ?? [])]
  const at = points.findIndex((p) => Math.abs(p.time - point.time) < 1 / 48000)
  if (at >= 0) points[at] = point
  else if (points.length < 128) points.push(point)
  return points.sort((a, b) => a.time - b.time)
}
export function moveGainPoint(clip: AudioClip, index: number, local: number, gain: number) {
  const points = (clip.gainPoints ?? []).map((p) => ({ ...p }))
  if (!points[index]) return points
  const point = gainPointAt(clip, local, gain)
  point.time = Math.max(
    points[index - 1]?.time + 1 / 48000 || clip.envelopeOffset,
    Math.min(
      (points[index + 1]?.time ?? clip.envelopeOffset + clip.duration + 1 / 48000) - 1 / 48000,
      point.time
    )
  )
  points[index] = point
  return points
}
export function seamAuditionRange(
  clip: AudioClip,
  edge: 'start' | 'end',
  end: number,
  seconds = 1.5
) {
  const time = clip.start + (edge === 'end' ? clip.duration : 0)
  return {
    start: sampleTime(Math.max(0, time - seconds)),
    end: sampleTime(Math.min(end, time + seconds))
  }
}
