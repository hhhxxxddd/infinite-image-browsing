import type { ReactNode } from 'react'
import { ActionIcon, Button, Group, Slider, Text, Tooltip } from '@mantine/core'
import {
  IconChevronLeft,
  IconChevronRight,
  IconMagnet,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerSkipBack,
  IconPlayerSkipForward,
  IconPlayerTrackPrev
} from '@tabler/icons-react'
import { formatTimelineTime } from './timelineTime'
import './TimelineControls.css'

export default function TimelineTransport({
  playing,
  buffering,
  disabled,
  playhead,
  duration,
  onPlay,
  onSeek,
  onStep,
  stepLabels,
  onNavigate,
  settings,
  actions,
  viewActions,
  zoom,
  maxZoom,
  onZoom,
  onFit,
  selectionDisabled,
  snapping,
  onSnapping,
  alignmentPrecision
}: {
  playing: boolean
  buffering: boolean
  disabled: boolean
  playhead: number
  duration: number
  onPlay: () => void
  onSeek: (time: number) => void
  onStep: (direction: -1 | 1) => void
  stepLabels: [string, string]
  onNavigate: (direction: 'previous' | 'next') => void
  settings?: ReactNode
  actions?: ReactNode
  viewActions?: ReactNode
  zoom: number
  maxZoom: number
  onZoom: (zoom: number) => void
  onFit: (selected: boolean) => void
  selectionDisabled: boolean
  snapping: boolean
  onSnapping: () => void
  alignmentPrecision: string
}) {
  return (
    <div className="timeline-transport" role="toolbar" aria-label="时间线播放与视图">
      <Group gap={3} wrap="nowrap">
        <Tooltip label="播放 / 暂停（空格）">
          <ActionIcon
            variant="light"
            aria-label={playing ? '暂停' : '播放'}
            disabled={disabled}
            onClick={onPlay}
          >
            {playing ? <IconPlayerPause size={18} /> : <IconPlayerPlay size={18} />}
          </ActionIcon>
        </Tooltip>
        <Tooltip label="回到起点（Home）">
          <ActionIcon variant="subtle" aria-label="回到起点" onClick={() => onSeek(0)}>
            <IconPlayerTrackPrev size={15} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={stepLabels[0]}>
          <ActionIcon variant="subtle" aria-label={stepLabels[0]} onClick={() => onStep(-1)}>
            <IconPlayerSkipBack size={15} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={stepLabels[1]}>
          <ActionIcon variant="subtle" aria-label={stepLabels[1]} onClick={() => onStep(1)}>
            <IconPlayerSkipForward size={15} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="上一剪辑点或标记（[）">
          <ActionIcon
            variant="subtle"
            aria-label="上一剪辑点或标记"
            onClick={() => onNavigate('previous')}
          >
            <IconChevronLeft size={16} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="下一剪辑点或标记（]）">
          <ActionIcon
            variant="subtle"
            aria-label="下一剪辑点或标记"
            onClick={() => onNavigate('next')}
          >
            <IconChevronRight size={16} />
          </ActionIcon>
        </Tooltip>
        <Text size="xs" ff="monospace" className="timeline-transport-time">
          {formatTimelineTime(playhead)} / {formatTimelineTime(duration)}
        </Text>
        {buffering && (
          <Text size="xs" c="dimmed">
            准备播放…
          </Text>
        )}
        {settings}
        {actions}
      </Group>
      <Group gap={3} wrap="nowrap">
        {viewActions}
        <ActionIcon
          size="sm"
          variant="subtle"
          aria-label="缩小时间线"
          onClick={() => onZoom(Math.max(0.03125, zoom / 1.4))}
        >
          −
        </ActionIcon>
        <Slider
          min={-5}
          max={Math.log2(maxZoom)}
          step={0.1}
          value={Math.log2(zoom)}
          onChange={(value) => onZoom(2 ** value)}
          label={(value) => `${(2 ** value).toFixed(1)} px/s`}
          w={76}
          aria-label="时间线缩放"
        />
        <ActionIcon
          size="sm"
          variant="subtle"
          aria-label="放大时间线"
          onClick={() => onZoom(Math.min(maxZoom, zoom * 1.4))}
        >
          ＋
        </ActionIcon>
        <Button size="compact-xs" variant="subtle" onClick={() => onFit(false)}>
          适应内容
        </Button>
        <Button
          size="compact-xs"
          variant="subtle"
          disabled={selectionDisabled}
          onClick={() => onFit(true)}
        >
          适应选中
        </Button>
        <Tooltip
          label={`靠近播放头、标记、片段或文字边缘、时间线起点时自动对齐，方便拼接。按住 Shift 临时关闭对齐。关闭后仍按${alignmentPrecision}调整。`}
          multiline
          w={270}
        >
          <Button
            size="compact-xs"
            variant={snapping ? 'light' : 'subtle'}
            leftSection={<IconMagnet size={14} />}
            aria-label={`自动对齐${snapping ? '开启' : '关闭'}`}
            aria-pressed={snapping}
            onClick={onSnapping}
          >
            自动对齐：{snapping ? '开' : '关'}
          </Button>
        </Tooltip>
      </Group>
    </div>
  )
}
