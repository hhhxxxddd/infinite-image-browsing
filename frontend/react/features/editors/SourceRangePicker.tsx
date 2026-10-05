import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Group,
  Loader,
  Modal,
  RangeSlider,
  SegmentedControl,
  Select,
  Slider,
  Stack,
  Text
} from '@mantine/core'
import { IconMusic, IconPlayerPause, IconPlayerPlay } from '@tabler/icons-react'
import { apiFetch, apiUrl } from '../../shared/apiClient'
import type { WorkspaceAsset } from '../../../src/features/workspaces/model/workspaceModel'
import { TimelineTimeInput } from './TimelineTimeControls'
import { formatTimelineTime } from './timelineTime'
import {
  initialSourceRangeForMode,
  setSourceRangeEndpoint,
  sourceMetadata,
  sourceMetadataPath,
  sourceModeError,
  sourceRangeError,
  sourceRangeSelection,
  sourceStreamPath,
  type SourceAddMode,
  type SourcePlacementMode,
  type SourceMetadata,
  type SourceRange,
  type SourceRangeSelection
} from './sourceRange'
import './SourceRangePicker.css'
import { createSourceCommitGate } from './sourceCommitGate'
import { useContinuousAudioPreview } from './useContinuousAudioPreview'
import { sourceAudioPreviewDocument } from './sourceAudioPreview'
import { sourceAudioStreamError, sourceAudioStreamLabel } from './sourceAudioStreams'

export interface SourceRangePickerProps {
  opened: boolean
  onClose: () => void
  workspaceId: string
  asset: WorkspaceAsset | null
  readonly?: boolean
  maxDuration?: number
  modes?: SourceAddMode[]
  initialMode?: SourceAddMode
  placementMode?: SourcePlacementMode
  onConfirm: (selection: SourceRangeSelection) => void | Promise<void>
}

export default function SourceRangePicker(props: SourceRangePickerProps) {
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
      title={props.asset?.kind === 'image' ? '添加图片' : '选段添加'}
      size="lg"
      centered
      className="source-range-modal"
    >
      {props.opened &&
        props.asset &&
        (props.asset.kind === 'image' ? (
          <ImageSourceContent
            key={`${props.workspaceId}:${props.asset.path}`}
            {...props}
            asset={props.asset}
            committing={committing}
            onClose={close}
            onConfirm={(selection) => gate.run(() => props.onConfirm(selection), setCommitting)}
          />
        ) : (
          <SourceRangeContent
            key={`${props.workspaceId}:${props.asset.path}`}
            {...props}
            asset={props.asset}
            committing={committing}
            onClose={close}
            onConfirm={(selection) => gate.run(() => props.onConfirm(selection), setCommitting)}
          />
        ))}
    </Modal>
  )
}

function SourcePlacementControl({
  value,
  onChange,
  disabled
}: {
  value: SourcePlacementMode
  onChange: (value: SourcePlacementMode) => void
  disabled: boolean
}) {
  return (
    <Stack gap={4}>
      <Text size="xs">时间安排</Text>
      <SegmentedControl
        aria-label="时间安排"
        disabled={disabled}
        value={value}
        onChange={(next) => onChange(next as SourcePlacementMode)}
        data={[
          { value: 'overlay', label: '叠加' },
          { value: 'insert', label: '插入' },
          { value: 'overwrite', label: '覆盖' }
        ]}
      />
    </Stack>
  )
}

function ImageSourceContent({
  asset,
  readonly = false,
  maxDuration = 21600,
  placementMode,
  onConfirm,
  onClose,
  committing
}: SourceRangePickerProps & { asset: WorkspaceAsset; committing: boolean }) {
  const [placement, setPlacement] = useState<SourcePlacementMode>(placementMode ?? 'overlay')
  const [error, setError] = useState('')
  const duration = Math.max(0, Math.min(5, maxDuration))
  const id = asset.path.startsWith('workspace-artifact:') ? asset.path.slice(19) : ''
  const url = id
    ? `/workspace_artifacts/${encodeURIComponent(id)}/file`
    : `/file?path=${encodeURIComponent(asset.path)}`
  async function confirm() {
    if (readonly || committing || duration < 0.001) return
    try {
      setError('')
      await onConfirm({
        asset,
        sourceIn: 0,
        duration,
        sourceDuration: 5,
        mode: 'visual',
        ...(placementMode !== undefined ? { placementMode: placement } : {})
      })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '添加失败')
    }
  }
  return (
    <Stack gap="sm">
      <Text size="sm" lineClamp={1} title={asset.name}>
        {asset.name}
      </Text>
      <div className="source-range-preview">
        <img src={apiUrl(url)} alt={asset.name} />
      </div>
      <Text size="xs">时长 · {formatTimelineTime(duration)}</Text>
      {placementMode !== undefined && (
        <SourcePlacementControl value={placement} onChange={setPlacement} disabled={committing} />
      )}
      {error && (
        <Text size="xs" c="red" role="alert">
          {error}
        </Text>
      )}
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose} disabled={committing}>
          取消
        </Button>
        <Button
          onClick={() => void confirm()}
          loading={committing}
          disabled={readonly || duration < 0.001}
        >
          添加图片
        </Button>
      </Group>
    </Stack>
  )
}

function SourceRangeContent({
  workspaceId,
  asset,
  readonly = false,
  maxDuration = 21600,
  modes,
  initialMode,
  placementMode,
  onConfirm,
  onClose,
  committing
}: SourceRangePickerProps & { asset: WorkspaceAsset; committing: boolean }) {
  const [metadata, setMetadata] = useState<SourceMetadata | null>(null)
  const [range, setRange] = useState<SourceRange>({ start: 0, end: 0 })
  const [playhead, setPlayhead] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [retry, setRetry] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [mediaReady, setMediaReady] = useState(false)
  const availableModes = (modes ??
    (asset.kind === 'audio' ? ['sound'] : ['default', 'visual', 'sound'])) as SourceAddMode[]
  const [mode, setMode] = useState<SourceAddMode>(() =>
    initialMode && availableModes.includes(initialMode)
      ? initialMode
      : (availableModes[0] ?? 'default')
  )
  const [audioStream, setAudioStream] = useState(0)
  const [placement, setPlacement] = useState<SourcePlacementMode>(placementMode ?? 'overlay')
  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const live = useRef(true)
  const policy = useRef({ readonly, asset, mode, range, audioStream, placement })
  policy.current = { readonly, asset, mode, range, audioStream, placement }
  const selectionRef = useRef(range)
  selectionRef.current = range
  const frame = useRef(0)
  const playingSelection = useRef(false)
  const playEpoch = useRef(0)
  const usingAudio = useRef(false)
  const audioPreview = useContinuousAudioPreview({
    workspaceId,
    onTime: (time) => {
      if (!live.current || !usingAudio.current) return
      setPlayhead(time)
      const video = mediaRef.current
      if (video && mediaReady && mode !== 'sound' && !audioPreview.buffering) {
        if (Math.abs(video.currentTime - time) > 0.12) video.currentTime = time
        if (video.paused && time < selectionRef.current.end)
          void video.play().catch(() => {
            if (live.current) setPreviewError('画面无法播放，声音仍按所选流试听')
          })
      }
    },
    onEnded: () => {
      if (live.current) pause()
    },
    onError: (cause) => {
      if (live.current) {
        pause()
        setPreviewError(cause instanceof Error ? cause.message : '所选声音流试听失败')
      }
    }
  })
  const withAudio = mode !== 'visual' && !!metadata?.hasAudio
  const duration = metadata?.duration ?? 0
  const step = metadata && metadata.fps > 0 ? 1 / metadata.fps : 0.001
  const failure = metadata
    ? sourceRangeError(range, duration, maxDuration) ||
      sourceModeError(asset, metadata, mode) ||
      (withAudio
        ? sourceAudioStreamError(
            metadata.audioStreams,
            audioStream,
            range.start,
            range.end - range.start
          )
        : '')
    : ''
  useEffect(() => {
    if (usingAudio.current && audioPreview.buffering) mediaRef.current?.pause()
  }, [audioPreview.buffering])

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      cancelAnimationFrame(frame.current)
      mediaRef.current?.pause()
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    pause()
    setLoading(true)
    setError('')
    setMetadata(null)
    if (asset.kind === 'image') {
      setLoading(false)
      setError('图片无需选段')
      return
    }
    void apiFetch<unknown>(sourceMetadataPath(workspaceId, asset), { signal: controller.signal })
      .then((raw) => {
        if (controller.signal.aborted) return
        const info = sourceMetadata(raw, asset.kind)
        setMetadata(info)
        const nextMode =
          asset.kind === 'video' && !info.hasAudio && availableModes.includes('visual')
            ? 'visual'
            : policy.current.mode
        setMode(nextMode)
        setRange(initialSourceRangeForMode(info, nextMode, maxDuration, policy.current.audioStream))
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : '无法读取素材信息')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [workspaceId, asset.path, asset.kind, retry, maxDuration])

  function pause() {
    playEpoch.current++
    playingSelection.current = false
    usingAudio.current = false
    audioPreview.stop()
    cancelAnimationFrame(frame.current)
    mediaRef.current?.pause()
    setPlaying(false)
  }
  function seek(time: number) {
    pause()
    const next = Math.max(0, Math.min(duration, time))
    if (mediaRef.current && mediaRef.current.readyState >= 1) mediaRef.current.currentTime = next
    setPlayhead(next)
  }
  function updateRange(next: SourceRange) {
    pause()
    setRange(next)
  }
  function endpoint(edge: 'start' | 'end', time: number) {
    const next = setSourceRangeEndpoint(range, edge, time, duration)
    if (!next) {
      setError('入点需早于出点')
      return false
    }
    setError('')
    updateRange(next)
  }
  function trackPlayback() {
    const media = mediaRef.current
    if (!media || !playingSelection.current) return
    const end = selectionRef.current.end
    if (media.currentTime >= end) {
      pause()
      media.currentTime = end
      setPlayhead(end)
      return
    }
    setPlayhead(media.currentTime)
    frame.current = requestAnimationFrame(trackPlayback)
  }
  async function playSelection() {
    const media = mediaRef.current
    if (playing) {
      pause()
      return
    }
    if (!metadata || failure || (!withAudio && (!media || media.readyState < 1))) return
    pause()
    if (media && media.readyState >= 1) media.currentTime = range.start
    setPlayhead(range.start)
    playingSelection.current = true
    setPlaying(true)
    setPreviewError('')
    const epoch = playEpoch.current
    try {
      if (withAudio) {
        usingAudio.current = true
        await audioPreview.play({
          document: sourceAudioPreviewDocument(asset, metadata, range, audioStream),
          start: range.start,
          end: range.end
        })
      } else if (media) await media.play()
      if (!live.current || epoch !== playEpoch.current || !playingSelection.current) return
      if (!withAudio) frame.current = requestAnimationFrame(trackPlayback)
    } catch (cause) {
      if (live.current && epoch === playEpoch.current) {
        pause()
        setPreviewError(cause instanceof Error ? cause.message : '原片无法播放')
      }
    }
  }
  async function confirm() {
    if (readonly || !metadata || loading || saving) return
    try {
      setSaving(true)
      setError('')
      pause()
      const fresh = sourceMetadata(
        await apiFetch<unknown>(sourceMetadataPath(workspaceId, asset)),
        asset.kind
      )
      if (!live.current || policy.current.readonly || policy.current.asset.path !== asset.path)
        return
      if (
        policy.current.range.start !== range.start ||
        policy.current.range.end !== range.end ||
        policy.current.mode !== mode ||
        policy.current.audioStream !== audioStream ||
        policy.current.placement !== placement
      )
        throw new Error('选段已变化，请重新确认')
      setMetadata(fresh)
      await onConfirm({
        ...sourceRangeSelection(asset, fresh, range, mode, maxDuration, audioStream),
        ...(placementMode !== undefined ? { placementMode: placement } : {})
      })
      if (live.current) onClose()
    } catch (cause) {
      if (live.current) setError(cause instanceof Error ? cause.message : '添加失败')
    } finally {
      if (live.current) setSaving(false)
    }
  }
  const mediaEvents = {
    onLoadedMetadata: () => {
      setMediaReady(true)
      setPreviewError('')
      if (mediaRef.current) mediaRef.current.currentTime = playhead
    },
    onError: () => {
      setMediaReady(false)
      if (!usingAudio.current) pause()
      setPreviewError('原片无法在浏览器播放；仍可按源时间选段')
    },
    onEnded: () => {
      if (!usingAudio.current) pause()
    },
    onTimeUpdate: () => {
      if (usingAudio.current) return
      const media = mediaRef.current
      if (!media) return
      if (playingSelection.current && media.currentTime >= range.end) {
        pause()
        media.currentTime = range.end
      }
      setPlayhead(media.currentTime)
    }
  }
  return (
    <Stack
      className="source-range-content"
      gap="sm"
      onKeyDown={(event) => {
        if (saving) return
        const target = event.target as HTMLElement
        if (
          event.ctrlKey ||
          event.metaKey ||
          event.altKey ||
          target.closest('input,textarea,select,[contenteditable=true],[role=slider]')
        )
          return
        if (event.key.toLowerCase() === 'i' || event.key.toLowerCase() === 'o') {
          event.preventDefault()
          event.stopPropagation()
          if (metadata) endpoint(event.key.toLowerCase() === 'i' ? 'start' : 'end', playhead)
        } else if (event.code === 'Space' && !target.closest('button')) {
          event.preventDefault()
          event.stopPropagation()
          void playSelection()
        }
      }}
    >
      <Text size="sm" lineClamp={1} title={asset.name}>
        {asset.name}
      </Text>
      <div
        className={`source-range-preview ${mode === 'sound' ? 'is-sound' : ''}`}
        tabIndex={0}
        aria-label="素材预览，空格播放选段，I 设置入点，O 设置出点"
      >
        {asset.kind === 'video' ? (
          <video
            ref={(node) => {
              mediaRef.current = node
            }}
            src={apiUrl(sourceStreamPath(asset))}
            preload="metadata"
            playsInline
            muted
            {...mediaEvents}
          />
        ) : (
          <>
            <IconMusic size={60} stroke={1.1} />
          </>
        )}
        {loading && <Loader size="sm" className="source-range-loading" />}
      </div>
      {previewError && (
        <Text size="xs" c="dimmed">
          {previewError}
        </Text>
      )}
      {metadata && (
        <>
          <Group justify="space-between" gap="xs">
            <Button
              size="xs"
              variant="light"
              leftSection={playing ? <IconPlayerPause size={15} /> : <IconPlayerPlay size={15} />}
              onClick={() => void playSelection()}
              disabled={(!withAudio && !mediaReady) || !!failure}
            >
              {playing ? (audioPreview.buffering ? '准备试听…' : '暂停') : '播放选段'}
            </Button>
            <Text size="xs" c="dimmed">
              {formatTimelineTime(playhead)} / {formatTimelineTime(duration)}
            </Text>
          </Group>
          <Slider
            aria-label="素材播放位置"
            value={playhead}
            min={0}
            max={duration}
            step={step}
            onChange={seek}
            label={formatTimelineTime}
          />
          <div className="source-range-selection">
            <Text size="xs" c="dimmed">
              选段 · {formatTimelineTime(Math.max(0, range.end - range.start))}
            </Text>
            <RangeSlider
              value={[range.start, range.end]}
              disabled={saving}
              min={0}
              max={duration}
              step={step}
              minRange={0.001}
              label={formatTimelineTime}
              thumbFromLabel="素材入点"
              thumbToLabel="素材出点"
              onChange={([start, end]) => updateRange({ start, end })}
            />
          </div>
          <Group gap="sm" className="source-range-times">
            <TimelineTimeInput
              label="源位置"
              value={playhead}
              onChange={seek}
              max={duration}
              step={step}
            />
            <TimelineTimeInput
              label="入点"
              disabled={saving}
              value={range.start}
              onChange={(value) => endpoint('start', value)}
              max={duration}
              step={step}
            />
            <TimelineTimeInput
              label="出点"
              disabled={saving}
              value={range.end}
              onChange={(value) => endpoint('end', value)}
              max={duration}
              step={step}
            />
            <Button
              size="compact-xs"
              variant="default"
              onClick={() => endpoint('start', playhead)}
              disabled={saving || playhead >= duration}
            >
              I
            </Button>
            <Button
              size="compact-xs"
              variant="default"
              onClick={() => endpoint('end', playhead)}
              disabled={saving || playhead <= 0}
            >
              O
            </Button>
          </Group>
          {asset.kind === 'video' && availableModes.length > 1 && (
            <SegmentedControl
              aria-label="添加内容"
              disabled={saving}
              value={mode}
              onChange={(value) => {
                pause()
                setMode(value as SourceAddMode)
              }}
              data={availableModes.map((value) => ({
                value,
                label: {
                  default: metadata.hasAudio ? '音画' : '画面',
                  visual: '只画面',
                  sound: '只声音'
                }[value],
                disabled: value === 'sound' && !metadata.hasAudio
              }))}
            />
          )}
          {withAudio && (
            <Select
              size="xs"
              label="素材声音流"
              value={String(audioStream)}
              allowDeselect={false}
              disabled={saving}
              data={(metadata.audioStreams ?? []).map((stream) => ({
                value: String(stream.ordinal),
                label: sourceAudioStreamLabel(stream)
              }))}
              onChange={(value) => {
                if (value !== null) {
                  pause()
                  setAudioStream(Number(value))
                  setPreviewError('')
                }
              }}
            />
          )}
          {placementMode !== undefined && (
            <SourcePlacementControl value={placement} onChange={setPlacement} disabled={saving} />
          )}
          {failure && (
            <Text size="xs" c="red" role="alert">
              {failure}
            </Text>
          )}
        </>
      )}
      {error && (
        <Group gap="xs">
          <Text size="sm" c="red" role="alert">
            {error}
          </Text>
          {!metadata && (
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => setRetry((value) => value + 1)}
            >
              重试
            </Button>
          )}
        </Group>
      )}
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose} disabled={committing}>
          取消
        </Button>
        <Button
          onClick={() => void confirm()}
          loading={saving}
          disabled={readonly || loading || !metadata || !!failure}
        >
          {readonly ? '只读' : '选段添加'}
        </Button>
      </Group>
    </Stack>
  )
}
