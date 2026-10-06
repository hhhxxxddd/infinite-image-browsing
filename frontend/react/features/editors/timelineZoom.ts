export interface TimelineZoomAnchor {
  time: number
  offset: number
}

/** Each zoom step moves the chosen time closer to the visible content's center. */
export function timelineZoomAnchor({
  focusTime,
  previousZoom,
  nextZoom,
  scrollLeft,
  viewportWidth,
  pointerAnchor = null
}: {
  focusTime: number | null
  previousZoom: number
  nextZoom: number
  scrollLeft: number
  viewportWidth: number
  pointerAnchor?: TimelineZoomAnchor | null
}): TimelineZoomAnchor | null {
  if (focusTime === null) return pointerAnchor
  const width = Math.max(1, viewportWidth)
  const center = width / 2
  const offset = Math.max(0, Math.min(width, focusTime * previousZoom - scrollLeft))
  const remaining = Math.min(previousZoom / nextZoom, nextZoom / previousZoom)
  return { time: focusTime, offset: center + (offset - center) * remaining }
}
