import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { ActionIcon, Button, Group, Loader, Text, Tooltip } from '@mantine/core'
import { IconLayoutGrid, IconPhotoPlus, IconReplace, IconX } from '@tabler/icons-react'
import type { StudioDocument } from '../../../src/features/image-editor/model/imageStudioModel'
import { renderStudioDocument } from '../../../src/features/image-editor/model/imageStudioRender'
import type { EditorContext } from './EditorHub'
import AIEditCanvas from './AIEditCanvas'
import EditorParameterSlider from './EditorParameterSlider'
import { fitAIInputs, layoutAIInputs, type BoardFrame } from './aiInputBoardLayout'
import './aiEditCanvas.css'

export type AIInputItem = {
  path: string
  label: string
  name: string
  document: StudioDocument | null
  error?: string
}
export type AIInputSlot = 'main' | 'append' | { reference: string }

function InputImage({
  item,
  assetInfo,
  ...props
}: {
  item: AIInputItem
  assetInfo: EditorContext['assetInfo']
} & Omit<Parameters<typeof AIEditCanvas>[0], 'document' | 'previewUrl' | 'sourcePath'>) {
  const [preview, setPreview] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    if (!item.document || item.error) return
    const canvas = document.createElement('canvas')
    void renderStudioDocument(canvas, item.document, assetInfo, true)
      .then((missing) => {
        if (!live) return
        if (missing.length) throw new Error(`图片不可用：${missing.join('、')}`)
        setPreview(canvas.toDataURL('image/png'))
        setError('')
      })
      .catch((cause) => {
        if (live) setError(cause instanceof Error ? cause.message : '预览失败')
      })
    return () => {
      live = false
    }
  }, [item.document, item.error, assetInfo])
  if (error || item.error)
    return (
      <Text size="xs" c="red" p="sm">
        {item.error || error}
      </Text>
    )
  if (!item.document || !preview)
    return (
      <div className="react-ai-input-loading">
        <Loader size="sm" />
        <Text size="xs">正在载入图片</Text>
      </div>
    )
  return (
    <AIEditCanvas {...props} document={item.document} sourcePath={item.path} previewUrl={preview} />
  )
}

export default function AIInputBoard({
  inputs,
  selectedPath,
  assetInfo,
  readonly,
  fixedMain,
  historyHost,
  onSelect,
  onChange,
  onChoose,
  onRemove
}: {
  inputs: AIInputItem[]
  selectedPath: string
  assetInfo: EditorContext['assetInfo']
  readonly: boolean
  fixedMain: boolean
  historyHost: HTMLElement | null
  onSelect: (path: string) => void
  onChange: (path: string, document: StudioDocument) => void
  onChoose: (slot: AIInputSlot) => void
  onRemove: (path: string) => void
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const [controlsHost, setControlsHost] = useState<HTMLDivElement | null>(null)
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 400 })
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({})
  const [view, setView] = useState<{ zoom: number; x: number; y: number } | null>(null)
  const [panning, setPanning] = useState(false)
  const [space, setSpace] = useState(false)
  const drag = useRef<{
    id: number
    startX: number
    startY: number
    x: number
    y: number
    zoom: number
    path?: string
  } | null>(null)
  const hasMain = inputs.length > 0
  const frames = useMemo(
    () =>
      layoutAIInputs([
        ...inputs.map((item) => ({
          width: item.document?.width || 300,
          height: item.document?.height || 240
        })),
        ...(!hasMain ? [{ width: 220, height: 240 }] : [])
      ]),
    [inputs, hasMain]
  )
  const placed = frames.map((frame, i) => ({ ...frame, ...positions[inputs[i]?.path] }))
  const fitted = fitAIInputs(placed, viewportSize.width, viewportSize.height)
  const currentView = view || fitted
  const inputKey = inputs.map((item) => item.path).join('\n')
  useEffect(() => {
    setView(null)
  }, [inputKey])
  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    const measure = () =>
      setViewportSize({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (
        event.code !== 'Space' ||
        event.defaultPrevented ||
        (event.target instanceof HTMLElement &&
          event.target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]'))
      )
        return
      event.preventDefault()
      setSpace(true)
    }
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpace(false)
    }
    const blur = () => {
      setSpace(false)
      setPanning(false)
      drag.current = null
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])
  function startMove(event: PointerEvent<HTMLElement>, path?: string) {
    if (event.button !== 0 && event.button !== 1) return
    event.preventDefault()
    event.stopPropagation()
    setView(currentView)
    const frame = path ? placed[inputs.findIndex((item) => item.path === path)] : null
    if (path) onSelect(path)
    drag.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: frame?.x ?? currentView.x,
      y: frame?.y ?? currentView.y,
      zoom: currentView.zoom,
      path
    }
    // Capture on the viewport so dragging remains smooth across cards and empty space.
    viewport.current?.setPointerCapture(event.pointerId)
    setPanning(!path)
  }
  function endMove(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== event.pointerId) return
    drag.current = null
    setPanning(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }
  function zoomTo(zoom: number, x = viewportSize.width / 2, y = viewportSize.height / 2) {
    const next = Math.max(0.05, Math.min(4, zoom))
    setView({
      zoom: next,
      x: x - ((x - currentView.x) * next) / currentView.zoom,
      y: y - ((y - currentView.y) * next) / currentView.zoom
    })
  }
  const styleFor = (frame: BoardFrame) => ({
    left: frame.x,
    top: frame.y,
    width: frame.width,
    height: frame.height
  })
  return (
    <div className="react-ai-input-board">
      <div
        className="react-ai-input-viewport"
        ref={viewport}
        data-panning={panning || space}
        aria-label="AI 图片输入画布"
        onWheel={(event) => {
          event.preventDefault()
          const rect = event.currentTarget.getBoundingClientRect()
          zoomTo(
            currentView.zoom * Math.exp(-Math.max(-120, Math.min(120, event.deltaY)) * 0.0015),
            event.clientX - rect.left,
            event.clientY - rect.top
          )
        }}
        onPointerDownCapture={(event) => {
          if (event.button === 1 || (space && event.button === 0)) startMove(event)
        }}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) startMove(event)
        }}
        onPointerMove={(event) => {
          const state = drag.current
          if (!state || state.id !== event.pointerId) return
          const dx = event.clientX - state.startX,
            dy = event.clientY - state.startY
          const path = state.path
          if (path)
            setPositions((old) => ({
              ...old,
              [path]: { x: state.x + dx / state.zoom, y: state.y + dy / state.zoom }
            }))
          else setView({ zoom: state.zoom, x: state.x + dx, y: state.y + dy })
        }}
        onPointerUp={endMove}
        onPointerCancel={endMove}
      >
        <div
          className="react-ai-input-world"
          style={{
            transform: `translate(${currentView.x}px, ${currentView.y}px) scale(${currentView.zoom})`
          }}
        >
          {inputs.map((item, index) => (
            <section
              key={item.path}
              className="react-ai-input-card"
              data-active={selectedPath === item.path}
              data-input-role={index ? 'reference' : 'main'}
              style={styleFor(placed[index])}
              aria-label={`${item.label} · ${item.name}`}
            >
              <header
                onPointerDown={(event) => {
                  if (!(event.target as HTMLElement).closest('button')) startMove(event, item.path)
                }}
              >
                <button
                  type="button"
                  className="react-ai-input-label"
                  onClick={() => onSelect(item.path)}
                  title={item.name}
                >
                  <strong>{item.label}</strong>
                  <span>{item.name}</span>
                </button>
                <Group gap={2} wrap="nowrap">
                  {(!fixedMain || index > 0) && (
                    <Tooltip label={index ? '替换参考图' : '替换主图'}>
                      <ActionIcon
                        size={25}
                        variant="subtle"
                        color="gray"
                        aria-label={index ? `替换参考图 ${index}` : '替换主图'}
                        disabled={readonly}
                        onClick={() => onChoose(index ? { reference: item.path } : 'main')}
                      >
                        <IconReplace size={15} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                  {index > 0 && (
                    <Tooltip label="移除参考图">
                      <ActionIcon
                        size={25}
                        variant="subtle"
                        color="gray"
                        aria-label={`移除参考图 ${index}`}
                        disabled={readonly}
                        onClick={() => onRemove(item.path)}
                      >
                        <IconX size={15} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </Group>
              </header>
              <InputImage
                item={item}
                assetInfo={assetInfo}
                active={selectedPath === item.path}
                reference={index > 0}
                readonly={readonly}
                controlsHost={controlsHost}
                historyHost={historyHost}
                onSelect={() => onSelect(item.path)}
                onMoveStart={(event) => startMove(event, item.path)}
                onChange={(doc) => onChange(item.path, doc)}
              />
            </section>
          ))}
          {!hasMain && (
            <button
              type="button"
              className="react-ai-input-empty"
              style={styleFor(placed[inputs.length])}
              disabled={readonly}
              onClick={() => onChoose('main')}
            >
              <IconPhotoPlus size={30} />
              <strong>添加主图</strong>
            </button>
          )}
        </div>
      </div>
      <div ref={setControlsHost} className="react-ai-input-controls" />
      <Group className="react-ai-board-zoom" gap={6} wrap="nowrap">
        <EditorParameterSlider
          label="视图缩放"
          thumbLabel="AI 输入视图缩放"
          compact
          resetValue={100}
          formatValue={(v) => `${Math.round(v)}%`}
          min={5}
          max={400}
          value={currentView.zoom * 100}
          onChange={(v) => zoomTo(v / 100)}
          w={245}
        />
        <Button size="compact-xs" variant="subtle" onClick={() => setView(null)}>
          适应
        </Button>
        <Tooltip label="重新排列图片">
          <ActionIcon
            size="sm"
            color="gray"
            variant="subtle"
            aria-label="重新排列图片"
            onClick={() => {
              setPositions({})
              setView(null)
            }}
          >
            <IconLayoutGrid size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </div>
  )
}
