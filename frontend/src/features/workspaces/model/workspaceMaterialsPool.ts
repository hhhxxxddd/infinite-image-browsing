import type { WorkspaceAsset, WorkspaceRecord } from './workspaceModel.ts'
import type { WorkspaceWork } from './workspaceWorks.ts'
import { createWorkspaceDraftRepository } from './workspaceDraftRepository.ts'

export interface WorkMaterialReference extends WorkspaceAsset {
  drafts: { id: string; name: string }[]
}

/** Carry old work associations into the shared pool without rewriting or discarding them. */
export function collectWorkspaceMaterials(
  workspace: Pick<WorkspaceRecord, 'assets' | 'outputs'>,
  works: WorkspaceWork[],
  created: WorkspaceAsset[]
): WorkspaceAsset[] {
  return [
    ...new Map(
      [
        ...workspace.assets,
        ...workspace.outputs,
        ...works.flatMap((work) => [...work.assets, ...work.outputs]),
        ...created
      ].map((asset) => [asset.path, asset])
    ).values()
  ]
}

/** Usage comes from the saved editor inputs, never from the shared pool or generated files. */
export function collectWorkUsedAssets(
  workspaceId: string,
  work: WorkspaceWork,
  storage: Pick<Storage, 'getItem'>,
  available: WorkspaceAsset[]
): WorkMaterialReference[] {
  const known = new Map(available.map((asset) => [asset.path, asset]))
  const references = new Map<string, WorkMaterialReference>()
  const images = createWorkspaceDraftRepository(workspaceId, {
    getItem: (key) => storage.getItem(key),
    setItem: () => {
      throw new Error('只读引用查询')
    },
    removeItem: () => {
      throw new Error('只读引用查询')
    }
  })
  for (const draft of work.drafts) {
    const paths = new Set<string>()
    if (draft.kind === 'image') {
      for (const layer of images.loadDocument(draft.id)?.layers ?? [])
        if (layer.kind === 'image' && layer.path) paths.add(layer.path)
    } else if (draft.kind === 'ai') {
      const internalInputs = new Set<string>()
      if (draft.source) {
        draft.source.inputPaths.forEach((path) => paths.add(path))
        if (!draft.source.referenceInputs)
          draft.source.referencePaths.forEach((path) => paths.add(path))
        internalInputs.add(draft.source.inputPath)
      }
      const scope = `${workspaceId}:${work.id}:${draft.id}`
      const main = storage.getItem(`omnigallery:ai-image-edit-asset-v1:${scope}`)
      if (
        main &&
        storage.getItem(`omnigallery:ai-image-edit-v1:${scope}:${encodeURIComponent(main)}`)
      ) {
        if (!internalInputs.has(main)) paths.add(main)
        try {
          const refs: unknown = JSON.parse(
            storage.getItem(`omnigallery:ai-image-refs-v1:${scope}:${encodeURIComponent(main)}`) ??
              '[]'
          )
          if (Array.isArray(refs))
            for (const path of refs) {
              const input = draft.source?.referenceInputs?.find((ref) => ref.path === path)
              if (input) paths.add(input.sourcePath)
              if (
                typeof path === 'string' &&
                path &&
                (!draft.source || known.has(path) || !path.startsWith('workspace-artifact:'))
              )
                paths.add(path)
            }
        } catch {
          /* A damaged reference list does not hide the saved main image. */
        }
      }
    }
    for (const path of paths) {
      let reference = references.get(path)
      if (!reference) {
        reference = {
          ...(known.get(path) ?? { path, name: path.split(/[\\/]/).pop() ?? path, kind: 'image' }),
          drafts: []
        }
        references.set(path, reference)
      }
      reference.drafts.push({ id: draft.id, name: draft.name })
    }
  }
  return [...references.values()]
}
