import { useRef, useState } from 'react'
import { ActionIcon, Button, Group, Popover, Select, Stack, Text, Tooltip } from '@mantine/core'
import { IconTypography, IconUpload, IconX } from '@tabler/icons-react'

export default function AudioTextTool({
  tracks,
  activeTrackId,
  readonly,
  canCreateTrack,
  canAddCue,
  hasRange,
  format,
  scope,
  onCreateTrack,
  onSelectTrack,
  onAddCue,
  onImport,
  onFormatChange,
  onScopeChange,
  onExport,
  opened: controlledOpened,
  onOpenedChange
}: {
  tracks: { id: string; name: string; locked: boolean; count: number }[]
  activeTrackId?: string
  readonly: boolean
  canCreateTrack: boolean
  canAddCue: boolean
  hasRange: boolean
  format: 'srt' | 'lrc' | 'vtt'
  scope: 'all' | 'selection'
  onCreateTrack: () => void
  onSelectTrack: (id: string) => void
  onAddCue: () => void
  onImport: (file: File | null) => void
  onFormatChange: (format: 'srt' | 'lrc' | 'vtt') => void
  onScopeChange: (scope: 'all' | 'selection') => void
  onExport: () => void
  opened?: boolean
  onOpenedChange?: (opened: boolean) => void
}) {
  const [localOpened, setLocalOpened] = useState(false)
  const opened = controlledOpened ?? localOpened
  function setOpened(value: boolean) {
    setLocalOpened(value)
    onOpenedChange?.(value)
  }
  const input = useRef<HTMLInputElement>(null)
  const activeTrack = tracks.find((track) => track.id === activeTrackId)
  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="right-start"
      offset={12}
      width={320}
      withinPortal
      portalProps={{ target: '.react-editor-shell' }}
      closeOnClickOutside={false}
      shadow="md"
      zIndex={65}
    >
      <Popover.Target>
        <Tooltip label="文字" position="right">
          <ActionIcon
            variant={opened ? 'light' : 'subtle'}
            aria-label="文字工具"
            aria-expanded={opened}
            onClick={() => setOpened(!opened)}
          >
            <IconTypography size={19} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown className="react-editor-tool-popover react-editor-rail-popover audio-text-tool">
        <Stack gap="sm">
          <Group justify="space-between">
            <Text size="sm" fw={700}>
              文字
            </Text>
            <ActionIcon
              size="sm"
              variant="subtle"
              aria-label="关闭文字工具"
              onClick={() => setOpened(false)}
            >
              <IconX size={16} />
            </ActionIcon>
          </Group>
          <Group grow>
            <Button
              size="compact-xs"
              variant="light"
              disabled={readonly || !canAddCue}
              onClick={onAddCue}
            >
              添加文字
            </Button>
            <Button
              size="compact-xs"
              variant="subtle"
              disabled={readonly || !canCreateTrack}
              onClick={onCreateTrack}
            >
              新建文字轨
            </Button>
          </Group>
          {!!tracks.length && (
            <Select
              label="文字轨"
              size="xs"
              value={activeTrackId ?? null}
              placeholder="选择文字轨"
              allowDeselect={false}
              data={tracks.map((track) => ({ value: track.id, label: track.name }))}
              onChange={(id) => {
                if (id) onSelectTrack(id)
              }}
              comboboxProps={{
                withinPortal: true,
                portalProps: { target: '.react-editor-shell' },
                zIndex: 66
              }}
            />
          )}
          <Button
            size="compact-xs"
            variant="subtle"
            leftSection={<IconUpload size={14} />}
            disabled={readonly || !canCreateTrack}
            onClick={() => input.current?.click()}
          >
            导入歌词 / 字幕
          </Button>
          <input
            ref={input}
            type="file"
            hidden
            accept=".lrc,.srt,.vtt,.txt"
            aria-label="导入文字文件"
            onChange={(event) => {
              onImport(event.currentTarget.files?.[0] ?? null)
              event.currentTarget.value = ''
            }}
          />
          <Group grow>
            <Select
              label="下载格式"
              size="xs"
              value={format}
              allowDeselect={false}
              data={[
                { value: 'srt', label: 'SRT 字幕' },
                { value: 'lrc', label: 'LRC 歌词' },
                { value: 'vtt', label: 'WebVTT 字幕' }
              ]}
              onChange={(value) =>
                onFormatChange(value === 'lrc' || value === 'vtt' ? value : 'srt')
              }
              comboboxProps={{
                withinPortal: true,
                portalProps: { target: '.react-editor-shell' },
                zIndex: 66
              }}
            />
            <Select
              label="下载范围"
              size="xs"
              value={scope}
              allowDeselect={false}
              data={[
                { value: 'all', label: '整条文字轨' },
                { value: 'selection', label: '选区', disabled: !hasRange }
              ]}
              onChange={(value) => onScopeChange(value === 'selection' ? 'selection' : 'all')}
              comboboxProps={{
                withinPortal: true,
                portalProps: { target: '.react-editor-shell' },
                zIndex: 66
              }}
            />
          </Group>
          <Button
            size="compact-xs"
            variant="light"
            disabled={!activeTrack?.count || (scope === 'selection' && !hasRange)}
            onClick={onExport}
          >
            下载文字轨
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}
