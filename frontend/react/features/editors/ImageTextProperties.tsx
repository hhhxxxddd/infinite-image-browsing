import { ColorInput, NumberInput, Select, Stack, Textarea } from '@mantine/core'
import {
  IconAlignLeft,
  IconAlignCenter,
  IconAlignRight,
  IconBold,
  IconItalic,
  IconUnderline,
  IconStrikethrough
} from '@tabler/icons-react'
import type { StudioTextLayer } from '../../../src/features/image-editor/model/imageStudioModel'
import {
  studioFonts,
  isStudioFont
} from '../../../src/features/image-editor/model/imageStudioFonts'
import { PropertyButton, PropertyRow } from './ImagePropertyControls'

export default function ImageTextProperties({
  selected,
  disabled,
  onChange
}: {
  selected: StudioTextLayer
  disabled: boolean
  onChange: (change: Partial<StudioTextLayer>) => void
}) {
  const styles = [
    ['bold', '粗体', IconBold],
    ['italic', '斜体', IconItalic],
    ['underline', '下划线', IconUnderline],
    ['strike', '删除线', IconStrikethrough]
  ] as const
  return (
    <Stack gap="sm" className="react-image-text-properties">
      <Textarea
        size="xs"
        label="文字"
        aria-label="文字内容"
        value={selected.text}
        onChange={(e) => onChange({ text: e.currentTarget.value })}
        autosize
        minRows={2}
        maxRows={5}
        maxLength={1000}
        disabled={disabled}
      />
      <PropertyRow label="字体">
        <Select
          aria-label="文字字体"
          size="xs"
          data={studioFonts.map(({ value, label }) => ({ value, label }))}
          value={selected.font}
          onChange={(font) => {
            if (isStudioFont(font)) onChange({ font })
          }}
          disabled={disabled}
          searchable
          allowDeselect={false}
        />
      </PropertyRow>
      <PropertyRow label="字号">
        <div className="react-image-property-input-pair">
          <NumberInput
            aria-label="文字字号"
            size="xs"
            value={selected.fontSize}
            min={1}
            max={1000}
            disabled={disabled}
            onChange={(v) => {
              if (typeof v === 'number') onChange({ fontSize: v })
            }}
          />
          <ColorInput
            aria-label="文字颜色"
            size="xs"
            format="hex"
            value={selected.color}
            onChange={(color) => {
              if (/^#[\da-fA-F]{6}$/.test(color)) onChange({ color })
            }}
            disabled={disabled}
          />
        </div>
      </PropertyRow>
      <PropertyRow label="样式">
        <div className="react-image-property-button-group">
          {styles.map(([key, label, Icon]) => (
            <PropertyButton
              key={key}
              label={label}
              active={selected[key] ?? false}
              disabled={disabled}
              onClick={() => onChange({ [key]: !selected[key] })}
            >
              <Icon size={18} />
            </PropertyButton>
          ))}
        </div>
      </PropertyRow>
      <PropertyRow label="文字对齐">
        <div className="react-image-property-button-group">
          {(
            [
              ['left', '文字左对齐', IconAlignLeft],
              ['center', '文字居中', IconAlignCenter],
              ['right', '文字右对齐', IconAlignRight]
            ] as const
          ).map(([align, label, Icon]) => (
            <PropertyButton
              key={align}
              label={label}
              active={selected.align === align}
              disabled={disabled}
              onClick={() => onChange({ align })}
            >
              <Icon size={18} />
            </PropertyButton>
          ))}
        </div>
      </PropertyRow>
      <PropertyRow label="间距">
        <div className="react-image-property-input-pair">
          <NumberInput
            aria-label="文字行距"
            size="xs"
            prefix="行 "
            suffix="×"
            value={selected.lineHeight ?? 1.24}
            decimalScale={2}
            step={0.1}
            min={1}
            max={3}
            disabled={disabled}
            onChange={(v) => {
              if (typeof v === 'number') onChange({ lineHeight: v })
            }}
          />
          <NumberInput
            aria-label="文字字距"
            size="xs"
            prefix="字 "
            suffix="px"
            value={selected.letterSpacing ?? 0}
            decimalScale={1}
            step={1}
            min={-20}
            max={100}
            disabled={disabled}
            onChange={(v) => {
              if (typeof v === 'number') onChange({ letterSpacing: v })
            }}
          />
        </div>
      </PropertyRow>
    </Stack>
  )
}
