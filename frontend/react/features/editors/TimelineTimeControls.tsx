import { useRef, useState } from 'react'
import {
  clampTimelinePosition,
  formatTimelineTime,
  normalizeTimelineRange,
  nudgeTimelineTimeInput,
  resolveTimelineTimeInput,
  setTimelineRangeEndpoint,
  timelineTimeInputText
} from './timelineTime'
import './TimelineTimeControls.css'

export function TimelineTimeInput({
  label,
  value,
  onChange,
  onClear,
  max = 86400,
  step = 0.1,
  disabled = false
}: {
  label: string
  value: number | null
  onChange: (value: number) => void | boolean
  onClear?: () => void
  max?: number
  step?: number
  disabled?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [edited, setEdited] = useState(false)
  const [draft, setDraft] = useState('')
  const [validation, setValidation] = useState<{
    value: number | null
    message: string
  } | null>(null)
  const cancelled = useRef(false)
  const nudgedValue = useRef<number | null>(null)
  // Playback changes value every frame. Only an active edit needs local state.
  const text = editing && edited ? draft : timelineTimeInputText(value)
  const invalid = validation?.value === value ? validation.message : ''
  function commit() {
    const result = resolveTimelineTimeInput(
      text,
      cancelled.current ? value : (nudgedValue.current ?? value),
      max,
      {
        clearable: !!onClear,
        cancel: cancelled.current
      }
    )
    let accepted = result.valid
    if (!cancelled.current && accepted && result.value !== value) {
      if (result.value === null) onClear?.()
      else accepted = onChange(result.value) !== false
    }
    cancelled.current = false
    nudgedValue.current = null
    setValidation(
      accepted
        ? null
        : {
            value,
            message: result.valid
              ? '入点需早于出点，已恢复原值'
              : `请输入 0 至 ${formatTimelineTime(max)} 之间的有效时间，已恢复原值`
          }
    )
    setEditing(false)
    setEdited(false)
  }
  return (
    <label className="timeline-time-input">
      <span>{label}</span>
      <input
        aria-label={label}
        aria-invalid={!!invalid}
        title={invalid || '秒数或 时:分:秒.毫秒；上下键微调'}
        placeholder={onClear ? '未设置' : undefined}
        disabled={disabled}
        value={text}
        onFocus={() => {
          cancelled.current = false
          nudgedValue.current = null
          setDraft(timelineTimeInputText(value))
          setValidation(null)
          setEditing(true)
          setEdited(false)
        }}
        onChange={(event) => {
          nudgedValue.current = null
          setDraft(event.currentTarget.value)
          setEdited(true)
          setValidation(null)
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            event.currentTarget.blur()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            cancelled.current = true
            event.currentTarget.blur()
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            const next = nudgeTimelineTimeInput(
              text,
              nudgedValue.current ?? value,
              max,
              (event.key === 'ArrowUp' ? 1 : -1) * step * (event.shiftKey ? 10 : 1)
            )
            nudgedValue.current = next
            setDraft(formatTimelineTime(next))
            setEdited(true)
            setValidation(null)
          }
        }}
      />
    </label>
  )
}

export default function TimelineTimeControls({
  playhead,
  range,
  duration,
  onSeek,
  onRangeChange,
  step = 0.1,
  max = 86400
}: {
  playhead: number
  range: { start: number; end: number } | null
  duration: number
  onSeek: (value: number) => void
  onRangeChange: (range: { start: number; end: number } | null) => void
  step?: number
  max?: number
}) {
  const maximum = clampTimelinePosition(duration, max)
  const currentRange = normalizeTimelineRange(range, maximum)
  function setEndpoint(endpoint: 'start' | 'end', value: number) {
    const next = setTimelineRangeEndpoint(currentRange, endpoint, value, maximum)
    if (!next) return false
    onRangeChange(next)
  }
  return (
    <div className="timeline-time-controls">
      <TimelineTimeInput label="播放头" value={playhead} onChange={onSeek} step={step} max={max} />
      <TimelineTimeInput
        label="入点"
        value={currentRange?.start ?? null}
        onChange={(value) => setEndpoint('start', value)}
        onClear={() => onRangeChange(null)}
        step={step}
        max={maximum}
        disabled={!maximum}
      />
      <TimelineTimeInput
        label="出点"
        value={currentRange?.end ?? null}
        onChange={(value) => setEndpoint('end', value)}
        onClear={() => onRangeChange(null)}
        step={step}
        max={maximum}
        disabled={!maximum}
      />
      <button
        type="button"
        title="以播放头设为入点 (I)"
        disabled={!maximum || playhead >= maximum}
        onClick={() => setEndpoint('start', clampTimelinePosition(playhead, maximum))}
      >
        I
      </button>
      <button
        type="button"
        title="以播放头设为出点 (O)"
        disabled={!maximum || playhead <= 0 || playhead > maximum}
        onClick={() => setEndpoint('end', clampTimelinePosition(playhead, maximum))}
      >
        O
      </button>
      {currentRange && (
        <button type="button" aria-label="清除时间选区" onClick={() => onRangeChange(null)}>
          ×
        </button>
      )}
      {currentRange && (
        <small aria-label="选区时长" title="选区时长">
          {formatTimelineTime(currentRange.end - currentRange.start)}
        </small>
      )}
    </div>
  )
}
