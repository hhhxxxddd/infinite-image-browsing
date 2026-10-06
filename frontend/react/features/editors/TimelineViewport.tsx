import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type FocusEvent,
  type HTMLAttributes,
  type ReactNode,
  type RefObject
} from 'react'
import { TIMELINE_TRACK_HEADER_WIDTH } from './timelineLayout'
import './TimelineViewport.css'

interface TimelineRowProps {
  header: ReactNode
  height: number
  className?: string
  children?: ReactNode
}

export function TimelineRow({ height, className = '', children }: TimelineRowProps) {
  return (
    <div className={`timeline-viewport-row ${className}`} style={{ height }}>
      {children}
    </div>
  )
}

/** The content viewport owns both scroll axes; the ruler and headers only mirror it. */
export default function TimelineViewport({
  children,
  corner,
  ruler,
  overlay,
  width,
  scrollRef,
  scrollProps,
  canvasProps,
  wrapCanvas = (canvas) => canvas,
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  corner: ReactNode
  ruler: ReactNode
  overlay?: ReactNode
  width: number
  scrollRef: RefObject<HTMLDivElement | null>
  scrollProps?: HTMLAttributes<HTMLDivElement>
  canvasProps?: HTMLAttributes<HTMLDivElement>
  wrapCanvas?: (canvas: ReactNode) => ReactNode
}) {
  const rulerRef = useRef<HTMLDivElement>(null)
  const headersRef = useRef<HTMLDivElement>(null)
  const headersViewportRef = useRef<HTMLDivElement>(null)
  const rulerViewportRef = useRef<HTMLDivElement>(null)
  const rows = Children.toArray(children).filter(isValidElement<TimelineRowProps>)

  const synchronize = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    if (rulerRef.current) rulerRef.current.style.transform = `translateX(${-element.scrollLeft}px)`
    if (headersRef.current)
      headersRef.current.style.transform = `translateY(${-element.scrollTop}px)`
    if (headersViewportRef.current)
      headersViewportRef.current.style.height = `${element.clientHeight}px`
    if (rulerViewportRef.current) rulerViewportRef.current.style.width = `${element.clientWidth}px`
  }, [scrollRef])

  function revealFocused(event: FocusEvent<HTMLDivElement>, axis: 'x' | 'y') {
    const element = scrollRef.current
    if (!element) return
    if (axis === 'x' && !event.target.matches('.timeline-marker,[data-range-edge]')) return
    const viewport = event.currentTarget.getBoundingClientRect()
    const target =
      axis === 'y'
        ? (event.target.closest('.timeline-viewport-header-row') ?? event.target)
        : event.target
    const rect = target.getBoundingClientRect()
    if (axis === 'x') {
      if (rect.left < viewport.left) element.scrollLeft += rect.left - viewport.left
      else if (rect.right > viewport.right) element.scrollLeft += rect.right - viewport.right
    } else {
      if (rect.top < viewport.top || rect.height > viewport.height)
        element.scrollTop += rect.top - viewport.top
      else if (rect.bottom > viewport.bottom) element.scrollTop += rect.bottom - viewport.bottom
    }
    synchronize()
  }
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const observer = new ResizeObserver(synchronize)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    synchronize()
    return () => observer.disconnect()
  }, [scrollRef, synchronize])
  useEffect(() => {
    const surfaces = [headersViewportRef.current, rulerViewportRef.current]
    const wheel = (event: WheelEvent) => {
      const element = scrollRef.current
      if (!element) return
      if (event.ctrlKey || event.metaKey) {
        // Route ruler/header zoom through the same native handler as content zoom.
        const forwarded = new WheelEvent('wheel', {
          clientX: event.clientX,
          clientY: event.clientY,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaMode: event.deltaMode,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          cancelable: true
        })
        element.dispatchEvent(forwarded)
        if (forwarded.defaultPrevented) event.preventDefault()
        return
      }
      event.preventDefault()
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1
      element.scrollBy({
        left: (event.deltaX || (event.shiftKey ? event.deltaY : 0)) * unit,
        top: (event.shiftKey ? 0 : event.deltaY) * unit
      })
    }
    surfaces.forEach((surface) => surface?.addEventListener('wheel', wheel, { passive: false }))
    return () => surfaces.forEach((surface) => surface?.removeEventListener('wheel', wheel))
  }, [scrollRef])

  const canvas = (
    <div
      {...canvasProps}
      className={`timeline-viewport-canvas ${canvasProps?.className ?? ''}`}
      style={{ ...canvasProps?.style, width }}
    >
      {rows}
      {overlay}
    </div>
  )
  return (
    <div
      {...props}
      className={`timeline-viewport ${className}`}
      style={
        {
          '--timeline-track-header-width': `${TIMELINE_TRACK_HEADER_WIDTH}px`,
          ...props.style
        } as CSSProperties
      }
    >
      <div className="timeline-viewport-corner">{corner}</div>
      <div
        className="timeline-viewport-ruler"
        ref={rulerViewportRef}
        onFocusCapture={(event) => revealFocused(event, 'x')}
      >
        <div ref={rulerRef} style={{ width }}>
          {ruler}
        </div>
      </div>
      <div
        className="timeline-viewport-headers"
        ref={headersViewportRef}
        onFocusCapture={(event) => revealFocused(event, 'y')}
      >
        <div ref={headersRef}>
          {rows.map((row) => (
            <div
              key={row.key}
              className={`timeline-viewport-header-row ${row.props.className ?? ''}`}
              style={{ height: row.props.height }}
            >
              {row.props.header}
            </div>
          ))}
        </div>
      </div>
      <div
        {...scrollProps}
        ref={scrollRef}
        className={`timeline-viewport-scroll ${scrollProps?.className ?? ''}`}
        onScroll={(event) => {
          synchronize()
          scrollProps?.onScroll?.(event)
        }}
      >
        {wrapCanvas(canvas)}
      </div>
    </div>
  )
}
