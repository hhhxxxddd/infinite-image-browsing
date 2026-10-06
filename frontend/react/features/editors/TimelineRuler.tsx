import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type RefObject
} from 'react'
import {
  clampTimelinePosition,
  clampTimelineRange,
  formatTimelineTime,
  normalizeTimelineRange,
  timelinePointerTime,
  type TimelineRange
} from './timelineTime'
import './TimelineControls.css'
import { useFrameAction } from './useFrameAction'
import { Menu } from '@mantine/core'
import { IconFlag } from '@tabler/icons-react'
import TimelineMarker from './TimelineMarker'

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
  scrollLeft: number
  marker?: { id: string; time: number }
  nextTime?: number
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
  scrollContainer,
  playhead,
  range,
  step,
  showPlayhead = false,
  onSeek,
  onSeekCommit,
  onRangeChange,
  alignSelection,
  markers = [],
  selectedMarkerId,
  markerEditingDisabled = false,
  markerAddingDisabled = false,
  onMarkerSelect,
  onMarkerMove,
  onMarkerAdd,
  alignMarker
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
  scrollContainer: RefObject<HTMLDivElement | null>
  playhead: number
  range: TimelineRange | null
  step: number
  showPlayhead?: boolean
  onSeek: (time: number) => void
  onSeekCommit?: () => void
  onRangeChange: (range: TimelineRange | null) => void
  alignSelection: (time: number, bypass: boolean) => number
  markers?: { id: string; name: string; time: number; note?: string }[]
  selectedMarkerId?: string
  markerEditingDisabled?: boolean
  markerAddingDisabled?: boolean
  onMarkerSelect?: (id: string, time: number) => void
  onMarkerMove?: (id: string, time: number) => void
  onMarkerAdd?: (time: number) => void
  alignMarker?: (time: number, bypass: boolean, id: string) => number
}) {
  // Pointer feedback stays local; hovering does not rerender previews, waveforms or clips.
  const [hover, setHover] = useState<{ time: number; labelLeft: number } | null>(null)
  const drag = useRef<RulerDrag | null>(null)
  const [markerPreview, setMarkerPreview] = useState<{ id: string; time: number } | null>(null)
  const [menuTime, setMenuTime] = useState(0)
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
    setMarkerPreview(null)
    if (current?.moved && !current.marker) {
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
    const scroll = scrollContainer.current
    return timelinePointerTime({
      clientX,
      viewportLeft: (scroll ?? element).getBoundingClientRect().left,
      scrollLeft: scroll?.scrollLeft ?? 0,
      pixelsPerSecond,
      duration
    })
  }
  function updateHover(event: RulerPointer, markerTime?: number) {
    if (event.pointerType === 'touch') return
    const rect = event.currentTarget.getBoundingClientRect()
    const scroll = scrollContainer.current
    const left = scroll?.scrollLeft ?? 0
    const right = Math.min(width, left + (scroll?.clientWidth ?? rect.width))
    const time = markerTime ?? pointerTime(event.clientX, event.currentTarget)
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
        else if (event.clientX < rect.left + 22) root.scrollLeft -= 18
      }
      if (current.marker) {
        const raw = clampTimelinePosition(
          current.marker.time +
            (event.clientX - current.x + (root?.scrollLeft ?? 0) - current.scrollLeft) /
              pixelsPerSecond,
          duration
        )
        const time = alignMarker?.(raw, event.shiftKey, current.marker.id) ?? raw
        current.moved = true
        current.nextTime = time
        setMarkerPreview({ id: current.marker.id, time })
        updateHover(event, time)
        return
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
  const ruler = (
    <div
      ref={elementRef}
      className={`timeline-ruler ${className}`}
      tabIndex={0}
      style={{ width }}
      aria-label="时间尺，点击定位或拖动选择时间范围"
      onContextMenu={(event) => {
        event.stopPropagation()
        setMenuTime(pointerTime(event.clientX, event.currentTarget))
      }}
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
        const target = event.target as HTMLElement
        const markerButton = target.closest<HTMLButtonElement>('[data-marker-id]')
        const marker = markers.find((item) => item.id === markerButton?.dataset.markerId)
        if (marker && markerEditingDisabled) {
          markerButton?.focus({ preventScroll: true })
          onMarkerSelect?.(marker.id, marker.time)
          return
        }
        if (marker) onSeek(playhead)
        const focusTarget = markerButton ?? event.currentTarget
        focusTarget.focus({ preventScroll: true })
        const edge = (event.target as HTMLElement).dataset.rangeEdge as 'start' | 'end' | undefined
        drag.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          start: pointerTime(event.clientX, event.currentTarget),
          edge,
          range: selected,
          playhead,
          moved: false,
          scrollLeft: scrollContainer.current?.scrollLeft ?? 0,
          marker
        }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerUp={(event) => {
        const current = drag.current
        if (current?.pointerId !== event.pointerId) return
        frames.flush(() => move(event))
        // Pointer coordinates retain fractions; native click coordinates may be integer-rounded.
        if (current.marker) {
          const time = current.nextTime ?? current.marker.time
          if (current.moved && time !== current.marker.time) onMarkerMove?.(current.marker.id, time)
          onMarkerSelect?.(current.marker.id, time)
          setMarkerPreview(null)
        } else {
          if (!current.moved && !current.edge)
            onSeek(pointerTime(event.clientX, event.currentTarget))
          onSeekCommit?.()
        }
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
        <i
          className="timeline-ruler-playhead"
          style={
            {
              left: playhead * pixelsPerSecond,
              '--timeline-cap-offset': `${Math.max(-5, Math.min(0, viewportLeft - playhead * pixelsPerSecond))}px`
            } as CSSProperties
          }
        />
      )}
      {markers.map((marker) => {
        const time = markerPreview?.id === marker.id ? markerPreview.time : marker.time
        return (
          <TimelineMarker
            key={marker.id}
            name={marker.name}
            note={marker.note}
            time={time}
            selected={selectedMarkerId === marker.id || markerPreview?.id === marker.id}
            data-marker-id={marker.id}
            data-dragging={markerPreview?.id === marker.id || undefined}
            style={{
              left: time * pixelsPerSecond,
              transform: `translateX(${Math.max(-5, Math.min(0, viewportLeft - time * pixelsPerSecond))}px)`,
              visibility:
                time * pixelsPerSecond < viewportLeft ||
                time * pixelsPerSecond > viewportLeft + viewportWidth
                  ? 'hidden'
                  : undefined,
              cursor: markerEditingDisabled ? 'pointer' : undefined
            }}
            onClick={(event) => {
              if (event.detail === 0) onMarkerSelect?.(marker.id, time)
            }}
            onKeyDown={(event) => {
              if (markerEditingDisabled || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
              event.preventDefault()
              event.stopPropagation()
              const next = clampTimelinePosition(
                time + (event.key === 'ArrowRight' ? 1 : -1) * step * (event.shiftKey ? 10 : 1),
                duration
              )
              const aligned = alignMarker?.(next, true, marker.id) ?? next
              if (aligned !== time) onMarkerMove?.(marker.id, aligned)
              onMarkerSelect?.(marker.id, aligned)
            }}
          />
        )
      })}
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
  return (
    <Menu withinPortal position="bottom-start">
      <Menu.ContextMenu>{ruler}</Menu.ContextMenu>
      <Menu.Dropdown>
        <Menu.Item
          leftSection={<IconFlag size={14} />}
          disabled={markerEditingDisabled || markerAddingDisabled || !onMarkerAdd}
          onClick={() => onMarkerAdd?.(menuTime)}
        >
          在此添加标记
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}
