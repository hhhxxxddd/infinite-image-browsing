import type { StudioImageLayer } from './imageStudioModel.ts'

export type UpscaleMultiplier = 1 | 2 | 4
export type UpscaleResolution = 'original' | '2K' | '4K' | '8K'
export const upscaleResolutions = ['original', '2K', '4K', '8K'].map((value) => ({
  value,
  label: value === 'original' ? '原尺寸' : value
}))

/** Pixel plane before layer rotation/opacity; never silently downsample a 1× job. */
export function imageToolInputSize(
  layer: StudioImageLayer,
  natural: { width: number; height: number },
  limitCutout = false
) {
  let scale = Math.max(
    (natural.width * layer.crop.width) / layer.width,
    (natural.height * layer.crop.height) / layer.height
  )
  if (limitCutout)
    scale = Math.min(
      scale,
      8192 / Math.max(layer.width, layer.height),
      Math.sqrt(16_000_000 / (layer.width * layer.height))
    )
  return {
    width: Math.max(1, (limitCutout ? Math.floor : Math.round)(layer.width * scale)),
    height: Math.max(1, (limitCutout ? Math.floor : Math.round)(layer.height * scale))
  }
}

/** Match Comfy's shorter-edge sizing, including Python's half-to-even rounding. */
export function upscaleRequestedSize(
  size: { width: number; height: number },
  mode: UpscaleResolution | number
) {
  if (typeof mode === 'number') return { width: size.width * mode, height: size.height * mode }
  if (mode === 'original') return { ...size }
  const short = { '2K': 2048, '4K': 4096, '8K': 8192 }[mode]
  const round = (value: number) =>
    value % 1 === 0.5 ? Math.round(value / 2) * 2 : Math.round(value)
  return size.width >= size.height
    ? { width: round((size.width / size.height) * short), height: short }
    : { width: short, height: round((size.height / size.width) * short) }
}

export function upscaleSizeError(
  size: { width: number; height: number },
  mode: UpscaleResolution | number
) {
  const { width, height } = upscaleRequestedSize(size, mode)
  if (Math.min(width, height) < 2) return '结果宽高至少需要 2 像素，请提高输出尺寸'
  return Math.max(width, height) > 16384 || width * height > 100_000_000
    ? '结果超过 16384 像素边长或 1 亿像素，请降低输出尺寸'
    : ''
}

export function upscaleOutputSize(
  size: { width: number; height: number },
  mode: UpscaleResolution | number
) {
  const { width, height } = upscaleRequestedSize(size, mode)
  return { width: Math.floor(width / 2) * 2, height: Math.floor(height / 2) * 2 }
}
