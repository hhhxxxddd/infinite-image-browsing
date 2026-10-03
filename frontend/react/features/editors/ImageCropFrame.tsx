import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from 'react'
import type {
  StudioFrame,
  StudioImageLayer,
  StudioPoint
} from '../../../src/features/image-editor/model/imageStudioModel'
import {
  studioFramePoint,
  studioMoveCrop,
  studioResizeCrop
} from '../../../src/features/image-editor/model/imageStudioGeometry'
import type { ImageCropPreview } from './imageCropPreviewStore'

const handles = [
  ['nw', '左上角'],
  ['n', '上边'],
  ['ne', '右上角'],
  ['e', '右边'],
  ['se', '右下角'],
  ['s', '下边'],
  ['sw', '左下角'],
  ['w', '左边']
] as const

export default function ImageCropFrame({
  layer,
  frame,
  cropPreview,
  ratio,
  width,
  height,
  canvasRef,
  disabled,
  isPanning,
  onChange
}: {
  layer: StudioImageLayer
  frame: StudioFrame
  cropPreview: ImageCropPreview
  ratio: number
  width: number
  height: number
  canvasRef: RefObject<HTMLCanvasElement | null>
  disabled: boolean
  isPanning: () => boolean
  onChange: (frame: StudioFrame) => void
}) {
  const preview = useSyncExternalStore(cropPreview.subscribe, () => cropPreview.frame(frame))
  const drag = useRef<
    | {
        start: StudioPoint
        original: StudioFrame
        next: StudioFrame
        handle: string
        pointerId: number
      }
    | undefined
  >(undefined)
  const animation = useRef<number | undefined>(undefined)
  function stopAnimation() {
    if (animation.current !== undefined) cancelAnimationFrame(animation.current)
    animation.current = undefined
  }
  useLayoutEffect(() => {
    stopAnimation()
    drag.current = undefined
    cropPreview.clear()
  }, [frame, layer.id, ratio, cropPreview])
  useEffect(
    () => () => {
      stopAnimation()
      cropPreview.clear()
    },
    [cropPreview]
  )
  function localPoint(event: React.PointerEvent<HTMLElement>) {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return
    return studioFramePoint(layer, {
      x: ((event.clientX - rect.left) * width) / rect.width,
      y: ((event.clientY - rect.top) * height) / rect.height
    })
  }
  function begin(event: React.PointerEvent<HTMLElement>, handle = '') {
    if (event.button !== 0 || isPanning()) return
    event.stopPropagation()
    if (disabled || !canvasRef.current) return
    const start = localPoint(event)
    if (!start) return
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    drag.current = {
      start,
      original: preview,
      next: preview,
      handle,
      pointerId: event.pointerId
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function move(event: React.PointerEvent<HTMLElement>) {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    const point = localPoint(event)
    if (!point) return
    current.next = current.handle
      ? studioResizeCrop(
          layer,
          current.original,
          current.handle,
          point.x - current.start.x,
          point.y - current.start.y,
          ratio
        )
      : studioMoveCrop(
          layer,
          current.original,
          point.x - current.start.x,
          point.y - current.start.y
        )
    if (animation.current === undefined)
      animation.current = requestAnimationFrame(() => {
        animation.current = undefined
        if (drag.current) cropPreview.publish(frame, drag.current.next)
      })
  }
  function end() {
    const current = drag.current
    if (!current) return
    stopAnimation()
    drag.current = undefined
    cropPreview.publish(frame, current.next)
    onChange(current.next)
  }
  function cancel() {
    const current = drag.current
    stopAnimation()
    drag.current = undefined
    if (current) cropPreview.clear()
  }
  function keydown(event: React.KeyboardEvent<HTMLElement>, handle = '') {
    const step = event.shiftKey ? 10 : 1
    const motions: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step]
    }
    const motion = motions[event.key]
    if (!motion || disabled) return
    event.preventDefault()
    event.stopPropagation()
    const next = handle
      ? studioResizeCrop(layer, preview, handle, ...motion, ratio)
      : studioMoveCrop(layer, preview, ...motion)
    onChange(next)
  }
  const pointerEvents = {
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: cancel,
    onLostPointerCapture: end
  }
  const left = (preview.x / layer.width) * 100,
    top = (preview.y / layer.height) * 100
  const cropWidth = (preview.width / layer.width) * 100,
    cropHeight = (preview.height / layer.height) * 100
  return (
    <div
      className="react-image-crop-overlay"
      style={{
        left: `${(layer.x / width) * 100}%`,
        top: `${(layer.y / height) * 100}%`,
        width: `${(layer.width / width) * 100}%`,
        height: `${(layer.height / height) * 100}%`,
        transform: `rotate(${layer.rotation}deg)`
      }}
    >
      <div className="react-image-crop-shade" style={{ inset: `0 0 ${100 - top}% 0` }} />
      <div className="react-image-crop-shade" style={{ inset: `${top + cropHeight}% 0 0 0` }} />
      <div
        className="react-image-crop-shade"
        style={{ left: 0, top: `${top}%`, width: `${left}%`, height: `${cropHeight}%` }}
      />
      <div
        className="react-image-crop-shade"
        style={{
          right: 0,
          top: `${top}%`,
          width: `${100 - left - cropWidth}%`,
          height: `${cropHeight}%`
        }}
      />
      <div
        className="react-image-crop-frame"
        tabIndex={disabled ? -1 : 0}
        role="group"
        aria-label="裁剪框"
        style={{
          left: `${left}%`,
          top: `${top}%`,
          width: `${cropWidth}%`,
          height: `${cropHeight}%`
        }}
        onPointerDown={(event) => begin(event)}
        {...pointerEvents}
        onKeyDown={(event) => keydown(event)}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <div className="react-image-crop-grid" aria-hidden="true" />
        <span className="react-image-crop-size" aria-hidden="true">
          {Math.round(preview.width)} × {Math.round(preview.height)}
        </span>
        {!disabled &&
          handles.map(([handle, label]) => (
            <button
              key={handle}
              type="button"
              className={`react-image-transform-handle react-image-crop-handle is-${handle}`}
              aria-label={`调整裁剪框：${label}`}
              onPointerDown={(event) => begin(event, handle)}
              {...pointerEvents}
              onKeyDown={(event) => keydown(event, handle)}
            />
          ))}
      </div>
    </div>
  )
}
