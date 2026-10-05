import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'
import {
  clampTimelinePosition,
  clampTimelineRange,
  formatTimelineTime,
  normalizeTimelineRange,
  type TimelineRange
} from './timelineTime'
import './TimelineControls.css'
import { useFrameAction } from './useFrameAction'

type RulerPointer = Pick<
  PointerEvent<HTMLDivElement>,
  'clientX' | 'shiftKey' | 'pointerType' | 'currentTarget'
>

interface RulerDrag {
  pointerId: number
  x: number
  start: number
  edge?: 'start' | 'end'
  range: TimelineRange | null
  playhead: number
  moved: boolean
}

export default function TimelineRuler({
  className = '',
  width,
  duration,
  contentEnd,
  pixelsPerSecond,
  fps,
  ticks,
  viewportLeft,
  viewportWidth,
  headerWidth,
  scrollContainer,
  playhead,
  range,
  step,
  showPlayhead = false,
  onSeek,
  onRangeChange,
  alignSelection
}: {
  className?: string
  width: number
  duration: number
  contentEnd: number
  pixelsPerSecond: number
  fps?: number
  ticks: number[]
  viewportLeft: number
  viewportWidth: number
  headerWidth: number
  scrollContainer: RefObject<HTMLDivElement | null>
  playhead: number
  range: TimelineRange | null
  step: number
  showPlayhead?: boolean
  onSeek: (time: number) => void
  onRangeChange: (range: TimelineRange | null) => void
  alignSelection: (time: number, bypass: boolean) => number
}) {
  // Pointer feedback stays local; hovering does not rerender previews, waveforms or clips.
  const [hover, setHover] = useState<{ time: number; labelLeft: number } | null>(null)
  const drag = useRef<RulerDrag | null>(null)
  const elementRef = useRef<HTMLDivElement>(null)
  const frames = useFrameAction()
  const selected = normalizeTimelineRange(range, contentEnd)
  useEffect(
    () => setHover(null),
    [viewportLeft, viewportWidth, width, duration, pixelsPerSecond, fps]
  )

  function cancelDrag() {
    frames.cancel()
    const current = drag.current
    drag.current = null
    if (current?.moved) {
      onRangeChange(current.range)
      onSeek(current.playhead)
    }
    if (current && elementRef.current?.hasPointerCapture(current.pointerId))
      elementRef.current.releasePointerCapture(current.pointerId)
    setHover(null)
  }
  const cancelRef = useRef(cancelDrag)
  cancelRef.current = cancelDrag
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !drag.current) return
      event.preventDefault()
      event.stopImmediatePropagation()
      cancelRef.current()
    }
    window.addEventListener('keydown', cancel, true)
    return () => window.removeEventListener('keydown', cancel, true)
  }, [])
  function pointerTime(clientX: number, element: HTMLDivElement) {
    return clampTimelinePosition(
      (clientX - element.getBoundingClientRect().left) / pixelsPerSecond,
      duration
    )
  }
  function updateHover(event: RulerPointer) {
    if (event.pointerType === 'touch') return
    const rect = event.currentTarget.getBoundingClientRect()
    const scroll = scrollContainer.current
    const scrollLeft = scroll?.getBoundingClientRect().left ?? rect.left
    const left = Math.max(0, scrollLeft + (scroll ? headerWidth : 0) - rect.left)
    const right = Math.min(width, scrollLeft + (scroll?.clientWidth ?? width) - rect.left)
    const time = clampTimelinePosition((event.clientX - rect.left) / pixelsPerSecond, duration)
    setHover({
      time,
      labelLeft: Math.max(left + 4, Math.min(time * pixelsPerSecond + 10, right - 112))
    })
  }
  function move(event: RulerPointer) {
    const current = drag.current
    if (current && (current.edge || Math.abs(event.clientX - current.x) > 4 || current.moved)) {
      const root = scrollContainer.current
      if (root) {
        const rect = root.getBoundingClientRect()
        if (event.clientX > rect.right - 22) root.scrollLeft += 18
        else if (event.clientX < rect.left + headerWidth + 22) root.scrollLeft -= 18
      }
      const time = alignSelection(pointerTime(event.clientX, event.currentTarget), event.shiftKey)
      const first =
        current.edge === 'end'
          ? (current.range?.start ?? current.start)
          : current.edge
            ? time
            : alignSelection(current.start, event.shiftKey)
      const last = current.edge === 'start' ? (current.range?.end ?? current.start) : time
      if (!current.moved) onSeek(current.start)
      current.moved = true
      onRangeChange(normalizeTimelineRange(clampTimelineRange(first, last, contentEnd), contentEnd))
    }
    updateHover(event)
  }
  return (
    <div
      ref={elementRef}
      className={`timeline-ruler ${className}`}
      tabIndex={0}
      style={{ width }}
      aria-label="时间尺，点击定位或拖动选择时间范围"
      onPointerEnter={updateHover}
      onPointerMove={(event) => {
        const input = {
          clientX: event.clientX,
          shiftKey: event.shiftKey,
          pointerType: event.pointerType,
          currentTarget: event.currentTarget
        }
        frames.schedule(() => move(input))
      }}
      onPointerLeave={() => {
        if (!drag.current) {
          frames.cancel()
          setHover(null)
        }
      }}
      onPointerCancel={cancelDrag}
      onLostPointerCapture={() => {
        if (drag.current) cancelDrag()
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        event.currentTarget.focus({ preventScroll: true })
        const edge = (event.target as HTMLElement).dataset.rangeEdge as 'start' | 'end' | undefined
        drag.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          start: pointerTime(event.clientX, event.currentTarget),
          edge,
          range: selected,
          playhead,
          moved: false
        }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerUp={(event) => {
        const current = drag.current
        if (current?.pointerId !== event.pointerId) return
        frames.flush(() => move(event))
        // Pointer coordinates retain fractions; native click coordinates may be integer-rounded.
        if (!current.moved && !current.edge) onSeek(pointerTime(event.clientX, event.currentTarget))
        drag.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId)
      }}
    >
      {ticks.map((time) => (
        <span className="timeline-ruler-tick" key={time} style={{ left: time * pixelsPerSecond }}>
          {fps && pixelsPerSecond > fps * 24
            ? `${formatTimelineTime(time)} · ${Math.round((time % 1) * fps)}f`
            : formatTimelineTime(time)}
        </span>
      ))}
      {selected && (
        <div
          className="timeline-ruler-range"
          style={{
            left: selected.start * pixelsPerSecond,
            width: (selected.end - selected.start) * pixelsPerSecond
          }}
          aria-label={`选区 ${formatTimelineTime(selected.start)} 至 ${formatTimelineTime(selected.end)}`}
        >
          {(['start', 'end'] as const).map((edge) => (
            <button
              key={edge}
              type="button"
              aria-label={edge === 'start' ? '拖动入点' : '拖动出点'}
              data-range-edge={edge}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
                event.preventDefault()
                event.stopPropagation()
                const value =
                  selected[edge] +
                  (event.key === 'ArrowRight' ? 1 : -1) * step * (event.shiftKey ? 10 : 1)
                onRangeChange(
                  normalizeTimelineRange(
                    { ...selected, [edge]: clampTimelinePosition(value, contentEnd) },
                    contentEnd
                  )
                )
              }}
            />
          ))}
        </div>
      )}
      {showPlayhead && (
        <i className="timeline-ruler-playhead" style={{ left: playhead * pixelsPerSecond }} />
      )}
      {hover && (
        <>
          <div
            className="timeline-ruler-hover-guide"
            style={{ left: hover.time * pixelsPerSecond }}
            aria-hidden="true"
          />
          <output
            className="timeline-ruler-hover-time"
            style={{ left: hover.labelLeft }}
            aria-hidden="true"
          >
            {formatTimelineTime(hover.time)}
          </output>
        </>
      )}
    </div>
  )
}
