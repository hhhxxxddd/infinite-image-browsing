import { useEffect, useState } from 'react'
import { Button, Menu, Text, Tooltip } from '@mantine/core'
import { IconArrowsSort, IconCheck, IconChevronDown } from '@tabler/icons-react'
import {
  readWorkbenchSort,
  workbenchCardDate,
  workbenchSortOptions,
  type WorkbenchDatedCard,
  type WorkbenchSort
} from './workbenchCardOrder'

export function useWorkbenchSort(scope: 'workspaces' | 'works') {
  const key = `omnigallery:workbench-sort:${scope}`
  const [order, setOrder] = useState<WorkbenchSort>(() => {
    try {
      return readWorkbenchSort(localStorage.getItem(key))
    } catch {
      return 'recent'
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, order)
    } catch {
      // Sorting remains usable when browser preferences cannot be saved.
    }
  }, [key, order])
  return [order, setOrder] as const
}

export default function WorkbenchSortControl({
  label,
  value,
  onChange
}: {
  label: string
  value: WorkbenchSort
  onChange: (value: WorkbenchSort) => void
}) {
  const selected =
    workbenchSortOptions.find((option) => option.value === value) ?? workbenchSortOptions[0]
  return (
    <Menu position="bottom-end" shadow="md" width={220}>
      <Menu.Target>
        <Button
          className="wb-sort-control"
          variant="subtle"
          color="gray"
          size="xs"
          leftSection={<IconArrowsSort size={15} />}
          rightSection={<IconChevronDown size={13} />}
          aria-label={`${label}排序：${selected.label}`}
        >
          {selected.label}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        {workbenchSortOptions.map((option) => (
          <Menu.Item
            key={option.value}
            renderRoot={(props) => (
              <button {...props} role="menuitemradio" aria-checked={value === option.value} />
            )}
            leftSection={
              value === option.value ? (
                <IconCheck size={15} aria-hidden />
              ) : (
                <span style={{ width: 15 }} />
              )
            }
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  )
}

export function WorkbenchCardDate({
  item,
  order
}: {
  item: WorkbenchDatedCard
  order: WorkbenchSort
}) {
  const value = workbenchCardDate(item, order)
  if (value.timestamp === undefined) return null
  const date = new Date(value.timestamp)
  return (
    <Tooltip label={`${value.label}于 ${date.toLocaleString('zh-CN')}`}>
      <Text
        className="wb-card-date"
        component="time"
        dateTime={date.toISOString()}
        size="xs"
        c="dimmed"
      >
        {value.label} {date.toLocaleDateString('zh-CN')}
      </Text>
    </Tooltip>
  )
}
