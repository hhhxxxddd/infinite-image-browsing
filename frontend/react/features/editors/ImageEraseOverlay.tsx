import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject
} from 'react'
import type {
  StudioDocument,
  StudioImageLayer,
  StudioPoint
} from '../../../src/features/image-editor/model/imageStudioModel'
import { studioFramePoint } from '../../../src/features/image-editor/model/imageStudioGeometry'
import { upscaleSizeError } from '../../../src/features/image-editor/model/imageStudioUpscale'
import {
  clampEraseBox,
  erasePlan,
  eraseBlendBounds,
  unionEraseBox,
  type EraseDraft,
  type PixelBox
} from '../../../src/features/image-editor/model/imageStudioErase'
import type { ImageTransformPreview } from './imageTransformPreviewStore'
import type { useImageAITasks } from './useImageAITasks'
import { drawEraseStrokes, eraseMask } from './imageEraseInput'
import './ImageEraseTools.css'

type Drag = { point: StudioPoint; draft: EraseDraft; box: PixelBox; handle?: string }
const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export default function ImageEraseOverlay({
  layer: original,
  document,
  preview,
  canvasRef,
  erase,
  isPanning
}: {
  layer: StudioImageLayer
  document: StudioDocument
  preview: ImageTransformPreview
  canvasRef: RefObject<HTMLCanvasElement | null>
  erase: ReturnType<typeof useImageAITasks>['erase']
  isPanning: () => boolean
}) {
  const doc = useSyncExternalStore(preview.subscribe, () => preview.document(document))
  const liveLayer = doc.layers.find((item) => item.id === original.id)
  const layer = liveLayer?.kind === 'image' ? liveLayer : original
  const maskCanvas = useRef<HTMLCanvasElement>(null)
  const brushCursor = useRef<HTMLDivElement>(null)
  const hover = useRef<{ clientX: number; clientY: number; blocked: boolean } | null>(null)
  const drag = useRef<Drag | null>(null)
  const latest = useRef(erase.draft)
  const [local, setLocal] = useState<EraseDraft | null>(null)
  const raf = useRef(0)
  const draft = local || erase.draft
  const size = erase.size
  const editable =
    erase.view === 'selection' &&
    !erase.busy &&
    !erase.accepting &&
    !!size &&
    !upscaleSizeError(size, 1)
  const plan = size && erasePlan(draft, size)
  const brush = size ? Math.min(erase.brush, size.width, size.height) : erase.brush
  useEffect(() => {
    if (!drag.current) {
      latest.current = erase.draft
      setLocal(null)
    }
  }, [erase.draft, layer.id])
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  useLayoutEffect(() => {
    if (!maskCanvas.current || !size) return
    const scale = Math.min(1, 1600 / Math.max(size.width, size.height))
    drawEraseStrokes(
      maskCanvas.current,
      draft.strokes,
      {
        width: Math.max(1, Math.round(size.width * scale)),
        height: Math.max(1, Math.round(size.height * scale))
      },
      true
    )
  }, [draft.strokes, size])
  function localPoint(event: { clientX: number; clientY: number }) {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return null
    const p = studioFramePoint(layer, {
      x: ((event.clientX - rect.left) / rect.width) * doc.width,
      y: ((event.clientY - rect.top) / rect.height) * doc.height
    })
    return { x: p.x / layer.width, y: p.y / layer.height }
  }
  function point(event: React.PointerEvent) {
    const p = localPoint(event) || { x: 0, y: 0 }
    return { x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) }
  }
  function hideCursor() {
    hover.current = null
    if (brushCursor.current) brushCursor.current.style.visibility = 'hidden'
  }
  function refreshCursor() {
    const node = brushCursor.current
    if (!node) return
    const p = hover.current && localPoint(hover.current)
    const visible =
      editable &&
      !isPanning() &&
      !hover.current?.blocked &&
      !drag.current?.handle &&
      p &&
      p.x >= 0 &&
      p.x <= 1 &&
      p.y >= 0 &&
      p.y <= 1
    node.style.visibility = visible ? 'visible' : 'hidden'
    if (visible) {
      node.style.left = `${p.x * 100}%`
      node.style.top = `${p.y * 100}%`
    }
  }
  function trackCursor(event: React.PointerEvent) {
    hover.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      blocked:
        event.pointerType === 'touch' || !!(event.target as HTMLElement).closest('[data-handle]')
    }
    refreshCursor()
  }
  useLayoutEffect(refreshCursor)
  useEffect(() => {
    const clearOnSpace = (event: KeyboardEvent) => {
      if (event.code === 'Space') hideCursor()
    }
    window.addEventListener('blur', hideCursor)
    window.addEventListener('keydown', clearOnSpace)
    return () => {
      window.removeEventListener('blur', hideCursor)
      window.removeEventListener('keydown', clearOnSpace)
    }
  }, [])
  function schedule(next: EraseDraft) {
    latest.current = next
    if (!raf.current)
      raf.current = requestAnimationFrame(() => {
        raf.current = 0
        setLocal(latest.current)
      })
  }
  function move(event: React.PointerEvent) {
    const current = drag.current
    if (!current || !size) return
    const p = point(event)
    if (current.handle) {
      let { x, y, width, height } = current.box
      const dx = Math.round((p.x - current.point.x) * size.width)
      const dy = Math.round((p.y - current.point.y) * size.height)
      if (current.handle === 'move') {
        const support =
          current.draft.bounds &&
          eraseBlendBounds(current.draft.bounds, size, current.draft.blend_pixels)
        const minX = Math.max(0, support ? support.x + support.width - width : 0)
        const minY = Math.max(0, support ? support.y + support.height - height : 0)
        const maxX = Math.min(size.width - width, support?.x ?? size.width)
        const maxY = Math.min(size.height - height, support?.y ?? size.height)
        x = Math.max(minX, Math.min(maxX, x + dx))
        y = Math.max(minY, Math.min(maxY, y + dy))
      } else {
        if (current.handle.includes('w')) {
          const right = x + width
          x = Math.min(right - 1, x + dx)
          width = right - x
        }
        if (current.handle.includes('e')) width = Math.max(1, width + dx)
        if (current.handle.includes('n')) {
          const bottom = y + height
          y = Math.min(bottom - 1, y + dy)
          height = bottom - y
        }
        if (current.handle.includes('s')) height = Math.max(1, height + dy)
      }
      schedule({
        ...current.draft,
        range: 'manual',
        context: clampEraseBox({ x, y, width, height }, size)
      })
    } else {
      const previous = latest.current
      const stroke = previous.strokes[previous.strokes.length - 1]
      if (stroke.points.length >= 20000) return
      const last = stroke.points[stroke.points.length - 1]
      if (Math.hypot((p.x - last.x) * size.width, (p.y - last.y) * size.height) < 0.5) return
      const nextStroke = { ...stroke, points: [...stroke.points, p] }
      const r = (stroke.size * Math.min(size.width, size.height)) / 2 + 1
      const box = clampEraseBox(
        { x: p.x * size.width - r, y: p.y * size.height - r, width: r * 2, height: r * 2 },
        size
      )
      schedule({
        ...previous,
        strokes: [...previous.strokes.slice(0, -1), nextStroke],
        bounds: !stroke.erase
          ? previous.bounds
            ? unionEraseBox(previous.bounds, box)
            : box
          : previous.bounds
      })
    }
  }
  return (
    <div
      className="react-image-cutout-overlay react-image-erase-overlay"
      aria-label="消除画布工具"
      style={{
        left: `${(layer.x / doc.width) * 100}%`,
        top: `${(layer.y / doc.height) * 100}%`,
        width: `${(layer.width / doc.width) * 100}%`,
        height: `${(layer.height / doc.height) * 100}%`,
        transform: `rotate(${layer.rotation}deg)`,
        pointerEvents: editable ? undefined : 'none',
        cursor: editable ? 'none' : undefined
      }}
      onPointerEnter={trackCursor}
      onPointerLeave={hideCursor}
      onPointerOver={trackCursor}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(event) => {
        if (!editable || !size || !plan || event.button !== 0 || isPanning()) return
        event.preventDefault()
        event.stopPropagation()
        const handle = (event.target as HTMLElement).dataset.handle
        const p = point(event)
        if (handle) {
          drag.current = { point: p, draft, box: plan.context, handle }
          hideCursor()
        } else {
          if (draft.strokes.length >= 512) return
          drag.current = { point: p, draft, box: plan.context }
          const stroke = {
            points: [p],
            size: Math.min(1, erase.brush / Math.min(size.width, size.height)),
            erase: erase.mode === 'erase'
          }
          schedule({ ...draft, strokes: [...draft.strokes, stroke] })
        }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        trackCursor(event)
        if (drag.current) {
          event.stopPropagation()
          move(event)
        }
      }}
      onPointerUp={(event) => {
        if (!drag.current || !size) return
        event.stopPropagation()
        move(event)
        cancelAnimationFrame(raf.current)
        raf.current = 0
        let next = latest.current
        if (!drag.current.handle) {
          const mask = eraseMask(next.strokes, size)
          next = { ...next, bounds: mask.bounds }
          mask.canvas.width = mask.canvas.height = 0
        }
        drag.current = null
        setLocal(null)
        erase.setDraft(next)
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onPointerCancel={() => {
        hideCursor()
        cancelAnimationFrame(raf.current)
        raf.current = 0
        drag.current = null
        setLocal(null)
        latest.current = erase.draft
      }}
      onLostPointerCapture={() => {
        if (drag.current) {
          cancelAnimationFrame(raf.current)
          raf.current = 0
          drag.current = null
          setLocal(null)
          latest.current = erase.draft
        }
      }}
    >
      <div className="react-image-ai-boundary" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      {editable && <canvas ref={maskCanvas} className="react-image-erase-paint" />}
      {editable && size && (
        <div
          ref={brushCursor}
          className={`react-image-erase-cursor is-${erase.mode}`}
          aria-hidden="true"
          style={{
            width: `${(brush / size.width) * 100}%`,
            height: `${(brush / size.height) * 100}%`
          }}
        >
          <span>{erase.mode === 'erase' ? '−' : '+'}</span>
        </div>
      )}
      {editable && plan && size && (draft.bounds || draft.range !== 'auto') && (
        <div
          className="react-image-erase-region"
          aria-label="消除处理范围"
          style={{
            left: `${(plan.processing.x / size.width) * 100}%`,
            top: `${(plan.processing.y / size.height) * 100}%`,
            width: `${(plan.processing.width / size.width) * 100}%`,
            height: `${(plan.processing.height / size.height) * 100}%`
          }}
        >
          <span
            className="react-image-erase-region-label"
            data-handle={draft.range === 'whole' ? undefined : 'move'}
            title={draft.range === 'whole' ? '参考完整图片' : '拖动边线移动，拖动控制点缩放'}
          >
            {draft.range === 'whole' ? '参考整图' : '参考范围'} · {plan.target.width} ×{' '}
            {plan.target.height}
          </span>
          {draft.range !== 'whole' && (
            <>
              {['n', 'e', 's', 'w'].map((edge) => (
                <div
                  key={edge}
                  className={`react-image-erase-region-edge is-${edge}`}
                  data-handle="move"
                  title="拖动移动参考范围"
                />
              ))}
              {handles.map((handle) => (
                <button
                  key={handle}
                  type="button"
                  aria-label={`调整参考范围 ${handle}`}
                  data-handle={handle}
                  className={`react-image-erase-handle is-${handle}`}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
