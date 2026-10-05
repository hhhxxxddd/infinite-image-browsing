import { useEffect, useRef, useState } from 'react'
import { Button, Group, Select, Stack, Text, TextInput } from '@mantine/core'
import EditorDisclosure from './EditorDisclosure'
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
  readonly,
  onApply
}: {
  workspaceId: string
  draftId: string
  properties: AudioProperties
  readonly: boolean
  onApply: (properties: AudioProperties) => void
}) {
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
    <EditorDisclosure title="复制声音设置与预设">
      <Stack gap="xs">
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
            应用到选中
          </Button>
        </Group>
        <Select
          label="我的声音预设"
          size="xs"
          placeholder="选择预设"
          searchable
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
    </EditorDisclosure>
  )
}
