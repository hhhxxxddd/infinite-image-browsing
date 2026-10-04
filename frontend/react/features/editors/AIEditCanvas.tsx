import { useEditorToolAnchor } from './useEditorToolAnchor'
import { Fragment, useEffect, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  ActionIcon,
  Button,
  ColorInput,
  Divider,
  Group,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Textarea,
  Tooltip
} from '@mantine/core'
import {
  IconAdjustmentsHorizontal,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowUpRight,
  IconArrowsMove,
  IconBrush,
  IconEraser,
  IconMask,
  IconSquareDashed,
  IconX
} from '@tabler/icons-react'
import {
  scaleStudioDocument,
  type StudioDocument,
  type StudioImageLayer,
  type StudioPoint
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
import EditorParameterSlider from './EditorParameterSlider'
import ImageTransformTools from './ImageTransformTools'
import ImageCropFrame from './ImageCropFrame'
import { createImageCropPreview } from './imageCropPreviewStore'
import { createImageTransformPreview } from './imageTransformPreviewStore'
import { studioCenteredCrop } from '../../../src/features/image-editor/model/imageStudioGeometry'
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
  active,
  controlsHost,
  historyHost,
  onSelect,
  onMoveStart,
  readonly,
  sourcePath,
  reference = false,
  onChange
}: {
  document: StudioDocument
  previewUrl: string
  active: boolean
  controlsHost: HTMLElement | null
  historyHost: HTMLElement | null
  onSelect: () => void
  onMoveStart: (event: PointerEvent<HTMLElement>) => void
  readonly: boolean
  sourcePath: string
  reference?: boolean
  onChange: (next: StudioDocument) => void
}) {
  const toolRailRef = useRef<HTMLDivElement>(null)
  useEditorToolAnchor(toolRailRef, active && !!controlsHost)
  const [tool, setTool] = useState<Tool>('select')
  const [eraseTarget, setEraseTarget] = useState<AIEraseTarget>('paint')
  const [brushSize, setBrushSize] = useState(24)
  const [color, setColor] = useState('#ef4444')
  const [guideColor, setGuideColor] = useState('#ef4444')
  const [guideWidth, setGuideWidth] = useState(4)
  const [selectedGuideId, setSelectedGuideId] = useState('')
  const [gesturePoints, setGesturePoints] = useState<StudioPoint[]>([])
  const [cropFrame, setCropFrame] = useState<CropFrame | null>(null)
  const [cropRatio, setCropRatio] = useState('free')
  const [cropAspectRatio, setCropAspectRatio] = useState(0)
  const [cropPreview] = useState(createImageCropPreview)
  const [transformPreview] = useState(createImageTransformPreview)
  const [brushPoint, setBrushPoint] = useState<StudioPoint | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const undoStack = useRef<StudioDocument[]>([])
  const redoStack = useRef<StudioDocument[]>([])
  const imageLayer = document.layers.find(
    (layer): layer is StudioImageLayer => layer.kind === 'image' && layer.path === sourcePath
  )
  const guides = document.layers.filter((layer) => layer.kind === 'guide')
  const selectedGuide = guides.find((layer) => layer.id === selectedGuideId)
  const cropTarget = imageLayer
    ? { ...imageLayer, x: 0, y: 0, width: document.width, height: document.height, rotation: 0 }
    : undefined

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
    if (event.defaultPrevented || event.button !== 0) return
    if (!active) {
      onSelect()
      return
    }
    if (readonly || tool === 'scale' || tool === 'crop') return
    const startPoint = point(event)
    if (
      tool === 'select' &&
      !guides.some(
        (layer) =>
          startPoint.x >= layer.x - 8 &&
          startPoint.x <= layer.x + layer.width + 8 &&
          startPoint.y >= layer.y - 8 &&
          startPoint.y <= layer.y + layer.height + 8
      )
    ) {
      setSelectedGuideId('')
      onMoveStart(event)
      return
    }
    event.stopPropagation()
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const start = point(event)
    gesture.current = { pointerId: event.pointerId, start, points: [start] }
    setGesturePoints([start])
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    setBrushPoint(point(event))
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
    if (tool === 'rect' || tool === 'arrow') {
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
  const pendingGuide =
    (tool === 'rect' || tool === 'arrow') && gesturePoints.length > 1
      ? bounds(gesturePoints[0], gesturePoints[gesturePoints.length - 1])
      : null
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (!active || readonly || event.defaultPrevented || event.isComposing || gesture.current)
        return
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
      } else if (!modifier && event.key === 'Enter' && tool === 'crop' && cropFrame) {
        event.preventDefault()
        applyCrop()
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
  function chooseTool(next: Tool) {
    setTool(next)
    setSelectedGuideId('')
    setCropFrame(next === 'crop' ? studioCenteredCrop(document.width, document.height, 0) : null)
    setCropRatio('free')
    setCropAspectRatio(0)
    cropPreview.clear()
    setBrushPoint(null)
  }
  function applyCrop() {
    if (readonly || !cropFrame) return
    commit(cropAIEditDocument(document, cropPreview.frame(cropFrame)))
    chooseTool('select')
  }
  const isBrush = tool === 'paint' || tool === 'mask' || tool === 'erase'
  const isAdjust = tool === 'crop' || tool === 'scale'
  const showProperties = !isAdjust && (tool !== 'select' || !!selectedGuide)
  const toolItems = [
    { value: 'select' as Tool, label: '选择 / 移动 (V)', icon: IconArrowsMove },
    { value: 'crop' as Tool, label: '调整', icon: IconAdjustmentsHorizontal },
    ...(!reference
      ? [
          { value: 'rect' as Tool, label: '提示框', icon: IconSquareDashed },
          { value: 'arrow' as Tool, label: '箭头', icon: IconArrowUpRight },
          { value: 'paint' as Tool, label: '涂抹', icon: IconBrush },
          { value: 'mask' as Tool, label: '遮罩', icon: IconMask },
          { value: 'erase' as Tool, label: '橡皮擦', icon: IconEraser }
        ]
      : [])
  ]
  return (
    <>
      {active &&
        historyHost &&
        createPortal(
          <>
            <Tooltip label="撤销 (Ctrl+Z)">
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                aria-label="撤销画布操作"
                disabled={readonly || !undoStack.current.length}
                onClick={undo}
              >
                <IconArrowBackUp size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="重做 (Ctrl+Shift+Z)">
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                aria-label="重做画布操作"
                disabled={readonly || !redoStack.current.length}
                onClick={redo}
              >
                <IconArrowForwardUp size={18} />
              </ActionIcon>
            </Tooltip>
          </>,
          historyHost
        )}
      {active &&
        controlsHost &&
        createPortal(
          <>
            <div
              ref={toolRailRef}
              className="react-image-tool-rail react-ai-edit-tool-rail"
              role="toolbar"
              aria-label="AI 编辑画布工具"
            >
              {toolItems.map(({ value, label, icon: Icon }) => (
                <Fragment key={value}>
                  {value === 'crop' ? (
                    <ImageTransformTools
                      selected={cropTarget}
                      canvas={document}
                      targetLabel={`${reference ? '参考图' : '主图'} · ${document.name}`}
                      preview={transformPreview}
                      tool={tool === 'scale' ? 'resize' : tool === 'crop' ? 'crop' : 'select'}
                      disabled={readonly}
                      minDimension={10}
                      maxDimension={2048}
                      cropRatio={cropRatio}
                      cropFrame={cropFrame ?? undefined}
                      cropPreview={cropPreview}
                      cropAspectRatio={cropAspectRatio}
                      onToolChange={(next) => chooseTool(next === 'resize' ? 'scale' : 'crop')}
                      onResize={(width, height) =>
                        commit(scaleStudioDocument(document, width, height))
                      }
                      onCropRatio={(key, ratio) => {
                        setCropRatio(key)
                        setCropAspectRatio(ratio)
                        setCropFrame(studioCenteredCrop(document.width, document.height, ratio))
                      }}
                      onCrop={applyCrop}
                      onCropFrameChange={setCropFrame}
                      onCancel={() => chooseTool('select')}
                      resizeContent={
                        <>
                          {imageLayer && (
                            <Stack gap="xs">
                              <Stack gap="xs">
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
                                    if (
                                      value === 'cover' ||
                                      value === 'contain' ||
                                      value === 'stretch'
                                    )
                                      commit(
                                        updateAIImageContent(document, sourcePath, { fit: value })
                                      )
                                  }}
                                  disabled={readonly}
                                />
                                <EditorParameterSlider
                                  label="内容缩放"
                                  thumbLabel="图片内容缩放"
                                  resetValue={1}
                                  formatValue={(value) => `${Math.round(value * 100)}%`}
                                  min={1}
                                  max={8}
                                  step={0.05}
                                  value={imageLayer.zoom}
                                  onChange={(value) =>
                                    commit(
                                      updateAIImageContent(document, sourcePath, { zoom: value })
                                    )
                                  }
                                  disabled={readonly}
                                />
                              </Stack>
                              {(imageLayer.zoom !== 1 || imageLayer.fit === 'cover') && (
                                <Stack gap="xs">
                                  <EditorParameterSlider
                                    label="水平位置"
                                    thumbLabel="图片水平位置"
                                    resetValue={0.5}
                                    formatValue={(value) => `${Math.round(value * 100)}%`}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    value={imageLayer.focusX}
                                    onChange={(value) =>
                                      commit(
                                        updateAIImageContent(document, sourcePath, {
                                          focusX: value
                                        })
                                      )
                                    }
                                    disabled={readonly}
                                  />
                                  <EditorParameterSlider
                                    label="垂直位置"
                                    thumbLabel="图片垂直位置"
                                    resetValue={0.5}
                                    formatValue={(value) => `${Math.round(value * 100)}%`}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    value={imageLayer.focusY}
                                    onChange={(value) =>
                                      commit(
                                        updateAIImageContent(document, sourcePath, {
                                          focusY: value
                                        })
                                      )
                                    }
                                    disabled={readonly}
                                  />
                                </Stack>
                              )}
                            </Stack>
                          )}
                        </>
                      }
                    />
                  ) : (
                    <Tooltip label={label} position="right">
                      <ActionIcon
                        size={36}
                        variant={tool === value ? 'light' : 'subtle'}
                        color={tool === value ? 'blue' : 'gray'}
                        aria-label={label}
                        aria-pressed={tool === value}
                        onClick={() => chooseTool(value)}
                        disabled={readonly}
                      >
                        <Icon size={19} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                  {!reference && (value === 'crop' || value === 'arrow') && <Divider />}
                </Fragment>
              ))}
            </div>
            {showProperties && (
              <Stack className="react-ai-edit-properties" gap="sm">
                <Group justify="space-between">
                  <Text size="sm" fw={700}>
                    {isAdjust
                      ? '调整'
                      : isBrush
                        ? tool === 'erase'
                          ? '橡皮擦'
                          : tool === 'mask'
                            ? '遮罩'
                            : '涂抹'
                        : '提示标注'}
                  </Text>
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    color="gray"
                    aria-label="关闭工具设置"
                    onClick={() => {
                      chooseTool('select')
                      setSelectedGuideId('')
                    }}
                  >
                    <IconX size={14} />
                  </ActionIcon>
                </Group>
                <Text size="xs" c="dimmed" truncate>
                  {reference ? '参考图' : '主图'} · {document.name}
                </Text>
                {isBrush && (
                  <>
                    {tool === 'paint' && (
                      <ColorInput
                        label="涂抹颜色"
                        size="xs"
                        value={color}
                        onChange={setColor}
                        disabled={readonly}
                      />
                    )}
                    {tool === 'erase' && (
                      <SegmentedControl
                        size="xs"
                        aria-label="擦除对象"
                        value={eraseTarget}
                        onChange={(v) => setEraseTarget(v as AIEraseTarget)}
                        data={[
                          { value: 'paint', label: '涂抹' },
                          { value: 'mask', label: '遮罩' }
                        ]}
                        disabled={readonly}
                      />
                    )}
                    <EditorParameterSlider
                      label="笔刷大小"
                      thumbLabel="笔刷大小"
                      compact
                      resetValue={24}
                      formatValue={(v) => `${v}px`}
                      min={2}
                      max={120}
                      value={brushSize}
                      onChange={setBrushSize}
                      disabled={readonly}
                    />
                  </>
                )}
                {(tool === 'rect' || tool === 'arrow') && (
                  <>
                    <ColorInput
                      size="xs"
                      label="标注颜色"
                      value={guideColor}
                      onChange={setGuideColor}
                      disabled={readonly}
                    />
                    <EditorParameterSlider
                      label="线宽"
                      thumbLabel="标注线宽"
                      compact
                      resetValue={4}
                      formatValue={(v) => `${v}px`}
                      min={1}
                      max={24}
                      value={guideWidth}
                      onChange={setGuideWidth}
                      disabled={readonly}
                    />
                  </>
                )}
                {!reference && !isBrush && guides.length > 0 && (
                  <Stack gap="xs">
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
                              updateAIGuide(document, selectedGuide.id, {
                                prompt: event.currentTarget.value
                              })
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
              </Stack>
            )}
          </>,
          controlsHost
        )}
      <div
        ref={canvasRef}
        className="react-ai-edit-canvas"
        style={{ aspectRatio: `${document.width} / ${document.height}` }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerEnd}
        onPointerLeave={() => setBrushPoint(null)}
        onPointerCancel={() => {
          gesture.current = null
          setGesturePoints([])
          setBrushPoint(null)
        }}
        data-tool={active ? tool : 'inactive'}
        role={active && tool === 'crop' ? 'group' : 'img'}
        aria-label={`${reference ? '参考图' : '主图'}编辑画布，${document.width} × ${document.height}`}
      >
        <img src={previewUrl} alt={document.name} draggable={false} />
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
          {active && selectedGuide && (
            <rect
              x={selectedGuide.x}
              y={selectedGuide.y}
              width={selectedGuide.width}
              height={selectedGuide.height}
              fill="none"
              stroke="var(--omni-editor-accent)"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              strokeDasharray="4 3"
            />
          )}
          {active && isBrush && brushPoint && (
            <circle
              cx={brushPoint.x}
              cy={brushPoint.y}
              r={brushSize / 2}
              fill="none"
              stroke={tool === 'erase' ? '#fff' : color}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              style={{ filter: 'drop-shadow(0 0 1px black)' }}
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
        {active && tool === 'crop' && cropTarget && cropFrame && (
          <ImageCropFrame
            layer={cropTarget}
            frame={cropFrame}
            cropPreview={cropPreview}
            ratio={cropAspectRatio}
            width={document.width}
            height={document.height}
            canvasRef={canvasRef}
            disabled={readonly}
            isPanning={() => false}
            onChange={setCropFrame}
          />
        )}
      </div>
    </>
  )
}
