import type { FileNodeInfo } from '../../../src/shared/types/fileNode'
import type {
  StudioDocument,
  StudioImageLayer
} from '../../../src/features/image-editor/model/imageStudioModel'
import {
  renderStudioDocument,
  studioImageDimensions
} from '../../../src/features/image-editor/model/imageStudioRender'
import { managedImageAssetFile } from '../../../src/shared/lib/managedImageAssets'
import type { ImageToolJob } from '../../../src/features/image-editor/model/imageStudioCutout'
import {
  type UpscaleResolution,
  imageToolInputSize,
  upscaleSizeError
} from '../../../src/features/image-editor/model/imageStudioUpscale'
import { toRawFileUrl } from '../../../src/shared/lib/mediaUrls'
import { blobToBase64 } from '../../../src/shared/lib/blobEncoding'

export async function imageToolDimensions(
  layer: StudioImageLayer,
  info: Record<string, FileNodeInfo>,
  previous?: ImageToolJob,
  limitCutout = false
) {
  if (previous) return { width: previous.source.width, height: previous.source.height }
  const file = info[layer.path] || managedImageAssetFile(layer.path)
  const dimensions = file && (await studioImageDimensions(file))
  if (!dimensions) throw new Error('无法读取图片')
  return imageToolInputSize(layer, dimensions, limitCutout)
}

export async function cutoutInput(
  doc: StudioDocument,
  layer: StudioImageLayer,
  info: Record<string, FileNodeInfo>,
  previous?: ImageToolJob,
  upscaleResolution?: UpscaleResolution,
  limitCutout = !upscaleResolution
) {
  const { width, height } = await imageToolDimensions(layer, info, previous, limitCutout)
  const inputError = upscaleSizeError({ width, height }, 1)
  if (!limitCutout && inputError) throw new Error(inputError)
  if (upscaleResolution) {
    const error = upscaleSizeError({ width, height }, upscaleResolution)
    if (error) throw new Error(error)
  }
  if (previous) {
    const file = managedImageAssetFile(previous.source.path)
    if (!file) throw new Error('AI 原始输入不可用')
    const response = await fetch(toRawFileUrl(file), { credentials: 'include' })
    if (!response.ok) throw new Error('AI 原始输入不可用')
    return blobToBase64(await response.blob())
  }
  const input: StudioImageLayer = {
    ...layer,
    x: 0,
    y: 0,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    groupId: undefined,
    frameId: undefined,
    radius: (layer.radius * width) / layer.width
  }
  const canvas = document.createElement('canvas')
  const missing = await renderStudioDocument(
    canvas,
    { ...doc, width, height, background: 'transparent', groups: [], layers: [input] },
    info,
    false
  )
  if (missing.length) throw new Error('无法生成 AI 图片输入')
  return canvas.toDataURL('image/png').split(',')[1]
}
