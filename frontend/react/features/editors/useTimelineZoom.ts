import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { useFrameAction } from './useFrameAction'
import { timelineZoomAnchor, type TimelineZoomAnchor } from './timelineZoom'

/** Native non-passive wheel handling prevents Ctrl+wheel from zooming the whole page. */
export function useTimelineZoom(
  container: RefObject<HTMLDivElement | null>,
  zoom: number,
  maximum: number,
  onZoom: (zoom: number) => void,
  focusTime: number | null = null
) {
  const anchor = useRef<{ zoom: number; position: TimelineZoomAnchor } | null>(null)
  const frames = useFrameAction()
  const latest = useRef({ zoom, maximum, onZoom, focusTime })
  latest.current = { zoom, maximum, onZoom, focusTime }
  const pendingZoom = useRef(zoom)
  const zoomTo = useCallback(
    (value: number, pointerAnchor: TimelineZoomAnchor | null = null) => {
      frames.cancel()
      const current = latest.current
      const next = Math.min(current.maximum, Math.max(0.03125, value))
      pendingZoom.current = next
      if (next === current.zoom) return
      const element = container.current
      const position = element
        ? timelineZoomAnchor({
            focusTime: current.focusTime,
            previousZoom: current.zoom,
            nextZoom: next,
            scrollLeft: element.scrollLeft,
            viewportWidth: element.clientWidth,
            pointerAnchor
          })
        : null
      anchor.current = position ? { zoom: next, position } : null
      current.onZoom(next)
    },
    [container, frames]
  )
  useLayoutEffect(() => {
    if (anchor.current?.zoom === zoom && container.current) {
      const { time, offset } = anchor.current.position
      container.current.scrollLeft = Math.max(0, time * zoom - offset)
    }
    anchor.current = null
    pendingZoom.current = zoom
  }, [container, zoom])
  useEffect(() => {
    const element = container.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || !event.deltaY) return
      event.preventDefault()
      const current = latest.current
      const offset = Math.max(0, event.clientX - element.getBoundingClientRect().left)
      const time = (element.scrollLeft + offset) / current.zoom
      pendingZoom.current = Math.min(
        current.maximum,
        Math.max(0.03125, pendingZoom.current * (event.deltaY < 0 ? 1.15 : 1 / 1.15))
      )
      frames.schedule(() => {
        if (pendingZoom.current === latest.current.zoom) return
        zoomTo(pendingZoom.current, { time, offset })
      })
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => {
      element.removeEventListener('wheel', wheel)
      frames.cancel()
    }
  }, [container, frames, zoomTo])
  return zoomTo
}
