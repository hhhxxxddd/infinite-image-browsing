import { Button, Group, Progress, Stack, Text } from '@mantine/core'
import type { MixPreparation } from './audioMixPreview'

export default function AudioMixPreparation({
  job,
  onCancel
}: {
  job: MixPreparation | null
  onCancel: () => void
}) {
  if (!job || job.state === 'ready') return null
  const active = job.state === 'queued' || job.state === 'running'
  return (
    <Stack gap={4} role="status" aria-live="polite" style={{ padding: '6px 10px' }}>
      <Group justify="space-between" gap="xs">
        <Text size="xs" c={active ? 'dimmed' : 'red'}>
          {active
            ? job.state === 'queued'
              ? '混音排队中'
              : `准备混音 · ${Math.round(job.progress * 100)}%`
            : job.error || (job.state === 'cancelled' ? '混音准备已取消' : '混音缓存已过期')}
        </Text>
        {active && (
          <Button size="compact-xs" variant="subtle" onClick={onCancel}>
            取消准备
          </Button>
        )}
      </Group>
      {active && (
        <>
          <Progress size={3} value={job.progress * 100} aria-label="混音准备进度" />
          <Text size="xs" c="dimmed">
            首次处理需完成混音后试听，结果也用于导出。缓存约{' '}
            {((job.duration * 48000 * 8) / 1024 / 1024).toFixed(0)} MB。
          </Text>
        </>
      )}
    </Stack>
  )
}
