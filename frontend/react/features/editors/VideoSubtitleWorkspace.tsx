import { useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Divider,
  Group,
  Menu,
  Modal,
  NumberInput,
  Pagination,
  ScrollArea,
  Stack,
  Text,
  Textarea,
  TextInput
} from '@mantine/core'
import type { Caption } from './videoStudioModel'
import { CaptionProperties } from './VideoClipProperties'
import VideoTimingInput from './VideoTimingInput'
import { formatTimelineTime } from './timelineTime'
import {
  applySubtitleStyle,
  matchingSubtitles,
  MAX_SUBTITLE_TEXT_LENGTH,
  offsetSubtitles,
  replaceSubtitleText
} from './subtitleEditing'
import './VideoSubtitleWorkspace.css'

interface Props {
  opened: boolean
  onClose: () => void
  captions: Caption[]
  selectedId?: string
  fps: number
  readonly: boolean
  onSelect: (id: string, time: number) => void
  onChange: (captions: Caption[]) => void
  showSafeArea: boolean
  onSafeAreaChange: (show: boolean) => void
  onAdd: () => void
  onImport: () => void
  onExport: (format: 'srt' | 'vtt') => void
}
export default function VideoSubtitleWorkspace(props: Props) {
  const [query, setQuery] = useState('')
  const [replace, setReplace] = useState('')
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [error, setError] = useState('')
  const visible = matchingSubtitles(props.captions, query)
  const pages = Math.max(1, Math.ceil(visible.length / 50))
  const currentPage = Math.min(page, pages)
  const ids = selected.filter((id) => props.captions.some((cue) => cue.id === id))
  const current =
    props.captions.find((cue) => cue.id === props.selectedId) ??
    props.captions.find((cue) => ids.includes(cue.id))
  function apply(operation: () => Caption[]) {
    if (props.readonly) return
    try {
      props.onChange(operation())
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '字幕操作失败')
    }
  }
  function update(cue: Caption) {
    if (cue.text.length > MAX_SUBTITLE_TEXT_LENGTH) {
      setError(`单条字幕最多 ${MAX_SUBTITLE_TEXT_LENGTH} 字，原始字幕未修改`)
      return false
    }
    if (cue.start < 0 || cue.duration < 1 / props.fps || cue.start + cue.duration > 21600) {
      setError('字幕时间须在 0–6 小时内，且至少持续一帧')
      return false
    }
    apply(() => props.captions.map((item) => (item.id === cue.id ? cue : item)))
    return true
  }
  return (
    <Modal opened={props.opened} onClose={props.onClose} title="字幕" size="xl" centered>
      <Stack gap="sm">
        <Group gap="xs">
          <Button
            size="xs"
            disabled={props.readonly || props.captions.length >= 4096}
            onClick={props.onAdd}
          >
            在播放头添加
          </Button>
          <Button size="xs" variant="default" disabled={props.readonly} onClick={props.onImport}>
            导入 SRT / VTT
          </Button>
          <Menu withinPortal>
            <Menu.Target>
              <Button size="xs" variant="subtle" disabled={!props.captions.length}>
                导出字幕
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={() => props.onExport('srt')}>SRT</Menu.Item>
              <Menu.Item onClick={() => props.onExport('vtt')}>VTT</Menu.Item>
            </Menu.Dropdown>
          </Menu>
          <Checkbox
            label="安全区"
            checked={props.showSafeArea}
            onChange={(e) => props.onSafeAreaChange(e.currentTarget.checked)}
          />
        </Group>
        <Group wrap="nowrap">
          <TextInput
            aria-label="搜索字幕"
            placeholder="搜索字幕"
            value={query}
            onChange={(e) => {
              setQuery(e.currentTarget.value)
              setPage(1)
            }}
            style={{ flex: 1 }}
          />
          <Button
            variant="default"
            size="xs"
            onClick={() => setSelected(visible.map((cue) => cue.id))}
          >
            全选当前结果
          </Button>
          <Button variant="subtle" size="xs" onClick={() => setSelected([])} disabled={!ids.length}>
            取消选择
          </Button>
        </Group>
        {error && (
          <Alert color="red" withCloseButton onClose={() => setError('')}>
            {error}
          </Alert>
        )}
        <div className="video-subtitle-workspace">
          <Stack gap="xs" className="video-subtitle-list">
            <Text size="xs" c="dimmed">
              {visible.length} 条字幕 · 已选 {ids.length} 条
            </Text>
            <ScrollArea h={310}>
              <Stack gap={4}>
                {visible.slice((currentPage - 1) * 50, currentPage * 50).map((cue) => (
                  <div
                    key={cue.id}
                    className={`video-subtitle-row ${cue.id === current?.id ? 'is-current' : ''}`}
                  >
                    <Checkbox
                      aria-label={`选择字幕 ${cue.text.slice(0, 30)}`}
                      checked={ids.includes(cue.id)}
                      onChange={(e) =>
                        setSelected(
                          e.currentTarget.checked
                            ? [...new Set([...ids, cue.id])]
                            : ids.filter((id) => id !== cue.id)
                        )
                      }
                    />
                    <button type="button" onClick={() => props.onSelect(cue.id, cue.start)}>
                      <Text size="sm" lineClamp={2}>
                        {cue.text || '空字幕'}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {formatTimelineTime(cue.start)} —{' '}
                        {formatTimelineTime(cue.start + cue.duration)}
                      </Text>
                    </button>
                  </div>
                ))}
                {!visible.length && (
                  <Text size="sm" c="dimmed">
                    没有匹配的字幕
                  </Text>
                )}
              </Stack>
            </ScrollArea>
            {pages > 1 && (
              <Pagination total={pages} value={currentPage} onChange={setPage} size="xs" />
            )}
            <Divider />
            <Group wrap="nowrap" align="end">
              <TextInput
                label="替换为"
                value={replace}
                onChange={(e) => setReplace(e.currentTarget.value)}
                disabled={props.readonly}
                style={{ flex: 1 }}
              />
              <Button
                size="xs"
                disabled={props.readonly || !ids.length || !query}
                onClick={() =>
                  apply(() => replaceSubtitleText(props.captions, ids, query, replace))
                }
              >
                替换选中
              </Button>
            </Group>
            <Group wrap="nowrap" align="end">
              <NumberInput
                label="整体偏移（秒）"
                value={offset}
                min={-21600}
                max={21600}
                decimalScale={3}
                step={1 / props.fps}
                disabled={props.readonly}
                onChange={(value) => setOffset(typeof value === 'number' ? value : 0)}
                style={{ flex: 1 }}
              />
              <Button
                size="xs"
                disabled={props.readonly || !ids.length || !offset}
                onClick={() => apply(() => offsetSubtitles(props.captions, ids, offset))}
              >
                偏移选中
              </Button>
            </Group>
            <Button
              variant="default"
              size="xs"
              disabled={props.readonly || !current || !ids.length}
              onClick={() =>
                current && apply(() => applySubtitleStyle(props.captions, ids, current))
              }
            >
              把当前样式应用到选中字幕
            </Button>
          </Stack>
          <ScrollArea h={540} className="video-subtitle-properties">
            {current ? (
              <Stack gap="sm">
                <Textarea
                  label="当前字幕"
                  value={current.text}
                  maxLength={MAX_SUBTITLE_TEXT_LENGTH}
                  autosize
                  minRows={2}
                  maxRows={5}
                  disabled={props.readonly}
                  onChange={(e) => update({ ...current, text: e.currentTarget.value })}
                />
                <Group grow>
                  <VideoTimingInput
                    label="开始（秒）"
                    value={current.start}
                    min={0}
                    max={21600 - current.duration}
                    step={1 / props.fps}
                    disabled={props.readonly}
                    onCommit={(start) => (update({ ...current, start }) ? start : current.start)}
                  />
                  <VideoTimingInput
                    label="时长（秒）"
                    value={current.duration}
                    min={1 / props.fps}
                    max={21600 - current.start}
                    step={1 / props.fps}
                    disabled={props.readonly}
                    onCommit={(duration) =>
                      update({ ...current, duration }) ? duration : current.duration
                    }
                  />
                </Group>
                <CaptionProperties cue={current} disabled={props.readonly} onChange={update} />
              </Stack>
            ) : (
              <Text size="sm" c="dimmed">
                选择字幕编辑文字、时间和样式
              </Text>
            )}
          </ScrollArea>
        </div>
      </Stack>
    </Modal>
  )
}
