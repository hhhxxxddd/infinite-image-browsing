import { Fragment, useMemo, useState } from 'react'
import { ActionIcon, Menu, Text, TextInput } from '@mantine/core'
import { IconCheck, IconPencil, IconSearch, IconX } from '@tabler/icons-react'
import { groupTags } from '../../../src/features/media-library/model/tagGroups'
import { tagLabel } from '../../../src/features/media-library/model/tagLabel'
import type { MediaTag } from './mediaApi'
import { useMediaText } from './mediaLocale'
import { filterMediaTags } from './mediaTagSearch'

interface MediaTagMenuProps {
  tags: MediaTag[]
  selectedTags?: MediaTag[]
  onSelect: (tag: MediaTag) => void
  onEdit?: () => void
  getColor: (tag: MediaTag) => string
}

export function MediaTagMenu({
  tags,
  selectedTags,
  onSelect,
  onEdit,
  getColor
}: MediaTagMenuProps) {
  const m = useMediaText()
  const [query, setQuery] = useState('')
  const { groups, remaining } = useMemo(() => {
    const search = query.trim()
    const matches = filterMediaTags(tags, query, (tag) => m(tagLabel(tag)))
    const groups = groupTags(matches, search ? Infinity : 50)
    const visibleCount = groups.reduce((count, group) => count + group.tags.length, 0)
    return { groups, remaining: matches.length - visibleCount }
  }, [tags, query, m])
  const selected = new Set(selectedTags?.map((tag) => String(tag.id)))

  return (
    <>
      <TextInput
        className="ml-tag-menu-search"
        type="search"
        size="xs"
        aria-label={m('搜索标签')}
        placeholder={m('搜索标签')}
        leftSection={<IconSearch size={14} />}
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation()
        }}
        rightSection={
          query && (
            <ActionIcon
              size="xs"
              variant="subtle"
              color="gray"
              aria-label={m('清除标签搜索')}
              onClick={() => setQuery('')}
            >
              <IconX size={13} />
            </ActionIcon>
          )
        }
      />
      <div className="ml-tag-menu-list">
        {groups.map((group) => (
          <Fragment key={group.key}>
            <Menu.Label className="ml-tag-menu-heading">
              {group.key === 'custom' ? m('未分组') : group.label}
            </Menu.Label>
            {group.tags.map((tag) => (
              <Menu.Item
                key={tag.id}
                renderRoot={(props) => (
                  <button
                    {...props}
                    role={selectedTags ? 'menuitemcheckbox' : 'menuitem'}
                    aria-checked={selectedTags ? selected.has(String(tag.id)) : undefined}
                  />
                )}
                leftSection={
                  <span className="ml-tag-menu-color" style={{ background: getColor(tag) }} />
                }
                rightSection={
                  selectedTags &&
                  (selected.has(String(tag.id)) ? (
                    <IconCheck size={15} />
                  ) : (
                    <span className="ml-tag-spacer" />
                  ))
                }
                onClick={() => onSelect(tag)}
              >
                {m(tagLabel(tag))}
              </Menu.Item>
            ))}
          </Fragment>
        ))}
        {!groups.length && (
          <Text size="xs" c="dimmed" className="ml-tag-menu-empty">
            {m('没有匹配的标签')}
          </Text>
        )}
        {remaining > 0 && (
          <Text size="xs" c="dimmed" className="ml-tag-menu-empty">
            {m('还有 {count} 个，输入名称查找', { count: remaining })}
          </Text>
        )}
      </div>
      {onEdit && (
        <>
          <Menu.Divider />
          <Menu.Item leftSection={<IconPencil size={16} />} onClick={onEdit}>
            {m('编辑标签')}
          </Menu.Item>
        </>
      )}
    </>
  )
}
