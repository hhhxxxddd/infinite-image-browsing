import { Button, Select, Stack, Switch } from '@mantine/core'
import { AudioGainControls } from './AudioProcessingControls'
import type { VideoClip } from './videoStudioModel'

export default function VideoSoundPanel({
  clip,
  disabled,
  editGain,
  onEditGainChange,
  onChange,
  onInteractionStart,
  onInteractionEnd
}: {
  clip: VideoClip
  disabled: boolean
  editGain: boolean
  onEditGainChange: (value: boolean) => void
  onChange: (clip: VideoClip) => void
  onInteractionStart?: () => void
  onInteractionEnd?: (cancel?: boolean) => void
}) {
  return (
    <Stack gap="xs">
      <Button
        size="compact-xs"
        variant={editGain ? 'light' : 'subtle'}
        disabled={disabled}
        onClick={() => onEditGainChange(!editGain)}
      >
        {editGain ? '完成音量曲线' : '编辑音量曲线'}
      </Button>
      <AudioGainControls
        pan={clip.pan}
        gainPoints={clip.gainPoints}
        duration={clip.envelopeDuration ?? clip.duration}
        readonly={disabled}
        onInteractionStart={onInteractionStart}
        onInteractionEnd={onInteractionEnd}
        onPanChange={(pan) => onChange({ ...clip, pan })}
        onGainPointsChange={(gainPoints) => onChange({ ...clip, gainPoints })}
      />
      <Select
        label="淡化曲线"
        size="xs"
        value={clip.fadeCurve ?? 'linear'}
        allowDeselect={false}
        disabled={disabled}
        data={[
          { value: 'linear', label: '直线' },
          { value: 'smooth', label: '柔和' },
          { value: 'equalPower', label: '等功率' }
        ]}
        onChange={(value) => onChange({ ...clip, fadeCurve: value as VideoClip['fadeCurve'] })}
      />
      <Stack gap="xs">
        <Select
          label="声道"
          size="xs"
          value={clip.channels ?? 'stereo'}
          allowDeselect={false}
          disabled={disabled}
          data={[
            { value: 'stereo', label: '原声道' },
            { value: 'swap', label: '左右互换' },
            { value: 'mono', label: '合并为单声道' },
            { value: 'left', label: '只取左声道' },
            { value: 'right', label: '只取右声道' }
          ]}
          onChange={(value) => onChange({ ...clip, channels: value as VideoClip['channels'] })}
        />
        <Switch
          label="反转相位"
          size="xs"
          checked={!!clip.invertPhase}
          disabled={disabled}
          onChange={(event) => onChange({ ...clip, invertPhase: event.currentTarget.checked })}
        />
      </Stack>
    </Stack>
  )
}
