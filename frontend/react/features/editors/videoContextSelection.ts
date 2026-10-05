import { clipLocked, linkedSelection, type VideoTimelineDocument } from './videoStudioModel.ts'

/** A context menu targets the whole current selection when the hit item is already selected. */
export function contextVideoSelection(
  document: VideoTimelineDocument,
  selectedIds: readonly string[],
  hitId: string
) {
  return linkedSelection(document, selectedIds.includes(hitId) ? [...selectedIds] : [hitId])
}

export function videoSelectionLocked(document: VideoTimelineDocument, ids: readonly string[]) {
  const selected = new Set(linkedSelection(document, ids))
  return (
    document.visuals.some(
      (clip) => selected.has(clip.id) && clipLocked(document, clip, 'visual')
    ) ||
    document.sounds.some((clip) => selected.has(clip.id) && clipLocked(document, clip, 'sound'))
  )
}
