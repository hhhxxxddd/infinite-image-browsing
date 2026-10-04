import {
  ActionIcon,
  Button,
  Group,
  NumberInput,
  Popover,
  Stack,
  Switch,
  Tabs,
  Text,
  Tooltip
} from '@mantine/core'
import { IconAdjustments } from '@tabler/icons-react'
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type {
  StudioFrame,
  StudioLayer
} from '../../../src/features/image-editor/model/imageStudioModel'
import EditorParameterSlider from './EditorParameterSlider'
import {
  readImageCorrection,
  type StudioImageCorrection
} from '../../../src/features/image-editor/model/imageStudioCorrection'
import ImageAspectRatios from './ImageAspectRatios'
import {
  studioResizeDimensions,
  studioCropDimensions
} from '../../../src/features/image-editor/model/imageStudioGeometry'
import type { ImageTransformPreview } from './imageTransformPreviewStore'
import type { ImageCropPreview } from './imageCropPreviewStore'

export type ImageTransformTool =
  'select' | 'resize' | 'crop' | 'correct' | 'text' | 'layout' | 'shapes' | 'ai'

export default function ImageTransformTools({
  selected,
  canvas,
  targetLabel,
  onCorrection,
  preview,
  tool,
  disabled,
  cropRatio,
  cropFrame,
  cropPreview,
  cropAspectRatio,
  onToolChange,
  onResize,
  onCropRatio,
  onCrop,
  onCropFrameChange,
  onCancel,
  minDimension = 1,
  maxDimension = 16384,
  resizeContent
}: {
  canvas: { width: number; height: number }
  targetLabel: string
  onCorrection?: (correction: StudioImageCorrection) => void
  selected?: StudioLayer
  preview: ImageTransformPreview
  tool: ImageTransformTool
  disabled: boolean
  cropRatio: string
  cropFrame?: StudioFrame
  cropPreview: ImageCropPreview
  cropAspectRatio: number
  onToolChange: (tool: ImageTransformTool) => void
  onResize: (width: number, height: number) => void
  onCropRatio: (key: string, ratio: number) => void
  onCrop: () => void
  onCropFrameChange: (frame: StudioFrame) => void
  onCancel: () => void
  minDimension?: number
  maxDimension?: number
  resizeContent?: ReactNode
}) {
  const [initialSize, setInitialSize] = useState({ width: 1, height: 1 })
  const sizeSession = useRef<string | undefined>(undefined)
  const [ratio, setRatio] = useState(1)
  const [ratioKey, setRatioKey] = useState('original')
  const [locked, setLocked] = useState(true)
  const dimensions = useSyncExternalStore(preview.subscribe, () => {
    if (!selected) return `${canvas.width}:${canvas.height}`
    const layer = preview.layer(selected)
    return `${layer.width}:${layer.height}`
  })
  const [width, height] = dimensions.split(':').map(Number)
  const size = { width, height }
  const liveCrop = useSyncExternalStore(cropPreview.subscribe, () =>
    cropFrame ? cropPreview.frame(cropFrame) : undefined
  )
  const cropMaxWidth = selected
    ? Math.min(
        selected.width,
        cropAspectRatio > 0 ? selected.height * cropAspectRatio : selected.width
      )
    : 1
  const cropMaxHeight = selected
    ? Math.min(
        selected.height,
        cropAspectRatio > 0 ? selected.width / cropAspectRatio : selected.height
      )
    : 1
  const canCrop = !!liveCrop && liveCrop.width >= minDimension && liveCrop.height >= minDimension
  function changeCropSize(axis: 'width' | 'height', value: string | number) {
    if (typeof value !== 'number' || !selected || !liveCrop) return
    onCropFrameChange(studioCropDimensions(selected, liveCrop, axis, value, cropAspectRatio))
  }
  const active = tool === 'resize' || tool === 'crop' || tool === 'correct'
  useEffect(() => {
    if (!active) {
      sizeSession.current = undefined
      return
    }
    const target = selected?.id ?? 'canvas'
    if (sizeSession.current === target) return
    sizeSession.current = target
    const [width, height] = dimensions.split(':').map(Number)
    setInitialSize({ width, height })
    setRatio(width / height)
    setRatioKey('original')
    setLocked(true)
  }, [selected?.id, dimensions, active])
  function changeSize(axis: 'width' | 'height', value: string | number) {
    if (disabled || typeof value !== 'number' || !Number.isFinite(value)) return
    const next = Math.max(minDimension, Math.min(maxDimension, value))
    const other = axis === 'width' ? next / ratio : next * ratio
    const resized = locked
      ? studioResizeDimensions(axis === 'width' ? next : other, axis === 'height' ? next : other)
      : { ...size, [axis]: Math.round(next) }
    resizeWithinLimits(resized.width, resized.height)
  }
  function resizeWithinLimits(width: number, height: number) {
    const factor = Math.min(1, maxDimension / width, maxDimension / height)
    onResize(
      Math.max(minDimension, Math.round(width * factor)),
      Math.max(minDimension, Math.round(height * factor))
    )
  }
  const [lastTab, setLastTab] = useState<ImageTransformTool>('crop')
  const correction = readImageCorrection(
    selected?.kind === 'image' ? selected.correction : undefined
  )
  const imageOnly = selected?.kind === 'image'
  return (
    <Popover
      position="right-start"
      offset={12}
      width={320}
      withinPortal
      portalProps={{ target: '.react-editor-shell' }}
      closeOnClickOutside={false}
      shadow="md"
      zIndex={65}
      opened={active}
      onChange={(opened) => {
        if (!opened) onCancel()
      }}
    >
      <Popover.Target>
        <Tooltip label="调整">
          <ActionIcon
            aria-label="调整"
            variant={active ? 'light' : 'subtle'}
            onClick={() => (active ? onCancel() : onToolChange(selected ? lastTab : 'resize'))}
          >
            <IconAdjustments size={18} stroke={1.8} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown className="react-image-tool-popover react-image-rail-popover react-image-adjust-popover">
        <Stack gap="sm">
          <Text size="sm" fw={700}>
            调整
          </Text>
          <Text size="xs" c="dimmed" className="react-image-adjust-target">
            作用对象 · {targetLabel}
          </Text>
          <Tabs
            value={active ? tool : lastTab}
            onChange={(value) => {
              const next = value as ImageTransformTool
              setLastTab(next)
              onToolChange(next)
            }}
            keepMounted={false}
          >
            <Tabs.List grow>
              <Tabs.Tab value="crop">裁剪</Tabs.Tab>
              <Tabs.Tab value="resize">尺寸</Tabs.Tab>
              {onCorrection && <Tabs.Tab value="correct">校正</Tabs.Tab>}
            </Tabs.List>
            <Tabs.Panel value="resize" pt="sm">
              <fieldset disabled={disabled} className="react-image-adjust-fields">
                <Stack gap="sm">
                  <Group grow>
                    <NumberInput
                      size="xs"
                      label="宽度 px"
                      value={size.width}
                      decimalScale={0}
                      min={minDimension}
                      max={maxDimension}
                      onChange={(value) => changeSize('width', value)}
                    />
                    <NumberInput
                      size="xs"
                      label="高度 px"
                      value={size.height}
                      decimalScale={0}
                      min={minDimension}
                      max={maxDimension}
                      onChange={(value) => changeSize('height', value)}
                    />
                  </Group>
                  <Switch
                    size="xs"
                    label="保持比例"
                    checked={locked}
                    onChange={(event) => {
                      setLocked(event.currentTarget.checked)
                      setRatio(size.width / size.height)
                      setRatioKey('original')
                    }}
                  />
                  <ImageAspectRatios
                    value={ratioKey}
                    onChange={(key, next) => {
                      setRatioKey(key)
                      setRatio(next)
                      setLocked(true)
                      const resized = studioResizeDimensions(size.width, size.width / next)
                      resizeWithinLimits(resized.width, resized.height)
                    }}
                  />
                  {resizeContent}
                  <Group justify="space-between" gap="xs">
                    <Button
                      size="xs"
                      variant="subtle"
                      disabled={
                        size.width === initialSize.width && size.height === initialSize.height
                      }
                      onClick={() => {
                        onResize(initialSize.width, initialSize.height)
                        setRatio(initialSize.width / initialSize.height)
                        setRatioKey('original')
                        setLocked(true)
                      }}
                    >
                      重置尺寸
                    </Button>
                    <Button size="xs" onClick={onCancel}>
                      完成
                    </Button>
                  </Group>
                </Stack>
              </fieldset>
            </Tabs.Panel>
            <Tabs.Panel value="crop" pt="sm">
              {imageOnly ? (
                <fieldset disabled={disabled} className="react-image-adjust-fields">
                  <Stack gap="sm">
                    <Group grow>
                      <NumberInput
                        size="xs"
                        label="宽度 px"
                        value={liveCrop ? Math.round(liveCrop.width * 100) / 100 : ''}
                        min={Math.min(minDimension, cropMaxWidth)}
                        max={cropMaxWidth}
                        decimalScale={2}
                        clampBehavior="strict"
                        onChange={(value) => changeCropSize('width', value)}
                      />
                      <NumberInput
                        size="xs"
                        label="高度 px"
                        value={liveCrop ? Math.round(liveCrop.height * 100) / 100 : ''}
                        min={Math.min(minDimension, cropMaxHeight)}
                        max={cropMaxHeight}
                        decimalScale={2}
                        clampBehavior="strict"
                        onChange={(value) => changeCropSize('height', value)}
                      />
                    </Group>
                    <Group gap="xs">
                      <Button
                        size="compact-xs"
                        variant={cropRatio === 'free' ? 'light' : 'subtle'}
                        onClick={() => onCropRatio('free', 0)}
                      >
                        自由
                      </Button>
                      <Button
                        size="compact-xs"
                        variant={cropRatio === 'original' ? 'light' : 'subtle'}
                        onClick={() =>
                          onCropRatio('original', selected ? selected.width / selected.height : 1)
                        }
                      >
                        原比例
                      </Button>
                    </Group>
                    <ImageAspectRatios value={cropRatio} onChange={onCropRatio} />
                    <Group justify="flex-end" gap="xs">
                      <Button size="xs" variant="subtle" onClick={onCancel}>
                        取消
                      </Button>
                      <Button size="xs" disabled={!canCrop} onClick={onCrop}>
                        应用裁剪
                      </Button>
                    </Group>
                  </Stack>
                </fieldset>
              ) : (
                <Text size="sm" c="dimmed">
                  请选中一个图片图层，再调整裁剪范围。
                </Text>
              )}
            </Tabs.Panel>
            <Tabs.Panel value="correct" pt="sm">
              {imageOnly ? (
                <Stack gap="md">
                  <Text size="xs" c="dimmed">
                    旋转与透视自动放大以填满边界；中心校正调整向内或向外的镜头畸变。
                  </Text>
                  {(['vertical', 'horizontal', 'center', 'rotation'] as const).map((key) => (
                    <EditorParameterSlider
                      key={key}
                      label={
                        {
                          vertical: '垂直透视',
                          horizontal: '水平透视',
                          center: '中心校正',
                          rotation: '旋转'
                        }[key]
                      }
                      value={correction[key]}
                      resetValue={0}
                      disabled={disabled}
                      min={key === 'rotation' ? -180 : -100}
                      max={key === 'rotation' ? 180 : 100}
                      step={key === 'rotation' ? 0.1 : 1}
                      formatValue={(value) => (key === 'rotation' ? `${value}°` : String(value))}
                      onChange={(value) => onCorrection?.({ ...correction, [key]: value })}
                    />
                  ))}
                  <Group justify="space-between">
                    <Button
                      size="xs"
                      variant="subtle"
                      disabled={disabled || !Object.values(correction).some(Boolean)}
                      onClick={() => onCorrection?.(readImageCorrection(null))}
                    >
                      重置校正
                    </Button>
                    <Button size="xs" onClick={onCancel}>
                      完成
                    </Button>
                  </Group>
                </Stack>
              ) : (
                <Text size="sm" c="dimmed">
                  请选中一个图片图层，再进行透视校正。
                </Text>
              )}
            </Tabs.Panel>
          </Tabs>
          {disabled && (
            <Text size="xs" c="dimmed">
              当前对象不可编辑，请先解除锁定、退出对比或选择单个可见图层。
            </Text>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}
