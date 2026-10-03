import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
  type RefObject
} from 'react'
import { Group, NumberInput } from '@mantine/core'
import {
  studioGroupBounds,
  type StudioGroup,
  type StudioDocument,
  type StudioLayer
} from '../../../src/features/image-editor/model/imageStudioModel'
import { renderStudioDocument } from '../../../src/features/image-editor/model/imageStudioRender'
import { studioPreviewScale } from '../../../src/features/image-editor/model/imageStudioPreview'
import type { ImageTransformPreview } from './imageTransformPreviewStore'
import type { EditorContext } from './EditorHub'

function usePreviewDocument(preview: ImageTransformPreview, document: StudioDocument) {
  return useSyncExternalStore(preview.subscribe, () => preview.document(document))
}

function usePreviewLayer(preview: ImageTransformPreview, layer: StudioLayer) {
  return useSyncExternalStore(preview.subscribe, () => preview.layer(layer))
}

export function ImagePreviewCanvas({
  document,
  preview,
  original,
  compare,
  assetInfo,
  canvasRef,
  displayWidth,
  displayHeight,
  onError,
  ...canvasProps
}: Omit<ComponentProps<'canvas'>, 'ref' | 'onError'> & {
  document: StudioDocument
  preview: ImageTransformPreview
  original: StudioDocument
  compare: boolean
  assetInfo: EditorContext['assetInfo']
  canvasRef: RefObject<HTMLCanvasElement | null>
  displayWidth: number
  displayHeight: number
  onError: (message: string) => void
}) {
  const liveDocument = usePreviewDocument(preview, document)
  const previewCanvas = useRef<HTMLCanvasElement | null>(null)
  const renderSeq = useRef(0)
  const [pixelRatio, setPixelRatio] = useState(() => window.devicePixelRatio || 1)
  useEffect(() => {
    const update = () => setPixelRatio(window.devicePixelRatio || 1)
    const resolution = window.matchMedia(`(resolution: ${pixelRatio}dppx)`)
    resolution.addEventListener('change', update)
    window.addEventListener('resize', update)
    return () => {
      resolution.removeEventListener('change', update)
      window.removeEventListener('resize', update)
    }
  }, [pixelRatio])
  useLayoutEffect(() => {
    const seq = ++renderSeq.current
    const target =
      previewCanvas.current ?? (previewCanvas.current = window.document.createElement('canvas'))
    const controller = new AbortController()
    const document = compare ? original : liveDocument
    void renderStudioDocument(
      target,
      document,
      assetInfo,
      true,
      { kind: 'all' },
      1200,
      false,
      controller.signal,
      studioPreviewScale(document, { width: displayWidth, height: displayHeight }, pixelRatio)
    )
      .then(() => {
        if (controller.signal.aborted || seq !== renderSeq.current || !canvasRef.current) return
        const visible = canvasRef.current
        if (visible.width !== target.width) visible.width = target.width
        if (visible.height !== target.height) visible.height = target.height
        const ctx = visible.getContext('2d')
        if (ctx) {
          ctx.globalCompositeOperation = 'copy'
          ctx.drawImage(target, 0, 0)
          ctx.globalCompositeOperation = 'source-over'
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          onError(reason instanceof Error ? reason.message : '画布预览失败')
      })
    return () => controller.abort()
  }, [
    liveDocument,
    original,
    compare,
    assetInfo,
    canvasRef,
    onError,
    displayWidth,
    displayHeight,
    pixelRatio
  ])
  return <canvas {...canvasProps} ref={canvasRef} />
}

export function ImageSelectionFrame({
  document,
  preview,
  selected,
  children
}: {
  document: StudioDocument
  preview: ImageTransformPreview
  selected: StudioLayer
  children: (layer: StudioLayer) => ReactNode
}) {
  const layer = usePreviewLayer(preview, selected)
  return (
    <div
      className="react-image-selection"
      style={{
        left: `${(layer.x / document.width) * 100}%`,
        top: `${(layer.y / document.height) * 100}%`,
        width: `${(layer.width / document.width) * 100}%`,
        height: `${(layer.height / document.height) * 100}%`,
        transform: `rotate(${layer.rotation}deg)`
      }}
    >
      {children(layer)}
    </div>
  )
}

export function ImageGroupSelection({
  document,
  preview,
  group,
  locked,
  ...events
}: Omit<ComponentProps<'div'>, 'children'> & {
  document: StudioDocument
  preview: ImageTransformPreview
  group: StudioGroup
  locked: boolean
}) {
  const liveDocument = usePreviewDocument(preview, document)
  const bounds = studioGroupBounds(liveDocument, group.id)
  if (!bounds) return null
  return (
    <div
      {...events}
      role="group"
      tabIndex={0}
      aria-label={`分组：${group.name}`}
      className="react-image-selection react-image-group-selection"
      data-locked={locked}
      style={{
        left: `${(bounds.x / document.width) * 100}%`,
        top: `${(bounds.y / document.height) * 100}%`,
        width: `${(bounds.width / document.width) * 100}%`,
        height: `${(bounds.height / document.height) * 100}%`
      }}
    >
      <span className="react-image-group-label">▱ {group.name}</span>
      {['nw', 'ne', 'sw', 'se'].map((corner) => (
        <span key={corner} className={`react-image-group-corner is-${corner}`} />
      ))}
    </div>
  )
}

export function ImageGroupGeometry({
  document,
  preview,
  groupId,
  disabled,
  onMove
}: {
  document: StudioDocument
  preview: ImageTransformPreview
  groupId: string
  disabled: boolean
  onMove: (dx: number, dy: number) => void
}) {
  const liveDocument = usePreviewDocument(preview, document)
  const bounds = studioGroupBounds(liveDocument, groupId)
  if (!bounds) return null
  return (
    <>
      <Group grow>
        {(['x', 'y'] as const).map((axis) => (
          <NumberInput
            key={axis}
            label={axis.toUpperCase()}
            size="xs"
            value={Math.round(bounds[axis])}
            disabled={disabled}
            onChange={(value) => {
              const original = studioGroupBounds(document, groupId)
              if (typeof value === 'number' && original)
                onMove(axis === 'x' ? value - original.x : 0, axis === 'y' ? value - original.y : 0)
            }}
          />
        ))}
      </Group>
      <span className="react-image-group-dimensions">
        {Math.round(bounds.width)} × {Math.round(bounds.height)} px · 整组移动
      </span>
    </>
  )
}
