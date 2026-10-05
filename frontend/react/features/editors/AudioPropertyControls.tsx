import { useEffect, useRef, useState } from 'react'
import {
  ActionIcon,
  Button,
  Group,
  Popover,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip
} from '@mantine/core'
import { IconCopy, IconX } from '@tabler/icons-react'
import {
  mutateWorkspaceState,
  readWorkspaceState,
  subscribeWorkspaceState
} from '../../shared/workspaceState'
import { assertProductionDraftExists } from '../../../src/features/workspaces/model/workspaceWorks'
import {
  audioPresetsKey,
  readAudioPresets,
  type AudioProperties,
  type AudioPropertyPreset
} from '../../../src/features/media-editor/model/audioProperties'
export default function AudioPropertyControls({
  workspaceId,
  draftId,
  properties,
  targetLabel,
  readonly,
  onApply,
  opened: controlledOpened,
  onOpenedChange
}: {
  workspaceId: string
  draftId: string
  properties: AudioProperties
  targetLabel: string
  readonly: boolean
  onApply: (properties: AudioProperties) => void
  opened?: boolean
  onOpenedChange?: (opened: boolean) => void
}) {
  const [localOpened, setLocalOpened] = useState(false)
  const opened = controlledOpened ?? localOpened
  function setOpened(value: boolean) {
    setLocalOpened(value)
    onOpenedChange?.(value)
  }
  const [clipboard, setClipboard] = useState<AudioProperties | null>(null),
    [presets, setPresets] = useState<AudioPropertyPreset[]>([]),
    [selected, setSelected] = useState(''),
    [name, setName] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const policy = useRef({ readonly, properties }),
    live = useRef(true)
  policy.current = { readonly, properties }
  const key = audioPresetsKey(workspaceId)
  const kindLabels = { clip: '声音片段', track: '音轨', master: '总混音' }
  const applyLabel = {
    clip: '应用到所选片段',
    track: '应用到音轨',
    master: '应用到总混音'
  }[properties.kind]
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  useEffect(() => {
    const refresh = () => {
      try {
        setPresets(readAudioPresets(readWorkspaceState(workspaceId).getItem(key)))
        setError('')
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '预设读取失败')
      }
    }
    refresh()
    return subscribeWorkspaceState(workspaceId, refresh)
  }, [key, workspaceId])
  async function save() {
    if (readonly || busy) return
    setBusy(true)
    setError('')
    try {
      const snapshot = structuredClone(policy.current.properties)
      const title = name.trim() || `声音预设 ${presets.length + 1}`
      await mutateWorkspaceState(workspaceId, (storage) => {
        if (!live.current || policy.current.readonly) throw new Error('编辑器不可写')
        assertProductionDraftExists(storage, workspaceId, draftId)
        const list = readAudioPresets(storage.getItem(key))
        const next = [
          ...list,
          { id: crypto.randomUUID(), name: title.slice(0, 80), properties: snapshot }
        ].slice(-30)
        const raw = JSON.stringify(next)
        readAudioPresets(raw)
        storage.setItem(key, raw)
      })
      if (live.current) setName('')
    } catch (cause) {
      if (live.current) setError(cause instanceof Error ? cause.message : '预设保存失败')
    } finally {
      if (live.current) setBusy(false)
    }
  }
  async function remove() {
    if (readonly || busy || !selected) return
    setBusy(true)
    setError('')
    try {
      const id = selected
      await mutateWorkspaceState(workspaceId, (storage) => {
        if (!live.current || policy.current.readonly) throw new Error('编辑器不可写')
        assertProductionDraftExists(storage, workspaceId, draftId)
        const list = readAudioPresets(storage.getItem(key))
        storage.setItem(key, JSON.stringify(list.filter((preset) => preset.id !== id)))
      })
      if (live.current) setSelected('')
    } catch (cause) {
      if (live.current) setError(cause instanceof Error ? cause.message : '预设删除失败')
    } finally {
      if (live.current) setBusy(false)
    }
  }
  function apply(value: AudioProperties) {
    try {
      onApply(structuredClone(value))
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '应用失败')
    }
  }
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
        <Tooltip label="声音预设" position="right">
          <ActionIcon
            className="audio-property-trigger"
            variant={opened ? 'light' : 'subtle'}
            aria-label="声音预设"
            aria-expanded={opened}
            onClick={() => setOpened(!opened)}
          >
            <IconCopy size={19} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown className="react-editor-tool-popover react-editor-rail-popover audio-property-popover">
        <Stack gap="sm">
          <Group justify="space-between">
            <Text size="sm" fw={700}>
              声音预设
            </Text>
            <ActionIcon
              size="sm"
              variant="subtle"
              aria-label="关闭声音预设"
              onClick={() => setOpened(false)}
            >
              <IconX size={16} />
            </ActionIcon>
          </Group>
          <Text size="xs" c="dimmed" className="audio-property-target">
            作用对象 · {targetLabel}
          </Text>
          <Group grow>
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => setClipboard(structuredClone(properties))}
            >
              复制设置
            </Button>
            <Button
              size="compact-xs"
              variant="light"
              disabled={readonly || !clipboard || clipboard.kind !== properties.kind}
              onClick={() => {
                if (clipboard) apply(clipboard)
              }}
            >
              {applyLabel}
            </Button>
          </Group>
          {clipboard && (
            <Text size="xs" c="dimmed" role="status">
              已复制{kindLabels[clipboard.kind]}设置
              {clipboard.kind !== properties.kind && '，请选择同类对象后应用'}
            </Text>
          )}
          <Select
            label="我的声音预设"
            size="xs"
            placeholder="选择预设"
            searchable
            comboboxProps={{
              withinPortal: true,
              portalProps: { target: '.react-editor-shell' },
              zIndex: 66
            }}
            value={selected}
            onChange={(value) => setSelected(value ?? '')}
            data={presets
              .filter((preset) => preset.properties.kind === properties.kind)
              .map((preset) => ({ value: preset.id, label: preset.name }))}
          />
          <Group grow>
            <Button
              size="compact-xs"
              variant="light"
              disabled={
                readonly ||
                !presets.some(
                  (preset) => preset.id === selected && preset.properties.kind === properties.kind
                )
              }
              onClick={() => {
                const preset = presets.find((preset) => preset.id === selected)
                if (preset) apply(preset.properties)
              }}
            >
              应用预设
            </Button>
            <Button
              size="compact-xs"
              variant="subtle"
              disabled={
                readonly ||
                busy ||
                !presets.some(
                  (preset) => preset.id === selected && preset.properties.kind === properties.kind
                )
              }
              onClick={() => void remove()}
            >
              删除预设
            </Button>
          </Group>
          <TextInput
            label="保存为预设"
            size="xs"
            placeholder="预设名称"
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            disabled={readonly || busy}
          />
          <Button
            size="compact-xs"
            variant="subtle"
            disabled={readonly}
            loading={busy}
            onClick={() => void save()}
          >
            保存当前设置
          </Button>
          {error && (
            <Text size="xs" c="red" role="alert">
              {error}
            </Text>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}
