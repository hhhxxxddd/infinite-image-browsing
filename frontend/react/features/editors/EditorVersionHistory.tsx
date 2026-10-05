import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Tooltip
} from '@mantine/core'
import { IconHistory } from '@tabler/icons-react'
import {
  mutateWorkspaceState,
  readWorkspaceState,
  subscribeWorkspaceState
} from '../../shared/workspaceState'
import { assertProductionDraftExists } from '../../../src/features/workspaces/model/workspaceWorks'
import {
  appendEditorVersion,
  documentFromEditorVersion,
  editorVersionsKey,
  readEditorVersions,
  type EditorVersion,
  type EditorVersionKind
} from './editorVersionModel'
import './EditorVersions.css'
import EditorSnapshotPreview from './EditorSnapshotPreview'
import EditorRecoveryBackups from './EditorRecoveryBackups'
import { editorVersionGuard, restoreEditorVersion } from './editorVersionOperation'

export interface EditorVersionsProps<T> {
  workspaceId: string
  draftId: string
  kind: EditorVersionKind
  document: T
  readonly?: boolean
  disabled?: boolean
  parseDocument: (raw: string) => T
  summarize: (document: T) => string
  onRestore: (document: T) => void | Promise<void>
  onBeforeSave: () => Promise<boolean>
  onOpen?: () => void | Promise<void>
  renderPreview?: (document: T) => ReactNode
}

export default function EditorVersions<T>(props: EditorVersionsProps<T>) {
  const [opened, setOpened] = useState(false)
  const [history, setHistory] = useState<{ scope: string; entries: EditorVersion[] }>({
    scope: '',
    entries: []
  })
  const [selectedId, setSelectedId] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const latest = useRef(props)
  latest.current = props
  const live = useRef(true)
  const key = editorVersionsKey(props.workspaceId, props.draftId)
  const scopeKey = `${props.workspaceId}:${props.draftId}:${props.kind}`
  const entries = history.scope === scopeKey ? history.entries : []
  const scopeRevision = useRef({ key: scopeKey, revision: 0 })
  if (scopeRevision.current.key !== scopeKey)
    scopeRevision.current = { key: scopeKey, revision: scopeRevision.current.revision + 1 }
  function operationGuard(writable = true) {
    return editorVersionGuard(
      { ...props, revision: scopeRevision.current.revision },
      () => ({ ...latest.current, revision: scopeRevision.current.revision }),
      () => live.current,
      writable
    )
  }
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  useEffect(() => {
    if (!opened) return
    function refresh() {
      try {
        setHistory({
          scope: scopeKey,
          entries: readEditorVersions(
            readWorkspaceState(props.workspaceId).getItem(key)
          ).entries.filter((entry) => entry.kind === props.kind)
        })
        setError('')
      } catch (cause) {
        setHistory({ scope: scopeKey, entries: [] })
        setError(cause instanceof Error ? cause.message : '版本读取失败')
      }
    }
    refresh()
    return subscribeWorkspaceState(props.workspaceId, refresh)
  }, [opened, key, props.workspaceId, props.kind, scopeKey])

  async function saveVersion(title: string, guard: () => void) {
    guard()
    const current = latest.current
    if (current.readonly || current.disabled) throw new Error('当前制作文件不可修改')
    const snapshot: EditorVersion<T> = {
      id: crypto.randomUUID(),
      name: title.trim().slice(0, 80),
      createdAt: new Date().toISOString(),
      kind: current.kind,
      document: current.parseDocument(JSON.stringify(current.document))
    }
    await mutateWorkspaceState(current.workspaceId, (storage) => {
      guard()
      assertProductionDraftExists(storage, current.workspaceId, current.draftId)
      const currentKey = editorVersionsKey(current.workspaceId, current.draftId)
      storage.setItem(
        currentKey,
        JSON.stringify(
          appendEditorVersion(readEditorVersions(storage.getItem(currentKey)), snapshot)
        )
      )
    })
    return snapshot.id
  }
  async function create() {
    if (busy || props.readonly || props.disabled) return
    setBusy(true)
    setError('')
    const guard = operationGuard()
    try {
      guard()
      if (!(await latest.current.onBeforeSave())) throw new Error('请先完成当前操作并保存制作文件')
      guard()
      const id = await saveVersion(name.trim() || `版本 ${new Date().toLocaleString()}`, guard)
      guard()
      if (live.current) {
        setSelectedId(id)
        setName('')
      }
    } catch (cause) {
      if (live.current) setError(cause instanceof Error ? cause.message : '保存版本失败')
    } finally {
      if (live.current) setBusy(false)
    }
  }
  async function restore(entry: EditorVersion) {
    if (busy || props.readonly || props.disabled) return
    setBusy(true)
    setError('')
    const guard = operationGuard()
    try {
      await restoreEditorVersion({
        guard,
        read: () => documentFromEditorVersion(entry, props.kind, props.parseDocument),
        beforeSave: () => latest.current.onBeforeSave(),
        backup: () => saveVersion('恢复前的制作文件', guard),
        restore: (document) => latest.current.onRestore(document)
      })
      setOpened(false)
    } catch (cause) {
      if (live.current) setError(cause instanceof Error ? cause.message : '恢复版本失败')
    } finally {
      if (live.current) setBusy(false)
    }
  }
  const selected = entries.find((entry) => entry.id === selectedId)
  let summary = ''
  let invalid = ''
  if (selected) {
    try {
      summary = props.summarize(
        documentFromEditorVersion(selected, props.kind, props.parseDocument)
      )
    } catch (cause) {
      invalid = cause instanceof Error ? cause.message : '该版本无法恢复'
    }
  }
  return (
    <>
      <Tooltip label="制作版本">
        <ActionIcon
          variant="subtle"
          aria-label="制作版本"
          disabled={props.disabled || busy}
          onClick={() => {
            const guard = operationGuard(false)
            setBusy(true)
            void Promise.resolve()
              .then(() => {
                guard()
                return props.onOpen?.()
              })
              .then(() => {
                guard()
                setOpened(true)
              })
              .catch((cause) => {
                if (live.current)
                  setError(cause instanceof Error ? cause.message : '无法打开制作版本')
              })
              .finally(() => {
                if (live.current) setBusy(false)
              })
          }}
        >
          <IconHistory size={18} />
        </ActionIcon>
      </Tooltip>
      <Modal
        opened={opened}
        onClose={() => {
          if (!busy) setOpened(false)
        }}
        title="制作版本"
        size="xl"
        centered
        closeOnEscape={!busy}
        closeOnClickOutside={!busy}
        withCloseButton={!busy}
      >
        <Stack gap="sm">
          <Group align="end" wrap="nowrap">
            <TextInput
              label="版本名称"
              placeholder="记录当前制作进度"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.currentTarget.value)}
              disabled={busy || props.readonly}
              style={{ flex: 1 }}
            />
            <Button
              disabled={props.readonly || props.disabled}
              loading={busy}
              onClick={() => void create()}
            >
              保存版本
            </Button>
          </Group>
          <Text size="xs" c="dimmed">
            保留最近 30 个版本，容量不足时回收最早版本。恢复前会保存当前制作文件。
          </Text>
          {error && <Alert color="red">{error}</Alert>}
          <div className="editor-versions-body">
            <ScrollArea h={280} className="editor-versions-list">
              <Stack gap={4}>
                {entries.map((entry) => (
                  <button
                    type="button"
                    className={`editor-version-row ${entry.id === selectedId ? 'is-selected' : ''}`}
                    key={entry.id}
                    disabled={busy}
                    onClick={() => setSelectedId(entry.id)}
                  >
                    <Text size="sm" fw={600} truncate>
                      {entry.name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {new Date(entry.createdAt).toLocaleString()}
                    </Text>
                  </button>
                ))}
                {!entries.length && (
                  <Text size="sm" c="dimmed">
                    暂无制作版本
                  </Text>
                )}
              </Stack>
            </ScrollArea>
            <Stack gap="sm" className="editor-version-preview">
              <Text size="sm" fw={600}>
                {selected?.name ?? '选择版本查看内容'}
              </Text>
              {selected && <Text size="sm">{summary}</Text>}
              {selected && !invalid && opened && props.renderPreview
                ? props.renderPreview(
                    documentFromEditorVersion(selected, props.kind, props.parseDocument)
                  )
                : selected &&
                  !invalid &&
                  opened &&
                  (props.kind === 'audio' || props.kind === 'video') && (
                    <EditorSnapshotPreview
                      key={selected.id}
                      kind={props.kind}
                      document={selected.document}
                      workspaceId={props.workspaceId}
                    />
                  )}
              {invalid && <Alert color="red">{invalid}</Alert>}
              <Button
                disabled={!selected || !!invalid || busy || props.readonly || props.disabled}
                onClick={() => selected && void restore(selected)}
              >
                恢复此版本
              </Button>
            </Stack>
          </div>
          {opened && (
            <EditorRecoveryBackups workspaceId={props.workspaceId} draftId={props.draftId} />
          )}
        </Stack>
      </Modal>
    </>
  )
}
