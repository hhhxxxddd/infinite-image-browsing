export type AITaskStatus = {
  state: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled'
  phase?: string
  queue_position?: number | null
  cancel_requested?: boolean
  resumable?: boolean
}

export type AIImageTask = AITaskStatus & {
  id: string
  workspace_id: string
  name: string
  error: string
  artifact_id: string
  deleted?: boolean
  deletable?: boolean
  document_id?: string
  purpose?: 'image_edit' | 'image_generation'
  results?: { artifact_id: string; label: string; node_id: string }[]
}

export function aiTaskStatusLabel(task: AITaskStatus): string {
  if (task.state === 'completed') return '已完成'
  if (task.state === 'cancelled') return '已取消'
  if (task.state === 'failed') return '失败'
  if (task.state === 'interrupted') return '跟踪中断'
  if (task.cancel_requested) return '正在取消'
  if (task.state === 'queued') return '等待提交'
  if (task.phase === 'cloud_queued')
    return typeof task.queue_position === 'number' && task.queue_position > 0
      ? `前方 ${task.queue_position} 个任务`
      : '云端排队'
  return (
    {
      uploading: '上传输入',
      submitting: '提交中',
      processing: '处理中',
      downloading: '获取结果',
      saving: '保存结果',
      reconnecting: '重新连接'
    }[task.phase ?? ''] ?? '处理中'
  )
}
