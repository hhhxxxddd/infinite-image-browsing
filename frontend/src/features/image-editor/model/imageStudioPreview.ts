/** Rasterize vectors at their displayed device-pixel size, including zoomed small documents. */
export function studioPreviewScale(
  document: { width: number; height: number },
  display: { width: number; height: number },
  pixelRatio: number
): number {
  const density = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1
  const requested =
    Math.max(display.width / document.width, display.height / document.height) * density
  // Bound the drawing buffer without changing document coordinates or export dimensions.
  return Math.max(
    1 / Math.max(document.width, document.height),
    Math.min(
      requested,
      4096 / Math.max(document.width, document.height),
      Math.sqrt((8 * 1024 * 1024) / (document.width * document.height))
    )
  )
}
