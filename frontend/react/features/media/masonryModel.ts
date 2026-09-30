import type { MediaFile } from './mediaApi'

// Leave room for playback, selection and captions even on the smallest cards.
export const minimumMediaCardHeight = 144

export function mediaCardWidth(base: number, size: 'small' | 'medium' | 'large'): number {
  const factor = size === 'medium' ? 1.4 : size === 'large' ? 1.9 : 1
  return Math.round(base * factor)
}

/** Older settings used the medium width as their base. Preserve roughly the same small size. */
export function readSmallThumbnailWidth(value: unknown, legacyWidth?: unknown): number {
  const candidate = value ?? (typeof legacyWidth === 'number' ? legacyWidth * 0.72 : 176)
  const width = Number(candidate)
  return Number.isFinite(width) ? Math.min(512, Math.max(128, Math.round(width / 16) * 16)) : 176
}

export function masonryColumnCount(width: number, cardMinWidth: number): number {
  return Math.max(1, Math.floor((width + 12) / (cardMinWidth + 12)))
}

/** Positions follow source order so moving between columns never remounts a media card. */
export function layoutMasonry<T>(
  items: readonly T[],
  width: number,
  cardMinWidth: number,
  ratio: (item: T) => number
): {
  height: number
  positions: Array<{ left: number; top: number; width: number; height: number }>
} {
  const count = masonryColumnCount(width, cardMinWidth)
  const cardWidth = (width - 12 * (count - 1)) / count
  // Use a stable estimate so widths within the same column count keep the same membership.
  const columns = distributeMasonry(items, count, (item) =>
    Math.max(minimumMediaCardHeight, cardMinWidth / ratio(item))
  )
  const positions = new Array<{ left: number; top: number; width: number; height: number }>(
    items.length
  )
  let height = 0
  columns.forEach((column, columnIndex) => {
    let top = 0
    column.forEach(({ item, index }) => {
      const cardHeight = Math.max(minimumMediaCardHeight, cardWidth / ratio(item))
      positions[index] = {
        left: columnIndex * (cardWidth + 12),
        top,
        width: cardWidth,
        height: cardHeight
      }
      height = Math.max(height, top + cardHeight)
      top += cardHeight + 12
    })
  })
  return { height, positions }
}

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
