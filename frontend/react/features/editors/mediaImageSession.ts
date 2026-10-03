import type { FileNodeInfo } from '../../../src/shared/types/fileNode'

/** A copy has its own snapshot owner; the current document still edits the original. */
export function mergeSavedMediaAssets(
  assets: Record<string, FileNodeInfo>,
  file: FileNodeInfo,
  snapshots: Record<string, FileNodeInfo>,
  overwrite: boolean
): void {
  if (overwrite) Object.assign(assets, snapshots)
  assets[file.fullpath] = file
}
