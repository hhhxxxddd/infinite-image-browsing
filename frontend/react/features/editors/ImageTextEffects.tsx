import { useState } from 'react'
import {
  ActionIcon,
  ColorInput,
  Group,
  NumberInput,
  Popover,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  Tooltip
} from '@mantine/core'
import { IconAdjustmentsHorizontal, IconRestore, IconX } from '@tabler/icons-react'
import type { StudioTextLayer } from '../../../src/features/image-editor/model/imageStudioModel'
import {
  readStudioTextEffects,
  studioTextEffectDefaults,
  type StudioTextEffects
} from '../../../src/features/image-editor/model/imageStudioTextEffects'
import EditorParameterSlider from './EditorParameterSlider'
import './ImageTextEffects.css'

type Effect = keyof StudioTextEffects
const labels: Record<Effect, string> = {
  fill: '填充',
  stroke: '描边',
  shadow: '投影',
  glow: '外发光',
  background: '背景'
}
const effectOrder: Effect[] = ['fill', 'stroke', 'shadow', 'glow', 'background']
const colorPopoverProps = {
  withinPortal: false,
  position: 'left-start' as const,
  offset: 10,
  zIndex: 80,
  middlewares: { flip: false, shift: { padding: 12 } }
}

export default function ImageTextEffects({
  selected,
  disabled,
  onChange
}: {
  selected: StudioTextLayer
  disabled: boolean
  onChange: (change: Partial<StudioTextLayer>) => void
}) {
  const [opened, setOpened] = useState<Effect | null>(null)
  const effects = readStudioTextEffects(selected.effects)
  function change<K extends Effect>(key: K, value: Partial<StudioTextEffects[K]>) {
    onChange({ effects: { ...effects, [key]: { ...effects[key], ...value } } })
  }
  function effectColor(key: Effect) {
    return key === 'fill' ? selected.color : effects[key].color
  }
  function setColor(key: Effect, color: string) {
    if (!/^#[\da-f]{6}$/i.test(color)) return
    if (key === 'fill') onChange({ color })
    else change(key, { color })
  }
  function slider(
    label: string,
    value: number,
    resetValue: number,
    onValue: (value: number) => void,
    max = 100
  ) {
    return (
      <EditorParameterSlider
        label={label}
        value={value}
        resetValue={resetValue}
        min={0}
        max={Math.max(max, value)}
        step={1}
        disabled={disabled}
        formatValue={(v) => `${Math.round(v)}px`}
        onChange={onValue}
      />
    )
  }
  const colors = (key: Effect) => (
    <ColorInput
      size="xs"
      label={key === 'fill' && effects.fill.mode === 'gradient' ? '起始颜色' : '颜色'}
      aria-label={`${labels[key]}颜色`}
      format="hex"
      value={effectColor(key)}
      onChange={(color) => setColor(key, color)}
      disabled={disabled}
      popoverProps={colorPopoverProps}
    />
  )
  return (
    <Stack gap={8} className="react-image-text-effects" aria-label="文字效果">
      <Text size="xs" fw={600}>
        文字效果
      </Text>
      {effectOrder.map((key) => {
        const enabled = key === 'fill' || effects[key].enabled
        const quick =
          key === 'stroke'
            ? effects.stroke.width
            : key === 'shadow'
              ? effects.shadow.distance
              : key === 'glow'
                ? effects.glow.range
                : effects.background.radius
        const quickChange = (value: number | string) => {
          if (typeof value !== 'number') return
          if (key === 'stroke') change(key, { width: value })
          else if (key === 'shadow') change(key, { distance: value })
          else if (key === 'glow') change(key, { range: value })
          else if (key === 'background') change(key, { radius: value })
        }
        const quickLabel =
          key === 'stroke'
            ? '描边粗细'
            : key === 'shadow'
              ? '投影距离'
              : key === 'glow'
                ? '外发光范围'
                : '背景圆角'
        return (
          <Popover
            key={key}
            opened={opened === key}
            onChange={(open) => setOpened(open ? key : null)}
            position="left-start"
            offset={28}
            width={280}
            middlewares={{ flip: false, shift: { padding: 12 } }}
            withinPortal
            withRoles={false}
            portalProps={{ target: '.react-editor-shell' }}
            zIndex={75}
            shadow="md"
            hideDetached
            trapFocus
            returnFocus
            transitionProps={{ duration: 100 }}
          >
            <Popover.Target>
              <div className="react-image-text-effect-row" data-effect={key} data-enabled={enabled}>
                <span className="react-image-text-effect-label">{labels[key]}</span>
                <Tooltip label={`重置${labels[key]}`}>
                  <ActionIcon
                    size={22}
                    variant="subtle"
                    aria-label={`重置${labels[key]}`}
                    disabled={disabled}
                    onClick={() => {
                      if (key === 'fill') change(key, studioTextEffectDefaults.fill)
                      else change(key, { ...studioTextEffectDefaults[key], enabled })
                    }}
                  >
                    <IconRestore size={14} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label={`${labels[key]}颜色`}>
                  <button
                    type="button"
                    className="react-image-text-effect-swatch"
                    aria-label={`${labels[key]}颜色设置`}
                    disabled={disabled}
                    onClick={() => setOpened(opened === key ? null : key)}
                    style={{
                      background:
                        key === 'fill' && effects.fill.mode === 'gradient'
                          ? `linear-gradient(${90 + effects.fill.angle}deg, ${selected.color}, ${effects.fill.endColor})`
                          : effectColor(key)
                    }}
                  />
                </Tooltip>
                {key === 'fill' ? (
                  <SegmentedControl
                    size="xs"
                    aria-label="文字填充方式"
                    value={effects.fill.mode}
                    data={[
                      { value: 'solid', label: '纯色' },
                      { value: 'gradient', label: '渐变' }
                    ]}
                    disabled={disabled}
                    onChange={(value) =>
                      change('fill', { mode: value === 'gradient' ? 'gradient' : 'solid' })
                    }
                  />
                ) : (
                  <NumberInput
                    size="xs"
                    aria-label={quickLabel}
                    value={quick}
                    suffix="px"
                    min={0}
                    max={Math.max(key === 'stroke' ? 40 : 100, quick)}
                    step={1}
                    decimalScale={1}
                    disabled={disabled || !enabled}
                    onChange={quickChange}
                  />
                )}
                <Tooltip label={`${labels[key]}更多设置`}>
                  <ActionIcon
                    size={24}
                    aria-label={`${labels[key]}更多设置`}
                    aria-expanded={opened === key}
                    aria-haspopup="dialog"
                    variant={opened === key ? 'light' : 'subtle'}
                    disabled={disabled}
                    onClick={() => setOpened(opened === key ? null : key)}
                  >
                    <IconAdjustmentsHorizontal size={16} />
                  </ActionIcon>
                </Tooltip>
                {key === 'fill' ? (
                  <span />
                ) : (
                  <Switch
                    size="xs"
                    aria-label={`启用${labels[key]}`}
                    checked={enabled}
                    disabled={disabled}
                    onChange={(event) => change(key, { enabled: event.currentTarget.checked })}
                  />
                )}
              </div>
            </Popover.Target>
            <Popover.Dropdown
              className="react-image-tool-popover react-image-text-effect-popover"
              role="dialog"
              aria-label={`${labels[key]}设置`}
            >
              <Stack gap="sm">
                <Group justify="space-between">
                  <Text size="sm" fw={600}>
                    {labels[key]}设置
                  </Text>
                  <ActionIcon
                    size={22}
                    variant="subtle"
                    aria-label="关闭效果设置"
                    onClick={() => setOpened(null)}
                  >
                    <IconX size={15} />
                  </ActionIcon>
                </Group>
                {colors(key)}
                {key === 'fill' && effects.fill.mode === 'gradient' && (
                  <>
                    <ColorInput
                      size="xs"
                      label="结束颜色"
                      aria-label="渐变结束颜色"
                      format="hex"
                      value={effects.fill.endColor}
                      disabled={disabled}
                      popoverProps={colorPopoverProps}
                      onChange={(color) => {
                        if (/^#[\da-f]{6}$/i.test(color)) change('fill', { endColor: color })
                      }}
                    />
                    <Stack gap={4}>
                      <Text size="xs">方向</Text>
                      <SegmentedControl
                        size="xs"
                        aria-label="渐变方向"
                        value={String(effects.fill.angle)}
                        disabled={disabled}
                        data={[
                          { value: '0', label: '横向' },
                          { value: '90', label: '纵向' },
                          { value: '45', label: '斜向' }
                        ]}
                        onChange={(value) => change('fill', { angle: Number(value) })}
                      />
                    </Stack>
                  </>
                )}
                {key === 'stroke' &&
                  slider(
                    '粗细',
                    effects.stroke.width,
                    studioTextEffectDefaults.stroke.width,
                    (width) => change(key, { width }),
                    40
                  )}
                {key === 'shadow' && (
                  <>
                    <Stack gap={4}>
                      <Text size="xs">方向</Text>
                      <SegmentedControl
                        size="xs"
                        aria-label="投影方向"
                        value={String(effects.shadow.angle)}
                        disabled={disabled}
                        data={[
                          { value: '135', label: '↙' },
                          { value: '45', label: '↘' },
                          { value: '225', label: '↖' },
                          { value: '315', label: '↗' }
                        ]}
                        onChange={(value) => change('shadow', { angle: Number(value) })}
                      />
                    </Stack>
                    {slider(
                      '距离',
                      effects.shadow.distance,
                      studioTextEffectDefaults.shadow.distance,
                      (distance) => change(key, { distance })
                    )}
                    {slider(
                      '模糊',
                      effects.shadow.blur,
                      studioTextEffectDefaults.shadow.blur,
                      (blur) => change(key, { blur })
                    )}
                  </>
                )}
                {key === 'glow' &&
                  slider('范围', effects.glow.range, studioTextEffectDefaults.glow.range, (range) =>
                    change(key, { range })
                  )}
                {key === 'background' && (
                  <>
                    {slider(
                      '圆角',
                      effects.background.radius,
                      studioTextEffectDefaults.background.radius,
                      (radius) => change(key, { radius })
                    )}
                    <EditorParameterSlider
                      label="不透明度"
                      min={0}
                      max={100}
                      value={effects.background.opacity * 100}
                      resetValue={studioTextEffectDefaults.background.opacity * 100}
                      disabled={disabled}
                      formatValue={(v) => `${Math.round(v)}%`}
                      onChange={(value) => change(key, { opacity: value / 100 })}
                    />
                  </>
                )}
              </Stack>
            </Popover.Dropdown>
          </Popover>
        )
      })}
    </Stack>
  )
}
