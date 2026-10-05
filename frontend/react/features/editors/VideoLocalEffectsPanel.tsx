import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  ActionIcon,
  Button,
  Group,
  NumberInput,
  Select,
  Slider,
  Stack,
  Switch,
  Text
} from '@mantine/core'
import { IconPlus, IconTrash, IconPencil, IconRestore } from '@tabler/icons-react'
import {
  applyLocalVideoEffects,
  defaultLocalVideoEffects,
  MAX_LOCAL_VIDEO_REGIONS,
  moveLocalRegion,
  regionFromDrag,
  validateLocalVideoEffects
} from './videoLocalEffects'
import type { LocalVideoEffects, LocalVideoRegion } from './videoLocalEffects'
import './VideoLocalEffects.css'

export interface VideoLocalEffectsProps {
  value?: LocalVideoEffects
  onChange: (effects: LocalVideoEffects) => void
  readonly?: boolean
  /** Current cropped/fitted document-plane frame, before flips/transforms/effects. */
  frame?: CanvasImageSource | null
  frameVersion?: number | string
  aspectRatio?: number
  onInteractionStart?: () => void
  onInteractionEnd?: () => void
}

const effectNames = { mask: '透明', blur: '模糊', mosaic: '马赛克' }
const colorFields = [
  { key: 'exposure' as const, label: '曝光 EV', min: -2, max: 2, step: 0.05 },
  { key: 'temperature' as const, label: '色温 · 冷暖', min: -1, max: 1, step: 0.02 },
  { key: 'tint' as const, label: '色调 · 绿紫', min: -1, max: 1, step: 0.02 },
  { key: 'gamma' as const, label: 'Gamma', min: 0.25, max: 4, step: 0.05 }
]
type Point = { x: number; y: number }
type Drag = {
  pointer: number
  start: Point
  before: LocalVideoEffects
  region: LocalVideoRegion
  kind: 'draw' | 'move' | 'resize'
  anchor: Point
}

export default function VideoLocalEffects({
  value,
  onChange,
  readonly = false,
  frame,
  frameVersion,
  aspectRatio = 16 / 9,
  onInteractionStart,
  onInteractionEnd
}: VideoLocalEffectsProps) {
  const [draft, setDraft] = useState(value ?? defaultLocalVideoEffects())
  const latest = useRef(draft)
  const currentProps = useRef({ onChange, readonly, onInteractionEnd })
  currentProps.current = { onChange, readonly, onInteractionEnd }
  const [selected, setSelected] = useState<string | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [shape, setShape] = useState<LocalVideoRegion['shape']>('rectangle')
  const [effect, setEffect] = useState<LocalVideoRegion['effect']>('blur')
  const [error, setError] = useState('')
  const [previewError, setPreviewError] = useState('')
  const canvas = useRef<HTMLCanvasElement>(null)
  const board = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 16 / 9
  const region = draft.regions.find((item) => item.id === selected)
  function update(next: LocalVideoEffects) {
    latest.current = next
    setDraft(next)
  }
  function commit(next: LocalVideoEffects) {
    if (currentProps.current.readonly) return
    if (!validateLocalVideoEffects(next)) {
      setError('区域或调色参数无效')
      return
    }
    update(next)
    setError('')
    try {
      currentProps.current.onChange(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '效果无法保存')
    }
  }
  function cancelDrag() {
    const pending = drag.current
    if (!pending) return
    drag.current = null
    update(pending.before)
    currentProps.current.onInteractionEnd?.()
  }
  useEffect(() => {
    // A different selected clip or an external undo must cancel the pending gesture.
    cancelDrag()
    update(value ?? defaultLocalVideoEffects())
  }, [value])
  useEffect(() => {
    if (readonly) {
      cancelDrag()
      setDrawing(false)
      update(value ?? defaultLocalVideoEffects())
    }
  }, [readonly])
  useEffect(
    () => () => {
      if (drag.current) currentProps.current.onInteractionEnd?.()
    },
    []
  )
  useEffect(() => {
    const target = canvas.current
    if (!target) return
    const width = Math.max(1, Math.round(Math.min(480, 320 * ratio)))
    const height = Math.max(1, Math.round(width / ratio))
    target.width = width
    target.height = height
    const context = target.getContext('2d')
    if (!context) return
    context.clearRect(0, 0, width, height)
    setPreviewError('')
    if (!frame) return
    try {
      context.drawImage(frame, 0, 0, width, height)
      applyLocalVideoEffects(target, draft)
    } catch {
      setPreviewError('当前帧无法预览，请暂停后重试')
    }
  }, [frame, frameVersion, ratio, draft])
  function patchRegion(patch: Partial<LocalVideoRegion>, save = true) {
    if (!region || readonly) return
    const next = {
      ...latest.current,
      regions: latest.current.regions.map((item) =>
        item.id === region.id ? { ...item, ...patch } : item
      )
    }
    if (!validateLocalVideoEffects(next)) return
    if (save) commit(next)
    else update(next)
  }
  function newRegion(bounds = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }): LocalVideoRegion {
    return {
      id: crypto.randomUUID(),
      shape,
      effect,
      ...bounds,
      invert: false,
      feather: 0,
      strength: 0.5
    }
  }
  function point(event: ReactPointerEvent): Point {
    const box = board.current?.getBoundingClientRect()
    if (!box || !box.width || !box.height) return { x: 0, y: 0 }
    return {
      x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height))
    }
  }
  function begin(event: ReactPointerEvent, item?: LocalVideoRegion, corner?: string) {
    if (
      readonly ||
      event.button !== 0 ||
      (drawing && draft.regions.length >= MAX_LOCAL_VIDEO_REGIONS)
    )
      return
    if (!drawing && !item) return
    event.preventDefault()
    event.stopPropagation()
    board.current?.focus({ preventScroll: true })
    const start = point(event),
      before = latest.current
    const created = drawing || !item
    const target = created ? newRegion(regionFromDrag(start, start)) : item
    const anchor = corner
      ? {
          x: corner.includes('w') ? target.x + target.width : target.x,
          y: corner.includes('n') ? target.y + target.height : target.y
        }
      : start
    drag.current = {
      pointer: event.pointerId,
      start,
      before,
      region: target,
      kind: created ? 'draw' : corner ? 'resize' : 'move',
      anchor
    }
    setSelected(target.id)
    onInteractionStart?.()
    board.current?.setPointerCapture(event.pointerId)
    if (created) update({ ...before, regions: [...before.regions, target] })
  }
  function move(event: ReactPointerEvent) {
    const pending = drag.current
    if (!pending || pending.pointer !== event.pointerId || readonly) return
    const now = point(event)
    const moved =
      pending.kind === 'move'
        ? moveLocalRegion(pending.region, now.x - pending.start.x, now.y - pending.start.y)
        : {
            ...pending.region,
            ...regionFromDrag(pending.kind === 'resize' ? pending.anchor : pending.start, now)
          }
    update({
      ...latest.current,
      regions: latest.current.regions.map((item) => (item.id === moved.id ? moved : item))
    })
  }
  function finish(event: ReactPointerEvent) {
    const pending = drag.current
    if (!pending || event.pointerId !== pending.pointer) return
    move(event)
    drag.current = null
    setDrawing(false)
    const edited = latest.current.regions.find((item) => item.id === pending.region.id)
    if (!edited || (pending.kind === 'draw' && (edited.width < 0.005 || edited.height < 0.005)))
      update(pending.before)
    else commit(latest.current)
    currentProps.current.onInteractionEnd?.()
  }
  return (
    <Stack gap="xs" className="video-local-effects">
      <Text size="xs" fw={600}>
        局部处理
      </Text>
      <Group gap="xs" grow>
        <Select
          aria-label="区域形状"
          value={shape}
          allowDeselect={false}
          disabled={readonly}
          onChange={(next) => setShape(next as LocalVideoRegion['shape'])}
          data={[
            { value: 'rectangle', label: '矩形' },
            { value: 'ellipse', label: '椭圆' }
          ]}
        />
        <Select
          aria-label="新区域效果"
          value={effect}
          allowDeselect={false}
          disabled={readonly}
          onChange={(next) => setEffect(next as LocalVideoRegion['effect'])}
          data={Object.entries(effectNames).map(([value, label]) => ({ value, label }))}
        />
      </Group>
      <div
        ref={board}
        className={`video-local-board${drawing ? ' is-drawing' : ''}`}
        style={{ aspectRatio: ratio }}
        tabIndex={0}
        role="group"
        aria-label="局部区域编辑画面"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            cancelDrag()
            setDrawing(false)
          }
          if (
            !readonly &&
            region &&
            !drag.current &&
            ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
          ) {
            event.preventDefault()
            event.stopPropagation()
            const step = event.shiftKey ? 0.05 : 0.005
            patchRegion(
              moveLocalRegion(
                region,
                event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
                event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
              )
            )
          }
        }}
        onPointerDown={(event) => begin(event)}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={cancelDrag}
        onLostPointerCapture={() => {
          if (drag.current) cancelDrag()
        }}
      >
        <canvas ref={canvas} />
        {!frame && <span className="video-local-no-frame">当前帧尚未就绪</span>}
        {draft.regions.map((item, index) => (
          <div
            key={item.id}
            className={`video-local-region${item.id === selected ? ' is-selected' : ''}${item.shape === 'ellipse' ? ' is-ellipse' : ''}`}
            style={{
              left: `${item.x * 100}%`,
              top: `${item.y * 100}%`,
              width: `${item.width * 100}%`,
              height: `${item.height * 100}%`
            }}
            onPointerDown={(event) => begin(event, item)}
          >
            <span>{index + 1}</span>
            {item.id === selected &&
              !readonly &&
              ['nw', 'ne', 'sw', 'se'].map((corner) => (
                <i
                  key={corner}
                  className={`handle-${corner}`}
                  onPointerDown={(event) => begin(event, item, corner)}
                />
              ))}
          </div>
        ))}
      </div>
      <Group gap="xs" grow>
        <Button
          size="xs"
          variant={drawing ? 'light' : 'default'}
          leftSection={<IconPencil size={13} />}
          disabled={readonly || draft.regions.length >= MAX_LOCAL_VIDEO_REGIONS}
          onClick={() => setDrawing(!drawing)}
        >
          {drawing ? '拖动画区域' : '画区域'}
        </Button>
        <Button
          size="xs"
          variant="default"
          leftSection={<IconPlus size={13} />}
          disabled={readonly || draft.regions.length >= MAX_LOCAL_VIDEO_REGIONS}
          onClick={() => {
            const added = newRegion()
            setSelected(added.id)
            commit({ ...draft, regions: [...draft.regions, added] })
          }}
        >
          添加区域
        </Button>
      </Group>
      {draft.regions.length > 0 && (
        <Group gap="xs" wrap="nowrap">
          <Select
            className="video-local-region-select"
            aria-label="当前局部区域"
            placeholder="选择区域"
            value={selected}
            onChange={setSelected}
            data={draft.regions.map((item, index) => ({
              value: item.id,
              label: `${index + 1} · ${effectNames[item.effect]} · ${item.shape === 'ellipse' ? '椭圆' : '矩形'}`
            }))}
          />
          <ActionIcon
            aria-label="删除局部区域"
            variant="default"
            disabled={readonly || !region}
            onClick={() => {
              commit({ ...draft, regions: draft.regions.filter((item) => item.id !== selected) })
              setSelected(null)
            }}
          >
            <IconTrash size={14} />
          </ActionIcon>
        </Group>
      )}
      {region && (
        <Stack gap="xs">
          <Group gap="xs" grow>
            <Select
              aria-label="所选区域形状"
              value={region.shape}
              allowDeselect={false}
              disabled={readonly}
              onChange={(next) => patchRegion({ shape: next as LocalVideoRegion['shape'] })}
              data={[
                { value: 'rectangle', label: '矩形' },
                { value: 'ellipse', label: '椭圆' }
              ]}
            />
            <Select
              aria-label="所选区域效果"
              value={region.effect}
              allowDeselect={false}
              disabled={readonly}
              onChange={(next) => patchRegion({ effect: next as LocalVideoRegion['effect'] })}
              data={Object.entries(effectNames).map(([value, label]) => ({ value, label }))}
            />
          </Group>
          <div className="video-local-geometry">
            {(['x', 'y', 'width', 'height'] as const).map((key, index) => (
              <NumberInput
                key={key}
                label={['横向 %', '纵向 %', '宽度 %', '高度 %'][index]}
                value={Number((region[key] * 100).toFixed(2))}
                min={key === 'width' || key === 'height' ? 0.1 : 0}
                max={
                  (key === 'x'
                    ? 1 - region.width
                    : key === 'y'
                      ? 1 - region.height
                      : key === 'width'
                        ? 1 - region.x
                        : 1 - region.y) * 100
                }
                decimalScale={2}
                step={1}
                disabled={readonly}
                onChange={(next) => {
                  if (typeof next === 'number') patchRegion({ [key]: next / 100 }, false)
                }}
                onBlur={() => commit(latest.current)}
              />
            ))}
          </div>
          <Switch
            size="xs"
            label="反选"
            checked={region.invert}
            disabled={readonly}
            onChange={(event) => patchRegion({ invert: event.currentTarget.checked })}
          />
          <Text size="xs">柔边 · {Math.round(region.feather * 100)}%</Text>
          <Slider
            aria-label="区域柔边"
            value={region.feather}
            min={0}
            max={0.25}
            step={0.005}
            disabled={readonly}
            onChange={(next) => patchRegion({ feather: next }, false)}
            onChangeEnd={() => commit(latest.current)}
          />
          {region.effect !== 'mask' && (
            <>
              <Text size="xs">强度 · {Math.round(region.strength * 100)}%</Text>
              <Slider
                aria-label="区域效果强度"
                value={region.strength}
                min={0}
                max={1}
                step={0.01}
                disabled={readonly}
                onChange={(next) => patchRegion({ strength: next }, false)}
                onChangeEnd={() => commit(latest.current)}
              />
            </>
          )}
        </Stack>
      )}
      <Text size="xs" c="dimmed">
        区域随片段移动，按列表顺序处理；透明会露出下层。
      </Text>
      <Group justify="space-between">
        <Text size="xs" fw={600}>
          手动调色
        </Text>
        <ActionIcon
          aria-label="重置手动调色"
          variant="subtle"
          disabled={readonly}
          onClick={() => commit({ ...defaultLocalVideoEffects(), regions: draft.regions })}
        >
          <IconRestore size={13} />
        </ActionIcon>
      </Group>
      {colorFields.map(({ key, label, min, max, step }) => (
        <div key={key}>
          <Group justify="space-between">
            <Text size="xs">{label}</Text>
            <Text size="xs" c="dimmed">
              {draft[key].toFixed(2)}
            </Text>
          </Group>
          <Slider
            aria-label={label}
            value={draft[key]}
            min={min}
            max={max}
            step={step}
            disabled={readonly}
            onChange={(next) => update({ ...latest.current, [key]: next })}
            onChangeEnd={() => commit(latest.current)}
          />
        </div>
      ))}
      {(error || previewError) && (
        <Text size="xs" c="red" role="alert">
          {error || previewError}
        </Text>
      )}
    </Stack>
  )
}
