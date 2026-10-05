import './AudioProcessingControls.css'
import { Button, Group, NumberInput, Select, Slider, Stack, Switch, Text } from '@mantine/core'
import EditorDisclosure from './EditorDisclosure'
import {
  defaultAudioProcessing,
  type AudioProcessing,
  type GainPoint
} from '../../../src/features/media-editor/model/audioProcessing'

export function AudioProcessingControls({
  value,
  onChange,
  readonly = false,
  scope,
  inline = false
}: {
  value?: Partial<AudioProcessing>
  onChange: (value: AudioProcessing) => void
  readonly?: boolean
  scope: 'track' | 'master'
  inline?: boolean
}) {
  const current = { ...defaultAudioProcessing, ...value }
  const change = (patch: Partial<AudioProcessing>) => onChange({ ...current, ...patch })
  return (
    <EditorDisclosure title={scope === 'master' ? '混音处理' : '音轨处理'} inline={inline}>
      <Stack gap="xs">
        <Switch
          label="对比原声（暂时旁路处理）"
          checked={!!current.bypass}
          size="xs"
          disabled={readonly}
          onChange={(event) => change({ bypass: event.currentTarget.checked })}
        />
        <Select
          label="降噪"
          size="xs"
          value={current.denoise}
          disabled={readonly}
          allowDeselect={false}
          data={[
            { value: 'off', label: '关闭' },
            { value: 'light', label: '轻度 · 减少底噪' },
            { value: 'strong', label: '较强 · 嘈杂环境' }
          ]}
          onChange={(value) => change({ denoise: value as AudioProcessing['denoise'] })}
        />
        <Select
          label="音色"
          size="xs"
          value={current.equalizer}
          disabled={readonly}
          allowDeselect={false}
          data={[
            { value: 'flat', label: '原声' },
            { value: 'voice', label: '人声清晰' },
            { value: 'warm', label: '温暖饱满' },
            { value: 'bright', label: '明亮通透' },
            { value: 'custom', label: '手动调整' }
          ]}
          onChange={(value) => change({ equalizer: value as AudioProcessing['equalizer'] })}
        />
        {current.equalizer === 'custom' && (
          <Group grow gap="xs">
            {(['low', 'mid', 'high'] as const).map((band, index) => (
              <NumberInput
                key={band}
                label={['低频 dB', '中频 dB', '高频 dB'][index]}
                size="xs"
                min={-12}
                max={12}
                step={0.5}
                decimalScale={1}
                value={current.eq?.[band] ?? 0}
                disabled={readonly}
                onChange={(value) => {
                  if (typeof value === 'number')
                    change({ eq: { low: 0, mid: 0, high: 0, ...current.eq, [band]: value } })
                }}
              />
            ))}
          </Group>
        )}
        <Select
          label="动态压缩"
          size="xs"
          value={current.compressor}
          disabled={readonly}
          allowDeselect={false}
          data={[
            { value: 'off', label: '关闭' },
            { value: 'gentle', label: '柔和 · 缩小音量差' },
            { value: 'voice', label: '人声 · 稳定对白' },
            { value: 'custom', label: '手动调整' }
          ]}
          onChange={(value) => change({ compressor: value as AudioProcessing['compressor'] })}
        />
        {current.compressor === 'custom' && (
          <Stack gap="xs">
            {(
              [
                ['thresholdDb', '启动电平 dB', -60, 0, -18],
                ['ratio', '压缩比例', 1, 20, 2],
                ['attack', '启动时间 ms', 0.1, 200, 15],
                ['release', '恢复时间 ms', 10, 2000, 180],
                ['makeupDb', '补偿音量 dB', 0, 24, 0]
              ] as const
            ).map(([key, label, min, max, fallback]) => (
              <NumberInput
                key={key}
                label={label}
                size="xs"
                min={min}
                max={max}
                step={key === 'attack' ? 0.1 : 1}
                decimalScale={1}
                value={current.compression?.[key] ?? fallback}
                disabled={readonly}
                onChange={(value) => {
                  if (typeof value === 'number')
                    change({
                      compression: {
                        thresholdDb: -18,
                        ratio: 2,
                        attack: 15,
                        release: 180,
                        makeupDb: 0,
                        ...current.compression,
                        [key]: value
                      }
                    })
                }}
              />
            ))}
          </Stack>
        )}
        <Switch
          label="减轻齿音"
          size="xs"
          checked={current.deess}
          disabled={readonly}
          onChange={(event) => change({ deess: event.currentTarget.checked })}
        />
        <Select
          label="响度统一"
          size="xs"
          value={current.normalize}
          disabled={readonly}
          allowDeselect={false}
          data={[
            { value: 'off', label: '关闭' },
            { value: 'voice', label: '对白 · −16 LUFS' },
            { value: 'music', label: '音乐 · −14 LUFS' }
          ]}
          onChange={(value) => change({ normalize: value as AudioProcessing['normalize'] })}
        />
        <Switch
          label="限制峰值 · 防止过载"
          size="xs"
          checked={current.limiter}
          disabled={readonly}
          onChange={(event) => change({ limiter: event.currentTarget.checked })}
        />
        <Button
          size="compact-xs"
          variant="subtle"
          disabled={readonly}
          onClick={() => onChange({ ...defaultAudioProcessing })}
        >
          重置处理
        </Button>
      </Stack>
    </EditorDisclosure>
  )
}

export function AudioGainControls({
  pan = 0,
  onPanChange,
  readonly = false,
  onInteractionStart,
  onInteractionEnd
}: {
  pan?: number
  gainPoints?: GainPoint[]
  duration: number
  onPanChange: (pan: number) => void
  onGainPointsChange?: (points: GainPoint[]) => void
  readonly?: boolean
  onInteractionStart?: () => void
  onInteractionEnd?: (cancel?: boolean) => void
}) {
  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Text size="xs">声像</Text>
        <Text size="xs" c="dimmed">
          {pan === 0 ? '居中' : `${pan < 0 ? '左' : '右'} ${Math.round(Math.abs(pan) * 100)}%`}
        </Text>
      </Group>
      <Slider
        min={-1}
        max={1}
        step={0.01}
        value={pan}
        disabled={readonly}
        onChange={onPanChange}
        onPointerDown={() => onInteractionStart?.()}
        onPointerCancel={() => onInteractionEnd?.(true)}
        onChangeEnd={() => onInteractionEnd?.(false)}
        aria-label="声像"
      />
    </Stack>
  )
}
