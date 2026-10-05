import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActionIcon,
  Checkbox,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
  Tooltip
} from '@mantine/core'
import { IconCopy, IconPlus, IconTrash } from '@tabler/icons-react'
import {
  bounded,
  evaluatedTransform,
  type VideoAnimatedField,
  type VideoClip
} from './videoStudioModel'
import {
  copyVideoKeyframesToTime,
  moveVideoKeyframes,
  patchVideoKeyframes,
  upsertVideoKeyframe,
  videoEasingLabels,
  type VideoAnimationEdit
} from './videoAnimationEditing'
import './VideoKeyframesEditor.css'
import EditorDisclosure from './EditorDisclosure'
import { EditorPointerGesture } from './editorPointerGesture'
import { useFrameAction } from './useFrameAction'

const fields: {
  value: VideoAnimatedField
  label: string
  min: number
  max: number
  factor: number
}[] = [
  { value: 'x', label: '水平位置', min: -200, max: 200, factor: 100 },
  { value: 'y', label: '垂直位置', min: -200, max: 200, factor: 100 },
  { value: 'scale', label: '缩放', min: 5, max: 400, factor: 100 },
  { value: 'rotation', label: '旋转', min: -360, max: 360, factor: 1 },
  { value: 'opacity', label: '透明度', min: 0, max: 100, factor: 100 }
]
export default function VideoKeyframesEditor({
  clip,
  disabled,
  playhead,
  fps = 30,
  onChange,
  onSeek,
  onInteractionStart,
  onInteractionEnd
}: {
  clip: VideoClip
  disabled: boolean
  playhead: number
  fps?: number
  onChange: (clip: VideoClip) => void
  onSeek?: (time: number) => void
  onInteractionStart?: () => void
  onInteractionEnd?: (cancelled?: boolean) => void
}) {
  const [field, setField] = useState<VideoAnimatedField>('x'),
    [selected, setSelected] = useState<number[]>([])
  const [recordFields, setRecordFields] = useState<VideoAnimatedField[]>([
    'x',
    'y',
    'scale',
    'rotation',
    'opacity'
  ])
  const [error, setError] = useState(''),
    axis = useRef<HTMLDivElement>(null)
  const gesture = useRef<{
    original: VideoClip
    selected: number[]
    clientX: number
    pointerId: number
    width: number
    started: boolean
    lastTimes: number[]
  } | null>(null)
  const dragFrame = useFrameAction()
  const lifecycle = useRef(new EditorPointerGesture()),
    mounted = useRef(true)
  useEffect(() => {
    if (disabled || (gesture.current && gesture.current.original.id !== clip.id)) dragFrame.cancel()
    lifecycle.current.cancelIf(clip.id, disabled)
  }, [clip.id, disabled, dragFrame])
  useEffect(() => {
    mounted.current = true
    const transaction = lifecycle.current
    return () => {
      mounted.current = false
      dragFrame.cancel()
      transaction.finish(true)
    }
  }, [dragFrame])
  const frames = clip.keyframes ?? [],
    selectedFrames = frames.filter((f) => selected.includes(f.time))
  const meta = fields.find((f) => f.value === field) ?? fields[0],
    local = bounded(playhead - clip.start, 0, clip.duration)
  const curve = useMemo(() => {
    const raw = { ...clip, fadeIn: 0, fadeOut: 0, transitionIn: undefined }
    const samples = Array.from({ length: 65 }, (_, i) => ({
      time: (clip.duration * i) / 64,
      value: evaluatedTransform(raw, (clip.duration * i) / 64)[field]
    }))
    const min = Math.min(...samples.map((s) => s.value)),
      max = Math.max(...samples.map((s) => s.value)),
      span = Math.max(0.01, max - min)
    return samples
      .map((s) => `${(s.time / clip.duration) * 100},${42 - ((s.value - min) / span) * 34}`)
      .join(' ')
  }, [clip, field])
  const value =
    selectedFrames.length && selectedFrames.every((f) => f[field] === selectedFrames[0][field])
      ? selectedFrames[0][field]
      : undefined
  const easing =
    selectedFrames.length &&
    selectedFrames.every(
      (f) =>
        (f.curves?.[field]?.easing ?? f.easing ?? 'linear') ===
        (selectedFrames[0].curves?.[field]?.easing ?? selectedFrames[0].easing ?? 'linear')
    )
      ? (selectedFrames[0].curves?.[field]?.easing ?? selectedFrames[0].easing ?? 'linear')
      : null
  const apply = (result: VideoAnimationEdit) => {
    setError(result.error ?? '')
    if (!result.error) {
      onChange(result.clip)
      if (result.times) setSelected(result.times)
    }
  }
  const endDrag = (cancelled = false) => {
    dragFrame.cancel()
    lifecycle.current.finish(cancelled)
  }
  const moveDrag = (clientX: number, pointerId: number) => {
    const active = gesture.current
    if (!active || active.pointerId !== pointerId) return
    if (disabled || active.original.id !== clip.id) {
      endDrag(true)
      return
    }
    const delta = clientX - active.clientX
    if (!active.started && Math.abs(delta) < 2) return
    const result: VideoAnimationEdit =
      Math.abs(delta) < 2
        ? { clip: active.original, times: active.selected }
        : moveVideoKeyframes(
            active.original,
            active.selected,
            (delta / active.width) * active.original.duration,
            fps
          )
    if (result.error || !result.times) {
      setError(result.error ?? '')
      return
    }
    if (result.times.every((time, index) => time === active.lastTimes[index])) {
      setError('')
      return
    }
    if (!active.started) {
      active.started = true
      onInteractionStart?.()
    }
    active.lastTimes = result.times
    apply(result)
  }
  return (
    <Stack gap="xs" className="video-keyframes-editor">
      <Group justify="space-between" wrap="nowrap">
        <Text size="xs" fw={650}>
          动画
        </Text>
        <Group gap={3}>
          <Tooltip label="记录当前画面">
            <ActionIcon
              size="sm"
              variant="subtle"
              aria-label="记录当前画面关键帧"
              disabled={disabled || !recordFields.length}
              onClick={() => apply(upsertVideoKeyframe(clip, local, recordFields, fps))}
            >
              <IconPlus size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="复制到播放头">
            <ActionIcon
              size="sm"
              variant="subtle"
              aria-label="复制关键帧到播放头"
              disabled={disabled || !selectedFrames.length}
              onClick={() => apply(copyVideoKeyframesToTime(clip, selected, local, fps))}
            >
              <IconCopy size={15} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="删除选中关键帧">
            <ActionIcon
              size="sm"
              variant="subtle"
              aria-label="删除选中关键帧"
              disabled={disabled || !selectedFrames.length}
              onClick={() => {
                onChange({ ...clip, keyframes: frames.filter((f) => !selected.includes(f.time)) })
                setSelected([])
              }}
            >
              <IconTrash size={15} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      <div
        ref={axis}
        className="video-keyframes-axis"
        role="group"
        aria-label="片段动画时间轴"
        tabIndex={0}
        onPointerMove={(event) => {
          if (gesture.current?.pointerId !== event.pointerId) return
          const clientX = event.clientX,
            pointerId = event.pointerId
          dragFrame.schedule(() => moveDrag(clientX, pointerId))
        }}
        onPointerUp={(event) => {
          if (gesture.current?.pointerId !== event.pointerId) return
          const clientX = event.clientX,
            pointerId = event.pointerId
          dragFrame.flush(() => moveDrag(clientX, pointerId))
          endDrag()
        }}
        onPointerCancel={() => endDrag(true)}
        onLostPointerCapture={() => endDrag(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) endDrag(true)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && gesture.current) {
            event.preventDefault()
            event.stopPropagation()
            endDrag(true)
          }
        }}
      >
        <svg viewBox="0 0 100 48" preserveAspectRatio="none" aria-hidden="true">
          <polyline points={curve} className="video-keyframes-curve" />
          <line
            x1={(local / clip.duration) * 100}
            x2={(local / clip.duration) * 100}
            y1={0}
            y2={48}
            className="video-keyframes-head"
          />
        </svg>
        {frames.map((frame) => (
          <button
            type="button"
            key={frame.time}
            className={`video-keyframe-dot${selected.includes(frame.time) ? ' is-selected' : ''}`}
            style={{ left: `${(frame.time / clip.duration) * 100}%` }}
            aria-label={`关键帧 ${frame.time.toFixed(3)} 秒`}
            title={`${frame.time.toFixed(3)} 秒`}
            disabled={disabled}
            onPointerDown={(event) => {
              if (event.button !== 0 || disabled) return
              event.preventDefault()
              event.stopPropagation()
              axis.current?.focus({ preventScroll: true })
              endDrag(true)
              const next =
                event.ctrlKey || event.metaKey || event.shiftKey
                  ? selected.includes(frame.time)
                    ? selected.filter((t) => t !== frame.time)
                    : [...selected, frame.time]
                  : selected.includes(frame.time)
                    ? selected
                    : [frame.time]
              setSelected(next)
              onSeek?.(clip.start + frame.time)
              if (!next.includes(frame.time)) return
              const width = axis.current?.getBoundingClientRect().width
              if (!width) return
              gesture.current = {
                original: clip,
                selected: next,
                clientX: event.clientX,
                pointerId: event.pointerId,
                width,
                started: false,
                lastTimes: next
              }
              const original = gesture.current
              const target = axis.current
              lifecycle.current.begin(
                clip.id,
                () => {
                  if (!original.started) return
                  onChange(original.original)
                  if (mounted.current) setSelected(original.selected)
                },
                (cancelled) => {
                  dragFrame.cancel()
                  gesture.current = null
                  if (original.started) onInteractionEnd?.(cancelled)
                },
                () => {
                  if (target?.hasPointerCapture(original.pointerId))
                    target.releasePointerCapture(original.pointerId)
                }
              )
              axis.current?.setPointerCapture(event.pointerId)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault()
                event.stopPropagation()
                apply(
                  moveVideoKeyframes(
                    clip,
                    selected.includes(frame.time) ? selected : [frame.time],
                    ((event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 1)) / fps,
                    fps
                  )
                )
              }
            }}
            onClick={(event) => {
              if (event.detail === 0) {
                setSelected([frame.time])
                onSeek?.(clip.start + frame.time)
              }
            }}
          />
        ))}
        <span className="video-keyframes-start">0s</span>
        <span className="video-keyframes-end">{clip.duration.toFixed(2)}s</span>
      </div>
      <Group grow>
        <Select
          aria-label="动画属性"
          value={field}
          data={fields.map(({ value, label }) => ({ value, label }))}
          onChange={(value) => setField(value as VideoAnimatedField)}
        />
        <Select
          aria-label="动画缓动"
          placeholder="选中关键帧"
          value={easing}
          data={videoEasingLabels}
          disabled={disabled || !selectedFrames.length}
          onChange={(easing) => {
            if (easing)
              apply(
                patchVideoKeyframes(clip, selected, {
                  easing: easing as (typeof videoEasingLabels)[number]['value']
                })
              )
          }}
        />
      </Group>
      {!!selectedFrames.length && (
        <Group grow>
          <NumberInput
            label="时间 · 秒"
            value={Math.min(...selected)}
            min={0}
            max={clip.duration}
            step={1 / fps}
            decimalScale={3}
            disabled={disabled}
            onChange={(value) => {
              if (value !== '')
                apply(
                  moveVideoKeyframes(clip, selected, Number(value) - Math.min(...selected), fps)
                )
            }}
          />
          <NumberInput
            label={`${meta.label}${meta.factor === 100 ? ' %' : field === 'rotation' ? ' °' : ' ×'}`}
            value={value === undefined ? '' : value * meta.factor}
            placeholder="不同数值"
            min={meta.min}
            max={meta.max}
            decimalScale={2}
            disabled={disabled}
            onChange={(value) => {
              if (value !== '')
                apply(patchVideoKeyframes(clip, selected, { [field]: Number(value) / meta.factor }))
            }}
          />
        </Group>
      )}
      {!!frames.length && (
        <EditorDisclosure title={`关键帧列表 · ${frames.length}`}>
          <div className="video-keyframes-list">
            {frames.map((frame) => (
              <button
                type="button"
                key={frame.time}
                aria-pressed={selected.includes(frame.time)}
                onClick={(event) => {
                  setSelected(
                    event.ctrlKey || event.metaKey || event.shiftKey
                      ? selected.includes(frame.time)
                        ? selected.filter((t) => t !== frame.time)
                        : [...selected, frame.time]
                      : [frame.time]
                  )
                  onSeek?.(clip.start + frame.time)
                }}
              >
                <span>{frame.time.toFixed(3)}s</span>
                <span>
                  {fields
                    .filter((f) => frame[f.value] !== undefined)
                    .map((f) => f.label)
                    .join(' · ')}
                </span>
              </button>
            ))}
          </div>
        </EditorDisclosure>
      )}
      <Stack gap={4}>
        <Text size="xs" c="dimmed">
          记录属性
        </Text>
        <Group gap="xs" mt={6}>
          {fields.map((meta) => (
            <Checkbox
              key={meta.value}
              size="xs"
              label={meta.label}
              checked={recordFields.includes(meta.value)}
              disabled={disabled}
              onChange={(event) =>
                setRecordFields(
                  event.currentTarget.checked
                    ? [...recordFields, meta.value]
                    : recordFields.filter((field) => field !== meta.value)
                )
              }
            />
          ))}
        </Group>
      </Stack>
      {!!error && (
        <Text role="alert" size="xs" c="red">
          {error}
        </Text>
      )}
    </Stack>
  )
}
