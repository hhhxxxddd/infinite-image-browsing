import { useState } from 'react'
import { Button, Divider, Group, NumberInput, Stack, Switch, Text } from '@mantine/core'
import { aspectRatioPresets } from '../../../src/shared/lib/aspectRatioPresets'
import { emptyFilters, type MediaFilters, type MediaTag } from './mediaApi'
import { useMediaText } from './mediaLocale'
import { MediaFilterTags } from './MediaFilterTags'

const pairValid = (left?: number, right?: number) =>
  (left === undefined && right === undefined) ||
  (left !== undefined &&
    right !== undefined &&
    Number.isInteger(left) &&
    Number.isInteger(right) &&
    left > 0 &&
    right > 0)

/** Mount for each editing session; draft input never updates the media-list owner. */
export default function MediaFilterForm({
  initialValue,
  tags,
  onApply,
  layout = 'inline',
  showIncludeSubfolders = false,
  initialIncludeSubfolders = false
}: {
  initialValue: MediaFilters
  tags: MediaTag[]
  onApply: (filters: MediaFilters, includeSubfolders: boolean) => void
  layout?: 'inline' | 'panel'
  showIncludeSubfolders?: boolean
  initialIncludeSubfolders?: boolean
}) {
  const m = useMediaText()
  const [value, onChange] = useState(() => structuredClone(initialValue))
  const [includeSubfolders, setIncludeSubfolders] = useState(initialIncludeSubfolders)
  const clear = () => {
    onChange(emptyFilters())
    setIncludeSubfolders(false)
  }
  const valid =
    pairValid(value.dimensions.width, value.dimensions.height) &&
    pairValid(value.dimensions.ratio_width, value.dimensions.ratio_height)
  return (
    <>
      <Stack gap="md" className={layout === 'panel' ? 'ml-filter-panel-scroll' : undefined}>
        {showIncludeSubfolders && (
          <Switch
            label={m('包含子文件夹')}
            checked={includeSubfolders}
            onChange={(event) => setIncludeSubfolders(event.currentTarget.checked)}
          />
        )}
        <MediaFilterTags
          tags={tags}
          tagGroups={value.tag_groups}
          notTags={value.not_tags}
          excludeAllTags={value.exclude_all_tags}
          onChange={onChange}
          layout={layout}
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
                  onChange((current) => ({
                    ...current,
                    dimensions: {
                      ...current.dimensions,
                      ratio_width: active ? undefined : width,
                      ratio_height: active ? undefined : height
                    }
                  }))
                }
              >
                {m(label)}
              </Button>
            )
          })}
        </Group>
        <Group grow className="ml-filter-dimensions">
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
                onChange((current) => ({
                  ...current,
                  dimensions: {
                    ...current.dimensions,
                    [key]: typeof number === 'number' ? number : undefined
                  }
                }))
              }
            />
          ))}
        </Group>
        {!valid && (
          <Text c="red" size="xs">
            {m('宽高及比例必须成对填写有效正整数')}
          </Text>
        )}
      </Stack>
      {layout === 'panel' ? (
        <footer className="ml-filter-panel-footer">
          <Button
            variant="default"
            onClick={() => {
              onChange(structuredClone(initialValue))
              setIncludeSubfolders(initialIncludeSubfolders)
            }}
          >
            {m('重置')}
          </Button>
          <Button disabled={!valid} onClick={() => onApply(value, includeSubfolders)}>
            {m('应用筛选')}
          </Button>
          <Button variant="default" onClick={clear}>
            {m('清空全部筛选')}
          </Button>
        </footer>
      ) : (
        <Group justify="space-between" mt="md">
          <Button variant="subtle" onClick={clear}>
            {m('清空')}
          </Button>
          <Button disabled={!valid} onClick={() => onApply(value, includeSubfolders)}>
            {m('应用筛选')}
          </Button>
        </Group>
      )}
    </>
  )
}
