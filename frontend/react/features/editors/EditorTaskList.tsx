import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  Paper,
  Progress,
  Select,
  Stack,
  Text,
  Tooltip
} from '@mantine/core'
import { IconInfoCircle, IconPlayerPlay, IconRefresh, IconTrash, IconX } from '@tabler/icons-react'
import type { ImageToolJob } from '../../../src/features/image-editor/model/imageStudioCutout'
import { managedImageAssetFile } from '../../../src/shared/lib/managedImageAssets'
import { toImageThumbnailUrl, toRawFileUrl } from '../../../src/shared/lib/mediaUrls'
import { apiFetch, apiUrl } from '../../shared/apiClient'
import type { EditorContext } from './EditorHub'
import type { AudioExports } from './useAudioExports'
import type { VideoExports } from './useVideoExports'
import {
  editorTaskActions,
  canRemoveEditorTaskRecord,
  editorTaskDeleteUrl,
  editorTaskRecordOwner,
  editorTaskRequests,
  editorTaskSourceLabels,
  exportEditorTasks,
  filterEditorTasks,
  imageEditorTasks,
  imageToolEditorTasks,
  mergeEditorTasks,
  videoProxyEditorTasks,
  type EditorAIImageTask,
  type EditorTask,
  type EditorTaskKind,
  type EditorTaskResult,
  type EditorTaskScope,
  type EditorTaskSource,
  type EditorTaskStatusFilter
} from './editorTaskModel'
import type { VideoExportTask } from './videoExportSubmission'
import type { VideoProxyJob } from './videoMediaCache'
import { editorTaskRecords } from './editorTaskRecords'
import { getDeletedArtifactIds, subscribeArtifactDeletion } from './editorArtifactEvents'
import './EditorTaskList.css'

export type EditorTaskListProps = {
  context: EditorContext
  mediaPath?: string
  onClose: () => void
  exports?: AudioExports | VideoExports
  exportKind?: 'audio' | 'video'
  onRetryExport?: () => void
  ai?: {
    tasks: EditorAIImageTask[]
    refresh: () => Promise<void>
    action: (task: EditorAIImageTask, action: 'cancel' | 'resume') => Promise<void>
    actionId?: string
    viewResult?: (task: EditorAIImageTask, artifactId: string) => void
  }
  imageTools?: {
    documentKey: string
    jobs: ImageToolJob[]
    cancel: (job: ImageToolJob) => Promise<void>
  }
  videoProxies?: {
    jobs: VideoProxyJob[]
    cancel: (path: string) => Promise<void>
  }
}

function resultUrl(result: EditorTaskResult, thumbnail = false) {
  if (result.artifactId)
    return apiUrl(
      `/workspace_artifacts/${encodeURIComponent(result.artifactId)}/${thumbnail ? 'thumbnail?size=320' : 'file'}`
    )
  const file = result.path && managedImageAssetFile(result.path)
  return file ? (thumbnail ? toImageThumbnailUrl(file, '320x320') : toRawFileUrl(file)) : ''
}

export default function EditorTaskList(props: EditorTaskListProps) {
  const {
    context,
    mediaPath,
    onClose,
    exports,
    exportKind,
    onRetryExport,
    ai,
    imageTools,
    videoProxies
  } = props
  const workspaceId = mediaPath || context.workspaceId === 'media-image' ? '' : context.workspaceId
  const documentId = context.draft.id
  const documentKey = imageTools?.documentKey
  const scopeKey = `${workspaceId}:${documentId}:${mediaPath || ''}:${documentKey || ''}`
  const deletedArtifactIds = useSyncExternalStore(subscribeArtifactDeletion, getDeletedArtifactIds)
  const current = useRef({ props, scopeKey })
  current.current = { props, scopeKey }
  const mounted = useRef(false)
  const panelRef = useRef<HTMLElement>(null)
  const refreshingRequest = useRef<{ scope: string; promise: Promise<void> } | null>(null)
  const epoch = useRef(0)
  const [portalTarget, setPortalTarget] = useState<HTMLElement>()
  const [openFilter, setOpenFilter] = useState<'scope' | 'status' | 'kind' | null>(null)
  const [scope, setScope] = useState<EditorTaskScope>('document')
  const [status, setStatus] = useState<EditorTaskStatusFilter>('all')
  const [kind, setKind] = useState<EditorTaskKind | 'all'>('all')
  const [loaded, setLoaded] = useState<Partial<Record<EditorTaskSource, EditorTask[]>>>({})
  const [refreshing, setRefreshing] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [actionError, setActionError] = useState('')
  const [actionId, setActionId] = useState('')
  const [preview, setPreview] = useState<EditorTaskResult | null>(null)
  useEffect(
    () =>
      subscribeArtifactDeletion(({ id }) =>
        setPreview((current) => (current?.artifactId === id ? null : current))
      ),
    []
  )
  const [, setRecordRevision] = useState(0)
  const requests = useMemo(
    () => editorTaskRequests({ workspaceId, documentKey, mediaPath }),
    [workspaceId, documentKey, mediaPath]
  )
  const live = useCallback(
    () => mounted.current && current.current.scopeKey === scopeKey,
    [scopeKey]
  )
  useEffect(() => {
    const shell = panelRef.current?.closest<HTMLElement>('.react-editor-shell')
    if (shell) setPortalTarget(shell)
  }, [])
  const refresh = useCallback((): Promise<void> => {
    if (refreshingRequest.current?.scope === scopeKey) return refreshingRequest.current.promise
    const before = epoch.current
    const promise = (async () => {
      if (live()) setRefreshing(true)
      const result = await Promise.allSettled(
        requests.map(async (request) => {
          const value = await apiFetch<unknown>(request.url, { signal: AbortSignal.timeout(30000) })
          let tasks: EditorTask[]
          if (request.source === 'image-tools') {
            const items = (value as { items?: ImageToolJob[] })?.items
            if (!Array.isArray(items)) throw new Error('任务数据格式异常')
            tasks = imageToolEditorTasks(items, {
              workspaceId,
              documentId,
              documentKey: documentKey || ''
            })
          } else {
            if (!Array.isArray(value)) throw new Error('任务数据格式异常')
            tasks =
              request.source === 'image-ai'
                ? imageEditorTasks(value as EditorAIImageTask[])
                : exportEditorTasks(
                    value as VideoExportTask[],
                    request.source === 'audio-export' ? 'audio' : 'video'
                  )
          }
          return { source: request.source, tasks }
        })
      )
      if (!live() || before !== epoch.current) return
      const failures: string[] = []
      const next: Partial<Record<EditorTaskSource, EditorTask[]>> = {}
      result.forEach((item, index) => {
        if (item.status === 'fulfilled') next[item.value.source] = item.value.tasks
        else
          failures.push(
            `${editorTaskSourceLabels[requests[index].source]}读取失败：${item.reason instanceof Error ? item.reason.message : '请稍后重试'}`
          )
      })
      setLoaded((previous) => ({ ...previous, ...next }))
      setErrors(failures)
    })().finally(() => {
      if (refreshingRequest.current?.promise === promise) {
        refreshingRequest.current = null
        if (live()) setRefreshing(false)
      }
    })
    refreshingRequest.current = { scope: scopeKey, promise }
    return promise
  }, [scopeKey, requests, live, workspaceId, documentId, documentKey])

  useEffect(() => {
    mounted.current = true
    epoch.current++
    // A remount (including Strict Mode's development replay) needs a fresh request.
    refreshingRequest.current = null
    setLoaded({})
    setErrors([])
    setActionError('')
    setActionId('')
    setPreview(null)
    setOpenFilter(null)
    setScope('document')
    void refresh()
    return () => {
      mounted.current = false
      epoch.current++
    }
  }, [refresh])

  useEffect(() => editorTaskRecords.subscribe(() => setRecordRevision((value) => value + 1)), [])

  const tasks = mergeEditorTasks(
    ...Object.values(loaded),
    ai && workspaceId ? imageEditorTasks(ai.tasks) : [],
    exports && exportKind && workspaceId ? exportEditorTasks(exports.tasks, exportKind) : [],
    imageTools
      ? imageToolEditorTasks(imageTools.jobs, {
          workspaceId,
          documentId,
          documentKey: imageTools.documentKey
        })
      : [],
    videoProxies ? videoProxyEditorTasks(videoProxies.jobs, { workspaceId, documentId }) : []
  ).filter((task) => !editorTaskRecords.has(task.source, editorTaskRecordOwner(task), task.id))
  const scoped = filterEditorTasks(tasks, {
    workspaceId,
    documentId,
    workDocumentIds: context.work.drafts.map((draft) => draft.id),
    scope,
    status,
    kind
  })
  const hasActive = tasks.some(
    (task) => task.source !== 'video-proxy' && (task.state === 'queued' || task.state === 'running')
  )
  useEffect(() => {
    if (!hasActive) return
    const timer = window.setInterval(() => void refresh(), 3500)
    return () => window.clearInterval(timer)
  }, [hasActive, refresh])

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      event.stopPropagation()
      if (preview) setPreview(null)
      else if (openFilter) setOpenFilter(null)
      else onClose()
    }
    window.addEventListener('keydown', close, true)
    return () => window.removeEventListener('keydown', close, true)
  }, [onClose, preview, openFilter])

  async function refreshAll() {
    await Promise.allSettled([
      refresh(),
      current.current.props.exports?.refresh(),
      current.current.props.ai?.refresh()
    ])
  }

  async function act(task: EditorTask, action: 'cancel' | 'resume' | 'retry-export') {
    if (context.readonly || actionId || task.workspaceId !== workspaceId) return
    if (action === 'retry-export') {
      onRetryExport?.()
      return
    }
    setActionId(task.key)
    setActionError('')
    epoch.current++
    try {
      if (task.source === 'video-proxy') {
        if (!videoProxies || !task.videoProxyJob || action !== 'cancel') return
        await videoProxies.cancel(task.videoProxyJob.path)
      } else if (task.source === 'image-tools') {
        if (!imageTools || !task.imageToolJob) return
        await imageTools.cancel(task.imageToolJob)
      } else if (task.source === 'image-ai' && ai && task.imageTask) {
        await ai.action(task.imageTask, action)
      } else if (
        exports &&
        task.source === `${exportKind}-export` &&
        task.documentId === documentId
      ) {
        await exports.cancel(task.id)
      } else {
        const route =
          task.source === 'image-ai'
            ? '/image-ai/tasks'
            : task.source === 'audio-export'
              ? '/audio_studio/tasks'
              : task.source === 'video-export'
                ? '/video_studio/tasks'
                : ''
        if (!route) return
        await apiFetch(
          `${route}/${encodeURIComponent(task.id)}/${action}?${new URLSearchParams({ workspace_id: workspaceId })}`,
          { method: 'POST', signal: AbortSignal.timeout(30000) }
        )
      }
      // A poll started before the mutation must not overwrite its response.
      await refreshingRequest.current?.promise
      if (live()) await refreshAll()
    } catch (cause) {
      if (live()) setActionError(cause instanceof Error ? cause.message : '任务操作失败')
    } finally {
      if (live()) setActionId('')
    }
  }

  function viewResult(task: EditorTask, result: EditorTaskResult) {
    if (task.imageTask && result.artifactId && ai?.viewResult) {
      ai.viewResult(task.imageTask, result.artifactId)
      return
    }
    setPreview(result)
  }

  function resultButton(task: EditorTask, result: EditorTaskResult) {
    const url = resultUrl(result, result.kind === 'image')
    return (
      <Tooltip key={result.id} label={`预览 ${result.name}`}>
        <button
          type="button"
          className={`editor-task-result is-${result.kind}`}
          disabled={!url}
          aria-label={`预览${result.name}`}
          onClick={() => viewResult(task, result)}
        >
          {result.kind === 'image' ? (
            <img src={url} alt={result.name} loading="lazy" />
          ) : (
            <IconPlayerPlay size={20} />
          )}
        </button>
      </Tooltip>
    )
  }

  async function removeTaskRecord(task: EditorTask) {
    if (
      busy ||
      context.readonly ||
      !canRemoveEditorTaskRecord(task, context.readonly) ||
      task.workspaceId !== workspaceId
    )
      return
    setActionId(task.key)
    setActionError('')
    epoch.current++
    try {
      if (task.source !== 'video-proxy') {
        const url = editorTaskDeleteUrl(task)
        if (!url) return
        await apiFetch(url, { method: 'DELETE', signal: AbortSignal.timeout(30000) })
      }
      // Retain this guard outside the floating panel so old hook props cannot revive the row.
      editorTaskRecords.remove(task.source, editorTaskRecordOwner(task), task.id)
      if (live()) {
        setLoaded((previous) =>
          Object.fromEntries(
            Object.entries(previous).map(([source, items]) => [
              source,
              items.filter((item) => item.key !== task.key)
            ])
          )
        )
        await refreshingRequest.current?.promise
        await refreshAll()
      }
    } catch (cause) {
      if (live()) setActionError(cause instanceof Error ? cause.message : '删除任务记录失败')
    } finally {
      if (live()) setActionId('')
    }
  }

  const busy = !!actionId || !!ai?.actionId || !!exports?.cancelling
  const pending = exports?.pending && (kind === 'all' || kind === 'export') ? exports.pending : null
  return (
    <>
      <section
        ref={panelRef}
        className="editor-task-list-panel"
        id="editor-task-list"
        role="dialog"
        aria-label="任务列表"
      >
        <Group justify="space-between" wrap="nowrap">
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Text fw={700} size="sm">
              任务列表
            </Text>
            <Text size="xs" c="dimmed" truncate title={mediaPath || context.draft.name}>
              {mediaPath ? context.work.name : context.draft.name}
            </Text>
          </Stack>
          <Group gap={4} wrap="nowrap">
            <Tooltip label="刷新任务">
              <ActionIcon
                variant="subtle"
                aria-label="刷新任务"
                loading={refreshing || exports?.refreshing}
                onClick={() => void refreshAll()}
              >
                <IconRefresh size={17} />
              </ActionIcon>
            </Tooltip>
            <ActionIcon variant="subtle" aria-label="关闭任务列表" onClick={onClose}>
              <IconX size={17} />
            </ActionIcon>
          </Group>
        </Group>
        <div className="editor-task-filters">
          {workspaceId && (
            <Select
              size="xs"
              aria-label="任务范围"
              comboboxProps={{
                withinPortal: true,
                portalProps: { target: portalTarget },
                zIndex: 70
              }}
              dropdownOpened={openFilter === 'scope'}
              onDropdownOpen={() => setOpenFilter('scope')}
              onDropdownClose={() =>
                setOpenFilter((current) => (current === 'scope' ? null : current))
              }
              value={scope}
              onChange={(value) => setScope((value || 'document') as EditorTaskScope)}
              data={[
                { value: 'document', label: '当前制作文件' },
                { value: 'work', label: '当前作品' },
                { value: 'workspace', label: '当前工作区' }
              ]}
              allowDeselect={false}
            />
          )}
          <Select
            size="xs"
            aria-label="任务状态"
            comboboxProps={{
              withinPortal: true,
              portalProps: { target: portalTarget },
              zIndex: 70
            }}
            dropdownOpened={openFilter === 'status'}
            onDropdownOpen={() => setOpenFilter('status')}
            onDropdownClose={() =>
              setOpenFilter((current) => (current === 'status' ? null : current))
            }
            value={status}
            onChange={(value) => setStatus((value || 'all') as EditorTaskStatusFilter)}
            data={[
              { value: 'all', label: '全部状态' },
              { value: 'active', label: '进行中' },
              { value: 'completed', label: '已完成' },
              { value: 'exception', label: '异常 / 已取消' }
            ]}
            allowDeselect={false}
          />
          <Select
            size="xs"
            aria-label="任务类型"
            comboboxProps={{
              withinPortal: true,
              portalProps: { target: portalTarget },
              zIndex: 70
            }}
            dropdownOpened={openFilter === 'kind'}
            onDropdownOpen={() => setOpenFilter('kind')}
            onDropdownClose={() =>
              setOpenFilter((current) => (current === 'kind' ? null : current))
            }
            value={kind}
            onChange={(value) => setKind((value || 'all') as EditorTaskKind | 'all')}
            data={[
              { value: 'all', label: '全部类型' },
              { value: 'ai', label: 'AI 加工' },
              { value: 'export', label: '导出' },
              { value: 'processing', label: '专项处理' }
            ]}
            allowDeselect={false}
          />
        </div>
        <div className="editor-task-items">
          {[...new Set([...errors, actionError, exports?.error || ''].filter(Boolean))].map(
            (error) => (
              <Alert color="red" key={error} className="editor-task-error">
                {error}
              </Alert>
            )
          )}
          {pending && exports && (
            <Paper p="sm" withBorder radius="sm">
              <Stack gap="xs">
                <Text size="xs" fw={600} truncate title={pending.name}>
                  {pending.name}
                </Text>
                <Text size="xs" c="dimmed">
                  提交结果尚未确认。重试会核对同一份导出，不会重复创建任务。
                </Text>
                <Button
                  size="xs"
                  variant="light"
                  disabled={context.readonly}
                  loading={exports.submitting}
                  onClick={() => void exports.retryPending()}
                >
                  重试确认
                </Button>
              </Stack>
            </Paper>
          )}
          {!scoped.length && (
            <Text size="xs" c="dimmed" ta="center" py="lg">
              {refreshing ? '正在读取任务…' : '当前范围暂无符合条件的任务'}
            </Text>
          )}
          {scoped.map((task) => {
            const results = task.results.filter(
              (result) =>
                !result.artifactId ||
                (!deletedArtifactIds.has(result.artifactId) &&
                  !task.deletedArtifactIds?.includes(result.artifactId))
            )
            const actions = editorTaskActions(task, {
              readonly: context.readonly,
              documentId,
              exportKind,
              canRetryExport: !!onRetryExport,
              canCancelTool: !!imageTools,
              canCancelProxy: !!videoProxies
            })
            const removable = canRemoveEditorTaskRecord(task, context.readonly)
            const deletionHint = context.readonly
              ? '当前为只读，不能删除任务记录'
              : !removable
                ? task.state === 'queued' || task.state === 'running'
                  ? '先取消任务，结束后可删除记录'
                  : '云端任务尚未确认结束，暂不能删除记录'
                : task.source === 'video-proxy'
                  ? '仅隐藏当前会话的代理记录，不清理预览缓存'
                  : '仅删除任务记录，保留产物和媒体文件'
            const resultHint =
              task.source === 'image-tools'
                ? mediaPath
                  ? '图层处理结果，保存副本或覆盖原图后写入媒体库。'
                  : '图层处理结果，保存编辑后保留。'
                : task.source === 'video-proxy'
                  ? '用于流畅预览的缓存；正式导出使用原片，不计为产物。'
                  : ''
            return (
              <Paper key={task.key} p="xs" radius="sm" withBorder className="editor-task-card">
                <div className="editor-task-row">
                  {results.length === 1 && resultButton(task, results[0])}
                  <div className="editor-task-body">
                    <Group justify="space-between" gap={6} wrap="nowrap">
                      <Text size="xs" fw={600} truncate title={task.name}>
                        {task.name}
                      </Text>
                      <Badge
                        size="xs"
                        color={
                          task.state === 'completed'
                            ? 'teal'
                            : ['failed', 'interrupted'].includes(task.state)
                              ? 'red'
                              : task.state === 'cancelled'
                                ? 'gray'
                                : 'blue'
                        }
                      >
                        {task.statusLabel}
                      </Badge>
                    </Group>
                    <Group
                      gap={6}
                      justify="space-between"
                      wrap="nowrap"
                      className="editor-task-meta"
                    >
                      <Group gap={4} wrap="nowrap">
                        <Text size="xs" c="dimmed">
                          {task.typeLabel}
                        </Text>
                        {resultHint && (
                          <Tooltip label={resultHint} multiline w={240}>
                            <IconInfoCircle size={13} aria-label={resultHint} />
                          </Tooltip>
                        )}
                      </Group>
                      {task.createdAt > 0 && (
                        <Text
                          size="xs"
                          c="dimmed"
                          title={new Date(task.createdAt * 1000).toLocaleString()}
                        >
                          {new Date(task.createdAt * 1000).toLocaleString(undefined, {
                            month: 'numeric',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </Text>
                      )}
                    </Group>
                    {task.progress !== undefined && ['queued', 'running'].includes(task.state) && (
                      <Group gap={6} wrap="nowrap">
                        <Progress
                          size={4}
                          style={{ flex: 1 }}
                          value={task.progress}
                          animated={task.state === 'running'}
                          aria-label={`任务进度 ${Math.floor(task.progress)}%`}
                        />
                        <Text size="xs" c="dimmed">
                          {Math.floor(task.progress)}%
                        </Text>
                      </Group>
                    )}
                    {task.error && (
                      <Text
                        size="xs"
                        c="red"
                        className="editor-task-error"
                        lineClamp={2}
                        title={task.error}
                      >
                        {task.error}
                      </Text>
                    )}
                    {!!actions.length && (
                      <Group gap={2} wrap="nowrap" className="editor-task-operations">
                        {actions.map((action) => (
                          <Button
                            key={action}
                            size="compact-xs"
                            variant="subtle"
                            disabled={busy}
                            loading={actionId === task.key}
                            onClick={() => void act(task, action)}
                          >
                            {action === 'resume'
                              ? '继续跟踪'
                              : action === 'retry-export'
                                ? '重新导出当前制作文件'
                                : '取消任务'}
                          </Button>
                        ))}
                      </Group>
                    )}
                  </div>
                  <Tooltip label={deletionHint} multiline w={240}>
                    <span className="editor-task-delete-wrap">
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        color="gray"
                        aria-label={`${task.source === 'video-proxy' ? '隐藏代理记录' : '删除任务记录'} ${task.name}`}
                        disabled={busy || !removable}
                        loading={actionId === task.key}
                        onClick={() => void removeTaskRecord(task)}
                      >
                        <IconTrash size={15} />
                      </ActionIcon>
                    </span>
                  </Tooltip>
                </div>
                {!!task.results.length && !results.length && (
                  <Text size="xs" c="dimmed">
                    产物已删除
                  </Text>
                )}
                {results.length > 1 && (
                  <div className="editor-task-results">
                    {results.map((result) => resultButton(task, result))}
                  </div>
                )}
              </Paper>
            )
          })}
        </div>
      </section>
      <Modal
        opened={!!preview}
        onClose={() => setPreview(null)}
        title={preview?.name || '任务结果'}
        size="xl"
        centered
      >
        {preview && (
          <div className="editor-task-preview">
            {preview.kind === 'image' ? (
              <img src={resultUrl(preview)} alt={preview.name} />
            ) : preview.kind === 'audio' ? (
              <audio src={resultUrl(preview)} controls preload="metadata" />
            ) : (
              <video src={resultUrl(preview)} controls preload="metadata" />
            )}
          </div>
        )}
      </Modal>
    </>
  )
}
