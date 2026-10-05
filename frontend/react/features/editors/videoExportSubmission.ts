import type { WorkspaceArtifact } from '../../../src/features/workspaces/model/workspaceArtifactTypes'

export interface VideoExportTask {
  id: string
  workspace_id: string
  document_id: string
  document_revision: string
  name: string
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  phase: string
  progress: number
  error: string
  created_at: number
  updated_at: number
  artifact: WorkspaceArtifact | null
  deleted?: boolean
  deleted_artifact_ids?: string[]
  deletable?: boolean
}

export interface VideoExportInput {
  document: unknown
  revision: string
  name: string
  range?: { start: number; end: number }
}
export interface VideoExportRequest {
  task_id: string
  workspace_id: string
  document_id: string
  document_revision: string
  name: string
  document: unknown
  range?: { start: number; end: number }
}
export interface PendingVideoExport {
  version: 1
  /** Keep the original JSON immutable, including when media paths are later renamed. */
  body: string
}

export const pendingVideoExportKey = (workspaceId: string, documentId: string) =>
  `omnigallery:video-export-pending-v1:${workspaceId}:${documentId}`

export function scopedVideoExportTasks(
  tasks: VideoExportTask[],
  workspaceId: string,
  documentId: string
) {
  return tasks
    .filter(
      (task) =>
        !task.deleted && task.workspace_id === workspaceId && task.document_id === documentId
    )
    .sort((a, b) => b.created_at - a.created_at)
}

export function videoExportTaskLabel(task: VideoExportTask) {
  if (task.state === 'queued') return '等待导出'
  if (task.state === 'completed') return '已完成'
  if (task.state === 'failed') return '导出失败'
  if (task.state === 'cancelled') return '已取消'
  if (task.state === 'interrupted') return '导出中断'
  const phases: Record<string, string> = {
    preparing: '检查素材',
    rendering: '正在编码',
    saving: '保存产物'
  }
  return phases[task.phase] || '正在导出'
}

type SubmissionDependencies = {
  workspaceId: string
  documentId: string
  read: () => Pick<Storage, 'getItem'>
  mutate: <T>(operation: (storage: Storage) => T) => Promise<T>
  post: (body: string) => Promise<VideoExportTask>
  createId: () => string
}

/** Persists before POST; uncertain responses can only retry the exact same task and snapshot. */
export class VideoExportSubmission {
  private dependencies: SubmissionDependencies
  readonly key: string
  constructor(dependencies: SubmissionDependencies) {
    this.dependencies = dependencies
    this.key = pendingVideoExportKey(dependencies.workspaceId, dependencies.documentId)
  }

  pending(storage = this.dependencies.read()): VideoExportRequest | null {
    const raw = storage.getItem(this.key)
    if (!raw) return null
    try {
      const record = JSON.parse(raw) as PendingVideoExport
      const value = JSON.parse(record.body) as VideoExportRequest
      if (
        record.version !== 1 ||
        !/^[\da-f-]{36}$/i.test(value.task_id) ||
        value.workspace_id !== this.dependencies.workspaceId ||
        value.document_id !== this.dependencies.documentId ||
        !/^[a-f0-9]{64}$/.test(value.document_revision) ||
        typeof value.name !== 'string' ||
        !value.document ||
        typeof value.document !== 'object'
      )
        throw new Error('invalid')
      return value
    } catch {
      throw new Error('待确认的视频导出记录无法读取，已保留原记录；请重新打开制作文件')
    }
  }

  async submit(input: VideoExportInput) {
    const document = JSON.parse(JSON.stringify(input.document)) as unknown
    const range = input.range ? { ...input.range } : undefined
    const pending = await this.dependencies.mutate((storage) => {
      const existing = this.pending(storage)
      if (existing) {
        if (
          existing.document_revision !== input.revision ||
          existing.name !== input.name ||
          JSON.stringify(existing.range) !== JSON.stringify(range) ||
          JSON.stringify(existing.document) !== JSON.stringify(document)
        ) {
          throw new Error('上次导出尚未确认，请先在导出任务中重试确认，避免重复导出')
        }
        return existing
      }
      const request: VideoExportRequest = {
        task_id: this.dependencies.createId(),
        workspace_id: this.dependencies.workspaceId,
        document_id: this.dependencies.documentId,
        document_revision: input.revision,
        document,
        name: input.name,
        ...(range ? { range } : {})
      }
      storage.setItem(
        this.key,
        JSON.stringify({ version: 1, body: JSON.stringify(request) } satisfies PendingVideoExport)
      )
      return request
    })
    return this.post(pending)
  }

  async retry() {
    const pending = this.pending()
    if (!pending) throw new Error('没有待确认的视频导出')
    return this.post(pending)
  }

  async acknowledge(task: VideoExportTask) {
    await this.dependencies.mutate((storage) => {
      const pending = this.pending(storage)
      if (!pending || pending.task_id !== task.id) return
      if (
        task.workspace_id !== pending.workspace_id ||
        task.document_id !== pending.document_id ||
        task.document_revision !== pending.document_revision ||
        task.name !== pending.name
      ) {
        throw new Error('导出编号对应的任务内容不一致，待确认记录已保留')
      }
      storage.removeItem(this.key)
    })
  }

  private async clearRejected(taskId: string) {
    await this.dependencies.mutate((storage) => {
      if (this.pending(storage)?.task_id === taskId) storage.removeItem(this.key)
    })
  }

  private async post(
    pending: VideoExportRequest
  ): Promise<{ task: VideoExportTask; warning: string }> {
    let task: VideoExportTask
    try {
      task = await this.dependencies.post(JSON.stringify(pending))
    } catch (error) {
      // A retry may fail before the server looks up an earlier accepted request.
      // Only an explicit post-deduplication rejection proves the task does not exist.
      if (
        error &&
        typeof error === 'object' &&
        'notCreated' in error &&
        error.notCreated === true
      ) {
        try {
          await this.clearRejected(pending.task_id)
        } catch {
          /* Keep the retry record if clearing failed. */
        }
      }
      throw error
    }
    if (
      task.id !== pending.task_id ||
      task.workspace_id !== pending.workspace_id ||
      task.document_id !== pending.document_id ||
      task.document_revision !== pending.document_revision ||
      task.name !== pending.name
    ) {
      throw new Error('导出任务响应与提交不一致，待确认记录已保留')
    }
    try {
      await this.acknowledge(task)
      return { task, warning: '' }
    } catch {
      return { task, warning: '导出任务已确认，但本地确认记录未能清理；再次确认不会重复导出' }
    }
  }
}
