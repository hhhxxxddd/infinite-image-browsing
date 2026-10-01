import type { MediaFile } from './mediaApi'

export function mergeMediaPage(current: MediaFile[], incoming: MediaFile[]): MediaFile[] {
  const paths = new Set(current.map((file) => file.fullpath))
  const added: MediaFile[] = []
  for (const file of incoming) {
    if (paths.has(file.fullpath)) continue
    paths.add(file.fullpath)
    added.push(file)
  }
  return added.length ? [...current, ...added] : current
}
