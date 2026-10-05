import { useEffect, useRef, useState } from 'react'
import { Alert, Stack, Text } from '@mantine/core'
import type { FileNodeInfo } from '../../../src/shared/types/fileNode'
import type { StudioDocument } from '../../../src/features/image-editor/model/imageStudioModel'
import { renderStudioDocument } from '../../../src/features/image-editor/model/imageStudioRender'

/** Rendering a version never modifies the current canvas or its save queue. */
export default function ImageSnapshotPreview({
  document,
  assetInfo
}: {
  document: StudioDocument
  assetInfo: Record<string, FileNodeInfo>
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const target = canvas.current
    if (!target) return
    const controller = new AbortController()
    setError('')
    void renderStudioDocument(
      target,
      document,
      assetInfo,
      true,
      { kind: 'all' },
      640,
      true,
      controller.signal
    )
      .then((missing) => {
        if (!controller.signal.aborted && missing.length)
          setError(`部分素材无法预览：${missing.join('、')}`)
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : '图片版本无法预览')
      })
    return () => controller.abort()
  }, [document, assetInfo])
  return (
    <Stack gap="xs">
      <canvas
        ref={canvas}
        aria-label={`${document.name} · 版本预览`}
        style={{ maxWidth: '100%', maxHeight: 260, objectFit: 'contain', alignSelf: 'center' }}
      />
      <Text size="xs" c="dimmed">
        {document.width} × {document.height} · {document.layers.length} 个图层
      </Text>
      {error && <Alert color="yellow">{error}</Alert>}
    </Stack>
  )
}
