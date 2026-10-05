import { useEffect, useRef, useState } from 'react'
import { Button, Group, Select, Stack, Text } from '@mantine/core'
import { apiFetch } from '../../shared/apiClient'
import { mutateWorkspaceState, readWorkspaceState } from '../../shared/workspaceState'
import {
  timelineDuration,
  type AudioTimelineDocument
} from '../../../src/features/media-editor/model/audioTimeline'
import { formatTimelineTime } from './timelineTime'
import EditorDisclosure from './EditorDisclosure'
import {
  audioLoudnessReportsKey,
  loudnessReportStale,
  loudnessSoundRevision,
  readAudioLoudnessReports,
  saveAudioLoudnessReport,
  type AudioLoudnessReport,
  type SavedAudioLoudnessReport
} from './audioLoudnessReports'

type Job = {
  id: string
  state: 'running' | 'completed' | 'failed' | 'cancelled'
  result: AudioLoudnessReport | null
  error: string
}
type Run = { job: Job; revision: string; createdAt: string; scope: string; retries?: number }
export default function AudioLoudnessAnalysis({
  workspaceId,
  draftId,
  document,
  soundRevision,
  readonly,
  onSeek
}: {
  workspaceId: string
  draftId: string
  document: AudioTimelineDocument
  soundRevision: string
  readonly: boolean
  onSeek: (time: number) => void
}) {
  const scope = `${workspaceId}:${draftId}`
  const [run, setRun] = useState<Run | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [entries, setEntries] = useState<SavedAudioLoudnessReport[]>([])
  const [selected, setSelected] = useState('')
  const [currentRevision, setCurrentRevision] = useState('')
  const [sourceRevision, setSourceRevision] = useState('')
  const [sourceError, setSourceError] = useState('')
  const documentRef = useRef(document)
  documentRef.current = document
  const policy = useRef({ scope, readonly, alive: true })
  policy.current.scope = scope
  policy.current.readonly = readonly
  const savedJobs = useRef(new Set<string>())
  const duration = timelineDuration(document)
  useEffect(() => {
    policy.current.alive = true
    return () => {
      policy.current.alive = false
    }
  }, [])
  useEffect(() => {
    setRun(null)
    setBusy(false)
    setError('')
    setSaveError('')
    setEntries([])
    setSelected('')
    try {
      const reports = readAudioLoudnessReports(
        readWorkspaceState(workspaceId).getItem(audioLoudnessReportsKey(workspaceId, draftId))
      )
      setEntries(reports.entries)
      setSelected(reports.entries[0]?.id ?? '')
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : '读取响度报告失败')
    }
  }, [scope, workspaceId, draftId])
  useEffect(() => {
    let current = true
    setCurrentRevision('')
    void loudnessSoundRevision(soundRevision)
      .then((revision) => {
        if (current) setCurrentRevision(revision)
      })
      .catch((cause) => {
        if (current) setError(cause instanceof Error ? cause.message : '读取声音修订失败')
      })
    return () => {
      current = false
    }
  }, [soundRevision])
  useEffect(() => {
    if (!entries.length && !run?.job.result) return
    const controller = new AbortController()
    setSourceRevision('')
    const check = () => {
      if (controller.signal.aborted) return
      void apiFetch<{ revision: string }>('/audio_studio/analysis/revision', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          workspace_id: workspaceId,
          document: documentRef.current,
          start: 0,
          duration: Math.max(1 / 48000, timelineDuration(documentRef.current))
        })
      })
        .then((result) => {
          if (!controller.signal.aborted) {
            setSourceRevision(result.revision)
            setSourceError('')
          }
        })
        .catch((cause) => {
          if (!controller.signal.aborted) {
            setSourceRevision('')
            setSourceError(cause instanceof Error ? cause.message : '无法确认报告的源素材修订')
          }
        })
    }
    const timer = window.setTimeout(check, 400)
    window.addEventListener('focus', check)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
      window.removeEventListener('focus', check)
    }
  }, [soundRevision, scope, workspaceId, entries.length, run?.job.result?.sound_revision])
  const stillHere = (origin: string) => policy.current.alive && policy.current.scope === origin
  async function persist(next: Run) {
    if (!next.job.result || !stillHere(next.scope) || policy.current.readonly) return
    const entry: SavedAudioLoudnessReport = {
      id: next.job.id,
      createdAt: next.createdAt,
      soundRevision: next.revision,
      report: next.job.result
    }
    try {
      const reports = await mutateWorkspaceState(workspaceId, (storage) =>
        saveAudioLoudnessReport(storage, {
          workspaceId,
          draftId,
          entry,
          readonly: policy.current.readonly,
          isCurrent: () => stillHere(next.scope) && !policy.current.readonly
        })
      )
      if (stillHere(next.scope)) {
        setEntries(reports.entries)
        setSaveError('')
        savedJobs.current.add(next.job.id)
      }
    } catch (cause) {
      if (stillHere(next.scope))
        setSaveError(cause instanceof Error ? cause.message : '保存响度报告失败')
    }
  }
  useEffect(() => {
    if (!run || run.job.state !== 'running' || run.scope !== scope) return
    const controller = new AbortController()
    const timer = window.setTimeout(
      () => {
        void apiFetch<Job>(
          `/audio_studio/analysis/${run.job.id}?workspace_id=${encodeURIComponent(workspaceId)}`,
          { signal: controller.signal }
        )
          .then((job) => {
            if (controller.signal.aborted || !stillHere(run.scope)) return
            const next = { ...run, job, retries: 0 }
            setError('')
            setRun(next)
            if (job.state === 'completed' && job.result && !savedJobs.current.has(job.id))
              void persist(next)
          })
          .catch((cause) => {
            if (!controller.signal.aborted && stillHere(run.scope)) {
              setError(cause instanceof Error ? cause.message : '读取分析失败')
              setRun({ ...run, retries: (run.retries ?? 0) + 1 })
            }
          })
      },
      Math.min(10000, 1000 * (1 + (run.retries ?? 0)))
    )
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [run, scope, workspaceId])
  async function start() {
    const origin = scope,
      snapshot = document,
      signature = soundRevision
    setBusy(true)
    setError('')
    setSaveError('')
    try {
      const revision = await loudnessSoundRevision(signature)
      if (!stillHere(origin)) return
      const job = await apiFetch<Job>('/audio_studio/analysis', {
        method: 'POST',
        body: JSON.stringify({
          workspace_id: workspaceId,
          document: snapshot,
          start: 0,
          duration: timelineDuration(snapshot)
        })
      })
      if (stillHere(origin)) {
        const next = { job, revision, scope: origin, createdAt: new Date().toISOString() }
        setRun(next)
        setSelected('current')
        if (job.state === 'completed' && job.result) void persist(next)
      } else {
        void apiFetch(
          `/audio_studio/analysis/${job.id}?workspace_id=${encodeURIComponent(workspaceId)}`,
          { method: 'DELETE' }
        ).catch(() => {})
      }
    } catch (cause) {
      if (stillHere(origin)) setError(cause instanceof Error ? cause.message : '分析失败')
    } finally {
      if (stillHere(origin)) setBusy(false)
    }
  }
  async function cancel() {
    if (!run) return
    const origin = scope
    try {
      const job = await apiFetch<Job>(
        `/audio_studio/analysis/${run.job.id}?workspace_id=${encodeURIComponent(workspaceId)}`,
        { method: 'DELETE' }
      )
      if (stillHere(origin)) setRun({ ...run, job })
    } catch (cause) {
      if (stillHere(origin)) setError(cause instanceof Error ? cause.message : '取消失败')
    }
  }
  const currentEntry: SavedAudioLoudnessReport | undefined =
    run?.job.state === 'completed' && run.job.result
      ? {
          id: 'current',
          createdAt: run.createdAt,
          soundRevision: run.revision,
          report: run.job.result
        }
      : undefined
  const entry = selected === 'current' ? currentEntry : entries.find((item) => item.id === selected)
  const stale =
    !!entry &&
    ((!!currentRevision && loudnessReportStale(entry, currentRevision, duration)) ||
      (!!sourceRevision && entry.report.sound_revision !== sourceRevision))
  const number = (value: number | null, unit: string) =>
    value === null ? '静音或不足以测量' : `${value.toFixed(1)} ${unit}`
  return (
    <EditorDisclosure title={`响度检查${run?.job.state === 'running' ? ' · 分析中' : ''}`} inline>
      <Stack gap="xs">
        <Group>
          <Button
            size="compact-xs"
            variant="light"
            disabled={!duration || run?.job.state === 'running'}
            loading={busy}
            onClick={() => void start()}
          >
            检查整段混音
          </Button>
          {run?.job.state === 'running' && (
            <Button size="compact-xs" variant="subtle" onClick={() => void cancel()}>
              取消分析
            </Button>
          )}
        </Group>
        {(error || run?.job.error) && (
          <Text size="xs" c="red" role="alert">
            {error || run?.job.error}
          </Text>
        )}
        {saveError && (
          <Text size="xs" c="red" role="alert">
            {saveError}
          </Text>
        )}
        {run?.job.state === 'cancelled' && (
          <Text size="xs" c="dimmed">
            已取消
          </Text>
        )}
        {(entries.length > 0 || currentEntry) && (
          <Select
            label="响度报告"
            size="xs"
            value={selected}
            allowDeselect={false}
            onChange={(value) => setSelected(value ?? '')}
            data={[
              ...(currentEntry ? [{ value: 'current', label: '本次检查' }] : []),
              ...entries
                .filter((item) => item.id !== run?.job.id)
                .map((item) => ({
                  value: item.id,
                  label: new Date(item.createdAt).toLocaleString()
                }))
            ]}
          />
        )}
        {entry && (
          <>
            <Text size="xs" c="dimmed">
              {new Date(entry.createdAt).toLocaleString()} ·{' '}
              {formatTimelineTime(entry.report.start)} —{' '}
              {formatTimelineTime(entry.report.start + entry.report.duration)}
            </Text>
            {stale && (
              <Text size="xs" c="yellow">
                报告已过期：混音、时长或源素材已修改，请重新检查
              </Text>
            )}
            {sourceError && (
              <Text size="xs" c="yellow">
                无法确认报告是否仍有效：{sourceError}
              </Text>
            )}
            {!sourceRevision && !sourceError && (
              <Text size="xs" c="dimmed">
                正在核对源素材修订…
              </Text>
            )}
            <Text size="xs">整体响度 {number(entry.report.integrated_lufs, 'LUFS')}</Text>
            <Text size="xs">响度变化 {number(entry.report.loudness_range_lu, 'LU')}</Text>
            <Text size="xs">真峰值 {number(entry.report.true_peak_dbfs, 'dBTP')}</Text>
            <Text size="xs">
              {entry.report.overload_windows
                ? `发现 ${entry.report.overload_ranges.length} 段采样峰值超过 0 dBFS（最多显示 128 段）`
                : '采样峰值未过载'}
            </Text>
            {entry.report.overload_ranges.map((range, index) => (
              <Button
                key={index}
                size="compact-xs"
                variant="subtle"
                disabled={stale || !sourceRevision || !currentRevision}
                onClick={() => onSeek(range.start)}
              >
                {formatTimelineTime(range.start)} — {formatTimelineTime(range.end)}
              </Button>
            ))}
            {selected === 'current' && run && (
              <Text size="xs" c="dimmed">
                {readonly
                  ? '只读工作区，本次报告仅供查看'
                  : savedJobs.current.has(run.job.id)
                    ? '报告已保存，可在重新打开后查看'
                    : '报告尚未保存'}
              </Text>
            )}
            {selected === 'current' && run && !readonly && saveError && (
              <Button size="compact-xs" variant="subtle" onClick={() => void persist(run)}>
                重试保存报告
              </Button>
            )}
          </>
        )}
        {!entry && !run && (
          <Text size="xs" c="dimmed">
            检查最终混音的响度、真峰值与过载位置，最近 8 份报告保存在当前制作文件中。
          </Text>
        )}
      </Stack>
    </EditorDisclosure>
  )
}
