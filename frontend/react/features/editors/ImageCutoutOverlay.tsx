import { useRef, useSyncExternalStore, type RefObject } from 'react'
import type {
  StudioDocument,
  StudioImageLayer,
  StudioPoint
} from '../../../src/features/image-editor/model/imageStudioModel'
import {
  cutoutBox,
  cutoutInputLayer,
  cutoutLocalPoint,
  type CutoutHints
} from '../../../src/features/image-editor/model/imageStudioCutout'
import { apiUrl } from '../../shared/apiClient'
import type { ImageTransformPreview } from './imageTransformPreviewStore'
import './ImageCutoutTools.css'

export default function ImageCutoutOverlay({
  layer: originalLayer,
  document,
  preview,
  inputBounds,
  canvasRef,
  hints,
  pointKind,
  onChange,
  sourcePath,
  readOnly = false,
  isPanning
}: {
  layer: StudioImageLayer
  document: StudioDocument
  preview: ImageTransformPreview
  inputBounds?: CutoutHints['box']
  canvasRef: RefObject<HTMLCanvasElement | null>
  hints: CutoutHints
  pointKind: 'positive' | 'negative'
  onChange: (hints: CutoutHints) => void
  sourcePath?: string
  readOnly?: boolean
  isPanning: () => boolean
}) {
  const doc = useSyncExternalStore(preview.subscribe, () => preview.document(document))
  const liveLayer = doc.layers.find((item) => item.id === originalLayer.id)
  // Resolve the input bounds after reading the same gesture frame used by the canvas.
  const layer = cutoutInputLayer(
    liveLayer?.kind === 'image' ? liveLayer : originalLayer,
    inputBounds
  )
  const drag = useRef<{ start: StudioPoint; original: CutoutHints['box'] } | null>(null)
  const latestBox = useRef(hints.box)
  const point = (event: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return cutoutLocalPoint(layer, {
      x: ((event.clientX - rect.left) / rect.width) * doc.width,
      y: ((event.clientY - rect.top) / rect.height) * doc.height
    })
  }
  return (
    <div
      className="react-image-cutout-overlay"
      aria-label={readOnly ? 'AI 图片图层' : '抠图选区'}
      style={{
        left: `${(layer.x / doc.width) * 100}%`,
        top: `${(layer.y / doc.height) * 100}%`,
        width: `${(layer.width / doc.width) * 100}%`,
        height: `${(layer.height / doc.height) * 100}%`,
        transform: `rotate(${layer.rotation}deg)`,
        pointerEvents: readOnly ? 'none' : undefined
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        if (event.button !== 0 || isPanning()) return
        event.preventDefault()
        event.stopPropagation()
        const p = point(event)
        if (hints.mode === 'points') {
          if (hints[pointKind].length < 64)
            onChange({ ...hints, [pointKind]: [...hints[pointKind], p] })
        } else {
          drag.current = { start: p, original: hints.box }
          latestBox.current = null
          onChange({ ...hints, box: null })
          event.currentTarget.setPointerCapture(event.pointerId)
        }
      }}
      onPointerMove={(event) => {
        if (!drag.current) return
        latestBox.current = cutoutBox(drag.current.start, point(event))
        onChange({ ...hints, box: latestBox.current })
      }}
      onPointerUp={(event) => {
        if (!drag.current) return
        const box = cutoutBox(drag.current.start, point(event))
        onChange({
          ...hints,
          box:
            box.width * layer.width >= 1 && box.height * layer.height >= 1
              ? box
              : drag.current.original
        })
        drag.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onPointerCancel={() => {
        if (drag.current) onChange({ ...hints, box: drag.current.original })
        drag.current = null
      }}
      onLostPointerCapture={() => {
        drag.current = null
      }}
    >
      {sourcePath && (
        <img
          draggable={false}
          alt="抠图前的图片"
          src={apiUrl(`/image-editor-assets/${sourcePath.split(':')[1]}`)}
        />
      )}
      <div className="react-image-ai-boundary" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      {!readOnly && hints.mode === 'box' && hints.box && (
        <div
          className="react-image-cutout-box"
          style={{
            left: `${hints.box.x * 100}%`,
            top: `${hints.box.y * 100}%`,
            width: `${hints.box.width * 100}%`,
            height: `${hints.box.height * 100}%`
          }}
        />
      )}
      {!readOnly &&
        hints.mode === 'points' &&
        (['positive', 'negative'] as const).flatMap((kind) =>
          hints[kind].map((p, i) => (
            <button
              key={`${kind}-${i}`}
              type="button"
              className={`react-image-cutout-point is-${kind}`}
              aria-label={`移除${kind === 'positive' ? '保留' : '排除'}点 ${i + 1}`}
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
              onPointerDown={(event) => {
                if (event.button === 0 && !isPanning()) {
                  event.stopPropagation()
                  event.preventDefault()
                }
              }}
              onClick={(event) => {
                event.stopPropagation()
                onChange({ ...hints, [kind]: hints[kind].filter((_, index) => index !== i) })
              }}
            >
              {kind === 'positive' ? '+' : '−'}
            </button>
          ))
        )}
    </div>
  )
}
