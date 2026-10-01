import { useDeferredValue, useMemo, useState, type CSSProperties } from 'react'
import { Button, Group, Text, TextInput } from '@mantine/core'
import { IconCheck, IconSearch } from '@tabler/icons-react'
import { groupTags } from '../../../src/features/media-library/model/tagGroups'
import { tagLabel } from '../../../src/features/media-library/model/tagLabel'
import { tagColor } from '../../design/tagColors'
import type { MediaTag } from './mediaApi'
import { useMediaText } from './mediaLocale'
import { filterMediaTags } from './mediaTagSearch'
import './mediaTagPicker.css'

/** Shared draft selection for library, discovery and preview tag editors. */
export function MediaTagPicker({
  tags,
  value,
  onChange,
  label,
  disabled = false
}: {
  tags: MediaTag[]
  value: string[]
  onChange: (value: string[]) => void
  label: string
  disabled?: boolean
}) {
  const m = useMediaText()
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const groups = useMemo(
    () =>
      groupTags(
        filterMediaTags(
          tags.filter((tag) => tag.type === 'custom'),
          deferredQuery,
          (tag) => m(tagLabel(tag))
        )
      ),
    [tags, deferredQuery, m]
  )
  const selected = useMemo(() => new Set(value), [value])
  const tagResults = useMemo(
    () => (
      <fieldset className="ml-tag-picker-groups" aria-label={label} disabled={disabled}>
        {groups.map((group) => {
          const groupLabel = group.key === 'custom' ? m('未分组') : group.label
          return (
            <section className="ml-tag-picker-group" aria-label={groupLabel} key={group.key}>
              <Text component="h3" className="ml-tag-picker-heading">
                {groupLabel}
                <span>{group.tags.length}</span>
              </Text>
              <Group gap={6}>
                {group.tags.map((tag) => {
                  const id = String(tag.id)
                  const checked = selected.has(id)
                  return (
                    <button
                      type="button"
                      key={id}
                      className={`ml-tag-picker-tag${checked ? ' is-selected' : ''}`}
                      aria-pressed={checked}
                      title={`${groupLabel} · ${m(tagLabel(tag))}`}
                      style={{ '--ml-tag-color': tagColor(tag) } as CSSProperties}
                      onClick={() =>
                        onChange(checked ? value.filter((item) => item !== id) : [...value, id])
                      }
                    >
                      <span className="ml-tag-picker-dot" />
                      <span>{m(tagLabel(tag))}</span>
                      <IconCheck size={13} className="ml-tag-picker-check" aria-hidden="true" />
                    </button>
                  )
                })}
              </Group>
            </section>
          )
        })}
        {!groups.length && (
          <Text size="sm" c="dimmed" py="md">
            {m(deferredQuery.trim() ? '没有匹配的标签' : '暂无自定义标签')}
          </Text>
        )}
      </fieldset>
    ),
    [groups, selected, value, disabled, label, onChange, m, deferredQuery]
  )
  return (
    <div className="ml-tag-picker">
      <Group justify="space-between" gap="xs" mb="xs">
        <Text size="sm" fw={500}>
          {label}
        </Text>
        <Group gap="xs">
          <Text size="xs" c="dimmed" aria-live="polite">
            {m('已选 {count}', { count: selected.size })}
          </Text>
          <Button
            size="compact-xs"
            variant="subtle"
            color="gray"
            disabled={disabled || !value.length}
            onClick={() => onChange([])}
          >
            {m('清除选择')}
          </Button>
        </Group>
      </Group>
      <TextInput
        type="search"
        placeholder={m('搜索标签或分组')}
        aria-label={m('搜索标签或分组')}
        leftSection={<IconSearch size={16} />}
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        disabled={disabled}
      />
      {tagResults}
    </div>
  )
}
