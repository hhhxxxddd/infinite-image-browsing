import {
  ActionIcon,
  Button,
  Divider,
  Group,
  NumberInput,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  Textarea,
  Tooltip
} from '@mantine/core'
import { IconArrowBackUp, IconBrush, IconEraser, IconLock, IconLockOpen } from '@tabler/icons-react'
import type { useImageAITasks } from './useImageAITasks'
import {
  eraseAlignedSize,
  erasePlan,
  erasePrompt
} from '../../../src/features/image-editor/model/imageStudioErase'
import { upscaleSizeError } from '../../../src/features/image-editor/model/imageStudioUpscale'
import { eraseMask } from './imageEraseInput'
import EditorParameterSlider from './EditorParameterSlider'
import './ImageEraseTools.css'

export default function ImageEraseTools({
  erase,
  disabled,
  name
}: {
  erase: ReturnType<typeof useImageAITasks>['erase']
  disabled: boolean
  name?: string
}) {
  const { draft, setDraft, size, busy, previous, currentJob } = erase
  const selecting = erase.view === 'selection' || busy
  const blocked = disabled || busy || !!erase.accepting
  const plan = size && erasePlan(draft, size)
  const sizeError = size ? upscaleSizeError(size, 1) : ''
  const rangeError =
    plan &&
    (plan.processing.width * plan.processing.height > 100_000_000 ||
      Math.max(plan.processing.width, plan.processing.height) > 32768)
      ? '处理范围过大，请调整处理宽高比例'
      : ''
  function changeSize(axis: 'width' | 'height', value: number | string) {
    if (typeof value !== 'number') return
    const v = Math.max(64, Math.min(4096, value))
    const other = axis === 'width' ? 'height' : 'width'
    const ratio = plan ? plan.context[other] / plan.context[axis] : 1
    setDraft({
      ...draft,
      [`output_${axis}`]: v,
      ...(draft.linked
        ? { [`output_${other}`]: Math.max(64, Math.min(4096, Math.round(v * ratio))) }
        : {})
    })
  }
  return (
    <Stack gap="xs" className="react-image-erase-tools">
      <Text size="xs" c="dimmed" truncate title={name}>
        {name ? `图片 · ${name}` : '请选择一个图片图层'}
      </Text>
      {erase.recoverable && (
        <Button size="xs" variant="default" disabled={blocked} onClick={erase.recover}>
          恢复上次结果
        </Button>
      )}
      {selecting ? (
        <>
          <Group justify="space-between" gap={4}>
            <Text size="xs" fw={600}>
              消除区域
            </Text>
            <Group gap={2}>
              {previous && (
                <Button
                  size="compact-xs"
                  variant="subtle"
                  disabled={blocked}
                  onClick={() => erase.setView('after')}
                >
                  查看对比
                </Button>
              )}
              <Tooltip label="撤回一笔">
                <ActionIcon
                  size="sm"
                  aria-label="撤回一笔"
                  variant="subtle"
                  disabled={blocked || !draft.strokes.length}
                  onClick={() => {
                    const strokes = draft.strokes.slice(0, -1)
                    const mask = size && eraseMask(strokes, size)
                    setDraft({ ...draft, strokes, bounds: mask?.bounds || null })
                    if (mask) mask.canvas.width = mask.canvas.height = 0
                  }}
                >
                  <IconArrowBackUp size={15} />
                </ActionIcon>
              </Tooltip>
              <Button
                size="compact-xs"
                variant="subtle"
                disabled={blocked || !draft.strokes.length}
                onClick={() => setDraft({ ...draft, strokes: [], bounds: null })}
              >
                清空
              </Button>
            </Group>
          </Group>
          <div className="react-image-cutout-tools" role="group" aria-label="消除工具">
            {(
              [
                { id: 'paint', label: '涂抹', icon: IconBrush },
                { id: 'erase', label: '擦除选区', icon: IconEraser }
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className="react-image-cutout-tool"
                data-tool={id}
                aria-pressed={erase.mode === id}
                title={id === 'paint' ? '涂抹需要消除的区域' : '从涂抹选区中擦掉笔迹，不擦除图片'}
                disabled={blocked}
                onClick={() => erase.setMode(id)}
              >
                <Icon size={18} />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <EditorParameterSlider
            label="笔刷大小"
            min={1}
            max={Math.max(1, Math.min(500, size ? Math.min(size.width, size.height) : 500))}
            step={1}
            value={erase.brush}
            resetValue={24}
            formatValue={(v) => `${v}px`}
            disabled={blocked}
            onChange={erase.setBrush}
          />
          <Divider />
          <Group justify="space-between">
            <Tooltip label="局部：围绕涂抹区参考周边，可直接拖动黄框。整图：让 AI 参考完整图片。">
              <Text size="xs" fw={600}>
                参考范围
              </Text>
            </Tooltip>
            <Group gap={4}>
              {draft.range === 'manual' && (
                <Button
                  size="compact-xs"
                  variant="subtle"
                  disabled={blocked}
                  onClick={() => setDraft({ ...draft, range: 'auto', context: null })}
                >
                  重置范围
                </Button>
              )}
              <SegmentedControl
                size="xs"
                aria-label="AI 参考范围"
                value={draft.range === 'whole' ? 'whole' : 'local'}
                data={[
                  { value: 'local', label: '局部' },
                  { value: 'whole', label: '整图' }
                ]}
                disabled={blocked}
                onChange={(v) =>
                  setDraft({ ...draft, range: v === 'whole' ? 'whole' : 'auto', context: null })
                }
              />
            </Group>
          </Group>
          <div className="react-image-erase-size">
            <NumberInput
              label="处理宽度 px"
              aria-label="消除处理宽度"
              size="xs"
              value={draft.linked && plan ? plan.target.width : draft.output_width}
              min={64}
              max={4096}
              step={32}
              allowDecimal={false}
              disabled={blocked}
              onChange={(v) => changeSize('width', v)}
              onBlur={() =>
                setDraft({ ...draft, output_width: eraseAlignedSize(draft.output_width) })
              }
            />
            <Tooltip label="处理尺寸跟随范围比例">
              <ActionIcon
                mb={2}
                aria-label="处理尺寸跟随范围比例"
                aria-pressed={draft.linked}
                variant={draft.linked ? 'light' : 'subtle'}
                disabled={blocked}
                onClick={() => setDraft({ ...draft, linked: !draft.linked })}
              >
                {draft.linked ? <IconLock size={15} /> : <IconLockOpen size={15} />}
              </ActionIcon>
            </Tooltip>
            <NumberInput
              label="处理高度 px"
              aria-label="消除处理高度"
              size="xs"
              value={draft.linked && plan ? plan.target.height : draft.output_height}
              min={64}
              max={4096}
              step={32}
              allowDecimal={false}
              disabled={blocked}
              onChange={(v) => changeSize('height', v)}
              onBlur={() =>
                setDraft({ ...draft, output_height: eraseAlignedSize(draft.output_height) })
              }
            />
          </div>
          {plan && (
            <Text size="xs" c="dimmed">
              范围 {plan.processing.width} × {plan.processing.height} → 处理 {plan.target.width} ×{' '}
              {plan.target.height} px
            </Text>
          )}
          <NumberInput
            size="xs"
            label="边缘融合"
            aria-label="消除边缘融合"
            min={0}
            max={256}
            allowDecimal={false}
            value={draft.blend_pixels}
            disabled={blocked}
            onChange={(v) => {
              if (typeof v === 'number')
                setDraft({ ...draft, blend_pixels: Math.max(0, Math.min(256, v)) })
            }}
          />
          <Group justify="space-between">
            <Text size="xs" fw={600}>
              提示词
            </Text>
            <Button
              size="compact-xs"
              variant="subtle"
              disabled={blocked}
              onClick={() =>
                setDraft({ ...draft, prompt: erase.config?.factory_defaults.prompt || erasePrompt })
              }
            >
              恢复默认
            </Button>
          </Group>
          <Textarea
            aria-label="消除提示词"
            size="xs"
            minRows={2}
            maxRows={4}
            autosize
            value={draft.prompt}
            maxLength={4000}
            disabled={blocked}
            onChange={(e) => setDraft({ ...draft, prompt: e.currentTarget.value })}
          />
          <Button
            size="xs"
            fullWidth
            loading={!!erase.preparing}
            disabled={
              blocked ||
              !erase.config?.ready ||
              !draft.bounds ||
              !draft.prompt.trim() ||
              !size ||
              !!sizeError ||
              !!rangeError
            }
            onClick={() => void erase.start()}
          >
            开始消除
          </Button>
        </>
      ) : (
        previous && (
          <Stack gap="sm" className="react-image-cutout-comparison">
            <Group justify="space-between">
              <Text size="xs" fw={600}>
                效果对比
              </Text>
              <Button
                size="compact-xs"
                variant="subtle"
                disabled={blocked}
                onClick={() => erase.setView('selection')}
              >
                调整选区
              </Button>
            </Group>
            <Switch
              size="xs"
              label="显示处理前"
              checked={erase.view === 'before'}
              disabled={blocked}
              onChange={(e) => erase.setView(e.currentTarget.checked ? 'before' : 'after')}
            />
            <Button
              size="xs"
              fullWidth
              disabled={disabled || busy}
              loading={!!erase.accepting}
              onClick={() => void erase.accept()}
            >
              采用结果
            </Button>
          </Stack>
        )
      )}
      {(erase.dimensionError || sizeError || rangeError) && (
        <Text size="xs" c="orange">
          {erase.dimensionError || sizeError || rangeError}
        </Text>
      )}
      {erase.config && !erase.config.ready && (
        <Text size="xs" c="orange">
          请先在设置中配置 Comfy Cloud API Key
        </Text>
      )}
      {erase.connectionError && (
        <Text size="xs" c="orange">
          {erase.connectionError}
        </Text>
      )}
      {currentJob && ['queued', 'running'].includes(currentJob.state) && (
        <Group justify="space-between">
          <Text size="xs">{currentJob.state === 'queued' ? '等待消除' : '正在消除'}…</Text>
          <Tooltip label="停止应用本次结果；云端任务可能仍会继续运行。">
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => void erase.cancel(currentJob)}
            >
              取消
            </Button>
          </Tooltip>
        </Group>
      )}
      {currentJob && !busy && ['failed', 'canceled'].includes(currentJob.state) && (
        <Text size="xs" c={currentJob.state === 'failed' ? 'red' : 'dimmed'}>
          {currentJob.state === 'failed' ? currentJob.error : '已取消消除'}
        </Text>
      )}
    </Stack>
  )
}
