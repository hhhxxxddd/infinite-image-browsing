import {
  createStudioDocument,
  createImageLayer,
  studioLayerVisible,
  studioExportDocument,
  scaleStudioDocument,
  type StudioDocument
} from '../../image-editor/model/imageStudioModel.ts'
import { studioDocumentRevision } from '../../image-editor/model/studioPublication.ts'
import {
  createProductionDraft,
  createWorkspaceWorksRepository,
  type ProductionDraft,
  type ProductionSource
} from './workspaceWorks.ts'

export type AIInputScope = { kind: 'all' } | { kind: 'layer' | 'group'; id: string }
export function inputLayerIds(doc: StudioDocument, scope: AIInputScope): string[] {
  return doc.layers
    .filter(
      (layer) =>
        (layer.kind === 'image' || layer.kind === 'text') &&
        studioLayerVisible(doc, layer) &&
        (scope.kind === 'all' ||
          (scope.kind === 'layer' && layer.id === scope.id) ||
          (scope.kind === 'group' && layer.groupId === scope.id))
    )
    .map((layer) => layer.id)
}
export function inputScopeKey(scope: AIInputScope): string {
  return scope.kind === 'all' ? 'all' : `${scope.kind}:${scope.id}`
}
export function matchingAIBranches(
  drafts: ProductionDraft[],
  documentId: string,
  scope: AIInputScope,
  area: ProductionSource['inputArea']
): ProductionDraft[] {
  return drafts
    .filter(
      (draft) =>
        draft.kind === 'ai' &&
        draft.source?.documentId === documentId &&
        draft.source.scope === inputScopeKey(scope) &&
        draft.source.inputArea === area
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
export function prepareAIInput(
  doc: StudioDocument,
  scope: AIInputScope,
  area: ProductionSource['inputArea'],
  maskIds: string[]
): StudioDocument {
  const ids = new Set(inputLayerIds(doc, scope))
  if (!ids.size) throw new Error('所选范围没有可用的图片或文字图层')
  // The durable input is a plain serialized document, isolated from the active editor state.
  let input = JSON.parse(JSON.stringify(doc)) as StudioDocument
  input.layers = input.layers.filter(
    (layer) =>
      ids.has(layer.id) ||
      (studioLayerVisible(doc, layer) &&
        (layer.kind === 'mask'
          ? maskIds.includes(layer.id)
          : (layer.kind === 'guide' || layer.kind === 'paint') &&
            (scope.kind !== 'group' || layer.groupId === scope.id)))
  )
  input = studioExportDocument(input, area === 'content')
  const ratio = Math.min(1, 2048 / Math.max(input.width, input.height))
  return scaleStudioDocument(
    input,
    Math.max(1, Math.round(input.width * ratio)),
    Math.max(1, Math.round(input.height * ratio))
  )
}
export function createBranchDocument(
  input: StudioDocument,
  path: string,
  name: string
): StudioDocument {
  const doc = createStudioDocument(name)
  doc.width = input.width
  doc.height = input.height
  doc.background = 'transparent'
  const image = createImageLayer(path, { x: 0, y: 0, width: doc.width, height: doc.height }, name)
  image.fit = 'contain'
  doc.layers = [
    image,
    ...structuredClone(
      input.layers.filter((layer) => ['guide', 'paint', 'mask'].includes(layer.kind))
    )
  ]
  // The baked main image no longer needs the original groups. Overlay visibility is preserved.
  doc.layers.forEach((layer) => {
    delete layer.groupId
  })
  return doc
}
export function installAIBranch(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  workspaceId: string,
  workId: string,
  sourceDoc: StudioDocument,
  scope: AIInputScope,
  area: ProductionSource['inputArea'],
  label: string,
  productionId: string,
  inputPath: string,
  input: StudioDocument,
  references: { path: string; originalPath: string; doc: StudioDocument }[]
): ProductionDraft {
  const repo = createWorkspaceWorksRepository(workspaceId, storage)
  const state = repo.load()
  const work = state.works.find((item) => item.id === workId)
  if (!work?.drafts.some((draft) => draft.id === sourceDoc.id && draft.kind === 'image'))
    throw new Error('来源制作文件已删除，请重新打开作品')
  if (work.drafts.length >= 200) throw new Error('制作文件数量已达到上限')
  const base = sourceDoc.name.replace(/\.(png|jpe?g|webp)$/i, '')
  const targetName = label.replace(/\.(png|jpe?g|webp)$/i, '').slice(0, 20)
  const number = work.drafts.filter((draft) => draft.source?.documentId === sourceDoc.id).length + 1
  let name = `${base.slice(0, 38)} · ${targetName} · AI分支${number}`
  while (work.drafts.some((draft) => draft.name === name))
    name = `${base.slice(0, 38)} · ${targetName} · AI分支${number}-${crypto.randomUUID().slice(0, 4)}`
  const draft = createProductionDraft('ai', name, productionId)
  const layerIds = inputLayerIds(sourceDoc, scope)
  draft.source = {
    documentId: sourceDoc.id,
    revision: studioDocumentRevision(sourceDoc),
    scope: inputScopeKey(scope),
    label,
    inputArea: area,
    layerIds,
    inputPaths: [
      ...new Set(
        sourceDoc.layers.flatMap((layer) =>
          layer.kind === 'image' && layerIds.includes(layer.id) ? [layer.path] : []
        )
      )
    ],
    referencePaths: references.map((ref) => ref.originalPath),
    referenceInputs: references.map((ref) => ({ path: ref.path, sourcePath: ref.originalPath })),
    inputPath
  }
  const session = `${workspaceId}:${workId}:${productionId}`
  const main = createBranchDocument(input, inputPath, name)
  storage.setItem(`omnigallery:ai-image-edit-asset-v1:${session}`, inputPath)
  storage.setItem(
    `omnigallery:ai-image-edit-v1:${session}:${encodeURIComponent(inputPath)}`,
    JSON.stringify(main)
  )
  storage.setItem(
    `omnigallery:ai-image-refs-v1:${session}:${encodeURIComponent(inputPath)}`,
    JSON.stringify(references.map((ref) => ref.path))
  )
  for (const reference of references)
    storage.setItem(
      `omnigallery:ai-image-ref-v1:${session}:${encodeURIComponent(inputPath)}:${encodeURIComponent(reference.path)}`,
      JSON.stringify(reference.doc)
    )
  work.drafts.push(draft)
  work.updatedAt = draft.updatedAt
  repo.save(state)
  return draft
}
