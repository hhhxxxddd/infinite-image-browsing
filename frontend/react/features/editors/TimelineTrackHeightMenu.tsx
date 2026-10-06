import { ActionIcon, Menu, Tooltip } from '@mantine/core'
import { IconCheck, IconSpacingVertical } from '@tabler/icons-react'
import { TIMELINE_TRACK_HEIGHTS } from './timelineLayout'

export default function TimelineTrackHeightMenu({
  label,
  value,
  onChange
}: {
  label: string
  value: number
  onChange: (height: number) => void
}) {
  const current = TIMELINE_TRACK_HEIGHTS.find((option) => option.value === value)
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <Tooltip label={`${label}：${current?.label ?? '标准'}`}>
          <ActionIcon size="sm" variant="subtle" aria-label={label}>
            <IconSpacingVertical size={16} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{label}</Menu.Label>
        {TIMELINE_TRACK_HEIGHTS.map((option) => (
          <Menu.Item
            key={option.value}
            renderRoot={(props) => <button {...props} role="menuitemradio" />}
            aria-checked={value === option.value}
            rightSection={value === option.value ? <IconCheck size={14} /> : undefined}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  )
}
