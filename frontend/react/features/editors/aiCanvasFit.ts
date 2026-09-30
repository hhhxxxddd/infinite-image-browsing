export function fitAIEditCanvasWidth(
  documentWidth: number,
  documentHeight: number,
  availableWidth: number,
  availableHeight: number
): number {
  if (
    !Number.isFinite(documentWidth) ||
    !Number.isFinite(documentHeight) ||
    documentWidth <= 0 ||
    documentHeight <= 0
  )
    return 80
  return Math.max(
    80,
    Math.floor(
      Math.min(
        documentWidth,
        Math.max(1, availableWidth),
        Math.max(1, availableHeight) * (documentWidth / documentHeight)
      )
    )
  )
}
