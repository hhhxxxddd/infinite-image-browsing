export interface TimelineNavigationClip {
  id: string
  start: number
  duration: number
}
export interface TimelineNavigationRange {
  start: number
  end: number
}
export interface TimelineViewport {
  position: number
  pixelsPerSecond: number
  scrollLeft: number
  viewportWidth: number
  headerWidth?: number
  contentDuration?: number
  /** Fraction of the visible content kept clear near each edge. */
  margin?: number
}
export function timelineNavigationPoints(
  clips: readonly TimelineNavigationClip[],
  markers: readonly { time: number }[],
  kind: 'all' | 'cuts' | 'markers' = 'all'
) {
  const values = [
    ...(kind === 'markers'
      ? []
      : clips
          .filter(
            (clip) =>
              Number.isFinite(clip.start) &&
              Number.isFinite(clip.duration) &&
              clip.start >= 0 &&
              clip.duration > 0
          )
          .flatMap((clip) => [clip.start, clip.start + clip.duration])),
    ...(kind === 'cuts' ? [] : markers.map((marker) => marker.time))
  ]
    .filter((time) => Number.isFinite(time) && time >= 0)
    .sort((a, b) => a - b)
  const points: number[] = []
  for (const time of values)
    if (!points.length || time - points[points.length - 1] > 1e-6) points.push(time)
  return points
}
export function nextTimelinePoint(
  points: readonly number[],
  position: number,
  direction: 'next' | 'previous'
) {
  if (!Number.isFinite(position)) return undefined
  const candidates = points.filter(
    (time) =>
      Number.isFinite(time) &&
      time >= 0 &&
      (direction === 'next' ? time > position + 1e-6 : time < position - 1e-6)
  )
  return candidates.length
    ? direction === 'next'
      ? Math.min(...candidates)
      : Math.max(...candidates)
    : undefined
}
export function timelineSelectionRange(
  clips: readonly TimelineNavigationClip[],
  ids: readonly string[]
): TimelineNavigationRange | null {
  const chosen = new Set(ids)
  const selected = clips.filter(
    (clip) =>
      chosen.has(clip.id) &&
      Number.isFinite(clip.start) &&
      Number.isFinite(clip.duration) &&
      clip.start >= 0 &&
      clip.duration > 0
  )
  return selected.length
    ? {
        start: Math.min(...selected.map((clip) => clip.start)),
        end: Math.max(...selected.map((clip) => clip.start + clip.duration))
      }
    : null
}
function viewportGeometry(options: TimelineViewport) {
  const zoom =
    Number.isFinite(options.pixelsPerSecond) && options.pixelsPerSecond > 0
      ? options.pixelsPerSecond
      : 1
  const viewportWidth = Number.isFinite(options.viewportWidth)
    ? Math.max(1, options.viewportWidth)
    : 1
  const headerWidth = Number.isFinite(options.headerWidth)
    ? Math.max(0, options.headerWidth ?? 0)
    : 0
  const width = Math.max(1, viewportWidth - headerWidth)
  const maximum =
    options.contentDuration === undefined
      ? Infinity
      : Math.max(
          0,
          (Number.isFinite(options.contentDuration) ? options.contentDuration : 0) * zoom - width
        )
  const clamp = (value: number) =>
    Math.max(0, Math.min(maximum, Number.isFinite(value) ? value : 0))
  return { zoom, width, clamp }
}
export function followTimelineViewport(options: TimelineViewport) {
  const { zoom, width, clamp } = viewportGeometry(options)
  const left = clamp(options.scrollLeft),
    pixel = Math.max(0, options.position) * zoom
  if (!Number.isFinite(pixel)) return left
  const margin = Number.isFinite(options.margin) ? (options.margin ?? 0.15) : 0.15
  const padding = width * Math.min(0.45, Math.max(0, margin))
  if (pixel < left + padding) return clamp(pixel - padding)
  if (pixel > left + width - padding) return clamp(pixel - width + padding)
  return left
}
export function locateTimelineSelection(
  range: TimelineNavigationRange,
  options: Omit<TimelineViewport, 'position'>
) {
  const { zoom, width, clamp } = viewportGeometry({ ...options, position: range.start })
  const start = Math.max(0, Number.isFinite(range.start) ? range.start : 0)
  const end = Math.max(start, Number.isFinite(range.end) ? range.end : start)
  const span = (end - start) * zoom
  const left = span < width ? start * zoom - (width - span) / 2 : start * zoom - width * 0.05
  return { playhead: start, scrollLeft: clamp(left) }
}
