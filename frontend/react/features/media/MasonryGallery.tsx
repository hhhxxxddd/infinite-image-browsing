import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { MediaFile } from './mediaApi'
import { layoutMasonry, mediaCardRatio } from './masonryModel'

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
  const layout = useMemo(
    () => layoutMasonry(items, width || cardMinWidth, cardMinWidth, mediaCardRatio),
    [items, width, cardMinWidth]
  )
  // Resizing updates wrappers; the media, menus and selection controls keep their instances.
  const cards = useMemo(() => items.map(renderItem), [items, renderItem])
  return (
    <div ref={ref} className="ml-masonry" style={{ height: layout.height }}>
      {layout.positions.map((position, index) => (
        <div className="ml-masonry-item" key={items[index].fullpath} style={position}>
          {cards[index]}
        </div>
      ))}
    </div>
  )
}
