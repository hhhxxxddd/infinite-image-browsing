import { sha256Hex } from '../../../shared/lib/sha256.ts'
import type { StudioDocument } from './imageStudioModel.ts'

/** Autosave timestamps and object key order must not invalidate an exported version. */
export function studioDocumentRevision(document: StudioDocument): string {
  const { id, name, width, height, background, backgroundView, groups, layers } = document
  return sha256Hex(
    JSON.stringify(
      { id, name, width, height, background, backgroundView, groups, layers },
      (_key, value) =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
          : value
    )
  )
}
