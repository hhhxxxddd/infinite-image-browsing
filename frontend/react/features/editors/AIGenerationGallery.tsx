import { useEffect, useRef, useState } from 'react'
import { ActionIcon, Button, Group, Loader, Stack, Text, Title, Tooltip } from '@mantine/core'
import {
  IconChevronLeft,
  IconChevronRight,
  IconPhotoOff,
  IconRefresh,
  IconSparkles,
  IconZoomIn,
  IconZoomOut
} from '@tabler/icons-react'
import { apiUrl } from '../../shared/apiClient'
import { aiTaskStatusLabel } from './aiTaskStatus'
import type { AIImageTask } from './AITaskList'
import type { GenerationTaskResult } from './aiGenerationResults'
import './AIGenerationGallery.css'

function ResultImage({ result }: { result: GenerationTaskResult }) {
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [retry, setRetry] = useState(0)
  const canvas = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null)
  useEffect(() => {
    const target = canvas.current
    if (!target || state !== 'ready') return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      setZoom((value) => Math.max(0.25, Math.min(4, value * (event.deltaY < 0 ? 1.1 : 1 / 1.1))))
    }
    target.addEventListener('wheel', wheel, { passive: false })
    return () => target.removeEventListener('wheel', wheel)
  }, [state])
  function fit() {
    setZoom(1)
    setOffset({ x: 0, y: 0 })
  }
  return (
    <>
      <div
        ref={canvas}
        className="react-ai-result-canvas"
        data-ready={state === 'ready'}
        onPointerDown={(event) => {
          if (event.button !== 0 || state !== 'ready') return
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            offsetX: offset.x,
            offsetY: offset.y
          }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (!drag.current) return
          setOffset({
            x: drag.current.offsetX + event.clientX - drag.current.x,
            y: drag.current.offsetY + event.clientY - drag.current.y
          })
        }}
        onPointerUp={() => {
          drag.current = null
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
        onLostPointerCapture={() => {
          drag.current = null
        }}
        onDoubleClick={fit}
        aria-label="AI 生成结果预览"
        aria-busy={state === 'loading'}
      >
        <img
          key={retry}
          src={apiUrl(
            `/workspace_artifacts/${encodeURIComponent(result.artifactId)}/file${retry ? `?retry=${retry}` : ''}`
          )}
          alt={result.label || 'AI 生成结果'}
          draggable={false}
          onLoad={() => setState('ready')}
          onError={() => setState('error')}
          style={{
            visibility: state === 'ready' ? 'visible' : 'hidden',
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`
          }}
        />
        {state === 'loading' && (
          <Stack className="react-ai-result-message" align="center" gap="xs" role="status">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">
              正在读取生成结果
            </Text>
          </Stack>
        )}
        {state === 'error' && (
          <Stack className="react-ai-result-message" align="center" gap="xs" role="alert">
            <IconPhotoOff size={32} stroke={1.3} />
            <Text size="sm">无法读取这张产物</Text>
            <Button
              size="xs"
              variant="default"
              leftSection={<IconRefresh size={14} />}
              onClick={() => {
                setState('loading')
                setRetry((value) => value + 1)
              }}
            >
              重新加载
            </Button>
          </Stack>
        )}
      </div>
      <Group className="react-ai-result-zoom" gap={4} wrap="nowrap">
        <Text size="xs" c="dimmed">
          视图缩放
        </Text>
        <Tooltip label="缩小画面">
          <ActionIcon
            variant="subtle"
            aria-label="缩小画面"
            disabled={state !== 'ready' || zoom <= 0.25}
            onClick={() => setZoom((value) => Math.max(0.25, value / 1.1))}
          >
            <IconZoomOut size={16} />
          </ActionIcon>
        </Tooltip>
        <Text size="xs" className="react-ai-result-zoom-value">
          {Math.round(zoom * 100)}%
        </Text>
        <Tooltip label="放大画面">
          <ActionIcon
            variant="subtle"
            aria-label="放大画面"
            disabled={state !== 'ready' || zoom >= 4}
            onClick={() => setZoom((value) => Math.min(4, value * 1.1))}
          >
            <IconZoomIn size={16} />
          </ActionIcon>
        </Tooltip>
        <Button size="compact-xs" variant="subtle" onClick={fit} disabled={state !== 'ready'}>
          适应
        </Button>
      </Group>
    </>
  )
}

export default function AIGenerationGallery({
  results,
  selectedId,
  onSelect,
  loading,
  task,
  onShowTasks
}: {
  results: GenerationTaskResult[]
  selectedId: string
  onSelect: (artifactId: string) => void
  loading: boolean
  task?: AIImageTask
  onShowTasks: () => void
}) {
  const index = Math.max(
    0,
    results.findIndex((result) => result.artifactId === selectedId)
  )
  const result = results[index]
  const active = task?.state === 'queued' || task?.state === 'running'
  if (!result)
    return (
      <Stack align="center" maw={420} gap="sm" className="react-ai-generation-empty" role="status">
        {loading || active ? (
          <Loader size="lg" />
        ) : (
          <IconSparkles size={44} color="var(--mantine-primary-color-filled)" />
        )}
        <Title order={3}>
          {loading
            ? '正在读取生成结果'
            : task
              ? `生成任务 · ${aiTaskStatusLabel(task)}`
              : '从描述开始创作'}
        </Title>
        <Text c="dimmed" ta="center" size="sm">
          {loading
            ? '读取当前制作文件的任务与产物'
            : active
              ? '完成后会在这里展示图片，可以继续调整下一次生成的描述。'
              : task
                ? task.error || '可在任务列表查看这次任务的详情。'
                : '在右侧输入画面描述，生成结果将在这里展示。'}
        </Text>
        {!loading && task && (
          <Button size="xs" variant="default" onClick={onShowTasks}>
            查看任务
          </Button>
        )}
      </Stack>
    )
  return (
    <section className="react-ai-result-gallery" aria-label="图片生成结果">
      <Group className="react-ai-result-heading" justify="space-between" wrap="nowrap" gap="sm">
        <Text size="xs" c="dimmed" truncate title={result.label}>
          {result.label || 'AI 生成结果'}
        </Text>
        <Group gap={4} wrap="nowrap">
          {active && (
            <Button size="compact-xs" variant="subtle" onClick={onShowTasks}>
              {aiTaskStatusLabel(task)}
            </Button>
          )}
          {results.length > 1 && (
            <>
              <ActionIcon
                variant="subtle"
                aria-label="上一张生成结果"
                disabled={index === 0}
                onClick={() => onSelect(results[index - 1].artifactId)}
              >
                <IconChevronLeft size={16} />
              </ActionIcon>
              <Text size="xs" className="react-ai-result-page">
                {index + 1} / {results.length}
              </Text>
              <ActionIcon
                variant="subtle"
                aria-label="下一张生成结果"
                disabled={index === results.length - 1}
                onClick={() => onSelect(results[index + 1].artifactId)}
              >
                <IconChevronRight size={16} />
              </ActionIcon>
            </>
          )}
        </Group>
      </Group>
      <ResultImage key={result.artifactId} result={result} />
      {results.length > 1 && (
        <div className="react-ai-result-thumbnails" aria-label="生成结果列表">
          {results.map((item, itemIndex) => (
            <button
              key={item.artifactId}
              type="button"
              aria-label={`显示生成结果 ${itemIndex + 1}：${item.label}`}
              aria-pressed={item.artifactId === result.artifactId}
              title={item.label}
              onClick={() => onSelect(item.artifactId)}
            >
              <img
                src={apiUrl(
                  `/workspace_artifacts/${encodeURIComponent(item.artifactId)}/thumbnail?size=160`
                )}
                alt=""
                loading="lazy"
              />
              <span>{itemIndex + 1}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
