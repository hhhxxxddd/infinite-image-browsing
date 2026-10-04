import { ActionIcon, Divider, Popover, Stack, Text, Tooltip } from '@mantine/core'
import { IconTypography } from '@tabler/icons-react'
import type { StudioTextPreset } from '../../../src/features/image-editor/model/imageStudioText'
import type { TextTemplate } from '../../../src/features/image-editor/model/imageTextTemplates'
import ImageTextTemplates from './ImageTextTemplates'

export default function ImageTextTools({
  opened,
  disabled,
  onOpen,
  onClose,
  onAdd,
  onInsertTemplate
}: {
  opened: boolean
  disabled: boolean
  onOpen: () => void
  onClose: () => void
  onAdd: (preset: StudioTextPreset) => void
  onInsertTemplate: (template: TextTemplate) => void
}) {
  return (
    <Popover
      opened={opened}
      onChange={(open) => (open ? onOpen() : onClose())}
      position="right-start"
      offset={12}
      width={320}
      withinPortal
      portalProps={{ target: '.react-editor-shell' }}
      shadow="md"
      zIndex={65}
    >
      <Popover.Target>
        <Tooltip label="文字">
          <ActionIcon
            aria-label="文字"
            variant={opened ? 'light' : 'subtle'}
            disabled={disabled}
            onClick={opened ? onClose : onOpen}
          >
            <IconTypography size={18} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown className="react-image-tool-popover react-image-rail-popover react-image-text-popover">
        <Stack gap="sm" className="react-image-text-panel">
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
          <Divider />
          <ImageTextTemplates
            inline
            opened={opened}
            disabled={disabled}
            onInsert={onInsertTemplate}
          />
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}
