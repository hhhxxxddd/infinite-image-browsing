import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Alert, Button, Group, Loader, ScrollArea, Stack, Text } from '@mantine/core'
import { IconDownload, IconRefresh, IconRestore } from '@tabler/icons-react'
import {
  ensureWorkspaceState,
  mutateWorkspaceState,
  readWorkspaceState,
  reloadWorkspaceState,
  subscribeWorkspaceState
} from '../../shared/workspaceState'
import { assertProductionDraftExists } from '../../../src/features/workspaces/model/workspaceWorks'
import {
  documentFromEditorVersion,
  editorVersionsKey,
  readEditorVersions,
  type EditorVersion,
  type EditorVersionKind
} from './editorVersionModel'
import {
  editorTimelineStorageKey,
  parseRecoveryDocument,
  recoverEditorDocument,
  type EditorRecoveryRequest
} from './editorRecovery'
import EditorSnapshotPreview from './EditorSnapshotPreview'
import EditorRecoveryBackups, { downloadEditorRaw } from './EditorRecoveryBackups'
import './EditorRecoveryPanel.css'

export interface EditorRecoveryPanelProps {
  workspaceId: string
  draftId: string
  kind: Extract<EditorVersionKind, 'audio' | 'video'>
  name: string
  raw: string
  loadError: string
  readonly?: boolean
  backAction?: ReactNode
  helpAction?: ReactNode
  /** Remount the editor or reload the page; do not reuse its failed initial state/save queue. */
  onRecovered: () => void
}

export default function EditorRecoveryPanel(props: EditorRecoveryPanelProps) {
  return <RecoverySession key={`${props.workspaceId}:${props.draftId}:${props.kind}`} {...props} />
}
function RecoverySession(props: EditorRecoveryPanelProps) {
  const [versions, setVersions] = useState<EditorVersion[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [healthy, setHealthy] = useState(false)
  const [error, setError] = useState('')
  const policy = useRef(props)
  policy.current = props
  const live = useRef(true)
  const pending = useRef<EditorRecoveryRequest | null>(null)
  const operation = useRef(false)
  const scope = {
    workspaceId: props.workspaceId,
    draftId: props.draftId,
    kind: props.kind,
    raw: props.raw
  }
  const isCurrent = () =>
    live.current &&
    policy.current.workspaceId === scope.workspaceId &&
    policy.current.draftId === scope.draftId &&
    policy.current.kind === scope.kind &&
    policy.current.raw === scope.raw
  function read() {
    if (!isCurrent()) return
    const storage = readWorkspaceState(props.workspaceId)
    assertProductionDraftExists(storage, props.workspaceId, props.draftId)
    const entries = readEditorVersions(
      storage.getItem(editorVersionsKey(props.workspaceId, props.draftId))
    ).entries.filter((entry) => entry.kind === props.kind)
    setVersions(entries)
    setSelectedId((current) =>
      entries.some((entry) => entry.id === current) ? current : (entries[0]?.id ?? '')
    )
    const current = storage.getItem(
      editorTimelineStorageKey(props.workspaceId, props.draftId, props.kind)
    )
    let valid = false
    if (current !== null) {
      try {
        parseRecoveryDocument(props.kind, current)
        valid = true
      } catch {
        /* Keep recovery available. */
      }
    }
    setHealthy(valid)
    setLoaded(true)
  }
  useEffect(() => {
    live.current = true
    const refresh = () => {
      if (!live.current) return
      try {
        read()
      } catch (cause) {
        setLoaded(false)
        setError(cause instanceof Error ? cause.message : '历史版本读取失败')
      }
    }
    // Viewing recovery, including in a read-only editor, must not migrate browser state.
    void ensureWorkspaceState(props.workspaceId, true)
      .then(refresh)
      .catch((cause) => {
        if (live.current) setError(cause instanceof Error ? cause.message : '历史版本读取失败')
      })
    const unsubscribe = subscribeWorkspaceState(props.workspaceId, refresh)
    return () => {
      live.current = false
      unsubscribe()
    }
  }, [props.workspaceId, props.draftId, props.kind])
  async function refresh() {
    if (operation.current) return
    operation.current = true
    setRefreshing(true)
    setError('')
    try {
      await reloadWorkspaceState(props.workspaceId, true)
      read()
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : '刷新失败')
    } finally {
      operation.current = false
      if (isCurrent()) setRefreshing(false)
    }
  }
  async function restore() {
    if (operation.current || props.readonly || !loaded || !selectedId || healthy) return
    operation.current = true
    setBusy(true)
    setError('')
    const request =
      pending.current?.versionId === selectedId
        ? pending.current
        : {
            workspaceId: props.workspaceId,
            draftId: props.draftId,
            kind: props.kind,
            name: props.name,
            expectedRaw: props.raw,
            versionId: selectedId,
            backupId: crypto.randomUUID(),
            createdAt: new Date().toISOString()
          }
    pending.current = request
    try {
      await mutateWorkspaceState(props.workspaceId, (storage) =>
        recoverEditorDocument(storage, {
          ...request,
          readonly: policy.current.readonly,
          isCurrent: () => isCurrent() && !policy.current.readonly
        })
      )
      if (isCurrent()) {
        setHealthy(true)
        policy.current.onRecovered()
      }
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : '恢复失败，原始数据未覆盖')
    } finally {
      operation.current = false
      if (isCurrent()) setBusy(false)
    }
  }
  const selected = versions.find((entry) => entry.id === selectedId)
  let invalid = ''
  if (selected) {
    try {
      documentFromEditorVersion(selected, props.kind, (raw) =>
        parseRecoveryDocument(props.kind, raw)
      )
    } catch (cause) {
      invalid = cause instanceof Error ? cause.message : '此版本无法读取'
    }
  }
  return (
    <div className="react-editor-panel editor-recovery-panel">
      <Group className="editor-recovery-command" gap="xs">
        {props.backAction}
        <Text size="sm" fw={600} truncate>
          {props.name}
        </Text>
        {props.helpAction}
      </Group>
      <div className="editor-recovery-body">
        <Stack gap="md">
          <Alert color="red" title="制作文件无法读取">
            {props.loadError}。原始数据已保留。
          </Alert>
          <Group gap="xs">
            <Button
              variant="default"
              leftSection={<IconDownload size={15} />}
              onClick={() => downloadEditorRaw(props.raw, props.name)}
            >
              下载原始副本
            </Button>
            <Button
              variant="subtle"
              loading={refreshing}
              disabled={busy}
              leftSection={<IconRefresh size={15} />}
              onClick={() => void refresh()}
            >
              刷新版本
            </Button>
          </Group>
          {error && <Alert color="red">{error}</Alert>}
          {healthy && (
            <Alert color="teal" title="当前制作文件已可读取">
              <Button
                size="xs"
                variant="light"
                mt="xs"
                onClick={() => policy.current.onRecovered()}
              >
                重新加载编辑器
              </Button>
            </Alert>
          )}
          {!loaded && !error && <Loader size="sm" />}
          <Text size="sm">
            选择可用版本预览并恢复。恢复时会完整保留损坏副本，可在“制作版本”中下载。
          </Text>
          <div className="editor-recovery-versions">
            <ScrollArea h={320}>
              <Stack gap={4}>
                {versions.map((entry) => (
                  <Button
                    key={entry.id}
                    variant={entry.id === selectedId ? 'light' : 'subtle'}
                    justify="start"
                    disabled={busy}
                    onClick={() => setSelectedId(entry.id)}
                    className="editor-recovery-version"
                  >
                    <div>
                      <Text size="sm" truncate>
                        {entry.name}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {new Date(entry.createdAt).toLocaleString()}
                      </Text>
                    </div>
                  </Button>
                ))}
                {loaded && !versions.length && (
                  <Text size="sm" c="dimmed">
                    没有已保存的历史版本。请先下载原始副本，现有数据不会被覆盖。
                  </Text>
                )}
              </Stack>
            </ScrollArea>
            <Stack gap="sm" className="editor-recovery-preview">
              {selected && !invalid && (
                <EditorSnapshotPreview
                  key={selected.id}
                  kind={props.kind}
                  document={selected.document}
                  workspaceId={props.workspaceId}
                />
              )}
              {invalid && <Alert color="red">{invalid}</Alert>}
              <Button
                leftSection={<IconRestore size={15} />}
                loading={busy}
                disabled={
                  props.readonly || !loaded || !selected || !!invalid || healthy || refreshing
                }
                onClick={() => void restore()}
              >
                {props.readonly ? '只读 · 可预览历史版本' : '保留损坏副本并恢复此版本'}
              </Button>
            </Stack>
          </div>
          {loaded && (
            <EditorRecoveryBackups workspaceId={props.workspaceId} draftId={props.draftId} />
          )}
        </Stack>
      </div>
    </div>
  )
}
