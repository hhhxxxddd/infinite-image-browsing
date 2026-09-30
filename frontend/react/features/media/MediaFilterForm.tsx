import { useMemo, useState, type CSSProperties } from 'react'
import {
  Accordion,
  Button,
  Divider,
  Group,
  MultiSelect,
  NumberInput,
  Stack,
  Switch,
  Text,
  TextInput
} from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'
import { aspectRatioPresets } from '../../../src/shared/lib/aspectRatioPresets'
import { emptyFilters, type MediaFilters, type MediaTag } from './mediaApi'
import { useMediaText } from './mediaLocale'

const pairValid = (left?: number, right?: number) =>
  (left === undefined && right === undefined) ||
  (left !== undefined &&
    right !== undefined &&
    Number.isInteger(left) &&
    Number.isInteger(right) &&
    left > 0 &&
    right > 0)

function tagColor(tag: MediaTag) {
  if (tag.color) return tag.color
  const seed = [...String(tag.id)].reduce(
    (value, character) => (value * 31 + character.charCodeAt(0)) % 360,
    0
  )
  return `hsl(${seed} 75% 34%)`
}

/** Shared query contract: OR inside each group, AND between groups. */
export default function MediaFilterForm({
  value,
  onChange,
  tags,
  onApply
}: {
  value: MediaFilters
  onChange: (value: MediaFilters) => void
  tags: MediaTag[]
  onApply: () => void
}) {
  const m = useMediaText()
  const [query, setQuery] = useState('')
  const customTags = useMemo(() => tags.filter((tag) => tag.type === 'custom'), [tags])
  const groups = useMemo(
    () =>
      Object.entries(
        customTags.reduce<Record<string, MediaTag[]>>((result, tag) => {
          const key = tag.group_name ? `custom:${tag.group_name}` : 'custom'
          ;(result[key] ??= []).push(tag)
          return result
        }, {})
      ).map(
        ([key, items]) =>
          [
            key,
            items.sort(
              (a, b) =>
                b.count - a.count ||
                (a.display_name || a.name).localeCompare(b.display_name || b.name)
            )
          ] as const
      ),
    [customTags]
  )
  const search = query.trim().toLocaleLowerCase()
  const matches = (tag: MediaTag) =>
    !search || `${tag.display_name || tag.name} ${tag.name}`.toLocaleLowerCase().includes(search)
  const choices = customTags.map((tag) => ({
    value: String(tag.id),
    label: `${tag.display_name || tag.name}${tag.group_name ? ` · ${tag.group_name}` : ''}`
  }))
  const valid =
    pairValid(value.dimensions.width, value.dimensions.height) &&
    pairValid(value.dimensions.ratio_width, value.dimensions.ratio_height)
  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        {m('同一分组的标签任选其一，不同分组同时满足。')}
      </Text>
      <TextInput
        label={m('搜索所有标签')}
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        leftSection={<IconSearch size={15} />}
      />
      <Accordion
        key={groups.map(([key]) => key).join('|')}
        multiple
        defaultValue={groups.map(([key]) => key)}
        variant="separated"
        className="ml-filter-tag-groups"
      >
        {groups
          .filter(([key, items]) => items.some(matches) || value.tag_groups[key]?.length)
          .map(([key, items]) => (
            <Accordion.Item key={key} value={key}>
              <Accordion.Control>
                {key === 'custom' ? m('未分组') : key.slice(7)}
                {value.tag_groups[key]?.length
                  ? ` · ${m('已选 {count}', { count: value.tag_groups[key].length })}`
                  : ''}
              </Accordion.Control>
              <Accordion.Panel>
                <Group gap={6}>
                  {items.filter(matches).map((tag) => {
                    const selected = (value.tag_groups[key] || []).includes(Number(tag.id))
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        className={`ml-filter-tag${selected ? ' is-selected' : ''}`}
                        style={{ '--ml-tag-color': tagColor(tag) } as CSSProperties}
                        aria-pressed={selected}
                        onClick={() => {
                          const previous = value.tag_groups[key] || []
                          onChange({
                            ...value,
                            tag_groups: {
                              ...value.tag_groups,
                              [key]: selected
                                ? previous.filter((id) => id !== Number(tag.id))
                                : [...previous, Number(tag.id)]
                            },
                            not_tags: value.not_tags.filter((id) => id !== Number(tag.id)),
                            exclude_all_tags: false
                          })
                        }}
                      >
                        {selected ? '✓ ' : ''}
                        {tag.display_name || tag.name}
                        {tag.count ? ` · ${tag.count}` : ''}
                      </button>
                    )
                  })}
                </Group>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
      </Accordion>
      <MultiSelect
        label={m('排除标签')}
        searchable
        clearable
        data={choices}
        value={value.not_tags.map(String)}
        onChange={(ids) => {
          const excluded = ids.map(Number)
          onChange({
            ...value,
            not_tags: excluded,
            exclude_all_tags: false,
            tag_groups: Object.fromEntries(
              Object.entries(value.tag_groups).map(([key, items]) => [
                key,
                items.filter((id) => !excluded.includes(id))
              ])
            )
          })
        }}
      />
      <Switch
        label={m('没有自定义标签')}
        checked={value.exclude_all_tags}
        onChange={(event) =>
          onChange(
            event.currentTarget.checked
              ? { ...emptyFilters(), exclude_all_tags: true, dimensions: value.dimensions }
              : { ...value, exclude_all_tags: false }
          )
        }
      />
      <Divider label={m('尺寸')} />
      <Text size="sm" fw={600}>
        {m('画面比例')}
      </Text>
      <Group gap={6}>
        {aspectRatioPresets.map(({ label, width, height }) => {
          const active =
            value.dimensions.ratio_width === width && value.dimensions.ratio_height === height
          return (
            <Button
              key={label}
              size="compact-xs"
              variant={active ? 'filled' : 'light'}
              onClick={() =>
                onChange({
                  ...value,
                  dimensions: {
                    ...value.dimensions,
                    ratio_width: active ? undefined : width,
                    ratio_height: active ? undefined : height
                  }
                })
              }
            >
              {m(label)}
            </Button>
          )
        })}
      </Group>
      <Group grow>
        {(['width', 'height', 'ratio_width', 'ratio_height'] as const).map((key) => (
          <NumberInput
            key={key}
            label={m(
              {
                width: '宽度 px',
                height: '高度 px',
                ratio_width: '比例宽',
                ratio_height: '比例高'
              }[key]
            )}
            min={1}
            max={1000000}
            value={value.dimensions[key] ?? ''}
            onChange={(number) =>
              onChange({
                ...value,
                dimensions: {
                  ...value.dimensions,
                  [key]: typeof number === 'number' ? number : undefined
                }
              })
            }
          />
        ))}
      </Group>
      {!valid && (
        <Text c="red" size="xs">
          {m('宽高及比例必须成对填写有效正整数')}
        </Text>
      )}
      <Group justify="space-between">
        <Button variant="subtle" onClick={() => onChange(emptyFilters())}>
          {m('清空')}
        </Button>
        <Button disabled={!valid} onClick={onApply}>
          {m('应用筛选')}
        </Button>
      </Group>
    </Stack>
  )
}
