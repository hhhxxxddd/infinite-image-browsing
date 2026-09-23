export interface MasonryMedia {
  name: string
  fullpath?: string
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

type Dimensions = { width: number; height: number }

function aspectRatio(item: MasonryMedia, measured?: Dimensions): number {
  const width = measured?.width ?? item.width
  const height = measured?.height ?? item.height
  if (width && height && width > 0 && height > 0) return width / height
  if (/\.(mp4|webm|mov|mkv|avi|m4v|wmv|flv|ts)$/i.test(item.name)) return 16 / 9
  if (/\.(mp3|wav|flac|ogg|m4a|aac)$/i.test(item.name)) return 1
  return 3 / 4
}

export function layoutMasonry(items: readonly MasonryMedia[], columnCount: number, cellWidth: number, measuredDimensions?: ReadonlyMap<string, Dimensions>) {
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
    const ratio = Math.min(2, Math.max(0.5, aspectRatio(item, item.fullpath ? measuredDimensions?.get(item.fullpath) : undefined)))
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

export function masonryScrollAnchor(positions: readonly MasonryPosition[], scrollTop: number, maxItemHeight: number): MasonryPosition | undefined {
  const first = masonryItemIndexAt(positions, scrollTop - maxItemHeight)
  let anchor: MasonryPosition | undefined
  for (let index = first; index < positions.length; index++) {
    const position = positions[index]
    if (position.top > scrollTop) {
      if (!anchor) anchor = position
      break
    }
    if (position.top + position.height <= scrollTop) continue
    if (!anchor || position.top > anchor.top || (position.top === anchor.top && position.left < anchor.left)) anchor = position
  }
  return anchor
}
