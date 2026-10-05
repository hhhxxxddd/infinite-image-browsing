import type { WorkspaceArtifact } from '../../../src/features/workspaces/model/workspaceArtifactTypes'
import {
  imageToolName,
  type ImageToolJob
} from '../../../src/features/image-editor/model/imageStudioCutout.ts'
import { aiTaskStatusLabel, type AIImageTask } from './aiTaskStatus.ts'
import { videoExportTaskLabel, type VideoExportTask } from './videoExportSubmission.ts'
import type { VideoProxyJob } from './videoMediaCache'

export type EditorTaskSource =
  'image-ai' | 'audio-export' | 'video-export' | 'image-tools' | 'video-proxy'
export type EditorTaskKind = 'ai' | 'export' | 'processing'
export type EditorTaskScope = 'document' | 'work' | 'workspace'
export type EditorTaskStatusFilter = 'all' | 'active' | 'completed' | 'exception'
export type EditorTaskState = VideoExportTask['state']
export type EditorAIImageTask = AIImageTask & { created_at?: number; updated_at?: number }
export type EditorTaskResult = {
  id: string
  name: string
  kind: WorkspaceArtifact['kind']
  path?: string
  artifactId?: string
}
export type EditorTask = {
  key: string
  id: string
  source: EditorTaskSource
  kind: EditorTaskKind
  workspaceId: string
  documentId: string
  name: string
  typeLabel: string
  state: EditorTaskState
  statusLabel: string
  createdAt: number
  error: string
  progress?: number
  results: EditorTaskResult[]
  deletedArtifactIds?: string[]
  imageTask?: EditorAIImageTask
  exportTask?: VideoExportTask
  imageToolJob?: ImageToolJob
  videoProxyJob?: VideoProxyJob
}

export const editorTaskSourceLabels: Record<EditorTaskSource, string> = {
  'image-ai': '图片 AI',
  'audio-export': '音频导出',
  'video-export': '视频导出',
  'image-tools': '图片专项处理',
  'video-proxy': '视频预览代理'
}

export function editorTaskRequests({
  workspaceId,
  documentKey,
  mediaPath
}: {
  workspaceId: string
  documentKey?: string
  mediaPath?: string
}): { source: EditorTaskSource; url: string }[] {
  const requests: { source: EditorTaskSource; url: string }[] = []
  if (workspaceId && workspaceId !== 'media-image' && !mediaPath) {
    const query = new URLSearchParams({ workspace_id: workspaceId })
    requests.push(
      { source: 'image-ai', url: `/image-ai/tasks?${query}` },
      { source: 'audio-export', url: `/audio_studio/tasks?${query}` },
      { source: 'video-export', url: `/video_studio/tasks?${query}` }
    )
  }
  if (documentKey)
    requests.push({
      source: 'image-tools',
      url: `/image-ai-tools/tasks?${new URLSearchParams({ document_key: documentKey })}`
    })
  return requests
}

export function imageEditorTasks(tasks: EditorAIImageTask[]): EditorTask[] {
  return tasks
    .filter((task) => !task.deleted)
    .map((task) => ({
      key: `image-ai:${task.id}`,
      id: task.id,
      source: 'image-ai',
      kind: 'ai',
      workspaceId: task.workspace_id,
      documentId: task.document_id || '',
      name: task.name,
      typeLabel: task.purpose === 'image_generation' ? '图片生成' : '图片 AI 加工',
      state: task.state,
      statusLabel: aiTaskStatusLabel(task),
      createdAt: task.created_at || 0,
      error: task.error,
      deletedArtifactIds: task.deleted_artifact_ids,
      results:
        task.state === 'completed'
          ? (task.results?.length
              ? task.results
              : task.artifact_id
                ? [{ artifact_id: task.artifact_id, label: task.name }]
                : []
            )
              .filter((result) => !!result.artifact_id)
              .map((result) => ({
                id: result.artifact_id,
                artifactId: result.artifact_id,
                name: result.label || task.name,
                kind: 'image'
              }))
          : [],
      imageTask: task
    }))
}

export function exportEditorTasks(tasks: VideoExportTask[], kind: 'audio' | 'video'): EditorTask[] {
  const source = kind === 'audio' ? 'audio-export' : 'video-export'
  return tasks
    .filter((task) => !task.deleted)
    .map((task) => {
      const artifact = task.artifact
      const validResult =
        task.state === 'completed' &&
        artifact?.kind === kind &&
        artifact.workspace_id === task.workspace_id &&
        (!artifact.document_id || artifact.document_id === task.document_id)
      return {
        key: `${source}:${task.id}`,
        id: task.id,
        source,
        kind: 'export',
        workspaceId: task.workspace_id,
        documentId: task.document_id,
        name: task.name,
        typeLabel: editorTaskSourceLabels[source],
        state: task.state,
        statusLabel: videoExportTaskLabel(task),
        createdAt: task.created_at,
        error: task.error,
        deletedArtifactIds: task.deleted_artifact_ids,
        progress: Number.isFinite(task.progress) ? Math.max(0, Math.min(100, task.progress)) : 0,
        results: validResult
          ? [{ id: artifact.id, artifactId: artifact.id, name: artifact.name, kind: artifact.kind }]
          : [],
        exportTask: task
      }
    })
}

export function imageToolEditorTasks(
  jobs: ImageToolJob[],
  {
    workspaceId,
    documentId,
    documentKey
  }: { workspaceId: string; documentId: string; documentKey: string }
): EditorTask[] {
  return jobs
    .filter((job) => !job.deleted && job.document_key === documentKey)
    .map((job) => {
      const state = job.state === 'canceled' ? 'cancelled' : job.state
      return {
        key: `image-tools:${job.id}`,
        id: job.id,
        source: 'image-tools',
        kind: 'processing',
        workspaceId,
        documentId,
        name: `${job.layer_name || '图片'} · ${imageToolName(job)}`,
        typeLabel: imageToolName(job),
        state,
        statusLabel: {
          queued: '等待处理',
          running: '处理中',
          completed: '已完成',
          failed: '处理失败',
          cancelled: '已取消'
        }[state],
        createdAt: job.created_at,
        error: job.error,
        results:
          job.state === 'completed' && job.result
            ? [
                {
                  id: job.result.path,
                  path: job.result.path,
                  name: `${imageToolName(job)}结果`,
                  kind: 'image'
                }
              ]
            : [],
        imageToolJob: job
      }
    })
}

export function mergeEditorTasks(...groups: EditorTask[][]): EditorTask[] {
  const tasks = new Map<string, EditorTask>()
  for (const group of groups)
    for (const task of group) {
      const previousDeleted = tasks.get(task.key)?.deletedArtifactIds
      tasks.set(
        task.key,
        previousDeleted?.length
          ? {
              ...task,
              deletedArtifactIds: [
                ...new Set([...previousDeleted, ...(task.deletedArtifactIds ?? [])])
              ]
            }
          : task
      )
    }
  return [...tasks.values()].sort((a, b) => b.createdAt - a.createdAt || a.key.localeCompare(b.key))
}

/** Proxy records belong to the active session's referenced sources, not exported artifacts. */
export function videoProxyEditorTasks(
  jobs: VideoProxyJob[],
  { workspaceId, documentId }: { workspaceId: string; documentId: string }
): EditorTask[] {
  if (!workspaceId || workspaceId === 'media-image') return []
  return jobs.map((job) => {
    const state = job.state === 'succeeded' ? 'completed' : job.state
    return {
      key: `video-proxy:${job.id}`,
      id: job.id,
      source: 'video-proxy',
      kind: 'processing',
      workspaceId,
      documentId,
      name: `${job.path.split(/[\\/]/).pop() || '视频'} · 预览代理`,
      typeLabel: '视频预览代理',
      state,
      statusLabel: {
        queued: '等待准备',
        running: '准备代理',
        completed: '代理可用',
        failed: '准备失败',
        cancelled: '已取消'
      }[state],
      createdAt: 0,
      error: job.error || '',
      progress: Number.isFinite(job.progress) ? Math.max(0, Math.min(100, job.progress)) : 0,
      results: [],
      videoProxyJob: job
    }
  })
}

export function filterEditorTasks(
  tasks: EditorTask[],
  {
    workspaceId,
    documentId,
    workDocumentIds,
    scope,
    status = 'all',
    kind = 'all'
  }: {
    workspaceId: string
    documentId: string
    workDocumentIds: readonly string[]
    scope: EditorTaskScope
    status?: EditorTaskStatusFilter
    kind?: EditorTaskKind | 'all'
  }
): EditorTask[] {
  return tasks.filter((task) => {
    if (task.workspaceId !== workspaceId) return false
    if (scope === 'document' && task.documentId !== documentId) return false
    if (scope === 'work' && !workDocumentIds.includes(task.documentId)) return false
    if (kind !== 'all' && task.kind !== kind) return false
    if (status === 'active') return task.state === 'queued' || task.state === 'running'
    if (status === 'completed') return task.state === 'completed'
    if (status === 'exception') return ['failed', 'interrupted', 'cancelled'].includes(task.state)
    return true
  })
}

export function editorTaskActions(
  task: EditorTask,
  {
    readonly,
    documentId,
    exportKind,
    canRetryExport,
    canCancelTool,
    canCancelProxy = false
  }: {
    readonly: boolean
    documentId: string
    exportKind?: 'audio' | 'video'
    canRetryExport: boolean
    canCancelTool: boolean
    canCancelProxy?: boolean
  }
): ('cancel' | 'resume' | 'retry-export')[] {
  if (readonly) return []
  const actions: ('cancel' | 'resume' | 'retry-export')[] = []
  const active = task.state === 'queued' || task.state === 'running'
  if (task.source === 'image-ai' && task.imageTask?.resumable) actions.push('resume')
  if (
    (active || (task.source === 'image-ai' && task.imageTask?.resumable)) &&
    (task.source !== 'image-tools' || canCancelTool) &&
    (task.source !== 'video-proxy' || canCancelProxy) &&
    !task.imageTask?.cancel_requested
  )
    actions.push('cancel')
  if (
    canRetryExport &&
    task.documentId === documentId &&
    task.source === `${exportKind}-export` &&
    ['failed', 'cancelled', 'interrupted'].includes(task.state)
  )
    actions.push('retry-export')
  return actions
}

export function editorTaskRecordOwner(task: EditorTask) {
  if (task.source === 'image-tools') return task.imageToolJob?.document_key || ''
  if (task.source === 'video-proxy') return JSON.stringify([task.workspaceId, task.documentId])
  return task.workspaceId
}

export function canRemoveEditorTaskRecord(task: EditorTask, readonly: boolean) {
  if (readonly || task.state === 'queued' || task.state === 'running') return false
  if (
    task.imageTask?.deletable === false ||
    task.exportTask?.deletable === false ||
    task.imageToolJob?.deletable === false
  )
    return false
  // Interrupted cloud tracking can still have a live remote task and must remain recoverable.
  if (task.source === 'image-ai' && task.state === 'interrupted') return false
  return !!editorTaskRecordOwner(task)
}

export function editorTaskDeleteUrl(task: EditorTask): string | null {
  if (!canRemoveEditorTaskRecord(task, false) || task.source === 'video-proxy') return null
  const routes = {
    'image-ai': '/image-ai/tasks',
    'audio-export': '/audio_studio/tasks',
    'video-export': '/video_studio/tasks',
    'image-tools': '/image-ai-tools/tasks'
  }
  const query =
    task.source === 'image-tools'
      ? new URLSearchParams({ document_key: editorTaskRecordOwner(task) })
      : new URLSearchParams({ workspace_id: task.workspaceId })
  return `${routes[task.source]}/${encodeURIComponent(task.id)}?${query}`
}
