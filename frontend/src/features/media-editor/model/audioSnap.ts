import type { AudioTimelineDocument } from './audioTimeline.ts'

export function timelineSnapPoints(
  doc: AudioTimelineDocument,
  playhead?: number,
  excludeId?: string
) {
  const points = [0]
  if (playhead !== undefined) points.push(playhead)
  for (const track of [...doc.tracks, ...(doc.textTracks ?? [])]) {
    for (const item of 'clips' in track ? track.clips : track.cues) {
      if (item.id !== excludeId) points.push(item.start, item.start + item.duration)
    }
  }
  for (const marker of doc.markers ?? []) if (marker.id !== excludeId) points.push(marker.time)
  return [...new Set(points)].sort((a, b) => a - b)
}

/** The tolerance is measured in screen pixels by the caller, independent of zoom. */
export function snapTime(value: number, points: number[], tolerance: number, min = 0, max = 86400) {
  const time = Math.max(min, Math.min(max, value))
  let low = 0,
    high = points.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (points[mid] < time) low = mid + 1
    else high = mid
  }
  let anchor: number | undefined
  let distance = tolerance + Number.EPSILON
  for (const index of [low - 1, low]) {
    const point = points[index]
    if (point === undefined || point < min || point > max) continue
    const delta = Math.abs(point - time)
    if (delta < distance) {
      anchor = point
      distance = delta
    }
  }
  return { time: anchor ?? time, anchor }
}

export function snapSpanStart(
  start: number,
  duration: number,
  points: number[],
  tolerance: number
) {
  const max = 86400 - duration
  const first = snapTime(start, points, tolerance, 0, max)
  const last = snapTime(
    Math.max(0, Math.min(max, start)) + duration,
    points,
    tolerance,
    duration,
    86400
  )
  if (
    last.anchor !== undefined &&
    (first.anchor === undefined ||
      Math.abs(last.time - duration - start) < Math.abs(first.time - start))
  )
    return { time: last.time - duration, anchor: last.anchor }
  return first
}
