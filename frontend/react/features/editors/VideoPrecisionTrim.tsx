import { useEffect, useState } from 'react'
import { Button, Group, NumberInput, SegmentedControl, Select, Stack, Text } from '@mantine/core'
import { IconPlayerPlay } from '@tabler/icons-react'
import type { Lane, VideoTimelineDocument } from './videoStudioModel'
import { formatTimelineTime } from './timelineTime'
import {
  adjacentVideoBoundaries,
  precisionPreviewRange,
  rollVideoBoundary,
  slipVideoClip,
  type VideoPrecisionPreview
} from './videoPrecisionEditing'
import './VideoPrecisionTrim.css'

export interface VideoPrecisionTrimProps {
  document: VideoTimelineDocument
  clipId: string | null
  lane: Lane
  readonly?: boolean
  onApply: (document: VideoTimelineDocument) => void
  onPreview?: (request: VideoPrecisionPreview) => void | Promise<void>
}

export default function VideoPrecisionTrim({
  document,
  clipId,
  lane,
  readonly = false,
  onApply,
  onPreview
}: VideoPrecisionTrimProps) {
  const clip = document[lane === 'visual' ? 'visuals' : 'sounds'].find((item) => item.id === clipId)
  const boundaries = clipId ? adjacentVideoBoundaries(document, clipId, lane) : []
  const [mode, setMode] = useState<'slip' | 'roll'>('slip')
  const [offset, setOffset] = useState<string | number>(0)
  const [boundaryKey, setBoundaryKey] = useState('')
  const [boundaryValue, setBoundaryValue] = useState<string | number>(0)
  const [radius, setRadius] = useState<string | number>(1)
  const [error, setError] = useState('')
  const key = (item: { leftId: string; rightId: string }) =>
    JSON.stringify([item.leftId, item.rightId])
  const boundary = boundaries.find((item) => key(item) === boundaryKey)
  useEffect(() => {
    setOffset(0)
    const next = boundaries.find((item) => item.leftId === clipId) ?? boundaries[0]
    setBoundaryKey(next ? key(next) : '')
    setBoundaryValue(next?.time ?? 0)
    setError('')
  }, [document, clipId, lane])
  if (!clip || !clipId)
    return (
      <Text size="xs" c="dimmed">
        选择一个片段进行精剪
      </Text>
    )
  const requested = mode === 'slip' ? offset : boundaryValue
  const result =
    requested === '' || !Number.isFinite(Number(requested))
      ? { document, changedIds: [], error: '请输入有效数值' }
      : mode === 'slip'
        ? slipVideoClip(document, clipId, lane, Number(requested))
        : boundary
          ? rollVideoBoundary(document, boundary.leftId, boundary.rightId, lane, Number(requested))
          : { document, changedIds: [], error: '没有可滚动的相邻交界' }
  const center = mode === 'roll' ? (boundary?.time ?? clip.start) : clip.start
  const afterCenter =
    mode === 'roll' && result.changedIds.length
      ? (result.document[lane === 'visual' ? 'visuals' : 'sounds'].find(
          (item) => item.id === boundary?.rightId
        )?.start ?? center)
      : center
  async function preview(version: 'before' | 'after') {
    if (!onPreview) return
    setError('')
    try {
      await onPreview(
        precisionPreviewRange(
          version === 'before' ? document : result.document,
          version === 'before' ? center : afterCenter,
          version,
          Number(radius)
        )
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法试听')
    }
  }
  return (
    <Stack gap="xs" className="video-precision-trim">
      <SegmentedControl
        aria-label="精剪方式"
        value={mode}
        onChange={(value) => {
          setMode(value as 'slip' | 'roll')
          setError('')
        }}
        data={[
          { value: 'slip', label: '滑移源区间' },
          { value: 'roll', label: '滚动交界' }
        ]}
      />
      {mode === 'slip' ? (
        <>
          <NumberInput
            label="滑移偏移（时间线帧）"
            value={offset}
            onChange={setOffset}
            step={1}
            allowDecimal={false}
            disabled={readonly}
          />
          <Text size="xs" c="dimmed">
            片段位置与时长保持不变
          </Text>
        </>
      ) : (
        <>
          <Select
            label="相邻交界"
            value={boundaryKey || null}
            allowDeselect={false}
            data={boundaries.map((item) => ({ value: key(item), label: item.label }))}
            onChange={(value) => {
              setBoundaryKey(value ?? '')
              setBoundaryValue(boundaries.find((item) => key(item) === value)?.time ?? 0)
            }}
            disabled={readonly || !boundaries.length}
            placeholder="没有紧邻片段"
          />
          <NumberInput
            label="交界位置（秒）"
            value={boundaryValue}
            onChange={setBoundaryValue}
            step={1 / document.fps}
            decimalScale={3}
            disabled={readonly || !boundary}
          />
          <Text size="xs" c="dimmed">
            两侧外边界保持不变
          </Text>
        </>
      )}
      {result.error && (
        <Text size="xs" c="red" role="alert">
          {result.error}
        </Text>
      )}
      {!result.error && result.changedIds.length > 0 && (
        <Text size="xs" c="dimmed">
          {mode === 'slip'
            ? `源起点 ${formatTimelineTime(result.document[lane === 'visual' ? 'visuals' : 'sounds'].find((item) => item.id === clipId)?.sourceIn ?? clip.sourceIn)}`
            : `交界 ${formatTimelineTime(afterCenter)}`}{' '}
          · {result.changedIds.length} 个关联片段
        </Text>
      )}
      {onPreview && (
        <>
          <NumberInput
            label="交界前后试听（秒）"
            value={radius}
            onChange={setRadius}
            min={0.1}
            max={3}
            step={0.5}
            decimalScale={1}
          />
          <Group gap="xs" grow>
            <Button
              size="xs"
              variant="default"
              leftSection={<IconPlayerPlay size={13} />}
              onClick={() => void preview('before')}
            >
              修改前
            </Button>
            <Button
              size="xs"
              variant="default"
              leftSection={<IconPlayerPlay size={13} />}
              disabled={!!result.error}
              onClick={() => void preview('after')}
            >
              修改后
            </Button>
          </Group>
        </>
      )}
      {error && (
        <Text size="xs" c="red" role="alert">
          {error}
        </Text>
      )}
      <Button
        size="xs"
        disabled={readonly || !!result.error || !result.changedIds.length}
        onClick={() => {
          setError('')
          try {
            onApply(result.document)
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : '精剪失败')
          }
        }}
      >
        应用精剪
      </Button>
    </Stack>
  )
}
