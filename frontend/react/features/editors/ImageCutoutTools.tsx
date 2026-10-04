import { Button, Divider, Group, Stack, Switch, Text, Tooltip } from '@mantine/core'
import { IconCircleMinus, IconCirclePlus, IconSelect } from '@tabler/icons-react'
import EditorParameterSlider from './EditorParameterSlider'
import type { useImageAITasks } from './useImageAITasks'
import './ImageCutoutTools.css'

const selectionTools = [
  {
    id: 'positive',
    label: '保留点',
    icon: IconCirclePlus,
    hint: '点击要保留的主体，再次点击标记可移除。'
  },
  {
    id: 'negative',
    label: '排除点',
    icon: IconCircleMinus,
    hint: '点击要排除的区域，再次点击标记可移除。'
  },
  { id: 'box', label: '框选', icon: IconSelect, hint: '拖出一个主体选框，框选与点选分别使用。' }
] as const

export default function ImageCutoutTools({
  cutout,
  disabled,
  name
}: {
  cutout: ReturnType<typeof useImageAITasks>
  disabled: boolean
  name?: string
}) {
  const { hints, setHints, busy, config, currentJob, view } = cutout
  const controlsDisabled = disabled || busy || !!cutout.accepting || view !== 'selection'
  const noHints = hints.mode === 'points' ? !hints.positive.length : !hints.box
  const selecting = view === 'selection' || busy
  const selectionTool = hints.mode === 'box' ? 'box' : cutout.pointKind
  return (
    <Stack gap="sm">
      <Text size="xs" c="dimmed" truncate title={name}>
        {name ? `图片 · ${name}` : '请选择一个图片图层'}
      </Text>
      {cutout.recoverable && (
        <Button
          size="xs"
          variant="default"
          disabled={disabled || busy || !!cutout.accepting}
          onClick={cutout.recover}
        >
          恢复上次结果
        </Button>
      )}
      {selecting ? (
        <>
          <Stack gap={8}>
            <Group justify="space-between">
              <Text size="xs" fw={600}>
                选择主体
              </Text>
              <Group gap={4}>
                {cutout.previous && (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    disabled={disabled || busy}
                    onClick={() => cutout.setView('after')}
                  >
                    查看对比
                  </Button>
                )}
                <Button
                  size="compact-xs"
                  variant="subtle"
                  disabled={
                    controlsDisabled ||
                    (!hints.positive.length && !hints.negative.length && !hints.box)
                  }
                  onClick={() => setHints({ ...hints, positive: [], negative: [], box: null })}
                >
                  清空选区
                </Button>
              </Group>
            </Group>
            <div className="react-image-cutout-tools" role="group" aria-label="选区工具">
              {selectionTools.map(({ id, label, icon: Icon, hint }) => (
                <Tooltip key={id} label={hint}>
                  <button
                    type="button"
                    className="react-image-cutout-tool"
                    data-tool={id}
                    aria-pressed={selectionTool === id}
                    disabled={controlsDisabled}
                    onClick={() => {
                      setHints({ ...hints, mode: id === 'box' ? 'box' : 'points' })
                      if (id !== 'box') cutout.setPointKind(id)
                    }}
                  >
                    <Icon size={20} stroke={1.6} />
                    <span>{label}</span>
                  </button>
                </Tooltip>
              ))}
            </div>
          </Stack>
          <Divider />
          <Tooltip label="增加精修次数可能改善边缘，也会延长处理时间；0 表示不追加精修。">
            <div>
              <EditorParameterSlider
                label="边缘精修"
                min={0}
                max={5}
                step={1}
                resetValue={config?.defaults.refine_iterations ?? 3}
                value={hints.refine_iterations}
                formatValue={(v) => `${v} 次`}
                disabled={controlsDisabled}
                onChange={(refine_iterations) => setHints({ ...hints, refine_iterations })}
              />
            </div>
          </Tooltip>
          <Tooltip label="裁去外围透明留白，保留主体的最小矩形；不改变主体在画布上的位置和大小。">
            <Switch
              size="xs"
              label="按边缘裁剪"
              checked={hints.trim_transparent ?? false}
              disabled={controlsDisabled}
              onChange={(event) =>
                setHints({ ...hints, trim_transparent: event.currentTarget.checked })
              }
            />
          </Tooltip>
          <Button
            fullWidth
            size="xs"
            disabled={controlsDisabled || noHints || !config?.ready}
            loading={!!cutout.preparing}
            onClick={() => void cutout.start()}
          >
            开始抠图
          </Button>
        </>
      ) : (
        <Stack gap="sm" className="react-image-cutout-comparison">
          <Text size="xs" fw={600}>
            效果对比
          </Text>
          <Switch
            size="xs"
            label="显示处理前"
            checked={view === 'before'}
            disabled={disabled || busy || !!cutout.accepting}
            onChange={(event) => cutout.setView(event.currentTarget.checked ? 'before' : 'after')}
          />
          <Button
            size="xs"
            variant="default"
            fullWidth
            disabled={disabled || busy || !!cutout.accepting}
            onClick={() => cutout.setView('selection')}
          >
            调整选区
          </Button>
          <Button
            size="xs"
            fullWidth
            disabled={disabled || busy}
            loading={!!cutout.accepting}
            onClick={() => void cutout.accept()}
          >
            采用结果
          </Button>
        </Stack>
      )}
      {config && !config.ready && (
        <Text size="xs" c="orange">
          请先在设置中配置 Comfy Cloud API Key
        </Text>
      )}
      {cutout.connectionError && (
        <Text size="xs" c="orange">
          {cutout.connectionError}
        </Text>
      )}
      {currentJob && ['queued', 'running'].includes(currentJob.state) && (
        <Group justify="space-between">
          <Text size="xs">{currentJob.state === 'queued' ? '等待抠图' : '正在抠图'}…</Text>
          <Tooltip label="停止应用本次结果；云端任务可能仍会继续运行。">
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => void cutout.cancel(currentJob)}
            >
              取消
            </Button>
          </Tooltip>
        </Group>
      )}
      {currentJob && !busy && !['queued', 'running'].includes(currentJob.state) && (
        <Text size="xs" c={currentJob.state === 'failed' ? 'red' : 'dimmed'}>
          {currentJob.state === 'failed'
            ? currentJob.error
            : currentJob.state === 'canceled'
              ? '已取消抠图'
              : '抠图已完成'}
        </Text>
      )}
    </Stack>
  )
}
