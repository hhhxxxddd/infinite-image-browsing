import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WorkspaceArtifact } from '../../../src/features/workspaces/model/workspaceArtifactTypes'
import { assertProductionDraftExists } from '../../../src/features/workspaces/model/workspaceWorks'
import { apiFetch } from '../../shared/apiClient'
import { editorTaskRecords } from './editorTaskRecords'
import {
  mutateWorkspaceState,
  readWorkspaceState,
  subscribeWorkspaceState
} from '../../shared/workspaceState'
import {
  VideoExportSubmission,
  scopedVideoExportTasks,
  type VideoExportInput,
  type VideoExportRequest,
  type VideoExportTask
} from './videoExportSubmission'

const message = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback

export function useVideoExports({
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
  const currentScope = useRef(scope)
  currentScope.current = scope
  const mounted = useRef(true)
  const readonlyRef = useRef(readonly)
  readonlyRef.current = readonly
  const onArtifactRef = useRef(onArtifact)
  onArtifactRef.current = onArtifact
  const delivered = useRef(new Set<string>())
  const [tasks, setTasks] = useState<VideoExportTask[]>([])
  const [pending, setPending] = useState<VideoExportRequest | null>(null)
  const [error, setError] = useState('')
  const [refreshError, setRefreshError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [cancelling, setCancelling] = useState('')
  const submittingRef = useRef(false)
  const refreshRequest = useRef<{ scope: string; promise: Promise<void> } | null>(null)
  const responseEpoch = useRef(0)
  useEffect(
    () =>
      editorTaskRecords.subscribe(({ source, owner }) => {
        if (
          source === 'video-export' &&
          owner === workspaceId &&
          mounted.current &&
          currentScope.current === scope
        )
          setTasks((items) => editorTaskRecords.filter(source, owner, items))
      }),
    [workspaceId, scope]
  )
  const client = useMemo(
    () =>
      new VideoExportSubmission({
        workspaceId,
        documentId,
        read: () => readWorkspaceState(workspaceId),
        mutate: (operation) =>
          mutateWorkspaceState(workspaceId, (storage) => {
            if (readonlyRef.current) throw new Error('当前工作区为只读')
            assertProductionDraftExists(storage, workspaceId, documentId)
            return operation(storage)
          }),
        post: (body) =>
          apiFetch<VideoExportTask>('/video_studio/tasks', {
            method: 'POST',
            body,
            signal: AbortSignal.timeout(30000)
          }),
        createId: () => crypto.randomUUID()
      }),
    [workspaceId, documentId]
  )

  const syncPending = useCallback(() => {
    if (!mounted.current || currentScope.current !== scope) return
    try {
      setPending(client.pending())
    } catch (cause) {
      setError(message(cause, '待确认记录读取失败'))
    }
  }, [client, scope])

  const deliver = useCallback(
    (items: VideoExportTask[]) => {
      for (const task of editorTaskRecords.filter('video-export', workspaceId, items)) {
        const artifact = task.artifact
        if (
          task.workspace_id !== workspaceId ||
          task.document_id !== documentId ||
          task.state !== 'completed' ||
          !artifact ||
          artifact.kind !== 'video' ||
          artifact.workspace_id !== workspaceId ||
          (artifact.document_id && artifact.document_id !== documentId) ||
          delivered.current.has(artifact.id)
        )
          continue
        onArtifactRef.current(artifact)
        delivered.current.add(artifact.id)
      }
    },
    [workspaceId, documentId]
  )

  const refresh = useCallback((): Promise<void> => {
    if (refreshRequest.current?.scope === scope) return refreshRequest.current.promise
    const epoch = responseEpoch.current
    const promise: Promise<void> = (async () => {
      if (mounted.current && currentScope.current === scope) setRefreshing(true)
      try {
        const query = new URLSearchParams({ workspace_id: workspaceId, document_id: documentId })
        const all = await apiFetch<VideoExportTask[]>(`/video_studio/tasks?${query}`, {
          signal: AbortSignal.timeout(30000)
        })
        if (!mounted.current || currentScope.current !== scope || epoch !== responseEpoch.current)
          return
        const next = editorTaskRecords.filter(
          'video-export',
          workspaceId,
          scopedVideoExportTasks(all, workspaceId, documentId)
        )
        setTasks(next)
        deliver(next)
        const pendingRequest = client.pending()
        const accepted = next.find((task) => task.id === pendingRequest?.task_id)
        if (accepted && !readonlyRef.current) await client.acknowledge(accepted)
        if (mounted.current && currentScope.current === scope) {
          if (accepted) setError('')
          setRefreshError('')
          syncPending()
        }
      } catch (cause) {
        if (mounted.current && currentScope.current === scope)
          setRefreshError(message(cause, '导出任务读取失败'))
      } finally {
        if (mounted.current && currentScope.current === scope) setRefreshing(false)
      }
    })().finally(() => {
      if (refreshRequest.current?.promise === promise) refreshRequest.current = null
    })
    refreshRequest.current = { scope, promise }
    return promise
  }, [scope, workspaceId, documentId, client, deliver, syncPending])

  useEffect(() => {
    mounted.current = true
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
  }, [workspaceId, scope, syncPending, refresh])

  const active = tasks.some((task) => task.state === 'queued' || task.state === 'running')
  const unconfirmed =
    pending &&
    !tasks.some(
      (task) =>
        task.id === pending.task_id &&
        task.document_revision === pending.document_revision &&
        task.name === pending.name
    )
      ? pending
      : null
  useEffect(() => {
    if (!(active || opened || unconfirmed)) return
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') void refresh()
    }, 2500)
    return () => window.clearInterval(timer)
  }, [active, opened, unconfirmed?.task_id, refresh])

  const send = async (input?: VideoExportInput): Promise<VideoExportTask | null> => {
    if (readonly || submittingRef.current) return null
    submittingRef.current = true
    setSubmitting(true)
    setError('')
    try {
      const result = input ? await client.submit(input) : await client.retry()
      if (result.task.deleted) editorTaskRecords.remove('video-export', workspaceId, result.task.id)
      if (mounted.current && currentScope.current === scope) {
        responseEpoch.current++
        setTasks((current) =>
          scopedVideoExportTasks(
            editorTaskRecords.filter('video-export', workspaceId, [
              result.task,
              ...current.filter((task) => task.id !== result.task.id)
            ]),
            workspaceId,
            documentId
          )
        )
        deliver([result.task])
        setError(result.warning)
        syncPending()
        await refreshRequest.current?.promise
        // The accepted task is already visible; polling picks up its subsequent states.
      }
      return result.task
    } catch (cause) {
      if (mounted.current && currentScope.current === scope) {
        setError(message(cause, '导出提交未能确认，请重试确认原任务'))
        syncPending()
      }
      return null
    } finally {
      submittingRef.current = false
      if (mounted.current && currentScope.current === scope) setSubmitting(false)
    }
  }

  async function cancel(taskId: string) {
    if (readonly || cancelling) return
    setCancelling(taskId)
    setError('')
    try {
      const task = await apiFetch<VideoExportTask>(
        `/video_studio/tasks/${encodeURIComponent(taskId)}/cancel?${new URLSearchParams({ workspace_id: workspaceId })}`,
        { method: 'POST', signal: AbortSignal.timeout(30000) }
      )
      if (!mounted.current || currentScope.current !== scope) return
      responseEpoch.current++
      setTasks((current) =>
        scopedVideoExportTasks(
          editorTaskRecords.filter('video-export', workspaceId, [
            task,
            ...current.filter((item) => item.id !== task.id)
          ]),
          workspaceId,
          documentId
        )
      )
      deliver([task])
      await refreshRequest.current?.promise
      await refresh()
    } catch (cause) {
      if (mounted.current && currentScope.current === scope)
        setError(message(cause, '取消导出失败'))
    } finally {
      if (mounted.current && currentScope.current === scope) setCancelling('')
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
    submit: (input: VideoExportInput) => send(input),
    retryPending: () => send()
  }
}

export type VideoExports = ReturnType<typeof useVideoExports>
