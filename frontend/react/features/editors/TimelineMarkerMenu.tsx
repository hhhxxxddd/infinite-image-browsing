import { ActionIcon, Button, Group, Popover, Stack, Text, Tooltip } from '@mantine/core'
import { IconFlag, IconPlus } from '@tabler/icons-react'
import { useState } from 'react'
import { formatTimelineTime } from './timelineTime'
import './TimelineControls.css'

export default function TimelineMarkerMenu({
  markers,
  selectedId,
  addDisabled,
  onAdd,
  onSelect,
  opened: controlledOpened,
  onOpenedChange
}: {
  markers: { id: string; name: string; time: number; note?: string }[]
  selectedId?: string
  addDisabled: boolean
  onAdd: () => void
  onSelect: (id: string, time: number) => void
  opened?: boolean
  onOpenedChange?: (opened: boolean) => void
}) {
  const [localOpened, setLocalOpened] = useState(false)
  const opened = controlledOpened ?? localOpened
  function setOpened(value: boolean) {
    setLocalOpened(value)
    onOpenedChange?.(value)
  }
  return (
    <Popover opened={opened} onChange={setOpened} position="right-start" width={280} withinPortal>
      <Popover.Target>
        <Tooltip label="标记：添加、定位与备注（M 添加）" position="right">
          <ActionIcon
            variant={opened ? 'light' : 'subtle'}
            aria-label="时间线标记"
            aria-expanded={opened}
            onClick={() => setOpened(!opened)}
          >
            <IconFlag size={19} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Group justify="space-between">
            <Text size="sm" fw={600}>
              标记 · {markers.length}
            </Text>
            <Button
              size="compact-xs"
              variant="light"
              leftSection={<IconPlus size={14} />}
              disabled={addDisabled}
              onClick={() => {
                onAdd()
                setOpened(false)
              }}
            >
              在播放头添加
            </Button>
          </Group>
          {markers.length ? (
            <div className="timeline-marker-list">
              {[...markers]
                .sort((a, b) => a.time - b.time)
                .map((marker) => (
                  <button
                    type="button"
                    key={marker.id}
                    aria-pressed={selectedId === marker.id}
                    onClick={() => {
                      onSelect(marker.id, marker.time)
                      setOpened(false)
                    }}
                  >
                    <span>
                      <strong>{marker.name}</strong>
                      <small>{formatTimelineTime(marker.time)}</small>
                    </span>
                    {marker.note && <em>{marker.note}</em>}
                  </button>
                ))}
            </div>
          ) : (
            <Text size="xs" c="dimmed">
              暂无标记
            </Text>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}
