import { ActionIcon, Button, Menu, SegmentedControl, Select, Tooltip } from '@mantine/core'
import {
  IconCheck,
  IconDots,
  IconFilter,
  IconInfoCircle,
  IconPlayerPlay,
  IconRefresh,
  IconRestore
} from '@tabler/icons-react'
import { useMediaText } from './mediaLocale'

interface MediaLibraryViewControlsProps {
  sort: string
  sortOptions: Array<{ value: string; label: string }>
  onSort: (value: string) => void
  cardSize: string
  onCardSize: (value: string) => void
  showInformation: boolean
  onToggleInformation: () => void
  activeFilterCount: number
  filterDisabled: boolean
  onFilter: () => void
  loading: boolean
  scanning: boolean
  restoringOrder: boolean
  readOnly: boolean
  hasItems: boolean
  allSelected: boolean
  onRefresh: () => void
  onScan: () => void
  onRestoreOrder?: () => void
  onSelectAll: () => void
  onPreview: () => void
}

export function MediaLibraryViewControls(props: MediaLibraryViewControlsProps) {
  const m = useMediaText()
  return (
    <div className="ml-view-actions" role="group" aria-label={m('图库视图与操作')}>
      <Tooltip label={m(props.filterDisabled ? '高级筛选请返回当前文件夹' : '筛选媒体')}>
        <Button
          size="xs"
          variant={props.activeFilterCount ? 'light' : 'subtle'}
          color={props.activeFilterCount ? undefined : 'gray'}
          leftSection={<IconFilter size={16} />}
          aria-label={m('筛选媒体')}
          disabled={props.filterDisabled}
          onClick={props.onFilter}
        >
          {m('筛选')}
          {props.activeFilterCount > 0 && ` ${props.activeFilterCount}`}
        </Button>
      </Tooltip>
      <Tooltip label={m('仅排序已加载的项目')} disabled={props.sort === 'manual'}>
        <Select
          className="ml-sort-select"
          size="xs"
          aria-label={m('排序方式')}
          value={props.sort}
          data={props.sortOptions.map((option) => ({ ...option, label: m(option.label) }))}
          onChange={(value) => value && props.onSort(value)}
          allowDeselect={false}
        />
      </Tooltip>
      <SegmentedControl
        size="xs"
        aria-label={m('缩略图大小')}
        value={props.cardSize}
        onChange={props.onCardSize}
        data={[
          { label: m('小'), value: 'small' },
          { label: m('中'), value: 'medium' },
          { label: m('大'), value: 'large' }
        ]}
      />
      <Tooltip label={m('常驻显示文件名和标签')}>
        <Button
          size="xs"
          variant={props.showInformation ? 'light' : 'subtle'}
          color={props.showInformation ? undefined : 'gray'}
          leftSection={<IconInfoCircle size={16} />}
          aria-pressed={props.showInformation}
          onClick={props.onToggleInformation}
        >
          {m('显示信息')}
        </Button>
      </Tooltip>
      <Menu withinPortal position="bottom-end" shadow="md">
        <Menu.Target>
          <ActionIcon variant="subtle" color="gray" size="lg" aria-label={m('媒体库更多操作')}>
            <IconDots size={19} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item
            leftSection={<IconPlayerPlay size={16} />}
            disabled={!props.hasItems}
            onClick={props.onPreview}
          >
            {m('逐张查看')}
          </Menu.Item>
          <Menu.Item
            leftSection={<IconCheck size={16} />}
            disabled={!props.hasItems}
            onClick={props.onSelectAll}
          >
            {m(props.allSelected ? '取消全选' : '全选已加载')}
          </Menu.Item>
          <Menu.Item
            leftSection={<IconRefresh size={16} />}
            disabled={props.loading}
            onClick={props.onRefresh}
          >
            {m('刷新结果')}
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item
            leftSection={<IconRefresh size={16} />}
            disabled={props.readOnly || props.scanning}
            onClick={props.onScan}
          >
            {m(props.scanning ? '正在扫描…' : '扫描新增')}
          </Menu.Item>
          {props.onRestoreOrder && (
            <Menu.Item
              leftSection={<IconRestore size={16} />}
              disabled={props.readOnly || props.restoringOrder}
              onClick={props.onRestoreOrder}
            >
              {m('恢复时间排序')}
            </Menu.Item>
          )}
        </Menu.Dropdown>
      </Menu>
    </div>
  )
}
