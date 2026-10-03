import { ActionIcon, Box, Slider, Tooltip, type SliderProps } from '@mantine/core'
import { IconRestore } from '@tabler/icons-react'
import './EditorParameterSlider.css'

type Props = Omit<SliderProps, 'value' | 'defaultValue' | 'label' | 'onChange'> & {
  label: string
  value: number
  resetValue: number
  formatValue?: (value: number) => string
  compact?: boolean
  onChange: (value: number) => void
}

/** Parameter name, reset, slider and current value share one stable row. */
export default function EditorParameterSlider({
  label,
  value,
  resetValue,
  formatValue = String,
  compact = false,
  disabled,
  onChange,
  onChangeEnd,
  thumbLabel,
  w,
  className,
  ...sliderProps
}: Props) {
  return (
    <Box
      className={`react-editor-parameter-slider${className ? ` ${className}` : ''}`}
      data-compact={compact || undefined}
      w={w}
    >
      <span className="react-editor-parameter-name">{label}</span>
      <Tooltip label={`重置为 ${formatValue(resetValue)}`}>
        <ActionIcon
          size={22}
          variant="subtle"
          aria-label={`重置${label}`}
          disabled={disabled || value === resetValue}
          onClick={() => {
            onChange(resetValue)
            onChangeEnd?.(resetValue)
          }}
        >
          <IconRestore size={14} />
        </ActionIcon>
      </Tooltip>
      <Slider
        {...sliderProps}
        value={value}
        disabled={disabled}
        thumbLabel={thumbLabel || label}
        thumbValueText={formatValue}
        label={formatValue}
        onChange={onChange}
        onChangeEnd={onChangeEnd}
      />
      <span className="react-editor-parameter-value">{formatValue(value)}</span>
    </Box>
  )
}
