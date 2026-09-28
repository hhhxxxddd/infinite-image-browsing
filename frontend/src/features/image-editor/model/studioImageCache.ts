type SizedImage = { naturalWidth: number; naturalHeight: number }

/** Keep a stable working set even when a document exceeds the decoded pixel budget. */
export function createStudioImageCache<T extends SizedImage>(
  load: (url: string) => Promise<T | null>,
  pixelBudget = 32 * 1024 * 1024
) {
  const entries = new Map<string, { task: Promise<T | null>; pixels: number }>()
  let pixels = 0

  function remove(url: string) {
    const entry = entries.get(url)
    if (!entry) return
    pixels -= entry.pixels
    entries.delete(url)
  }

  return {
    clear() {
      entries.clear()
      pixels = 0
    },
    retain(urls: ReadonlySet<string>) {
      for (const url of entries.keys()) if (!urls.has(url)) remove(url)
    },
    load(url: string, estimatedPixels: number): Promise<T | null> {
      const cached = entries.get(url)
      if (cached) return cached.task
      const task = load(url)
      // Do not evict another active image to admit this one: sequentially
      // painting an oversized document would otherwise miss on every frame.
      if (estimatedPixels > pixelBudget - pixels) return task
      const entry = { task, pixels: estimatedPixels }
      entries.set(url, entry)
      pixels += estimatedPixels
      void task.then(
        (image) => {
          if (entries.get(url) !== entry) return
          if (!image) return remove(url)
          const actualPixels = image.naturalWidth * image.naturalHeight
          pixels += actualPixels - entry.pixels
          entry.pixels = actualPixels
          if (pixels > pixelBudget) remove(url)
        },
        () => {
          if (entries.get(url) === entry) remove(url)
        }
      )
      return task
    }
  }
}
