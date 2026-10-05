import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  Progress,
  Stack,
  Text,
  Tooltip
} from '@mantine/core'
import { IconPlayerPlay, IconRefresh, IconX } from '@tabler/icons-react'
import type { VideoExports } from './useVideoExports'
import { videoExportTaskLabel } from './videoExportSubmission'
import './VideoExportTasks.css'

export default function VideoExportTasks({
  exports,
  readonly,
  onPreview,
  onClose
}: {
  exports: VideoExports
  readonly: boolean
  onPreview: (path: string) => void
  onClose: () => void
}) {
  return (
    <section className="video-export-tasks" id="video-export-task-list" aria-label="视频导出任务">
      <Group justify="space-between" wrap="nowrap">
        <Text fw={700} size="sm">
          导出任务
        </Text>
        <Group gap={4} wrap="nowrap">
          <Tooltip label="刷新导出任务">
            <ActionIcon
              variant="subtle"
              aria-label="刷新导出任务"
              loading={exports.refreshing}
              onClick={() => void exports.refresh()}
            >
              <IconRefresh size={17} />
            </ActionIcon>
          </Tooltip>
          <ActionIcon variant="subtle" aria-label="关闭导出任务" onClick={onClose}>
            <IconX size={17} />
          </ActionIcon>
        </Group>
      </Group>
      {exports.error && (
        <Alert color="red" variant="light" className="video-export-error">
          {exports.error}
        </Alert>
      )}
      {exports.pending && (
        <Paper p="sm" withBorder radius="sm">
          <Stack gap="xs">
            <Text size="xs" fw={600} truncate title={exports.pending.name}>
              {exports.pending.name}
            </Text>
            <Text size="xs" c="dimmed">
              提交结果尚未确认。重试会核对同一份导出，不会创建重复任务。
            </Text>
            <Button
              size="xs"
              variant="light"
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
        {exports.tasks.map((task) => {
          const active = task.state === 'queued' || task.state === 'running'
          const progress = Math.max(
            0,
            Math.min(100, Number.isFinite(task.progress) ? task.progress : 0)
          )
          return (
            <Paper key={task.id} p="sm" radius="sm" withBorder>
              <Stack gap="xs">
                <Group justify="space-between" gap="xs" wrap="nowrap">
                  <Text size="xs" fw={600} truncate title={task.name}>
                    {task.name}
                  </Text>
                  <Badge
                    size="xs"
                    variant="light"
                    color={
                      task.state === 'completed'
                        ? 'teal'
                        : task.state === 'failed' || task.state === 'interrupted'
                          ? 'red'
                          : task.state === 'cancelled'
                            ? 'gray'
                            : 'blue'
                    }
                  >
                    {videoExportTaskLabel(task)}
                  </Badge>
                </Group>
                <Text size="xs" c="dimmed">
                  {new Date(task.created_at * 1000).toLocaleString()}
                </Text>
                {active && (
                  <>
                    <Progress
                      value={progress}
                      animated={task.state === 'running'}
                      aria-label={`导出进度 ${Math.floor(progress)}%`}
                    />
                    <Group justify="space-between" wrap="nowrap">
                      <Text size="xs" c="dimmed">
                        {task.state === 'queued' ? '等待本地导出队列' : `${Math.floor(progress)}%`}
                      </Text>
                      {!readonly && (
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          color="gray"
                          loading={exports.cancelling === task.id}
                          disabled={!!exports.cancelling}
                          onClick={() => void exports.cancel(task.id)}
                        >
                          取消导出
                        </Button>
                      )}
                    </Group>
                  </>
                )}
                {task.error && (
                  <Text size="xs" c="red" className="video-export-error">
                    {task.error}
                  </Text>
                )}
                {task.state === 'interrupted' && (
                  <Text size="xs" c="dimmed">
                    本次导出未完成，可检查后重新导出。
                  </Text>
                )}
                {task.state === 'completed' && task.artifact && (
                  <Button
                    size="xs"
                    variant="light"
                    leftSection={<IconPlayerPlay size={14} />}
                    onClick={() => onPreview(`workspace-artifact:${task.artifact?.id}`)}
                  >
                    查看产物
                  </Button>
                )}
              </Stack>
            </Paper>
          )
        })}
      </div>
    </section>
  )
}
