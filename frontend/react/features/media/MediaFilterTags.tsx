import {
  memo,
  useDeferredValue,
  useMemo,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction
} from 'react'
import { Accordion, Group, MultiSelect, Switch, Text, TextInput } from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'
import { groupTags } from '../../../src/features/media-library/model/tagGroups'
import { tagLabel } from '../../../src/features/media-library/model/tagLabel'
import { tagColor } from '../../design/tagColors'
import { emptyFilters, type MediaFilters, type MediaTag } from './mediaApi'
import { useMediaText } from './mediaLocale'
import { filterMediaTags } from './mediaTagSearch'

/** Dimension edits do not rerender the tag controls; search keeps its input urgent. */
export const MediaFilterTags = memo(function MediaFilterTags({
  tags,
  tagGroups,
  notTags,
  excludeAllTags,
  onChange,
  layout
}: {
  tags: MediaTag[]
  tagGroups: MediaFilters['tag_groups']
  notTags: number[]
  excludeAllTags: boolean
  onChange: Dispatch<SetStateAction<MediaFilters>>
  layout: 'inline' | 'panel'
}) {
  const m = useMediaText()
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const customTags = useMemo(() => tags.filter((tag) => tag.type === 'custom'), [tags])
  const groups = useMemo(() => groupTags(customTags), [customTags])
  const choices = useMemo(
    () =>
      groups.map((group) => ({
        group: group.key === 'custom' ? m('未分组') : group.label,
        items: group.tags.map((tag) => ({
          value: String(tag.id),
          label: `${m(tagLabel(tag))}${tag.group_name ? ` · ${tag.group_name}` : ''}`
        }))
      })),
    [groups, m]
  )
  const [expandedGroups, setExpandedGroups] = useState(() =>
    groups
      .filter((group) => layout !== 'panel' || tagGroups[group.key]?.length)
      .map((group) => group.key)
  )
  const [collapsedSearchGroups, setCollapsedSearchGroups] = useState<string[]>([])
  const searching = !!deferredQuery.trim()
  const visibleGroups = useMemo(() => {
    const matching = new Set(filterMediaTags(customTags, deferredQuery, (tag) => m(tagLabel(tag))))
    return groups
      .map((group) => ({ ...group, tags: group.tags.filter((tag) => matching.has(tag)) }))
      .filter((group) => group.tags.length || tagGroups[group.key]?.length)
  }, [customTags, deferredQuery, groups, tagGroups, m])
  // Reuse the result tree during the urgent keystroke render instead of remounting groups.
  const tagResults = useMemo(
    () => (
      <Accordion
        multiple
        value={
          searching
            ? visibleGroups
                .map((group) => group.key)
                .filter((key) => !collapsedSearchGroups.includes(key))
            : expandedGroups
        }
        onChange={(opened) => {
          if (searching)
            setCollapsedSearchGroups(
              visibleGroups.map((group) => group.key).filter((key) => !opened.includes(key))
            )
          else setExpandedGroups(opened)
        }}
        variant="separated"
        className="ml-filter-tag-groups"
      >
        {visibleGroups.map((group) => (
          <Accordion.Item key={group.key} value={group.key}>
            <Accordion.Control>
              {group.key === 'custom' ? m('未分组') : group.label}
              {tagGroups[group.key]?.length
                ? ` · ${m('已选 {count}', { count: tagGroups[group.key].length })}`
                : ''}
            </Accordion.Control>
            <Accordion.Panel>
              <Group gap={6}>
                {group.tags.map((tag) => {
                  const id = Number(tag.id)
                  const selected = (tagGroups[group.key] || []).includes(id)
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      className={`ml-filter-tag${selected ? ' is-selected' : ''}`}
                      style={{ '--ml-tag-color': tagColor(tag) } as CSSProperties}
                      aria-pressed={selected}
                      onClick={() =>
                        onChange((current) => {
                          const previous = current.tag_groups[group.key] || []
                          return {
                            ...current,
                            tag_groups: {
                              ...current.tag_groups,
                              [group.key]: previous.includes(id)
                                ? previous.filter((item) => item !== id)
                                : [...previous, id]
                            },
                            not_tags: current.not_tags.filter((item) => item !== id),
                            exclude_all_tags: false
                          }
                        })
                      }
                    >
                      {selected ? '✓ ' : ''}
                      {m(tagLabel(tag))}
                      {tag.count ? ` · ${tag.count}` : ''}
                    </button>
                  )
                })}
              </Group>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    ),
    [visibleGroups, searching, expandedGroups, collapsedSearchGroups, tagGroups, onChange, m]
  )
  return (
    <>
      <Text size="sm" c="dimmed">
        {m('同一分组的标签任选其一，不同分组同时满足。')}
      </Text>
      <TextInput
        label={m('搜索所有标签')}
        value={query}
        onChange={(event) => {
          setQuery(event.currentTarget.value)
          if (collapsedSearchGroups.length) setCollapsedSearchGroups([])
        }}
        leftSection={<IconSearch size={15} />}
      />
      {tagResults}
      <MultiSelect
        label={m('排除标签')}
        searchable
        clearable
        data={choices}
        value={notTags.map(String)}
        onChange={(ids) => {
          const excluded = ids.map(Number)
          onChange((current) => ({
            ...current,
            not_tags: excluded,
            exclude_all_tags: false,
            tag_groups: Object.fromEntries(
              Object.entries(current.tag_groups).map(([key, items]) => [
                key,
                items.filter((id) => !excluded.includes(id))
              ])
            )
          }))
        }}
      />
      <Switch
        label={m('没有自定义标签')}
        checked={excludeAllTags}
        onChange={(event) => {
          const checked = event.currentTarget.checked
          onChange((current) =>
            checked
              ? { ...emptyFilters(), exclude_all_tags: true, dimensions: current.dimensions }
              : { ...current, exclude_all_tags: false }
          )
        }}
      />
    </>
  )
})
