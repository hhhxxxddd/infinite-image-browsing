import { useState, useSyncExternalStore } from 'react'
import { NumberInput, Stack } from '@mantine/core'
import {
  IconLayoutAlignLeft,
  IconLayoutAlignCenter,
  IconLayoutAlignRight,
  IconLayoutAlignTop,
  IconLayoutAlignBottom,
  IconLayoutAlignMiddle,
  IconLock,
  IconLockOpen,
  IconFlipHorizontal,
  IconFlipVertical,
  IconRotateClockwise
} from '@tabler/icons-react'
import type {
  StudioDocument,
  StudioLayer
} from '../../../src/features/image-editor/model/imageStudioModel'
import {
  studioAlignFrame,
  studioResizeDimensions
} from '../../../src/features/image-editor/model/imageStudioGeometry'
import type { ImageTransformPreview } from './imageTransformPreviewStore'
import { PropertyButton, PropertyRow } from './ImagePropertyControls'

/** Only geometry subscribes to drag frames; typography controls keep their committed state. */
export default function ImageLayerGeometry({
  selected,
  preview,
  document,
  disabled,
  onChange
}: {
  selected: StudioLayer
  preview: ImageTransformPreview
  document: StudioDocument
  disabled: boolean
  onChange: (change: Partial<StudioLayer>) => void
}) {
  const layer = useSyncExternalStore(preview.subscribe, () => preview.layer(selected))
  const [locked, setLocked] = useState(true)
  const flippable =
    layer.kind === 'image' || layer.kind === 'text' || layer.kind === 'guide' ? layer : undefined
  function dimension(axis: 'width' | 'height', value: string | number) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return
    const next = Math.max(1, Math.min(16384, value))
    if (!locked) onChange({ [axis]: next })
    else
      onChange(
        studioResizeDimensions(
          axis === 'width' ? next : (next * layer.width) / layer.height,
          axis === 'height' ? next : (next * layer.height) / layer.width
        )
      )
  }
  const alignments = [
    ['left', '画布左对齐', IconLayoutAlignLeft],
    ['center', '画布水平居中', IconLayoutAlignCenter],
    ['right', '画布右对齐', IconLayoutAlignRight],
    ['top', '画布顶对齐', IconLayoutAlignTop],
    ['middle', '画布垂直居中', IconLayoutAlignMiddle],
    ['bottom', '画布底对齐', IconLayoutAlignBottom]
  ] as const
  return (
    <Stack gap="sm" className="react-image-property-geometry">
      <PropertyRow label="尺寸">
        <div className="react-image-property-dimensions">
          <NumberInput
            aria-label="图层宽度"
            size="xs"
            suffix=" 宽"
            value={Math.round(layer.width)}
            min={1}
            max={16384}
            disabled={disabled}
            onChange={(v) => dimension('width', v)}
          />
          <PropertyButton
            label="保持比例"
            active={locked}
            disabled={disabled}
            onClick={() => setLocked(!locked)}
          >
            {locked ? <IconLock size={16} /> : <IconLockOpen size={16} />}
          </PropertyButton>
          <NumberInput
            aria-label="图层高度"
            size="xs"
            suffix=" 高"
            value={Math.round(layer.height)}
            min={1}
            max={16384}
            disabled={disabled}
            onChange={(v) => dimension('height', v)}
          />
        </div>
      </PropertyRow>
      <PropertyRow label="位置">
        <div className="react-image-property-input-pair">
          {(['x', 'y'] as const).map((axis) => (
            <NumberInput
              key={axis}
              aria-label={`图层${axis.toUpperCase()}`}
              size="xs"
              suffix={` ${axis.toUpperCase()}`}
              value={Math.round(layer[axis])}
              min={-65536}
              max={65536}
              disabled={disabled}
              onChange={(v) => {
                if (typeof v === 'number') onChange({ [axis]: v })
              }}
            />
          ))}
        </div>
      </PropertyRow>
      <PropertyRow label="画布对齐">
        <div className="react-image-property-button-group">
          {alignments.map(([alignment, label, Icon]) => (
            <PropertyButton
              key={alignment}
              label={label}
              disabled={disabled}
              onClick={() => onChange(studioAlignFrame(layer, document, alignment))}
            >
              <Icon size={17} />
            </PropertyButton>
          ))}
        </div>
      </PropertyRow>
      <PropertyRow label="角度">
        <div className="react-image-property-angle">
          <NumberInput
            aria-label="图层旋转角度"
            size="xs"
            suffix="°"
            value={layer.rotation}
            min={-360}
            max={360}
            disabled={disabled}
            onChange={(v) => {
              if (typeof v === 'number') onChange({ rotation: v })
            }}
          />
          <PropertyButton
            label="顺时针旋转90度"
            disabled={disabled}
            onClick={() =>
              onChange({ rotation: ((((layer.rotation + 270) % 360) + 360) % 360) - 180 })
            }
          >
            <IconRotateClockwise size={17} />
          </PropertyButton>
          <PropertyButton
            label="水平翻转"
            active={flippable?.flipX ?? false}
            disabled={disabled || !flippable}
            onClick={() => {
              if (flippable) onChange({ flipX: !flippable.flipX })
            }}
          >
            <IconFlipHorizontal size={17} />
          </PropertyButton>
          <PropertyButton
            label="垂直翻转"
            active={flippable?.flipY ?? false}
            disabled={disabled || !flippable}
            onClick={() => {
              if (flippable) onChange({ flipY: !flippable.flipY })
            }}
          >
            <IconFlipVertical size={17} />
          </PropertyButton>
        </div>
      </PropertyRow>
    </Stack>
  )
}
