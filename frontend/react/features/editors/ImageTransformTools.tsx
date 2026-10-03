import {
  ActionIcon,
  Button,
  Group,
  NumberInput,
  Popover,
  Stack,
  Switch,
  Text,
  Tooltip
} from '@mantine/core'
import { IconResize, IconScissors } from '@tabler/icons-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type {
  StudioFrame,
  StudioLayer
} from '../../../src/features/image-editor/model/imageStudioModel'
import ImageAspectRatios from './ImageAspectRatios'
import {
  studioResizeDimensions,
  studioCropDimensions
} from '../../../src/features/image-editor/model/imageStudioGeometry'
import type { ImageTransformPreview } from './imageTransformPreviewStore'
import type { ImageCropPreview } from './imageCropPreviewStore'

export type ImageTransformTool = 'select' | 'resize' | 'crop' | 'text'

export default function ImageTransformTools({
  selected,
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
  onCancel
}: {
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
}) {
  const [size, setSize] = useState({ width: 1, height: 1 })
  const [ratio, setRatio] = useState(1)
  const [ratioKey, setRatioKey] = useState('original')
  const [locked, setLocked] = useState(true)
  const dimensions = useSyncExternalStore(preview.subscribe, () => {
    if (!selected) return ''
    const layer = preview.layer(selected)
    return `${layer.width}:${layer.height}`
  })
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
  const canCrop = !!liveCrop && liveCrop.width >= 1 && liveCrop.height >= 1
  function changeCropSize(axis: 'width' | 'height', value: string | number) {
    if (typeof value !== 'number' || !selected || !liveCrop) return
    onCropFrameChange(studioCropDimensions(selected, liveCrop, axis, value, cropAspectRatio))
  }
  useEffect(() => {
    if (!dimensions) return
    const [width, height] = dimensions.split(':').map(Number)
    setSize({ width: Math.round(width), height: Math.round(height) })
    setRatio(width / height)
    setRatioKey('original')
    setLocked(true)
  }, [selected?.id, dimensions, tool])
  function changeSize(axis: 'width' | 'height', value: string | number) {
    if (typeof value !== 'number') return
    const next = Math.max(1, Math.min(16384, value))
    const other = axis === 'width' ? next / ratio : next * ratio
    setSize((current) =>
      locked
        ? studioResizeDimensions(axis === 'width' ? next : other, axis === 'height' ? next : other)
        : { ...current, [axis]: next }
    )
  }
  const popover = {
    position: 'right-start' as const,
    offset: 12,
    width: 292,
    withinPortal: true,
    portalProps: { target: '.react-editor-shell' },
    closeOnClickOutside: false,
    shadow: 'md',
    zIndex: 65
  }
  return (
    <>
      <Popover
        {...popover}
        opened={tool === 'resize' && !disabled}
        onChange={(opened) => {
          if (!opened) onCancel()
        }}
      >
        <Popover.Target>
          <Tooltip label="缩放图层">
            <ActionIcon
              aria-label="缩放图层"
              variant={tool === 'resize' ? 'light' : 'subtle'}
              disabled={disabled}
              onClick={() => (tool === 'resize' ? onCancel() : onToolChange('resize'))}
            >
              <IconResize size={18} stroke={1.8} />
            </ActionIcon>
          </Tooltip>
        </Popover.Target>
        <Popover.Dropdown className="react-image-tool-popover">
          <Stack gap="sm">
            <Text size="sm" fw={700}>
              缩放图层
            </Text>
            <Group grow>
              <NumberInput
                size="xs"
                label="宽度 px"
                value={size.width}
                min={1}
                max={16384}
                onChange={(value) => changeSize('width', value)}
              />
              <NumberInput
                size="xs"
                label="高度 px"
                value={size.height}
                min={1}
                max={16384}
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
                setSize((current) => studioResizeDimensions(current.width, current.width / next))
              }}
            />
            <Text size="xs" c="dimmed">
              也可拖动选框角点缩放；按 Shift 切换是否保持比例。
            </Text>
            <Group justify="flex-end" gap="xs">
              <Button size="xs" variant="subtle" onClick={onCancel}>
                取消
              </Button>
              <Button size="xs" onClick={() => onResize(size.width, size.height)}>
                应用缩放
              </Button>
            </Group>
          </Stack>
        </Popover.Dropdown>
      </Popover>
      <Popover
        {...popover}
        opened={tool === 'crop' && !disabled}
        onChange={(opened) => {
          if (!opened) onCancel()
        }}
      >
        <Popover.Target>
          <Tooltip label="裁剪图层">
            <ActionIcon
              aria-label="裁剪图层"
              variant={tool === 'crop' ? 'light' : 'subtle'}
              disabled={disabled || selected?.kind !== 'image'}
              onClick={() => (tool === 'crop' ? onCancel() : onToolChange('crop'))}
            >
              <IconScissors size={18} stroke={1.8} />
            </ActionIcon>
          </Tooltip>
        </Popover.Target>
        <Popover.Dropdown className="react-image-tool-popover">
          <Stack gap="sm">
            <Text size="sm" fw={700}>
              裁剪图层
            </Text>
            <Group grow>
              <NumberInput
                size="xs"
                label="宽度 px"
                value={liveCrop ? Math.round(liveCrop.width * 100) / 100 : ''}
                min={Math.min(1, cropMaxWidth)}
                max={cropMaxWidth}
                decimalScale={2}
                clampBehavior="strict"
                onChange={(value) => changeCropSize('width', value)}
              />
              <NumberInput
                size="xs"
                label="高度 px"
                value={liveCrop ? Math.round(liveCrop.height * 100) / 100 : ''}
                min={Math.min(1, cropMaxHeight)}
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
            <Text size="xs" c="dimmed">
              拖动框内移动，拖动边角调整范围；点击“应用裁剪”后生效。
            </Text>
            <Group justify="flex-end" gap="xs">
              <Button size="xs" variant="subtle" onClick={onCancel}>
                取消
              </Button>
              <Button size="xs" disabled={!canCrop} onClick={onCrop}>
                应用裁剪
              </Button>
            </Group>
          </Stack>
        </Popover.Dropdown>
      </Popover>
    </>
  )
}
