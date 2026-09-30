import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { MediaFile } from './mediaApi'
import { distributeMasonry, mediaCardRatio } from './masonryModel'

export function MasonryGallery({
  items,
  cardMinWidth,
  renderItem
}: {
  items: MediaFile[]
  cardMinWidth: number
  renderItem: (file: MediaFile, index: number) => ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => setWidth(element.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const gap = 12
  const count = Math.max(1, Math.floor((width + gap) / (cardMinWidth + gap)))
  const cardWidth = width ? (width - gap * (count - 1)) / count : cardMinWidth
  const columns = useMemo(
    () => distributeMasonry(items, count, (file) => cardWidth / mediaCardRatio(file)),
    [items, count, cardWidth]
  )
  return (
    <div ref={ref} className="ml-masonry" style={{ '--ml-columns': count } as React.CSSProperties}>
      {columns.map((column, index) => (
        <div className="ml-masonry-column" key={index}>
          {column.map(({ item, index: itemIndex }) => renderItem(item, itemIndex))}
        </div>
      ))}
    </div>
  )
}
