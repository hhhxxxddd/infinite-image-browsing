export interface MasonryMedia {
  name: string
  width?: number | null
  height?: number | null
}

export interface MasonryPosition {
  index: number
  left: number
  top: number
  width: number
  height: number
}

const GAP = 16

function aspectRatio(item: MasonryMedia): number {
  if (item.width && item.height && item.width > 0 && item.height > 0) return item.width / item.height
  if (/\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(item.name)) return 16 / 9
  if (/\.(mp3|wav|flac|ogg|m4a|aac)$/i.test(item.name)) return 1
  return 3 / 4
}

export function layoutMasonry(items: readonly MasonryMedia[], columnCount: number, cellWidth: number) {
  const count = Math.max(1, Math.floor(columnCount))
  const width = Math.max(64, Math.floor(cellWidth))
  const columnHeights = Array<number>(count).fill(GAP / 2)
  const positions: MasonryPosition[] = []
  let maxItemHeight = 0
  for (const [index, item] of items.entries()) {
    let column = 0
    for (let candidate = 1; candidate < count; candidate++) {
      if (columnHeights[candidate] < columnHeights[column]) column = candidate
    }
    const ratio = Math.min(2, Math.max(0.5, aspectRatio(item)))
    const height = Math.round(width / ratio)
    maxItemHeight = Math.max(maxItemHeight, height)
    positions.push({ index, left: column * (width + GAP) + GAP / 2, top: columnHeights[column], width, height })
    columnHeights[column] += height + GAP
  }
  return { positions, totalHeight: Math.max(0, ...columnHeights), maxItemHeight }
}

export function masonryItemIndexAt(positions: readonly MasonryPosition[], offset: number): number {
  if (!positions.length) return 0
  let low = 0, high = positions.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (positions[middle].top <= offset) low = middle + 1
    else high = middle
  }
  return Math.max(0, low - 1)
}
