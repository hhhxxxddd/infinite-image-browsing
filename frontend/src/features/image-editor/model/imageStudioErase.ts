import type { StudioPoint } from './imageStudioModel.ts'

export type PixelBox = { x: number; y: number; width: number; height: number }
export type EraseStroke = { points: StudioPoint[]; size: number; erase: boolean }
export type EraseSettings = {
  prompt: string
  blend_pixels: number
  output_width: number
  output_height: number
}
export type EraseDraft = EraseSettings & {
  strokes: EraseStroke[]
  bounds: PixelBox | null
  context: PixelBox | null
  range: 'auto' | 'manual' | 'whole'
  linked: boolean
}
export const erasePrompt = '移除涂抹区域内的物体，根据周围环境自然补全，保持画面风格和光照一致。'
export const emptyEraseDraft = (defaults?: Partial<EraseSettings>): EraseDraft => ({
  prompt: erasePrompt,
  blend_pixels: 16,
  output_width: 512,
  output_height: 512,
  ...defaults,
  strokes: [],
  bounds: null,
  context: null,
  range: 'auto',
  linked: true
})
export const eraseAlignedSize = (v: number) => Math.max(64, Math.min(4096, Math.ceil(v / 32) * 32))
export const unionEraseBox = (a: PixelBox, b: PixelBox): PixelBox => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x),
  height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y)
})
export function clampEraseBox(box: PixelBox, size: { width: number; height: number }): PixelBox {
  const x = Math.max(0, Math.min(size.width - 1, Math.floor(box.x)))
  const y = Math.max(0, Math.min(size.height - 1, Math.floor(box.y)))
  return {
    x,
    y,
    width: Math.max(1, Math.min(size.width, Math.ceil(box.x + box.width)) - x),
    height: Math.max(1, Math.min(size.height, Math.ceil(box.y + box.height)) - y)
  }
}
/** Nonzero mask support after the CropAndStitch CPU blend dilation + Gaussian. */
export function eraseBlendBounds(
  bounds: PixelBox,
  size: { width: number; height: number },
  blend: number
) {
  const kernel = Math.ceil((3 * blend) / 8 + 1)
  const radius = Math.floor(blend / 2 + 0.5)
  const left = blend ? Math.floor(kernel / 2) + radius : 0
  const right = blend ? Math.floor((kernel - 1) / 2) + radius : 0
  return clampEraseBox(
    {
      x: bounds.x - left,
      y: bounds.y - left,
      width: bounds.width + left + right,
      height: bounds.height + left + right
    },
    size
  )
}
export function eraseContext(draft: EraseDraft, size: { width: number; height: number }) {
  const full = { x: 0, y: 0, ...size }
  if (draft.range === 'whole' || !draft.bounds) return full
  const support = eraseBlendBounds(draft.bounds, size, draft.blend_pixels)
  if (draft.range === 'manual' && draft.context)
    return clampEraseBox(unionEraseBox(draft.context, support), size)
  const margin = Math.max(16, Math.ceil(Math.max(support.width, support.height) * 0.25))
  return clampEraseBox(
    {
      x: support.x - margin,
      y: support.y - margin,
      width: support.width + margin * 2,
      height: support.height + margin * 2
    },
    size
  )
}
export function eraseTarget(draft: EraseDraft, context: PixelBox) {
  if (!draft.linked)
    return {
      width: eraseAlignedSize(draft.output_width),
      height: eraseAlignedSize(draft.output_height)
    }
  const longest = Math.max(draft.output_width, draft.output_height)
  const scale = longest / Math.max(context.width, context.height)
  return {
    width: eraseAlignedSize(context.width * scale),
    height: eraseAlignedSize(context.height * scale)
  }
}
/** Same pixel geometry as the server's processing_box, including off-image padding. */
export function eraseProcessingBox(
  context: PixelBox,
  target: { width: number; height: number },
  size: { width: number; height: number }
): PixelBox {
  let { x, y, width, height } = context
  const ratio = target.width / target.height
  if (width / height < ratio) {
    const grown = Math.floor(height * ratio)
    x -= Math.floor((grown - width) / 2)
    width = grown
    x =
      width <= size.width
        ? Math.max(0, Math.min(x, size.width - width))
        : -Math.floor((width - size.width) / 2)
  } else {
    const grown = Math.floor(width / ratio)
    y -= Math.floor((grown - height) / 2)
    height = grown
    y =
      height <= size.height
        ? Math.max(0, Math.min(y, size.height - height))
        : -Math.floor((height - size.height) / 2)
  }
  return { x, y, width, height }
}
export function erasePlan(draft: EraseDraft, size: { width: number; height: number }) {
  const context = eraseContext(draft, size)
  const target = eraseTarget(draft, context)
  return { context, target, processing: eraseProcessingBox(context, target, size) }
}
