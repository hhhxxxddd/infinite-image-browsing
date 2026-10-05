import { useEffect, useRef, useState } from 'react'
import { Button, Group, Loader, Modal, Select, Stack, Text } from '@mantine/core'
import { apiFetch } from '../../shared/apiClient'
import type { WorkspaceAsset } from '../../../src/features/workspaces/model/workspaceModel'
import { formatTimelineTime } from './timelineTime'
import { sourceMetadata, sourceMetadataPath, type SourceMetadata } from './sourceRange'
import {
  sourceRelinkCompatible,
  sourceRelinkError,
  sourceRelinkSelection,
  type SourceRelinkSelection,
  type SourceRelinkSource
} from './sourceRelink'
import './SourceRelinkDialog.css'
import { createSourceCommitGate } from './sourceCommitGate'

export interface SourceRelinkDialogProps {
  opened: boolean
  onClose: () => void
  workspaceId: string
  sources: SourceRelinkSource[]
  assets: WorkspaceAsset[]
  readonly?: boolean
  onConfirm: (selection: SourceRelinkSelection) => void | Promise<void>
}

export default function SourceRelinkDialog(props: SourceRelinkDialogProps) {
  const [gate] = useState(createSourceCommitGate)
  const [committing, setCommitting] = useState(false)
  const close = () => {
    gate.requestClose(props.onClose)
  }
  return (
    <Modal
      opened={props.opened}
      onClose={close}
      closeButtonProps={{ disabled: committing }}
      closeOnEscape={!committing}
      closeOnClickOutside={!committing}
      title="重新指定素材"
      size="md"
      centered
      className="source-relink-modal"
    >
      {props.opened && (
        <SourceRelinkContent
          key={props.workspaceId}
          {...props}
          committing={committing}
          onClose={close}
          onConfirm={(selection) => gate.run(() => props.onConfirm(selection), setCommitting)}
        />
      )}
    </Modal>
  )
}

function SourceRelinkContent({
  workspaceId,
  sources,
  assets,
  readonly = false,
  onConfirm,
  onClose,
  committing
}: SourceRelinkDialogProps & { committing: boolean }) {
  const [sourcePath, setSourcePath] = useState<string | null>(sources[0]?.path ?? null)
  const [replacementPath, setReplacementPath] = useState<string | null>(null)
  const [metadata, setMetadata] = useState<{ path: string; value: SourceMetadata } | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const source = sources.find((item) => item.path === sourcePath)
  const candidates = source
    ? [
        ...new Map(
          assets
            .filter((asset) => sourceRelinkCompatible(source, asset))
            .map((asset) => [asset.path, asset])
        ).values()
      ]
    : []
  const replacement = candidates.find((asset) => asset.path === replacementPath)
  const current = metadata?.path === replacement?.path ? metadata?.value : undefined
  const failure =
    source && replacement && current ? sourceRelinkError(source, replacement, current) : ''
  const live = useRef(true)
  const policy = useRef({ readonly, source, replacement })
  policy.current = { readonly, source, replacement }
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    setMetadata(null)
    setError('')
    if (!replacement) {
      setLoading(false)
      return
    }
    setLoading(true)
    void apiFetch<unknown>(sourceMetadataPath(workspaceId, replacement), {
      signal: controller.signal
    })
      .then((raw) => {
        if (!controller.signal.aborted)
          setMetadata({ path: replacement.path, value: sourceMetadata(raw, replacement.kind) })
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : '无法读取替换素材')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [workspaceId, replacement?.path, replacement?.kind, retry])

  async function confirm() {
    if (readonly || !source || !replacement || !current || failure || saving) return
    try {
      setSaving(true)
      setError('')
      // Recheck disk metadata at confirmation; a file can be replaced while the dialog is open.
      const fresh = sourceMetadata(
        await apiFetch<unknown>(sourceMetadataPath(workspaceId, replacement)),
        replacement.kind
      )
      if (
        !live.current ||
        policy.current.readonly ||
        policy.current.source?.path !== source.path ||
        policy.current.replacement?.path !== replacement.path
      )
        return
      setMetadata({ path: replacement.path, value: fresh })
      const latest = policy.current.source
      await onConfirm(sourceRelinkSelection(latest, replacement, fresh))
      if (live.current) onClose()
    } catch (cause) {
      if (live.current) setError(cause instanceof Error ? cause.message : '重新指定失败')
    } finally {
      if (live.current) setSaving(false)
    }
  }
  return (
    <Stack gap="sm">
      <Select
        label="待替换素材"
        searchable
        allowDeselect={false}
        value={sourcePath}
        data={sources.map((item) => ({ value: item.path, label: item.name }))}
        disabled={saving}
        onChange={(path) => {
          setSourcePath(path)
          setReplacementPath(null)
          setMetadata(null)
          setError('')
        }}
        placeholder="没有待替换素材"
      />
      {source && (
        <div className="source-relink-original">
          <Text size="xs" c="dimmed">
            {source.path}
          </Text>
          <Text size="xs">{source.clips.length} 个片段</Text>
        </div>
      )}
      <Select
        label="替换为"
        searchable
        clearable
        value={replacementPath}
        data={candidates.map((asset) => ({ value: asset.path, label: asset.name }))}
        disabled={readonly || saving || !source}
        onChange={setReplacementPath}
        placeholder="选择工作区素材"
        nothingFoundMessage="没有兼容素材，请先添加到素材条"
      />
      {replacement && (
        <Text className="source-relink-path" size="xs" c="dimmed">
          {replacement.path}
        </Text>
      )}
      {loading && (
        <Group gap="xs">
          <Loader size="xs" />
          <Text size="sm">正在读取素材…</Text>
        </Group>
      )}
      {current && (
        <Text size="sm">
          {replacement?.kind === 'image'
            ? `${current.width} × ${current.height}`
            : `素材时长 ${formatTimelineTime(current.duration)}`}
        </Text>
      )}
      {(failure || error) && (
        <Text c="red" size="sm" role="alert">
          {error || failure}
        </Text>
      )}
      {replacement && error && !saving && (
        <Button variant="subtle" size="compact-xs" onClick={() => setRetry((value) => value + 1)}>
          重新检查
        </Button>
      )}
      <Text size="xs" c="dimmed">
        保留片段位置、剪辑范围与效果。
      </Text>
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose} disabled={committing}>
          取消
        </Button>
        <Button
          onClick={() => void confirm()}
          loading={saving}
          disabled={readonly || loading || !source || !replacement || !current || !!failure}
        >
          {readonly ? '只读' : '重新指定素材'}
        </Button>
      </Group>
    </Stack>
  )
}
