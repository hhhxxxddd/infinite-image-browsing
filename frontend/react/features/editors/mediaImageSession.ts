import type { FileNodeInfo } from '../../../src/shared/types/fileNode'
import type { StudioDocument } from '../../../src/features/image-editor/model/imageStudioModel'

export function remapRenamedMediaDocument(
  document: StudioDocument,
  source: string,
  file: FileNodeInfo
): StudioDocument {
  return {
    ...document,
    name: file.name.replace(/\.[^.]+$/, ''),
    layers: document.layers.map((layer) =>
      layer.kind === 'image' && layer.path === source
        ? {
            ...layer,
            path: file.fullpath,
            taskSource: {
              path: file.fullpath,
              revisionPath:
                layer.taskSource?.path === source ? layer.taskSource.revisionPath : source
            },
            name: layer.name === source.split(/[\\/]/).pop() ? file.name : layer.name
          }
        : layer
    )
  }
}

export function remapRenamedMediaAssets(
  assets: Record<string, FileNodeInfo>,
  source: string,
  file: FileNodeInfo
) {
  for (const [path, asset] of Object.entries(assets)) {
    if (asset.edit_snapshot?.owner === source)
      assets[path] = { ...asset, edit_snapshot: { ...asset.edit_snapshot, owner: file.fullpath } }
  }
  delete assets[source]
  assets[file.fullpath] = file
}

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
