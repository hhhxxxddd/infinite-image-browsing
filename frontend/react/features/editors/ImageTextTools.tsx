import { ActionIcon, Badge, Button, Group, Popover, Stack, Text, Tooltip } from '@mantine/core'
import { IconChevronRight, IconTypography } from '@tabler/icons-react'
import type { StudioTextPreset } from '../../../src/features/image-editor/model/imageStudioText'

export default function ImageTextTools({
  opened,
  disabled,
  onOpen,
  onClose,
  onAdd
}: {
  opened: boolean
  disabled: boolean
  onOpen: () => void
  onClose: () => void
  onAdd: (preset: StudioTextPreset) => void
}) {
  return (
    <Popover
      opened={opened}
      onChange={(open) => (open ? onOpen() : onClose())}
      position="right-start"
      offset={12}
      width={300}
      withinPortal
      portalProps={{ target: '.react-editor-shell' }}
      shadow="md"
      zIndex={65}
    >
      <Popover.Target>
        <Tooltip label="添加文字">
          <ActionIcon
            aria-label="添加文字"
            variant={opened ? 'light' : 'subtle'}
            disabled={disabled}
            onClick={opened ? onClose : onOpen}
          >
            <IconTypography size={18} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown className="react-image-tool-popover react-image-text-popover">
        <Stack gap="sm">
          <Text size="sm" fw={700}>
            文字
          </Text>
          <Text size="xs" c="dimmed">
            点击添加文本
          </Text>
          <div className="react-image-text-presets">
            {(['title', 'subtitle', 'body'] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                data-preset={preset}
                disabled={disabled}
                onClick={() => onAdd(preset)}
              >
                {{ title: '标题', subtitle: '副标题', body: '正文' }[preset]}
              </button>
            ))}
          </div>
          <Tooltip label="文字模板尚未开放">
            <Button
              variant="subtle"
              fullWidth
              disabled
              className="react-image-text-template"
              rightSection={<IconChevronRight size={15} />}
            >
              <Group gap="xs">
                文字模板{' '}
                <Badge size="xs" color="gray" variant="light">
                  即将开放
                </Badge>
              </Group>
            </Button>
          </Tooltip>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}
