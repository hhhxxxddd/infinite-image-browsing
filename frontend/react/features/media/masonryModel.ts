import type { MediaFile } from './mediaApi'

export function mediaCardRatio(file: MediaFile): number {
  const extension = file.name.split('.').pop()?.toLowerCase() || ''
  const video = /^(mp4|mkv|mov|webm|avi|m4v|wmv|flv|ts)$/.test(extension)
  const audio = /^(mp3|m4a|aac|wav|flac|ogg|opus|wma|aiff?)$/.test(extension)
  const ratio =
    file.width && file.height ? file.width / file.height : video ? 16 / 9 : audio ? 1 : 3 / 4
  return Math.min(2, Math.max(0.5, ratio))
}

export function distributeMasonry<T>(
  items: readonly T[],
  columnCount: number,
  estimateHeight: (item: T) => number
): Array<Array<{ item: T; index: number }>> {
  const count = Math.max(1, Math.floor(columnCount))
  const heights = Array<number>(count).fill(0)
  const columns: Array<Array<{ item: T; index: number }>> = Array.from({ length: count }, () => [])
  items.forEach((item, index) => {
    let column = 0
    for (let candidate = 1; candidate < count; candidate += 1) {
      if (heights[candidate] < heights[column]) column = candidate
    }
    columns[column].push({ item, index })
    heights[column] += estimateHeight(item) + 12
  })
  return columns
}
