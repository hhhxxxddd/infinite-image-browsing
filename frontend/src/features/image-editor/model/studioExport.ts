import { canvasContext } from '@/shared/lib/canvasContext'
import type { FileNodeInfo } from '@/shared/types/fileNode'
import type { StudioDocument } from './imageStudioModel'
import { renderStudioDocument, type StudioRenderScope } from './imageStudioRender'

/** Full-resolution export shared by the editor and draft cards. */
export async function exportStudioBlob(
  document: StudioDocument,
  assetInfo: Record<string, FileNodeInfo>,
  format: 'png' | 'jpeg' = 'png',
  scope: StudioRenderScope = { kind: 'all' }
): Promise<Blob> {
  if (document.width * document.height > 100_000_000)
    throw new Error('输出图片超过一亿像素，请缩小画布')
  const target = window.document.createElement('canvas')
  const failures = await renderStudioDocument(target, document, assetInfo, false, scope)
  if (failures.length) throw new Error('无法读取图层：' + failures.join('、'))
  if (format === 'jpeg') {
    const ctx = canvasContext(target)
    ctx.globalCompositeOperation = 'destination-over'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, target.width, target.height)
  }
  const blob = await new Promise<Blob | null>((resolve) =>
    target.toBlob(resolve, format === 'jpeg' ? 'image/jpeg' : 'image/png', 0.93)
  )
  if (!blob) throw new Error('导出失败，请缩小画布尺寸')
  return blob
}
