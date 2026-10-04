import { useState } from 'react'
import { ActionIcon, Badge, Button, Group, Paper, Stack, Text, Tooltip } from '@mantine/core'
import { IconRefresh, IconX } from '@tabler/icons-react'
import { apiUrl } from '../../shared/apiClient'
import { aiTaskStatusLabel, type AITaskStatus } from './aiTaskStatus'

export type AIImageTask = AITaskStatus & {
  id: string
  workspace_id: string
  name: string
  error: string
  artifact_id: string
  document_id?: string
  purpose?: 'image_edit' | 'image_generation'
  results?: { artifact_id: string; label: string; node_id: string }[]
}

export default function AITaskList({
  tasks,
  documentName,
  readonly,
  taskAction,
  onRefresh,
  onClose,
  onAction,
  onViewResult
}: {
  tasks: AIImageTask[]
  documentName: string
  readonly: boolean
  taskAction: string
  onRefresh: () => Promise<void>
  onClose: () => void
  onAction: (task: AIImageTask, action: 'cancel' | 'resume') => Promise<void>
  onViewResult: (task: AIImageTask, artifactId: string) => void
}) {
  const [refreshing, setRefreshing] = useState(false)
  async function refresh() {
    setRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setRefreshing(false)
    }
  }
  return (
    <section className="react-ai-tasks-panel" id="ai-studio-task-list" aria-label="任务列表">
      <Group justify="space-between" wrap="nowrap">
        <Text size="sm" fw={700}>
          任务列表
        </Text>
        <Group gap={4} wrap="nowrap">
          <Tooltip label="刷新任务">
            <ActionIcon
              aria-label="刷新任务"
              variant="subtle"
              loading={refreshing}
              onClick={() => void refresh()}
            >
              <IconRefresh size={17} />
            </ActionIcon>
          </Tooltip>
          <ActionIcon aria-label="关闭任务列表" variant="subtle" onClick={onClose}>
            <IconX size={17} />
          </ActionIcon>
        </Group>
      </Group>
      <Text size="xs" c="dimmed" truncate title={documentName}>
        {documentName}
      </Text>
      <div className="react-ai-task-list">
        {!tasks.length && (
          <Text size="xs" c="dimmed" py="lg" ta="center">
            当前制作文件还没有任务
          </Text>
        )}
        {tasks
          .slice()
          .reverse()
          .map((task) => {
            const results = task.results?.length
              ? task.results
              : task.artifact_id
                ? [{ artifact_id: task.artifact_id, label: task.name, node_id: '' }]
                : []
            return (
              <Paper key={task.id} withBorder radius="sm" p="sm">
                <Stack gap="xs">
                  <Group justify="space-between" wrap="nowrap" gap="xs">
                    <Text size="xs" fw={650} truncate title={task.name}>
                      {task.name}
                    </Text>
                    <Badge
                      size="xs"
                      style={{ flexShrink: 0 }}
                      color={
                        task.state === 'completed'
                          ? 'teal'
                          : task.state === 'failed' || task.state === 'interrupted'
                            ? 'red'
                            : 'blue'
                      }
                    >
                      {aiTaskStatusLabel(task)}
                    </Badge>
                  </Group>
                  {!readonly &&
                    (task.state === 'queued' || task.state === 'running' || task.resumable) && (
                      <Group gap="xs">
                        {task.resumable && (
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            loading={taskAction === task.id}
                            disabled={!!taskAction}
                            onClick={() => void onAction(task, 'resume')}
                          >
                            继续跟踪
                          </Button>
                        )}
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          color="gray"
                          loading={taskAction === task.id}
                          disabled={!!taskAction || task.cancel_requested}
                          onClick={() => void onAction(task, 'cancel')}
                        >
                          {task.cancel_requested ? '已请求取消' : '取消任务'}
                        </Button>
                      </Group>
                    )}
                  {task.error && (
                    <Text size="xs" c="red" className="react-ai-task-error">
                      {task.error}
                    </Text>
                  )}
                  {!!results.length && (
                    <div className="react-ai-task-results">
                      {results.map((result) => (
                        <button
                          key={result.artifact_id}
                          type="button"
                          className="react-ai-task-result"
                          onClick={() => onViewResult(task, result.artifact_id)}
                          aria-label={`查看结果：${result.label || task.name}`}
                          title={result.label || task.name}
                        >
                          <img
                            src={apiUrl(
                              `/workspace_artifacts/${encodeURIComponent(result.artifact_id)}/thumbnail?size=320`
                            )}
                            alt={result.label || task.name}
                            loading="lazy"
                          />
                          <span>{result.label || task.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </Stack>
              </Paper>
            )
          })}
      </div>
    </section>
  )
}
