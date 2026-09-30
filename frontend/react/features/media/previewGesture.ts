export interface TouchPoint {
  x: number
  y: number
}

/** Match the legacy preview's short vertical swipe without stealing horizontal drags. */
export function previewSwipeDirection(
  start: TouchPoint,
  end: TouchPoint,
  viewportHeight: number
): 'previous' | 'next' | null {
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const threshold = Math.min(80, Math.max(1, viewportHeight) * 0.15)
  if (Math.abs(deltaY) <= threshold || Math.abs(deltaY) <= Math.abs(deltaX) * 1.25) return null
  return deltaY > 0 ? 'previous' : 'next'
}
