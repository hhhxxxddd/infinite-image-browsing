import { useState, type ComponentProps } from 'react'
import { ActionIcon, Popover, Tooltip } from '@mantine/core'
import { IconChartBar, IconX } from '@tabler/icons-react'
import AudioLoudnessAnalysis from './AudioLoudnessAnalysis'

export default function AudioLoudnessTool({
  opened: controlledOpened,
  onOpenedChange,
  ...props
}: ComponentProps<typeof AudioLoudnessAnalysis> & {
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
    <Popover
      opened={opened}
      onChange={setOpened}
      position="right-start"
      offset={12}
      width={340}
      withinPortal
      portalProps={{ target: '.react-editor-shell' }}
      closeOnClickOutside={false}
      keepMounted
      shadow="md"
      zIndex={65}
    >
      <Popover.Target>
        <Tooltip label="响度检查" position="right">
          <ActionIcon
            variant={opened ? 'light' : 'subtle'}
            aria-label="响度检查"
            aria-expanded={opened}
            onClick={() => setOpened(!opened)}
          >
            <IconChartBar size={19} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown className="react-editor-tool-popover react-editor-rail-popover audio-loudness-tool">
        <ActionIcon
          className="audio-loudness-close"
          size="sm"
          variant="subtle"
          aria-label="关闭响度检查"
          onClick={() => setOpened(false)}
        >
          <IconX size={16} />
        </ActionIcon>
        <AudioLoudnessAnalysis {...props} />
      </Popover.Dropdown>
    </Popover>
  )
}
