import { useEffect, useRef, useState } from 'react'
import { Group, Loader, Select, Stack, Text } from '@mantine/core'
import { apiFetch } from '../../shared/apiClient'
import { sourceMetadata, sourceMetadataPath, type SourceMetadata } from './sourceRange'
import { sourceAudioStreamError, sourceAudioStreamLabel } from './sourceAudioStreams'

export interface AudioSourceStreamSelectProps {
  workspaceId: string
  path: string
  kind: 'audio' | 'video'
  value?: number
  sourceIn: number
  duration: number
  rate?: number
  freeze?: boolean
  readonly?: boolean
  onChange: (ordinal: number, sourceDuration: number) => void
}
export default function AudioSourceStreamSelect(props: AudioSourceStreamSelectProps) {
  const {
    workspaceId,
    path,
    kind,
    value = 0,
    sourceIn,
    duration,
    rate = 1,
    freeze,
    readonly = false
  } = props
  const [loaded, setLoaded] = useState<{ key: string; metadata: SourceMetadata } | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const key = `${workspaceId}:${path}:${kind}`
  const selectionKey = (value: AudioSourceStreamSelectProps) =>
    JSON.stringify([
      value.workspaceId,
      value.path,
      value.kind,
      value.value ?? 0,
      value.sourceIn,
      value.duration,
      value.rate ?? 1,
      !!value.freeze
    ])
  const policy = useRef(props),
    live = useRef(true)
  policy.current = props
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    void apiFetch<unknown>(sourceMetadataPath(workspaceId, { path, name: '', kind }), {
      signal: controller.signal
    })
      .then((raw) => {
        if (!controller.signal.aborted) setLoaded({ key, metadata: sourceMetadata(raw, kind) })
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : '无法读取声音流')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [key])
  const metadata = loaded?.key === key ? loaded.metadata : undefined
  const failure = metadata
    ? sourceAudioStreamError(
        metadata.audioStreams,
        value,
        sourceIn,
        freeze ? 1e-6 : duration,
        freeze ? 1 : rate
      )
    : ''
  async function select(ordinal: number) {
    if (readonly || saving || ordinal === value) return
    const original = selectionKey(policy.current)
    setSaving(true)
    setError('')
    try {
      const metadata = sourceMetadata(
        await apiFetch<unknown>(sourceMetadataPath(workspaceId, { path, name: '', kind })),
        kind
      )
      if (!live.current || selectionKey(policy.current) !== original || policy.current.readonly)
        return
      const reason = sourceAudioStreamError(
        metadata.audioStreams,
        ordinal,
        sourceIn,
        freeze ? 1e-6 : duration,
        freeze ? 1 : rate
      )
      if (reason) throw new Error(reason)
      const stream = metadata.audioStreams?.find((item) => item.ordinal === ordinal)
      if (!stream) throw new Error('声音流信息未知，请重新读取素材')
      setLoaded({ key, metadata })
      policy.current.onChange(ordinal, stream.duration)
    } catch (cause) {
      if (live.current) setError(cause instanceof Error ? cause.message : '切换声音流失败')
    } finally {
      if (live.current) setSaving(false)
    }
  }
  return (
    <Stack gap={4}>
      <Select
        size="xs"
        label="素材声音流"
        value={String(value)}
        allowDeselect={false}
        data={(metadata?.audioStreams ?? []).map((stream) => ({
          value: String(stream.ordinal),
          label: sourceAudioStreamLabel(stream)
        }))}
        disabled={readonly || loading || saving || !metadata?.audioStreams?.length}
        onChange={(selected) => {
          if (selected !== null) void select(Number(selected))
        }}
      />
      {(loading || saving) && (
        <Group gap={4}>
          <Loader size={10} />
          <Text size="xs" c="dimmed">
            {saving ? '验证源区间…' : '读取声音流…'}
          </Text>
        </Group>
      )}
      {(error || failure) && (
        <Text size="xs" c="red" role="alert">
          {error || failure}
        </Text>
      )}
    </Stack>
  )
}
