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
import {
  IconCopy,
  IconClipboard,
  IconDeviceFloppy,
  IconRefresh,
  IconTrash,
  IconX
} from '@tabler/icons-react'
import { assertProductionDraftExists } from '../../../src/features/workspaces/model/workspaceWorks'
import {
  ensureWorkspaceState,
  mutateWorkspaceState,
  readWorkspaceState,
  reloadWorkspaceState,
  subscribeWorkspaceState
} from '../../shared/workspaceState'
import {
  deleteVideoPreset,
  readVideoPresets,
  saveVideoPreset,
  validVideoProperties,
  videoPresetsKey,
  type VideoProperties,
  type VideoPropertyApplication,
  type VideoPropertyPreset
} from './videoProperties'

export interface VideoPropertyControlsProps {
  workspaceId: string
  draftId: string
  properties: VideoProperties | null
  targetLabel?: string
  readonly: boolean
  opened?: boolean
  onOpenedChange?: (opened: boolean) => void
  onApply: (
    properties: VideoProperties
  ) => void | Pick<VideoPropertyApplication, 'appliedIds' | 'skippedLockedIds' | 'unchangedIds'>
}

export default function VideoPropertyControls({
  workspaceId,
  draftId,
  properties,
  targetLabel,
  readonly,
  onApply,
  opened: controlledOpened,
  onOpenedChange
}: VideoPropertyControlsProps) {
  const [clipboard, setClipboard] = useState<VideoProperties | null>(null)
  const [localOpened, setLocalOpened] = useState(false)
  const opened = controlledOpened ?? localOpened
  function setOpened(value: boolean) {
    setLocalOpened(value)
    onOpenedChange?.(value)
  }
  const [presets, setPresets] = useState<VideoPropertyPreset[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const live = useRef(true)
  const policy = useRef({ workspaceId, draftId, properties, readonly, onApply })
  policy.current = { workspaceId, draftId, properties, readonly, onApply }
  const key = videoPresetsKey(workspaceId)
  const kind = properties?.kind
  const chosen = presets.find((preset) => preset.id === selected && preset.properties.kind === kind)
  const scope = () => ({ workspaceId: policy.current.workspaceId, draftId: policy.current.draftId })
  function isCurrent(snapshot: ReturnType<typeof scope>) {
    return (
      live.current &&
      snapshot.workspaceId === policy.current.workspaceId &&
      snapshot.draftId === policy.current.draftId
    )
  }
  function assertCurrent(snapshot: ReturnType<typeof scope>) {
    if (!isCurrent(snapshot) || policy.current.readonly) throw new Error('编辑器已切换或不可写')
  }
  function read(snapshot: ReturnType<typeof scope>) {
    if (!isCurrent(snapshot)) return
    const storage = readWorkspaceState(snapshot.workspaceId)
    assertProductionDraftExists(storage, snapshot.workspaceId, snapshot.draftId)
    const list = readVideoPresets(storage.getItem(videoPresetsKey(snapshot.workspaceId)))
    setPresets(list)
    setSelected((value) => (list.some((entry) => entry.id === value) ? value : null))
    setLoaded(true)
  }
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  useEffect(() => {
    setClipboard(null)
    setName('')
  }, [workspaceId])
  useEffect(() => {
    const snapshot = { workspaceId, draftId }
    setBusy(false)
    setLoaded(false)
    setPresets([])
    setSelected(null)
    setStatus('')
    setError('')
    const refresh = () => {
      if (!isCurrent(snapshot)) return
      try {
        read(snapshot)
        setError('')
      } catch (cause) {
        setLoaded(false)
        setPresets([])
        setError(cause instanceof Error ? cause.message : '预设读取失败')
      }
    }
    // Reading presets must not migrate/write state in a read-only editor.
    void ensureWorkspaceState(workspaceId, true)
      .then(refresh)
      .catch((cause) => {
        if (isCurrent(snapshot)) setError(cause instanceof Error ? cause.message : '预设读取失败')
      })
    return subscribeWorkspaceState(workspaceId, refresh)
  }, [workspaceId, draftId, key])
  async function reload() {
    if (busy) return
    const snapshot = scope()
    setBusy(true)
    setError('')
    setStatus('')
    try {
      await reloadWorkspaceState(snapshot.workspaceId, true)
      read(snapshot)
    } catch (cause) {
      if (isCurrent(snapshot)) {
        setLoaded(false)
        setError(cause instanceof Error ? cause.message : '预设刷新失败')
      }
    } finally {
      if (isCurrent(snapshot)) setBusy(false)
    }
  }
  async function save() {
    if (readonly || busy || !loaded || !properties) return
    const snapshot = scope(),
      captured = structuredClone(properties)
    const title =
      name.trim() || `${properties.kind === 'visual' ? '画面' : '字幕'}预设 ${presets.length + 1}`
    const preset = { id: crypto.randomUUID(), name: title.slice(0, 80), properties: captured }
    setBusy(true)
    setError('')
    setStatus('')
    try {
      await mutateWorkspaceState(snapshot.workspaceId, (storage) => {
        assertCurrent(snapshot)
        saveVideoPreset(
          storage,
          snapshot.workspaceId,
          snapshot.draftId,
          preset,
          policy.current.readonly
        )
      })
      if (isCurrent(snapshot)) {
        read(snapshot)
        setSelected(preset.id)
        setName('')
        setStatus('预设已保存')
      }
    } catch (cause) {
      if (isCurrent(snapshot)) setError(cause instanceof Error ? cause.message : '预设保存失败')
    } finally {
      if (isCurrent(snapshot)) setBusy(false)
    }
  }
  async function remove() {
    if (readonly || busy || !loaded || !chosen) return
    const snapshot = scope(),
      id = chosen.id
    setBusy(true)
    setError('')
    setStatus('')
    try {
      await mutateWorkspaceState(snapshot.workspaceId, (storage) => {
        assertCurrent(snapshot)
        deleteVideoPreset(
          storage,
          snapshot.workspaceId,
          snapshot.draftId,
          id,
          policy.current.readonly
        )
      })
      if (isCurrent(snapshot)) {
        read(snapshot)
        setSelected(null)
        setStatus('预设已删除')
      }
    } catch (cause) {
      if (isCurrent(snapshot)) setError(cause instanceof Error ? cause.message : '预设删除失败')
    } finally {
      if (isCurrent(snapshot)) setBusy(false)
    }
  }
  function apply(value: VideoProperties) {
    try {
      assertCurrent(scope())
      assertProductionDraftExists(readWorkspaceState(workspaceId), workspaceId, draftId)
      if (!validVideoProperties(value) || value.kind !== policy.current.properties?.kind)
        throw new Error('属性类型与当前选择不符')
      const result = policy.current.onApply(structuredClone(value))
      setError('')
      setStatus(
        result
          ? `已应用 ${result.appliedIds.length} 项${result.skippedLockedIds.length ? `，跳过 ${result.skippedLockedIds.length} 个锁定对象` : ''}${result.unchangedIds.length ? `，${result.unchangedIds.length} 项未变化` : ''}`
          : '已应用到选中项'
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '属性应用失败')
    }
  }
  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="right-start"
      width={350}
      withinPortal
      portalProps={{ target: '.react-editor-shell' }}
      zIndex={64}
      shadow="md"
    >
      <Popover.Target>
        <Tooltip label="画面与字幕预设" position="right">
          <ActionIcon
            variant={opened ? 'light' : 'subtle'}
            aria-label="画面与字幕预设"
            aria-expanded={opened}
            disabled={!properties}
            onClick={() => setOpened(!opened)}
          >
            <IconCopy size={19} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown className="react-editor-tool-popover react-editor-rail-popover video-tool-popover">
        <Stack gap="xs">
          <Group justify="space-between">
            <Text size="sm" fw={700}>
              预设
            </Text>
            <ActionIcon
              size="sm"
              variant="subtle"
              aria-label="关闭预设"
              onClick={() => setOpened(false)}
            >
              <IconX size={16} />
            </ActionIcon>
          </Group>
          {targetLabel && (
            <Text size="xs" c="dimmed" lineClamp={1}>
              {targetLabel}
            </Text>
          )}
          <Group gap="xs" grow>
            <Button
              size="compact-xs"
              variant="subtle"
              leftSection={<IconCopy size={13} />}
              disabled={!properties}
              onClick={() => {
                if (properties) {
                  setClipboard(structuredClone(properties))
                  setStatus(`已复制${properties.kind === 'visual' ? '画面' : '字幕'}属性`)
                  setError('')
                }
              }}
            >
              复制属性
            </Button>
            <Button
              size="compact-xs"
              variant="light"
              leftSection={<IconClipboard size={13} />}
              disabled={readonly || busy || !loaded || !clipboard || clipboard.kind !== kind}
              onClick={() => {
                if (clipboard) apply(clipboard)
              }}
            >
              应用到选中
            </Button>
          </Group>
          <Group gap="xs" align="end" wrap="nowrap">
            <Select
              style={{ flex: 1, minWidth: 0 }}
              label={kind === 'caption' ? '我的字幕预设' : '我的画面预设'}
              size="xs"
              placeholder="选择预设"
              searchable
              comboboxProps={{
                withinPortal: true,
                portalProps: { target: '.react-editor-shell' },
                zIndex: 66
              }}
              value={chosen?.id ?? null}
              onChange={setSelected}
              data={presets
                .filter((preset) => preset.properties.kind === kind)
                .map((preset) => ({ value: preset.id, label: preset.name }))}
            />
            <Tooltip label="刷新预设">
              <ActionIcon
                aria-label="刷新预设"
                variant="default"
                loading={busy}
                onClick={() => void reload()}
              >
                <IconRefresh size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
          <Group grow gap="xs">
            <Button
              size="compact-xs"
              variant="light"
              disabled={readonly || busy || !loaded || !chosen}
              onClick={() => {
                if (chosen) apply(chosen.properties)
              }}
            >
              应用预设
            </Button>
            <Button
              size="compact-xs"
              variant="subtle"
              leftSection={<IconTrash size={13} />}
              disabled={readonly || busy || !loaded || !chosen}
              onClick={() => void remove()}
            >
              删除预设
            </Button>
          </Group>
          <TextInput
            label="预设名称"
            size="xs"
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            disabled={readonly || busy}
            placeholder="保存当前属性"
          />
          <Button
            size="compact-xs"
            variant="default"
            leftSection={<IconDeviceFloppy size={13} />}
            disabled={readonly || busy || !loaded || !properties}
            onClick={() => void save()}
          >
            保存为预设
          </Button>
          {status && (
            <Text size="xs" c="dimmed" role="status">
              {status}
            </Text>
          )}
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
