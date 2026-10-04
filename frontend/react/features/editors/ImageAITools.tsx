import { ActionIcon, Group, Popover, Stack, Tabs, Text, Tooltip } from '@mantine/core'
import { IconEraser, IconPhotoUp, IconScissors, IconSparkles } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import './ImageAITools.css'

const features = [
  {
    id: 'erase',
    label: '消除',
    icon: IconEraser,
    description: '涂抹需要移除的区域，自动补全背景。'
  },
  {
    id: 'upscale',
    label: '高清化',
    icon: IconPhotoUp,
    description: '放大图片并提升细节，适合低分辨率素材。'
  },
  {
    id: 'cutout',
    label: '抠图',
    icon: IconScissors,
    description: '提取图片主体，生成透明背景图层。'
  },
  {
    id: 'advanced',
    label: '高级'
  }
]

export default function ImageAITools({
  opened,
  tab,
  onTabChange,
  cutout,
  upscale,
  erase,
  advanced,
  onOpen,
  onClose
}: {
  opened: boolean
  tab: string
  onTabChange: (tab: string) => void
  cutout: ReactNode
  upscale: ReactNode
  erase: ReactNode
  advanced: ReactNode
  onOpen: () => void
  onClose: () => void
}) {
  return (
    <Popover
      opened={opened}
      closeOnClickOutside={false}
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
        <Tooltip label="AI 工具">
          <ActionIcon
            aria-label="AI 工具"
            variant={opened ? 'light' : 'subtle'}
            onClick={opened ? onClose : onOpen}
          >
            <IconSparkles size={18} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown className="react-image-tool-popover react-image-rail-popover react-image-ai-tools">
        <Stack gap="sm">
          <Group justify="space-between">
            <Text size="sm" fw={700}>
              AI 工具
            </Text>
          </Group>
          <Tabs
            className="react-image-ai-tabs"
            value={tab}
            onChange={(value) => onTabChange(value || 'cutout')}
          >
            <Tabs.List grow>
              {features.map(({ id, label }) => (
                <Tabs.Tab key={id} value={id}>
                  {label}
                </Tabs.Tab>
              ))}
            </Tabs.List>
            {features.map(({ id }) => (
              <Tabs.Panel key={id} value={id}>
                {id === 'cutout'
                  ? cutout
                  : id === 'upscale'
                    ? upscale
                    : id === 'erase'
                      ? erase
                      : advanced}
              </Tabs.Panel>
            ))}
          </Tabs>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}
