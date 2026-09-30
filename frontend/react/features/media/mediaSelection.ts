/** Card clicks toggle independently; Shift adds the visible range from the last clicked file. */
export function toggleMediaSelection(
  current: ReadonlySet<string>,
  visiblePaths: readonly string[],
  path: string,
  rangeAnchor?: string | null
): Set<string> {
  const next = new Set(current)
  const index = visiblePaths.indexOf(path)
  if (index < 0) return next
  const anchorIndex = rangeAnchor ? visiblePaths.indexOf(rangeAnchor) : -1
  if (anchorIndex >= 0) {
    const start = Math.min(index, anchorIndex)
    const end = Math.max(index, anchorIndex)
    for (let i = start; i <= end; i += 1) next.add(visiblePaths[i])
  } else if (next.has(path)) next.delete(path)
  else next.add(path)
  return next
}
