import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Group, NumberInput, Select, Stack, Text } from '@mantine/core'
import {
  bounded,
  setVideoTransition,
  transitionPrevious,
  videoEase,
  type VideoClip,
  type VideoEasing,
  type VideoTimelineDocument
} from './videoStudioModel'
import { videoEasingLabels } from './videoAnimationEditing'
import './VideoKeyframesEditor.css'
import { EditorPointerGesture } from './editorPointerGesture'
import { useFrameAction } from './useFrameAction'

export default function VideoTransitionEditor({
  doc,
  clip,
  disabled,
  onChange,
  onSeek,
  onInteractionStart,
  onInteractionEnd
}: {
  doc: VideoTimelineDocument
  clip: VideoClip
  disabled: boolean
  onChange: (doc: VideoTimelineDocument) => void
  onSeek?: (time: number) => void
  onInteractionStart?: () => void
  onInteractionEnd?: (cancelled?: boolean) => void
}) {
  const [error, setError] = useState(''),
    axis = useRef<HTMLDivElement>(null)
  const gesture = useRef<{
    doc: VideoTimelineDocument
    clientX: number
    pointerId: number
    duration: number
    span: number
    scope: string
    width: number
    max: number
    easing: VideoEasing
    started: boolean
    lastDuration: number
  } | null>(null)
  const dragFrame = useFrameAction()
  const previous = transitionPrevious(doc, clip)
  const scope = `${clip.id}:${previous?.id ?? ''}`
  const lifecycle = useRef(new EditorPointerGesture())
  const endDrag = (cancelled = false) => {
    dragFrame.cancel()
    lifecycle.current.finish(cancelled)
  }
  useEffect(() => {
    if (disabled || (gesture.current && gesture.current.scope !== scope)) dragFrame.cancel()
    lifecycle.current.cancelIf(scope, disabled)
  }, [scope, disabled, dragFrame])
  useEffect(() => {
    const transaction = lifecycle.current
    return () => {
      dragFrame.cancel()
      transaction.finish(true)
    }
  }, [dragFrame])
  const easing = clip.transitionIn?.easing ?? 'linear'
  const curve = useMemo(
    () =>
      Array.from(
        { length: 33 },
        (_, i) => `${(i / 32) * 100},${40 - videoEase(i / 32, easing) * 36}`
      ).join(' '),
    [easing]
  )
  if (!previous)
    return (
      <Text size="xs" c="dimmed">
        同一画面轨相邻两段可添加转场。
      </Text>
    )
  const transition = clip.transitionIn,
    duration = transition?.duration ?? 0
  const max = Math.min(30, previous.duration, clip.duration),
    end = previous.start + previous.duration
  const left = Math.min(previous.start, clip.start),
    right = Math.max(end, clip.start + clip.duration),
    span = Math.max(0.001, right - left)
  const percent = (time: number) => ((time - left) / span) * 100
  const apply = (seconds: number, curve = easing, source = doc) => {
    const result = setVideoTransition(source, clip.id, seconds, curve)
    setError(result.error ?? '')
    if (!result.error) onChange(result.document)
  }
  const moveDrag = (clientX: number, pointerId: number) => {
    const active = gesture.current
    if (!active || active.pointerId !== pointerId) return
    if (disabled || active.scope !== scope) {
      endDrag(true)
      return
    }
    const delta = clientX - active.clientX
    if (!active.started && Math.abs(delta) < 2) return
    const fps = active.doc.fps
    const seconds =
      Math.abs(delta) < 2
        ? active.duration
        : Math.round(
            bounded(active.duration - (delta / active.width) * active.span, 1 / fps, active.max) *
              fps
          ) / fps
    if (seconds === active.lastDuration) {
      setError('')
      return
    }
    const result: ReturnType<typeof setVideoTransition> =
      seconds === active.duration
        ? { document: active.doc }
        : setVideoTransition(active.doc, clip.id, seconds, active.easing)
    setError(result.error ?? '')
    if (result.error) return
    if (!active.started) {
      active.started = true
      onInteractionStart?.()
    }
    active.lastDuration = seconds
    onChange(result.document)
  }
  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Text size="xs" fw={650}>
          转场
        </Text>
        {transition && (
          <Button size="compact-xs" variant="subtle" disabled={disabled} onClick={() => apply(0)}>
            移除
          </Button>
        )}
      </Group>
      <div
        ref={axis}
        className="video-transition-axis"
        role="group"
        aria-label="两片段实际转场范围"
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
        <div
          className="video-transition-before"
          style={{
            left: `${percent(previous.start)}%`,
            width: `${(previous.duration / span) * 100}%`
          }}
          title={previous.name}
        >
          {previous.name}
        </div>
        <div
          className="video-transition-after"
          style={{ left: `${percent(clip.start)}%`, width: `${(clip.duration / span) * 100}%` }}
          title={clip.name}
        >
          {clip.name}
        </div>
        {!!duration && (
          <div
            className="video-transition-range"
            style={{ left: `${percent(end - duration)}%`, width: `${(duration / span) * 100}%` }}
          />
        )}
        <button
          type="button"
          className="video-transition-handle"
          style={{ left: `${percent(end - duration)}%` }}
          aria-label="拖动调整转场开始"
          title="拖动调整重叠范围"
          disabled={disabled}
          onPointerDown={(event) => {
            if (event.button !== 0 || disabled) return
            event.preventDefault()
            axis.current?.focus({ preventScroll: true })
            endDrag(true)
            const width = axis.current?.getBoundingClientRect().width
            if (!width) return
            gesture.current = {
              doc,
              clientX: event.clientX,
              pointerId: event.pointerId,
              duration,
              span,
              scope,
              width,
              max,
              easing,
              started: false,
              lastDuration: duration
            }
            const original = gesture.current
            const target = axis.current
            lifecycle.current.begin(
              scope,
              () => {
                if (original.started) onChange(original.doc)
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
              apply(bounded(duration + (event.key === 'ArrowLeft' ? 1 : -1) / doc.fps, 0, max))
            }
          }}
        />
      </div>
      <Group grow>
        <NumberInput
          label="重叠时长 · 秒"
          value={duration}
          min={0}
          max={max}
          step={1 / doc.fps}
          decimalScale={3}
          disabled={disabled}
          onChange={(value) => {
            if (value !== '') apply(Number(value))
          }}
        />
        <Select
          label="变化"
          value={easing}
          data={videoEasingLabels}
          disabled={disabled}
          onChange={(value) => {
            if (value) apply(duration || Math.min(0.5, max), value as VideoEasing)
          }}
        />
      </Group>
      {!!duration && (
        <>
          <svg
            className="video-transition-curve"
            viewBox="0 0 100 44"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polyline points={curve} className="video-keyframes-curve" />
          </svg>
          <Button size="compact-xs" variant="subtle" onClick={() => onSeek?.(end - duration)}>
            {(end - duration).toFixed(3)} – {end.toFixed(3)} 秒
          </Button>
        </>
      )}
      {!!error && (
        <Text role="alert" size="xs" c="red">
          {error}
        </Text>
      )}
    </Stack>
  )
}
