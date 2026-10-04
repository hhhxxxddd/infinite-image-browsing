import type { StudioDocument } from './imageStudioModel.ts'

export const imageProcessingLabels = {
  erase: '正在消除…',
  upscale: '正在高清化…',
  cutout: '正在抠图…'
} as const

/** Ancestor frames/groups must not resize, hide or detach a processing image. */
export function processingProtectedIds(doc: StudioDocument, processingIds: readonly string[]) {
  const ids = new Set(processingIds)
  for (const id of processingIds) {
    const layer = doc.layers.find((item) => item.id === id)
    if (layer?.frameId) ids.add(layer.frameId)
  }
  return ids
}

export function processingChangeAllowed(
  before: StudioDocument,
  after: StudioDocument,
  processingIds: readonly string[]
): boolean {
  const ids = processingProtectedIds(before, processingIds)
  const nonPosition = (value: object) =>
    JSON.stringify(
      Object.entries(value)
        .filter(([key]) => !['x', 'y'].includes(key))
        .sort(([a], [b]) => a.localeCompare(b))
    )
  for (const id of ids) {
    const layer = before.layers.find((item) => item.id === id)
    if (!layer) continue
    const next = after.layers.find((item) => item.id === id)
    if (!next || nonPosition(layer) !== nonPosition(next)) return false
    if (layer.groupId) {
      const group = before.groups.find((item) => item.id === layer.groupId)
      const nextGroup = after.groups.find((item) => item.id === layer.groupId)
      if (
        group &&
        (!nextGroup ||
          ['name', 'visible', 'locked'].some(
            (key) => group[key as keyof typeof group] !== nextGroup[key as keyof typeof nextGroup]
          ))
      )
        return false
    }
  }
  return true
}
