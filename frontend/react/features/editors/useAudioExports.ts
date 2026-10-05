import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WorkspaceArtifact } from '../../../src/features/workspaces/model/workspaceArtifactTypes'
import { assertProductionDraftExists } from '../../../src/features/workspaces/model/workspaceWorks'
import { apiFetch } from '../../shared/apiClient'
import {
  mutateWorkspaceState,
  readWorkspaceState,
  subscribeWorkspaceState
} from '../../shared/workspaceState'
import {
  AudioExportSubmission,
  type AudioExportInput,
  type AudioExportTask
} from './audioExportSubmission'
import { scopedVideoExportTasks } from './videoExportSubmission'

const message = (error: unknown) =>
  error instanceof Error ? error.message.replaceAll('视频', '音频') : '音频导出操作失败'
export function useAudioExports({
  workspaceId,
  documentId,
  onArtifact,
  opened = false,
  readonly = false
}: {
  workspaceId: string
  documentId: string
  onArtifact: (artifact: WorkspaceArtifact) => void
  opened?: boolean
  readonly?: boolean
}) {
  const scope = `${workspaceId}:${documentId}`
  const current = useRef({ scope, readonly, onArtifact })
  current.current = { scope, readonly, onArtifact }
  const mounted = useRef(true)
  const delivered = useRef(new Set<string>())
  const busy = useRef(false)
  const epoch = useRef(0)
  const refreshingRef = useRef<Promise<void> | null>(null)
  const [tasks, setTasks] = useState<AudioExportTask[]>([])
  const [pending, setPending] = useState<ReturnType<AudioExportSubmission['pending']>>(null)
  const [error, setError] = useState('')
  const [refreshError, setRefreshError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [cancelling, setCancelling] = useState('')
  const client = useMemo(
    () =>
      new AudioExportSubmission({
        workspaceId,
        documentId,
        read: () => readWorkspaceState(workspaceId),
        mutate: (operation) =>
          mutateWorkspaceState(workspaceId, (storage) => {
            if (current.current.readonly || current.current.scope !== scope)
              throw new Error('当前工作区不可写')
            assertProductionDraftExists(storage, workspaceId, documentId)
            return operation(storage)
          }),
        post: (body) =>
          apiFetch<AudioExportTask>('/audio_studio/tasks', {
            method: 'POST',
            body,
            signal: AbortSignal.timeout(30000)
          }),
        createId: () => crypto.randomUUID()
      }),
    [workspaceId, documentId, scope]
  )
  const alive = useCallback(() => mounted.current && current.current.scope === scope, [scope])
  const syncPending = useCallback(() => {
    if (!alive()) return
    try {
      setPending(client.pending())
    } catch (error) {
      setError(message(error))
    }
  }, [client, alive])
  const deliver = useCallback(
    (items: AudioExportTask[]) => {
      for (const task of items) {
        const artifact = task.artifact
        if (
          task.workspace_id === workspaceId &&
          task.document_id === documentId &&
          task.state === 'completed' &&
          artifact?.kind === 'audio' &&
          artifact.workspace_id === workspaceId &&
          (!artifact.document_id || artifact.document_id === documentId) &&
          !delivered.current.has(artifact.id)
        ) {
          current.current.onArtifact(artifact)
          delivered.current.add(artifact.id)
        }
      }
    },
    [workspaceId, documentId]
  )
  const refresh = useCallback((): Promise<void> => {
    if (refreshingRef.current) return refreshingRef.current
    const before = epoch.current
    const promise = (async () => {
      if (alive()) setRefreshing(true)
      try {
        const items = await apiFetch<AudioExportTask[]>(
          `/audio_studio/tasks?${new URLSearchParams({ workspace_id: workspaceId, document_id: documentId })}`,
          { signal: AbortSignal.timeout(30000) }
        )
        if (!alive() || before !== epoch.current) return
        const next = scopedVideoExportTasks(items, workspaceId, documentId)
        setTasks(next)
        deliver(next)
        const pending = client.pending()
        const accepted = next.find((task) => task.id === pending?.task_id)
        if (accepted && !current.current.readonly) await client.acknowledge(accepted)
        if (alive()) {
          syncPending()
          setRefreshError('')
          if (accepted) setError('')
        }
      } catch (error) {
        if (alive()) setRefreshError(message(error))
      } finally {
        if (alive()) setRefreshing(false)
      }
    })().finally(() => {
      if (refreshingRef.current === promise) refreshingRef.current = null
    })
    refreshingRef.current = promise
    return promise
  }, [workspaceId, documentId, alive, client, deliver, syncPending])
  useEffect(() => {
    mounted.current = true
    epoch.current++
    refreshingRef.current = null
    delivered.current.clear()
    setTasks([])
    setError('')
    setRefreshError('')
    syncPending()
    void refresh()
    const unsubscribe = subscribeWorkspaceState(workspaceId, syncPending)
    const focus = () => {
      if (document.visibilityState !== 'hidden') void refresh()
    }
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', focus)
    return () => {
      mounted.current = false
      unsubscribe()
      window.removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', focus)
    }
  }, [workspaceId, refresh, syncPending])
  const unconfirmed =
    pending &&
    !tasks.some(
      (task) =>
        task.id === pending.task_id &&
        task.workspace_id === workspaceId &&
        task.document_id === documentId &&
        task.document_revision === pending.document_revision &&
        task.name === pending.name
    )
      ? pending
      : null
  const active = tasks.some((task) => ['queued', 'running'].includes(task.state))
  useEffect(() => {
    if (!(active || opened || unconfirmed)) return
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') void refresh()
    }, 2500)
    return () => clearInterval(timer)
  }, [active, opened, unconfirmed, refresh])
  const send = async (input?: AudioExportInput) => {
    if (current.current.readonly || busy.current) return null
    busy.current = true
    setSubmitting(true)
    setError('')
    try {
      const result = input ? await client.submit(input) : await client.retry()
      if (alive()) {
        epoch.current++
        setTasks((items) =>
          scopedVideoExportTasks(
            [result.task, ...items.filter((item) => item.id !== result.task.id)],
            workspaceId,
            documentId
          )
        )
        deliver([result.task])
        setError(result.warning)
        syncPending()
      }
      return result.task
    } catch (error) {
      if (alive()) {
        setError(message(error))
        syncPending()
      }
      return null
    } finally {
      busy.current = false
      if (alive()) setSubmitting(false)
    }
  }
  const cancel = async (id: string) => {
    if (current.current.readonly || cancelling) return
    setCancelling(id)
    setError('')
    try {
      const task = await apiFetch<AudioExportTask>(
        `/audio_studio/tasks/${encodeURIComponent(id)}/cancel?${new URLSearchParams({ workspace_id: workspaceId })}`,
        { method: 'POST', signal: AbortSignal.timeout(30000) }
      )
      if (alive()) {
        epoch.current++
        setTasks((items) =>
          scopedVideoExportTasks(
            [task, ...items.filter((item) => item.id !== task.id)],
            workspaceId,
            documentId
          )
        )
        deliver([task])
      }
    } catch (error) {
      if (alive()) setError(message(error))
    } finally {
      if (alive()) setCancelling('')
    }
  }
  return {
    tasks,
    pending: unconfirmed,
    error: error || refreshError,
    submitting,
    refreshing,
    cancelling,
    refresh,
    cancel,
    submit: (input: AudioExportInput) => send(input),
    retryPending: () => send()
  }
}
export type AudioExports = ReturnType<typeof useAudioExports>
