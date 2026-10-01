import { Button, SegmentedControl, Tooltip } from '@mantine/core'
import { IconInfoCircle } from '@tabler/icons-react'
import { useMediaText } from './mediaLocale'

export function MediaGalleryViewOptions({
  cardSize,
  onCardSize,
  showInformation,
  onToggleInformation
}: {
  cardSize: string
  onCardSize: (value: string) => void
  showInformation: boolean
  onToggleInformation: () => void
}) {
  const m = useMediaText()
  return (
    <>
      <SegmentedControl
        size="xs"
        aria-label={m('缩略图大小')}
        value={cardSize}
        onChange={onCardSize}
        data={[
          { label: m('小'), value: 'small' },
          { label: m('中'), value: 'medium' },
          { label: m('大'), value: 'large' }
        ]}
      />
      <Tooltip label={m('常驻显示文件名和标签')}>
        <Button
          size="xs"
          variant={showInformation ? 'light' : 'subtle'}
          color={showInformation ? undefined : 'gray'}
          leftSection={<IconInfoCircle size={16} />}
          aria-pressed={showInformation}
          onClick={onToggleInformation}
        >
          {m('显示信息')}
        </Button>
      </Tooltip>
    </>
  )
}
