/** Timed lyrics arrive sorted by time from the audio metadata API. */
export function activeLyricAt(lines: ReadonlyArray<{ time?: number }>, seconds: number) {
  if (!Number.isFinite(seconds)) return -1
  let low = 0
  let high = lines.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if ((lines[middle].time ?? Infinity) <= seconds) low = middle + 1
    else high = middle
  }
  return low - 1
}
