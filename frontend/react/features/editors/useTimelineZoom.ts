import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { useFrameAction } from './useFrameAction'

/** Native non-passive wheel handling prevents Ctrl+wheel from zooming the whole page. */
export function useTimelineZoom(
  container: RefObject<HTMLDivElement | null>,
  zoom: number,
  maximum: number,
  headerWidth: number,
  onZoom: (zoom: number) => void
) {
  const anchor = useRef<{ time: number; offset: number } | null>(null)
  const frames = useFrameAction()
  const latest = useRef({ zoom, maximum, headerWidth, onZoom })
  latest.current = { zoom, maximum, headerWidth, onZoom }
  const pendingZoom = useRef(zoom)
  useLayoutEffect(() => {
    if (anchor.current && container.current) {
      container.current.scrollLeft = Math.max(0, anchor.current.time * zoom - anchor.current.offset)
      anchor.current = null
    }
    pendingZoom.current = zoom
  }, [container, zoom])
  useEffect(() => {
    const element = container.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || !event.deltaY) return
      event.preventDefault()
      const current = latest.current
      const offset = Math.max(
        0,
        event.clientX - element.getBoundingClientRect().left - current.headerWidth
      )
      const time = (element.scrollLeft + offset) / current.zoom
      pendingZoom.current = Math.min(
        current.maximum,
        Math.max(0.03125, pendingZoom.current * (event.deltaY < 0 ? 1.15 : 1 / 1.15))
      )
      frames.schedule(() => {
        if (pendingZoom.current === latest.current.zoom) return
        anchor.current = { time, offset }
        latest.current.onZoom(pendingZoom.current)
      })
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => {
      element.removeEventListener('wheel', wheel)
      frames.cancel()
    }
  }, [container, frames])
}
