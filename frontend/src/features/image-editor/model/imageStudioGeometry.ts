import type { StudioFrame, StudioPoint } from './imageStudioModel.ts'

type RotatedFrame = StudioFrame & { rotation: number }

export type StudioCanvasAlignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'

/** Align the visible rotated bounds to the canvas, leaving the other axis unchanged. */
export function studioAlignFrame(
  frame: RotatedFrame,
  canvas: Pick<StudioFrame, 'width' | 'height'>,
  alignment: StudioCanvasAlignment
): Pick<StudioFrame, 'x' | 'y'> {
  const angle = (frame.rotation * Math.PI) / 180
  const width = Math.abs(Math.cos(angle)) * frame.width + Math.abs(Math.sin(angle)) * frame.height
  const height = Math.abs(Math.sin(angle)) * frame.width + Math.abs(Math.cos(angle)) * frame.height
  const x = frame.x + (frame.width - width) / 2
  const y = frame.y + (frame.height - height) / 2
  const horizontal = alignment === 'left' || alignment === 'center' || alignment === 'right'
  const target = horizontal
    ? alignment === 'left'
      ? 0
      : alignment === 'right'
        ? canvas.width - width
        : (canvas.width - width) / 2
    : alignment === 'top'
      ? 0
      : alignment === 'bottom'
        ? canvas.height - height
        : (canvas.height - height) / 2
  return horizontal
    ? { x: frame.x + target - x, y: frame.y }
    : { x: frame.x, y: frame.y + target - y }
}

export function studioResizeDimensions(width: number, height: number) {
  const factor = Math.min(1, 16384 / width, 16384 / height)
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor))
  }
}

/** Layer-local pixels, measured from the unrotated top-left corner. */
export function studioFramePoint(frame: RotatedFrame, point: StudioPoint): StudioPoint {
  const angle = (frame.rotation * Math.PI) / 180
  const dx = point.x - frame.x - frame.width / 2
  const dy = point.y - frame.y - frame.height / 2
  return {
    x: dx * Math.cos(angle) + dy * Math.sin(angle) + frame.width / 2,
    y: -dx * Math.sin(angle) + dy * Math.cos(angle) + frame.height / 2
  }
}

export function studioFrameWorldPoint(frame: RotatedFrame, point: StudioPoint): StudioPoint {
  const angle = (frame.rotation * Math.PI) / 180
  const dx = point.x - frame.width / 2,
    dy = point.y - frame.height / 2
  return {
    x: frame.x + frame.width / 2 + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: frame.y + frame.height / 2 + dx * Math.sin(angle) + dy * Math.cos(angle)
  }
}

export function studioFrameContainsPoint(frame: RotatedFrame, point: StudioPoint): boolean {
  const local = studioFramePoint(frame, point)
  return local.x >= 0 && local.y >= 0 && local.x <= frame.width && local.y <= frame.height
}

export function studioPointerRotation(
  frame: RotatedFrame,
  start: StudioPoint,
  point: StudioPoint,
  snap: boolean
): number {
  const cx = frame.x + frame.width / 2,
    cy = frame.y + frame.height / 2
  const delta = Math.atan2(point.y - cy, point.x - cx) - Math.atan2(start.y - cy, start.x - cx)
  let rotation = frame.rotation + (delta * 180) / Math.PI
  rotation = ((((rotation + 180) % 360) + 360) % 360) - 180
  return snap ? Math.round(rotation / 15) * 15 : Math.round(rotation * 10) / 10
}

export function studioCenteredCrop(width: number, height: number, ratio: number): StudioFrame {
  const w = ratio > 0 ? Math.min(width, height * ratio) : width
  const h = ratio > 0 ? w / ratio : height
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h }
}

export function studioMoveCrop(
  bounds: Pick<StudioFrame, 'width' | 'height'>,
  crop: StudioFrame,
  dx: number,
  dy: number
): StudioFrame {
  return {
    ...crop,
    x: Math.max(0, Math.min(bounds.width - crop.width, crop.x + dx)),
    y: Math.max(0, Math.min(bounds.height - crop.height, crop.y + dy))
  }
}

/** Numeric crop sizes keep their center where possible and never extend beyond the layer. */
export function studioCropDimensions(
  bounds: Pick<StudioFrame, 'width' | 'height'>,
  crop: StudioFrame,
  axis: 'width' | 'height',
  value: number,
  ratio: number
): StudioFrame {
  if (!Number.isFinite(value)) return crop
  let width = crop.width,
    height = crop.height
  if (ratio > 0) {
    const limit = Math.min(bounds.width, bounds.height * ratio)
    width = Math.max(
      Math.min(limit, Math.max(1, ratio)),
      Math.min(limit, axis === 'width' ? value : value * ratio)
    )
    height = width / ratio
  } else if (axis === 'width') width = Math.max(1, Math.min(bounds.width, value))
  else height = Math.max(1, Math.min(bounds.height, value))
  return {
    x: Math.max(0, Math.min(bounds.width - width, crop.x + (crop.width - width) / 2)),
    y: Math.max(0, Math.min(bounds.height - height, crop.y + (crop.height - height) / 2)),
    width,
    height
  }
}

/** Adjust an existing crop in layer-local pixels, preserving its opposite anchor. */
export function studioResizeCrop(
  bounds: Pick<StudioFrame, 'width' | 'height'>,
  crop: StudioFrame,
  handle: string,
  dx: number,
  dy: number,
  ratio: number
): StudioFrame {
  const sx = handle.includes('w') ? -1 : handle.includes('e') ? 1 : 0
  const sy = handle.includes('n') ? -1 : handle.includes('s') ? 1 : 0
  const anchorX = crop.x + (sx < 0 ? crop.width : sx > 0 ? 0 : crop.width / 2)
  const anchorY = crop.y + (sy < 0 ? crop.height : sy > 0 ? 0 : crop.height / 2)
  const availableWidth = sx
    ? sx > 0
      ? bounds.width - anchorX
      : anchorX
    : 2 * Math.min(anchorX, bounds.width - anchorX)
  const availableHeight = sy
    ? sy > 0
      ? bounds.height - anchorY
      : anchorY
    : 2 * Math.min(anchorY, bounds.height - anchorY)
  let width = crop.width + sx * dx
  let height = crop.height + sy * dy
  if (ratio > 0) {
    const requestedWidth =
      !sx || (sy && Math.abs(dy) * ratio > Math.abs(dx)) ? height * ratio : width
    const limit = Math.min(availableWidth, availableHeight * ratio)
    width = Math.max(Math.min(limit, Math.max(1, ratio)), Math.min(limit, requestedWidth))
    height = width / ratio
  } else {
    width = sx ? Math.max(Math.min(1, availableWidth), Math.min(availableWidth, width)) : crop.width
    height = sy
      ? Math.max(Math.min(1, availableHeight), Math.min(availableHeight, height))
      : crop.height
  }
  return {
    x: anchorX - (sx < 0 ? width : sx > 0 ? 0 : width / 2),
    y: anchorY - (sy < 0 ? height : sy > 0 ? 0 : height / 2),
    width,
    height
  }
}
