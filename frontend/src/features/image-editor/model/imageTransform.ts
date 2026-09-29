export interface TransformSize {
  width: number
  height: number
}
export interface TransformFrame extends TransformSize {
  x: number
  y: number
}
export const transformRatios = ['free', 'original', '1:1', '4:3', '3:4', '16:9', '9:16'] as const
export const maxTransformDimension = 16384

export function transformRatio(value: string, original: TransformSize): number | undefined {
  if (value === 'free') return undefined
  if (value === 'original') return original.width / original.height
  const [width, height] = value.split(':').map(Number)
  return width > 0 && height > 0 ? width / height : undefined
}

export function fitTransformSize(width: number, ratio: number): TransformSize {
  const bounded = Math.max(1, Math.min(maxTransformDimension, maxTransformDimension * ratio, width))
  return { width: Math.round(bounded), height: Math.max(1, Math.round(bounded / ratio)) }
}

export function changeTransformSize(
  current: TransformSize,
  axis: 'width' | 'height',
  value: number,
  locked: boolean,
  ratio = current.width / current.height
): TransformSize {
  if (!Number.isFinite(value)) return { ...current }
  const size = Math.max(1, Math.min(maxTransformDimension, Math.round(value)))
  if (!locked) return { ...current, [axis]: size }
  return fitTransformSize(axis === 'width' ? size : size * ratio, ratio)
}

export function centeredTransformCrop(size: TransformSize, ratio?: number): TransformFrame {
  const width = ratio ? Math.min(size.width, size.height * ratio) : size.width
  const height = ratio ? width / ratio : size.height
  return { x: (size.width - width) / 2, y: (size.height - height) / 2, width, height }
}

/** A crop dragged in either direction stays inside the canvas and keeps the chosen ratio. */
export function draggedTransformCrop(
  start: { x: number; y: number },
  end: { x: number; y: number },
  bounds: TransformSize,
  ratio?: number
): TransformFrame {
  const sx = end.x < start.x ? -1 : 1,
    sy = end.y < start.y ? -1 : 1
  let width = Math.abs(end.x - start.x),
    height = Math.abs(end.y - start.y)
  if (ratio) {
    width = Math.max(width, height * ratio)
    width = Math.min(
      width,
      sx < 0 ? start.x : bounds.width - start.x,
      (sy < 0 ? start.y : bounds.height - start.y) * ratio
    )
    height = width / ratio
  }
  return {
    x: sx < 0 ? start.x - width : start.x,
    y: sy < 0 ? start.y - height : start.y,
    width,
    height
  }
}
