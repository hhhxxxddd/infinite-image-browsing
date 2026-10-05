import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  Progress,
  Stack,
  Text
} from '@mantine/core'
import { IconPlayerPlay, IconRefresh, IconX } from '@tabler/icons-react'
import type { AudioExports } from './useAudioExports'
import { videoExportTaskLabel } from './videoExportSubmission'
import './VideoExportTasks.css'

export default function AudioExportTasks({
  exports,
  readonly,
  onPreview,
  onClose,
  onRetry
}: {
  exports: AudioExports
  readonly: boolean
  onPreview: (path: string) => void
  onClose: () => void
  onRetry?: () => void
}) {
  return (
    <section className="video-export-tasks" id="audio-export-task-list" aria-label="音频导出任务">
      <Group justify="space-between">
        <Text fw={700} size="sm">
          导出任务
        </Text>
        <Group gap={4}>
          <ActionIcon
            variant="subtle"
            aria-label="刷新导出任务"
            loading={exports.refreshing}
            onClick={() => void exports.refresh()}
          >
            <IconRefresh size={17} />
          </ActionIcon>
          <ActionIcon variant="subtle" aria-label="关闭导出任务" onClick={onClose}>
            <IconX size={17} />
          </ActionIcon>
        </Group>
      </Group>
      {exports.error && (
        <Alert color="red" className="video-export-error">
          {exports.error}
        </Alert>
      )}
      {exports.pending && (
        <Paper p="sm" withBorder>
          <Stack gap="xs">
            <Text size="xs" fw={600}>
              {exports.pending.name}
            </Text>
            <Text size="xs" c="dimmed">
              提交结果尚未确认。重试会核对同一份导出，不会重复创建任务。
            </Text>
            <Button
              size="xs"
              disabled={readonly}
              loading={exports.submitting}
              onClick={() => void exports.retryPending()}
            >
              重试确认
            </Button>
          </Stack>
        </Paper>
      )}
      <div className="video-export-task-list">
        {!exports.tasks.length && (
          <Text size="xs" c="dimmed" ta="center" py="lg">
            {exports.refreshing ? '正在读取导出任务…' : '当前制作文件还没有导出任务'}
          </Text>
        )}
        {exports.tasks.map((task) => (
          <Paper key={task.id} p="sm" withBorder>
            <Stack gap="xs">
              <Group justify="space-between" wrap="nowrap">
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
                        : 'blue'
                  }
                >
                  {videoExportTaskLabel(task)}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed">
                {new Date(task.created_at * 1000).toLocaleString()}
              </Text>
              {['queued', 'running'].includes(task.state) && (
                <>
                  <Progress
                    value={Math.max(0, Math.min(100, task.progress || 0))}
                    animated={task.state === 'running'}
                    aria-label="导出进度"
                  />
                  <Group justify="space-between">
                    <Text size="xs">{Math.floor(task.progress || 0)}%</Text>
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      disabled={readonly || !!exports.cancelling}
                      loading={exports.cancelling === task.id}
                      onClick={() => void exports.cancel(task.id)}
                    >
                      取消导出
                    </Button>
                  </Group>
                </>
              )}
              {task.error && (
                <Text size="xs" c="red" className="video-export-error">
                  {task.error}
                </Text>
              )}
              {onRetry && ['failed', 'interrupted', 'cancelled'].includes(task.state) && (
                <Button size="xs" variant="light" disabled={readonly} onClick={onRetry}>
                  重新导出当前制作文件
                </Button>
              )}
              {task.state === 'completed' && task.artifact && (
                <Button
                  size="xs"
                  variant="light"
                  leftSection={<IconPlayerPlay size={14} />}
                  onClick={() => {
                    if (task.artifact) onPreview(`workspace-artifact:${task.artifact.id}`)
                  }}
                >
                  查看产物
                </Button>
              )}
            </Stack>
          </Paper>
        ))}
      </div>
    </section>
  )
}
