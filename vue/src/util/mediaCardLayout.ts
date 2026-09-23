export const MEDIA_CARD_HEIGHT_RATIO = 4 / 3

export const mediaCardHeight = (width: number) => Math.round(width * MEDIA_CARD_HEIGHT_RATIO)

export function cardThumbnailShortEdge(width: number, devicePixelRatio: number, limit: number) {
  const displayPixels = width * devicePixelRatio
  const bucket = displayPixels <= 256 ? 256 : displayPixels <= 512 ? 512 : 1024
  return Math.min(limit, bucket)
}
