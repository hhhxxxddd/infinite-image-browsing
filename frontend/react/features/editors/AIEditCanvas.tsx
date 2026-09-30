import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import {
  Button,
  ColorInput,
  Group,
  SegmentedControl,
  Select,
  Slider,
  Stack,
  Text,
  Textarea
} from '@mantine/core'
import { IconArrowBackUp, IconArrowForwardUp } from '@tabler/icons-react'
import type {
  StudioDocument,
  StudioImageLayer,
  StudioPoint
} from '../../../src/features/image-editor/model/imageStudioModel'
import {
  appendAIGuide,
  appendAIStroke,
  cropAIEditDocument,
  removeAIAnnotation,
  updateAIGuide,
  updateAIImageContent,
  type AIBrushTool,
  type AIEraseTarget
} from './aiEditDocument'
import { fitAIEditCanvasWidth } from './aiCanvasFit'
import './aiEditCanvas.css'

type Tool = AIBrushTool | 'select' | 'rect' | 'arrow' | 'crop' | 'scale'
type Gesture = { pointerId: number; start: StudioPoint; points: StudioPoint[] }
type CropFrame = { x: number; y: number; width: number; height: number }

function bounds(start: StudioPoint, end: StudioPoint): CropFrame {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  }
}

export default function AIEditCanvas({
  document,
  previewUrl,
  readonly,
  sourcePath,
  reference = false,
  onChange
}: {
  document: StudioDocument
  previewUrl: string
  readonly: boolean
  sourcePath: string
  reference?: boolean
  onChange: (next: StudioDocument) => void
}) {
  const [tool, setTool] = useState<Tool>(reference ? 'crop' : 'select')
  const [eraseTarget, setEraseTarget] = useState<AIEraseTarget>('paint')
  const [brushSize, setBrushSize] = useState(24)
  const [color, setColor] = useState('#ef4444')
  const [guideColor, setGuideColor] = useState('#ef4444')
  const [guideWidth, setGuideWidth] = useState(4)
  const [selectedGuideId, setSelectedGuideId] = useState('')
  const [gesturePoints, setGesturePoints] = useState<StudioPoint[]>([])
  const [cropFrame, setCropFrame] = useState<CropFrame | null>(null)
  const [viewZoom, setViewZoom] = useState(1)
  const [fitWidth, setFitWidth] = useState(160)
  const gesture = useRef<Gesture | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const undoStack = useRef<StudioDocument[]>([])
  const redoStack = useRef<StudioDocument[]>([])
  const imageLayer = document.layers.find(
    (layer): layer is StudioImageLayer => layer.kind === 'image' && layer.path === sourcePath
  )
  const guides = document.layers.filter((layer) => layer.kind === 'guide')
  const selectedGuide = guides.find((layer) => layer.id === selectedGuideId)

  function commit(next: StudioDocument) {
    if (next === document) return
    undoStack.current.push(document)
    if (undoStack.current.length > 40) undoStack.current.shift()
    redoStack.current = []
    onChange(next)
  }
  function undo() {
    const previous = undoStack.current.pop()
    if (!previous) return
    redoStack.current.push(document)
    onChange(previous)
  }
  function redo() {
    const next = redoStack.current.pop()
    if (!next) return
    undoStack.current.push(document)
    onChange(next)
  }
  function point(event: PointerEvent<HTMLDivElement>): StudioPoint {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(
        0,
        Math.min(document.width, ((event.clientX - rect.left) / rect.width) * document.width)
      ),
      y: Math.max(
        0,
        Math.min(document.height, ((event.clientY - rect.top) / rect.height) * document.height)
      )
    }
  }
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (readonly || event.button !== 0 || tool === 'scale') return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const start = point(event)
    gesture.current = { pointerId: event.pointerId, start, points: [start] }
    setGesturePoints([start])
    if (tool === 'crop') setCropFrame(null)
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current
    if (!active || active.pointerId !== event.pointerId) return
    const next = point(event)
    const last = active.points[active.points.length - 1]
    if (Math.hypot(next.x - last.x, next.y - last.y) < 1) return
    active.points.push(next)
    setGesturePoints([...active.points])
  }
  function pointerEnd(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current
    if (!active || active.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
    const end = point(event)
    if (
      Math.hypot(
        end.x - active.points[active.points.length - 1].x,
        end.y - active.points[active.points.length - 1].y
      ) >= 1
    )
      active.points.push(end)
    gesture.current = null
    setGesturePoints([])
    if (tool === 'crop') {
      const frame = bounds(active.start, end)
      setCropFrame(frame.width >= 10 && frame.height >= 10 ? frame : null)
    } else if (tool === 'rect' || tool === 'arrow') {
      const result = appendAIGuide(document, tool, active.start, end, guideColor, guideWidth)
      if (result) {
        commit(result.document)
        setSelectedGuideId(result.id)
      }
    } else if (tool === 'select') {
      const selected = [...guides]
        .reverse()
        .find(
          (layer) =>
            active.start.x >= layer.x - 8 &&
            active.start.x <= layer.x + layer.width + 8 &&
            active.start.y >= layer.y - 8 &&
            active.start.y <= layer.y + layer.height + 8
        )
      setSelectedGuideId(selected?.id || '')
      if (selected && Math.hypot(end.x - active.start.x, end.y - active.start.y) >= 2)
        commit(
          updateAIGuide(document, selected.id, {
            x: Math.max(
              0,
              Math.min(document.width - selected.width, selected.x + end.x - active.start.x)
            ),
            y: Math.max(
              0,
              Math.min(document.height - selected.height, selected.y + end.y - active.start.y)
            )
          })
        )
    } else if (tool === 'paint' || tool === 'mask' || tool === 'erase') {
      commit(appendAIStroke(document, tool, active.points, brushSize, color, eraseTarget))
    }
  }
  const pendingCrop =
    tool === 'crop' && gesturePoints.length > 1
      ? bounds(gesturePoints[0], gesturePoints[gesturePoints.length - 1])
      : cropFrame
  const pendingGuide =
    (tool === 'rect' || tool === 'arrow') && gesturePoints.length > 1
      ? bounds(gesturePoints[0], gesturePoints[gesturePoints.length - 1])
      : null
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (readonly || event.defaultPrevented || event.isComposing || gesture.current) return
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement &&
          (target.isContentEditable || !!target.closest('[role="dialog"]')))
      )
        return
      const modifier = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      if (modifier && key === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      } else if (modifier && key === 'y') {
        event.preventDefault()
        redo()
      } else if (!modifier && !event.altKey && key === 'v') {
        event.preventDefault()
        setTool('select')
        setCropFrame(null)
      } else if (event.key === 'Delete' && selectedGuideId) {
        event.preventDefault()
        commit(removeAIAnnotation(document, selectedGuideId))
        setSelectedGuideId('')
      } else if (event.key === 'Enter' && tool === 'crop' && cropFrame) {
        event.preventDefault()
        commit(cropAIEditDocument(document, cropFrame))
        setCropFrame(null)
      } else if (event.key === 'Escape') {
        if (cropFrame || selectedGuideId || tool !== 'select') event.preventDefault()
        setCropFrame(null)
        setSelectedGuideId('')
        setTool('select')
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  })
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const stage = canvas?.closest<HTMLElement>('.react-editor-stage')
    if (!canvas || !stage) return
    const measure = () => {
      const stageRect = stage.getBoundingClientRect()
      const canvasRect = canvas.getBoundingClientRect()
      const styles = window.getComputedStyle(stage)
      const horizontalPadding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight)
      const bottomPadding = parseFloat(styles.paddingBottom)
      const canvasTop = canvasRect.top - stageRect.top + stage.scrollTop
      setFitWidth(
        fitAIEditCanvasWidth(
          document.width,
          document.height,
          stage.clientWidth - horizontalPadding,
          stage.clientHeight - canvasTop - bottomPadding - 2
        )
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [document.width, document.height, tool, cropFrame])
  return (
    <Stack className="react-ai-edit-tools" gap="sm" align="center">
      <Group gap="xs" justify="center" wrap="wrap">
        <SegmentedControl
          size="sm"
          orientation="vertical"
          className="react-ai-edit-tool-switch"
          aria-label="AI 编辑画布工具"
          value={tool}
          onChange={(value) => {
            setTool(value as Tool)
            setCropFrame(null)
          }}
          data={[
            { value: 'select', label: '移动' },
            { value: 'scale', label: '缩放' },
            { value: 'crop', label: '裁剪' },
            ...(!reference
              ? [
                  { value: 'rect', label: '提示框' },
                  { value: 'arrow', label: '箭头' },
                  { value: 'paint', label: '涂抹' },
                  { value: 'mask', label: '遮罩' },
                  { value: 'erase', label: '橡皮擦' }
                ]
              : [])
          ]}
          disabled={readonly}
        />
        <Button.Group>
          <Button
            size="xs"
            variant="default"
            aria-label="撤销画布操作"
            disabled={readonly || !undoStack.current.length}
            onClick={undo}
          >
            <IconArrowBackUp size={15} />
          </Button>
          <Button
            size="xs"
            variant="default"
            aria-label="重做画布操作"
            disabled={readonly || !redoStack.current.length}
            onClick={redo}
          >
            <IconArrowForwardUp size={15} />
          </Button>
        </Button.Group>
      </Group>
      {tool === 'paint' || tool === 'mask' || tool === 'erase' ? (
        <Group gap="sm" className="react-ai-edit-brush" wrap="wrap" justify="center">
          {tool === 'paint' && (
            <ColorInput
              size="xs"
              label="涂抹颜色"
              value={color}
              onChange={setColor}
              w={116}
              disabled={readonly}
            />
          )}
          {tool === 'erase' && (
            <SegmentedControl
              size="xs"
              aria-label="擦除对象"
              value={eraseTarget}
              onChange={(value) => setEraseTarget(value as AIEraseTarget)}
              data={[
                { value: 'paint', label: '涂抹' },
                { value: 'mask', label: '遮罩' }
              ]}
              disabled={readonly}
            />
          )}
          <Text size="xs" c="dimmed">
            笔刷 {brushSize}px
          </Text>
          <Slider
            aria-label="笔刷大小"
            min={2}
            max={120}
            value={brushSize}
            onChange={setBrushSize}
            w={130}
            disabled={readonly}
          />
        </Group>
      ) : tool === 'rect' || tool === 'arrow' ? (
        <Group gap="sm" className="react-ai-edit-brush" wrap="wrap" justify="center">
          <ColorInput
            size="xs"
            label="标注颜色"
            value={guideColor}
            onChange={setGuideColor}
            w={116}
            disabled={readonly}
          />
          <Text size="xs" c="dimmed">
            线宽 {guideWidth}px
          </Text>
          <Slider
            aria-label="标注线宽"
            min={1}
            max={24}
            value={guideWidth}
            onChange={setGuideWidth}
            w={120}
            disabled={readonly}
          />
        </Group>
      ) : tool === 'crop' && cropFrame ? (
        <Group gap="xs">
          <Text size="xs" c="dimmed">
            {Math.round(cropFrame.width)} × {Math.round(cropFrame.height)}
          </Text>
          <Button
            size="xs"
            onClick={() => {
              commit(cropAIEditDocument(document, cropFrame))
              setCropFrame(null)
            }}
            disabled={readonly}
          >
            应用裁剪
          </Button>
          <Button size="xs" variant="default" onClick={() => setCropFrame(null)}>
            取消
          </Button>
        </Group>
      ) : tool === 'crop' ? (
        <Text size="xs" c="dimmed">
          在画布上框选裁剪范围
        </Text>
      ) : (
        <Text size="xs" c="dimmed">
          选择提示框或箭头，可拖动位置并编辑说明
        </Text>
      )}
      <div
        ref={canvasRef}
        className="react-ai-edit-canvas"
        style={{
          width: `${Math.round(fitWidth * viewZoom)}px`,
          aspectRatio: `${document.width} / ${document.height}`
        }}
        onWheel={(event) => {
          event.preventDefault()
          setViewZoom((value) =>
            Math.max(
              0.3,
              Math.min(4, value * Math.exp(-Math.max(-120, Math.min(120, event.deltaY)) * 0.0015))
            )
          )
        }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerEnd}
        onPointerCancel={pointerEnd}
        data-tool={tool}
        role="img"
        aria-label={`AI 编辑画布，${document.width} × ${document.height}`}
      >
        <img src={previewUrl} alt="当前 AI 编辑画布" draggable={false} />
        <svg
          className="react-ai-edit-overlay"
          viewBox={`0 0 ${document.width} ${document.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {(tool === 'paint' || tool === 'mask' || tool === 'erase') &&
            gesturePoints.length > 0 && (
              <polyline
                points={gesturePoints.map((point) => `${point.x},${point.y}`).join(' ')}
                fill="none"
                stroke={tool === 'mask' ? '#8b9ab8' : tool === 'erase' ? '#ffffff' : color}
                strokeWidth={brushSize}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={tool === 'mask' ? 0.65 : 0.9}
              />
            )}
          {pendingCrop && (
            <rect
              x={pendingCrop.x}
              y={pendingCrop.y}
              width={pendingCrop.width}
              height={pendingCrop.height}
              fill="rgba(42,115,215,.12)"
              stroke="#69b5ff"
              strokeWidth={Math.max(1, document.width / 420)}
              strokeDasharray={`${Math.max(3, document.width / 150)} ${Math.max(2, document.width / 250)}`}
            />
          )}
          {pendingGuide && tool === 'rect' && (
            <rect
              x={pendingGuide.x}
              y={pendingGuide.y}
              width={pendingGuide.width}
              height={pendingGuide.height}
              fill="none"
              stroke={guideColor}
              strokeWidth={guideWidth}
              strokeDasharray="8 5"
            />
          )}
          {pendingGuide && tool === 'arrow' && (
            <g
              stroke={guideColor}
              fill="none"
              strokeWidth={guideWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path
                d={`M ${gesturePoints[0].x} ${gesturePoints[0].y} L ${gesturePoints[gesturePoints.length - 1].x} ${gesturePoints[gesturePoints.length - 1].y}`}
              />
              <circle
                cx={gesturePoints[gesturePoints.length - 1].x}
                cy={gesturePoints[gesturePoints.length - 1].y}
                r={Math.max(3, guideWidth * 2)}
                fill={guideColor}
              />
            </g>
          )}
        </svg>
      </div>
      <Group className="react-ai-view-zoom" gap="xs" wrap="nowrap">
        <Text size="xs">{Math.round(viewZoom * 100)}%</Text>
        <Slider
          aria-label="画布视图缩放"
          min={30}
          max={400}
          value={viewZoom * 100}
          onChange={(value) => setViewZoom(value / 100)}
          w={120}
        />
        <Button
          size="compact-xs"
          variant="subtle"
          onClick={() => {
            setViewZoom(1)
            canvasRef.current?.closest('.react-editor-stage')?.scrollTo(0, 0)
          }}
        >
          适应
        </Button>
      </Group>
      {imageLayer && (tool === 'scale' || tool === 'crop') && (
        <Stack className="react-ai-edit-image-controls" gap="xs">
          <Group gap="sm" grow>
            <Select
              size="xs"
              label="填充"
              data={[
                { value: 'cover', label: '铺满' },
                { value: 'contain', label: '完整显示' },
                { value: 'stretch', label: '拉伸' }
              ]}
              value={imageLayer.fit}
              onChange={(value) => {
                if (value === 'cover' || value === 'contain' || value === 'stretch')
                  commit(updateAIImageContent(document, sourcePath, { fit: value }))
              }}
              disabled={readonly}
            />
            <Text size="xs" c="dimmed">
              内容缩放 {Math.round(imageLayer.zoom * 100)}%
            </Text>
            <Slider
              aria-label="图片内容缩放"
              min={1}
              max={8}
              step={0.05}
              value={imageLayer.zoom}
              onChange={(value) =>
                commit(updateAIImageContent(document, sourcePath, { zoom: value }))
              }
              disabled={readonly}
            />
          </Group>
          {(imageLayer.zoom !== 1 || imageLayer.fit === 'cover') && (
            <Group grow gap="sm">
              <Text size="xs" c="dimmed">
                水平位置
              </Text>
              <Slider
                aria-label="图片水平位置"
                min={0}
                max={1}
                step={0.01}
                value={imageLayer.focusX}
                onChange={(value) =>
                  commit(updateAIImageContent(document, sourcePath, { focusX: value }))
                }
                disabled={readonly}
              />
              <Text size="xs" c="dimmed">
                垂直位置
              </Text>
              <Slider
                aria-label="图片垂直位置"
                min={0}
                max={1}
                step={0.01}
                value={imageLayer.focusY}
                onChange={(value) =>
                  commit(updateAIImageContent(document, sourcePath, { focusY: value }))
                }
                disabled={readonly}
              />
            </Group>
          )}
        </Stack>
      )}
      {!reference && guides.length > 0 && (
        <Stack className="react-ai-edit-guide-controls" gap="xs">
          <Select
            size="xs"
            label="提示标注"
            placeholder="选择一条标注"
            data={guides.map((guide) => ({ value: guide.id, label: guide.name }))}
            value={selectedGuideId || null}
            onChange={(value) => setSelectedGuideId(value || '')}
            clearable
          />
          {selectedGuide && (
            <>
              <Textarea
                size="xs"
                label="标注说明"
                value={selectedGuide.prompt}
                maxLength={500}
                minRows={2}
                onChange={(event) =>
                  commit(
                    updateAIGuide(document, selectedGuide.id, { prompt: event.currentTarget.value })
                  )
                }
                disabled={readonly}
              />
              <Button
                size="xs"
                color="red"
                variant="subtle"
                onClick={() => {
                  commit(removeAIAnnotation(document, selectedGuide.id))
                  setSelectedGuideId('')
                }}
                disabled={readonly}
              >
                删除标注
              </Button>
            </>
          )}
        </Stack>
      )}
      {!reference && (
        <Text size="xs" c="dimmed">
          涂抹与提示标注会合成到提交图片；遮罩仅在支持遮罩的工作流中作为单独输入。
        </Text>
      )}
    </Stack>
  )
}
