import {
  Button,
  Divider,
  Group,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  Tooltip
} from '@mantine/core'
import { useEffect, useState } from 'react'
import type { StudioImageLayer } from '../../../src/features/image-editor/model/imageStudioModel'
import {
  upscaleResolutions,
  upscaleSizeError,
  upscaleOutputSize,
  type UpscaleResolution
} from '../../../src/features/image-editor/model/imageStudioUpscale'
import type { FileNodeInfo } from '../../../src/shared/types/fileNode'
import type { useImageAITasks } from './useImageAITasks'
import { imageToolDimensions } from './imageCutoutInput'

export default function ImageUpscaleTools({
  upscale,
  layer,
  assetInfo,
  disabled
}: {
  upscale: ReturnType<typeof useImageAITasks>['upscale']
  layer?: StudioImageLayer
  assetInfo: Record<string, FileNodeInfo>
  disabled: boolean
}) {
  const { resolution, busy, config, previous, currentJob } = upscale
  const [dimensions, setDimensions] = useState<{ key: string; width: number; height: number }>()
  const [dimensionError, setDimensionError] = useState('')
  const key = layer
    ? JSON.stringify([layer.id, layer.path, layer.width, layer.height, layer.crop, previous?.id])
    : ''
  useEffect(() => {
    let active = true
    setDimensionError('')
    if (layer)
      void imageToolDimensions(layer, assetInfo, previous)
        .then((size) => {
          if (active) setDimensions({ ...size, key })
        })
        .catch(() => {
          if (active) setDimensionError('无法读取图片尺寸')
        })
    return () => {
      active = false
    }
  }, [key, assetInfo])
  const size = dimensions?.key === key ? dimensions : undefined
  const sizeError = size ? upscaleSizeError(size, resolution) : ''
  const outputSize = size && upscaleOutputSize(size, resolution)
  const evenAlignment =
    !!size && resolution === 'original' && (size.width % 2 !== 0 || size.height % 2 !== 0)
  const controlsDisabled = disabled || busy || !!upscale.accepting
  return (
    <Stack gap="sm">
      <Text size="xs" c="dimmed" truncate title={layer?.name}>
        {layer ? `图片 · ${layer.name}` : '请选择一个图片图层'}
      </Text>
      {upscale.recoverable && (
        <Button size="xs" variant="default" disabled={controlsDisabled} onClick={upscale.recover}>
          恢复上次结果
        </Button>
      )}
      <Stack gap={6}>
        <Text size="xs" fw={600}>
          短边尺寸
        </Text>
        <SegmentedControl
          fullWidth
          aria-label="高清化短边尺寸"
          size="xs"
          value={resolution}
          disabled={controlsDisabled}
          data={upscaleResolutions}
          onChange={(value) => upscale.setResolution(value as UpscaleResolution)}
        />
      </Stack>
      {size && (
        <Text size="xs" c="dimmed" ta="center">
          {size.width} × {size.height} → {outputSize?.width} × {outputSize?.height} px
        </Text>
      )}
      {resolution === 'original' && (
        <Text size="xs" c="dimmed">
          {evenAlignment
            ? '重绘并改善细节；奇数边长向下对齐为偶数。'
            : '保持分辨率，重绘并改善细节。'}
        </Text>
      )}
      {(sizeError || dimensionError) && (
        <Text size="xs" c="orange">
          {sizeError || dimensionError}
        </Text>
      )}
      <Button
        fullWidth
        size="xs"
        loading={!!upscale.preparing}
        disabled={controlsDisabled || !config?.ready || !size || !!sizeError || !!dimensionError}
        onClick={() => {
          upscale.setView('after')
          void upscale.start()
        }}
      >
        开始高清化
      </Button>
      {previous && !busy && (
        <>
          <Divider />
          <Stack gap="sm" className="react-image-cutout-comparison">
            <Group justify="space-between">
              <Text size="xs" fw={600}>
                效果对比
              </Text>
              <Text size="xs" c="dimmed">
                {previous.target_resolution === 'original'
                  ? '原尺寸'
                  : previous.target_resolution || `${previous.multiplier}×`}
              </Text>
            </Group>
            <Switch
              size="xs"
              label="显示处理前"
              checked={upscale.view === 'before'}
              disabled={controlsDisabled}
              onChange={(event) =>
                upscale.setView(event.currentTarget.checked ? 'before' : 'after')
              }
            />
            <Button
              size="xs"
              fullWidth
              disabled={disabled || busy}
              loading={!!upscale.accepting}
              onClick={() => void upscale.accept()}
            >
              采用结果
            </Button>
          </Stack>
        </>
      )}
      {config && !config.ready && (
        <Text size="xs" c="orange">
          请先在设置中配置 Comfy Cloud API Key
        </Text>
      )}
      {upscale.connectionError && (
        <Text size="xs" c="orange">
          {upscale.connectionError}
        </Text>
      )}
      {currentJob && ['queued', 'running'].includes(currentJob.state) && (
        <Group justify="space-between">
          <Text size="xs">{currentJob.state === 'queued' ? '等待高清化' : '正在高清化'}…</Text>
          <Tooltip label="停止应用本次结果；云端任务可能仍会继续运行。">
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => void upscale.cancel(currentJob)}
            >
              取消
            </Button>
          </Tooltip>
        </Group>
      )}
      {currentJob && !busy && ['failed', 'canceled'].includes(currentJob.state) && (
        <Text size="xs" c={currentJob.state === 'failed' ? 'red' : 'dimmed'}>
          {currentJob.state === 'failed' ? currentJob.error : '已取消高清化'}
        </Text>
      )}
    </Stack>
  )
}
